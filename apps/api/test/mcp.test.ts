// MCP endpoint (decision 0023, phase 1): personal access tokens, the read-only tools, roles, and both
// protocol eras (2025 clients and 2026-07-28), through the official MCP client over real HTTP.

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { uuidv7 } from '@9eye/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { newAccessToken } from '../src/mcp/auth';
import { ALL, auth, block, makeCatalog, makeCompany, min, resetDb, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
let server: Server;
let url: URL;

const SAT = '2030-06-01'; // the fixture channel's week starts on Saturday
const TOOLS = ['check_day', 'get_campaign', 'get_channel', 'get_day_playlist', 'get_deal', 'get_layout', 'get_plan', 'get_rotation_lists', 'get_title', 'list_categories', 'list_channels', 'list_clients', 'list_deals', 'list_plans', 'list_weeks', 'search_media'];

let a: Fixture;
let b: Fixture;
let cat: CatalogFixture;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await platformDb.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
  cat = await makeCatalog(a);
});

async function person(email: string, platformAdmin = false) {
  return platformDb.user.create({ data: { id: uuidv7(), email, name: email.split('@')[0], platformAdmin } });
}

/** A member of the company with a role of these grants ("module:action"); channels: null = all. */
async function member(f: Fixture, email: string, grants: string[], channelIds: string[] | null = null, status = 'active') {
  const user = await person(email);
  const role = await platformDb.role.create({
    data: {
      id: uuidv7(), tenantId: f.tenantId, name: `Role of ${email}`, allChannels: channelIds === null,
      grants: { create: grants.map((g) => ({ id: uuidv7(), module: g.split(':')[0], action: g.split(':')[1] })) },
      scopes: { create: (channelIds ?? []).map((channelId) => ({ id: uuidv7(), channelId })) },
    },
  });
  await platformDb.membership.create({ data: { id: uuidv7(), tenantId: f.tenantId, userId: user.id, roleId: role.id, status } });
  return user;
}

async function tokenFor(userId: string, f: Fixture, more: { expiresAt?: Date; revokedAt?: Date } = {}) {
  const { token, hash } = newAccessToken();
  await platformDb.accessToken.create({
    data: { id: uuidv7(), userId, tenantId: f.tenantId, name: 'test', tokenHash: hash, expiresAt: more.expiresAt ?? new Date(Date.now() + 86_400_000), revokedAt: more.revokedAt },
  });
  return token;
}

const adminToken = async (f: Fixture) => tokenFor((await person(`admin-${f.slug}@test.example`, true)).id, f);

/** The main layout: on Saturdays Run Block 1 06:00 with the breaks Billboard 1 06:00 and Ad Pod 06:30, then Half Block 07:00. */
async function saturdayLayout(f: Fixture) {
  const blocks = [block(6, f.types.run1, 0, 60, [f.breaks['Billboard 1 06'], f.breaks['AB 06']]), block(6, f.types.half, 60, 30)];
  await request(app).put(`/api/templates/${f.mainTemplateId}`).set(auth(f.slug)).send({ version: 1, name: 'MAIN', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL, blocks }).expect(200);
}

type Era = 'legacy' | { pin: string };

async function connect(token: string, mode: Era = 'legacy') {
  const client = new Client({ name: '9eye-test', version: '1.0.0' }, { versionNegotiation: { mode } });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: { token: async () => token } }));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as { type: string; text: string }[];
  return { text: content.map((c) => c.text).join('\n'), isError: !!r.isError };
}

const post = (headers: Record<string, string> = {}) =>
  request(app).post('/api/mcp').set({ Accept: 'application/json, text/event-stream', ...headers }).send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

describe('access tokens', () => {
  it('refuses requests without a token, or with an unknown, expired or revoked one', async () => {
    const r = await post().expect(401);
    expect(r.headers['www-authenticate']).toContain('Bearer');
    await post({ Authorization: 'Bearer 9eye_pat_nope' }).expect(401);
    const user = await person('p@test.example', true);
    await post({ Authorization: `Bearer ${await tokenFor(user.id, a, { expiresAt: new Date(Date.now() - 1000) })}` }).expect(401);
    await post({ Authorization: `Bearer ${await tokenFor(user.id, a, { revokedAt: new Date() })}` }).expect(401);
    // The session cookie of the web app does not open the MCP endpoint.
    await post(auth(a.slug)).expect(401);
  });

  it('refuses a person who is no longer an active member of the company', async () => {
    const user = await member(a, 'gone@test.example', ['playlist:view'], null, 'invited');
    await post({ Authorization: `Bearer ${await tokenFor(user.id, a)}` }).expect(403);
  });

  it('keeps only the hash and notes when the token was last used', async () => {
    const user = await person('p@test.example', true);
    const token = await tokenFor(user.id, a);
    expect(await platformDb.accessToken.count({ where: { tokenHash: token } })).toBe(0);
    const c = await connect(token);
    await c.listTools();
    await c.close();
    const row = await platformDb.accessToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.lastUsedAt).not.toBeNull();
  });
});

describe('tools', () => {
  it.each<[string, Era]>([
    ['2025 clients', 'legacy'],
    ['2026-07-28 clients', { pin: '2026-07-28' }],
  ])('lists sixteen read-only tools to %s', async (_, era) => {
    const c = await connect(await adminToken(a), era);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(c.getInstructions()).toContain('read only');
    expect((await call(c, 'list_channels')).text).toContain('AURORA TV');
    await c.close();
  });

  it('list_channels shows only the channels of the token’s company', async () => {
    const c = await connect(await adminToken(a));
    const r = await call(c, 'list_channels');
    expect(r.text).toContain('AURORA TV · code AURORA');
    expect(r.text).not.toContain('OTHER TV');
    const other = await call(c, 'get_day_playlist', { channel: b.channelId, date: SAT });
    expect(other).toMatchObject({ isError: true });
    expect(other.text).toContain('No channel');
    await c.close();
  });

  it('get_day_playlist and check_day read a day, rows with media not ready included', async () => {
    await saturdayLayout(a);
    await request(app).post(`/api/channels/${a.channelId}/weeks`).set(auth(a.slug)).send({ kinds: ['main', 'ads'], fromWeek: SAT, toWeek: SAT }).expect(201);
    const first = await platformDb.playlistBlock.findFirstOrThrow({ where: { day: { date: new Date(`${SAT}T00:00:00Z`), playlist: { kind: 'main' } } }, orderBy: { startFrames: 'asc' } });
    await platformDb.production.update({ where: { id: cat.harborEps[1] }, data: { mediaStatus: 'not-ready' } });
    await platformDb.playlistEvent.create({ data: { id: uuidv7(), blockId: first.id, sequence: 50, kind: 'program', title: 'Harbor Nights - 2', lengthFrames: min(25), productionId: cat.harborEps[1] } });

    const c = await connect(await adminToken(a));
    const day = await call(c, 'get_day_playlist', { channel: 'aurora tv', date: SAT });
    expect(day.isError).toBe(false);
    expect(day.text).toContain('AURORA TV · Main playlist · Saturday 2030-06-01 · Draft');
    expect(day.text).toContain('06:00:00:00  Run Block 1');
    expect(day.text).toMatch(/00:25:00:00 {2}Programme · Harbor Nights - 2 · ep 2 · MEDIA NOT READY/);
    expect(day.text).toContain('Break · Billboard 1 06:00');

    const short = await call(c, 'get_day_playlist', { channel: 'AURORA', date: SAT, rows: false });
    expect(short.text).toContain('Run Block 1');
    expect(short.text).not.toContain('Harbor Nights - 2');

    const check = await call(c, 'check_day', { channel: 'AURORA', date: SAT });
    expect(check.text).toContain('Issues:');
    expect(check.text).toMatch(/Rows whose media is not ready:\n- \d{2}:\d{2}:\d{2}:\d{2} Harbor Nights - 2 \(ep 2\)/);

    const none = await call(c, 'check_day', { channel: 'AURORA', date: '2030-06-08' });
    expect(none.text).toContain('No day playlist yet: the week of this day has not been created');
    await c.close();
  });

  it('search_media finds titles and items with length, episode and media state', async () => {
    const c = await connect(await adminToken(a));
    const r = await call(c, 'search_media', { query: 'harbor' });
    expect(r.text).toContain('"Harbor Nights" · category "TV Series Drama"');
    expect(r.text).toContain('"Harbor Nights - 1" · code HAR-1 · ep 1 · 00:45:00:00 · media ready');
    expect(r.text).not.toContain('[TEMPLATE]');
    const ads = await call(c, 'search_media', { query: 'harbor', kind: 'ads' });
    expect(ads.text).toContain('Items (0)');
    await c.close();
  });

  it('list_deals, get_deal and get_campaign read deals and their campaigns', async () => {
    await saturdayLayout(a);
    const as =(path: string, body: object) => request(app).post(`/api${path}`).set(auth(a.slug)).send(body);
    const client = (await as('/commercials/clients', { name: 'Clearwater Films', type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null }).expect(201)).body.id;
    const deal = (await as('/commercials/contracts', { clientId: client, name: 'Clearwater · Jun 2030', startDate: '2030-06-01', endDate: '2030-06-30', currency: 'USD', totalAgreed: 12000, notes: 'Prime time only', channelIds: [a.channelId] }).expect(201)).body.id;
    const { ids } = (await as(`/commercials/contracts/${deal}/orders`, { channelIds: [a.channelId], startDate: '2030-06-01' }).expect(201)).body;

    const c = await connect(await adminToken(a));
    const list = await call(c, 'list_deals', { query: 'clearwater' });
    expect(list.text).toContain('"Clearwater · Jun 2030" · client "Clearwater Films" · 2030-06-01 → 2030-06-30 · 1 campaign');
    expect((await call(c, 'list_deals', { on: '2031-01-01' })).text).toContain('0 deals');

    const one = await call(c, 'get_deal', { deal: 'clearwater · jun 2030' });
    expect(one.text).toContain('deal value 12,000 USD');
    expect(one.text).toContain('Notes: Prime time only');
    expect(one.text).toContain(`id ${ids[0]}`);

    const campaign = await call(c, 'get_campaign', { campaign: ids[0] });
    expect(campaign.isError).toBe(false);
    expect(campaign.text).toContain('Deal "Clearwater · Jun 2030" · client "Clearwater Films"');
    expect(campaign.text).toContain('Draft · 2030-06-01 → 2030-06-30 · channel AURORA TV · layout "MAIN"');
    expect(campaign.text).toMatch(/Breaks it can book into \(2\):\n- 06:00:00:00 Billboard 1 06:00 · Sat\n- \d{2}:\d{2}:\d{2}:\d{2} Ad Pod 06:30 · Sat/);
    await c.close();
  });

  it('every tool call goes to the audit log, failures included', async () => {
    const user = await person('ai@test.example', true);
    const c = await connect(await tokenFor(user.id, a));
    await call(c, 'list_channels');
    await call(c, 'get_day_playlist', { channel: 'nope' });
    await c.close();
    const tok = await platformDb.accessToken.findFirstOrThrow({ where: { userId: user.id } });
    const rows = await platformDb.auditEvent.findMany({ where: { tenantId: a.tenantId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((e) => [e.action, e.via, e.ok, e.userId, e.tokenId])).toEqual([
      ['tool list_channels', 'mcp', true, user.id, tok.id],
      ['tool get_day_playlist', 'mcp', false, user.id, tok.id],
    ]);
    expect(rows[1].message).toContain('No channel "nope"');
    expect(rows[1].input).toMatchObject({ channel: 'nope', playlist: 'main' });
  });

  it('list_plans answers for a channel without plans', async () => {
    const c = await connect(await adminToken(a));
    expect((await call(c, 'list_plans', { channel: 'AURORA' })).text).toContain('AURORA TV · 0 plans');
    await c.close();
  });
});

describe('roles', () => {
  it('a tool needs its module in the person’s role', async () => {
    const user = await member(a, 'media@test.example', ['catalog:view']);
    const c = await connect(await tokenFor(user.id, a));
    const day = await call(c, 'get_day_playlist', { channel: 'AURORA', date: SAT });
    expect(day).toEqual({ isError: true, text: 'Your role does not let you view Playlist.' });
    expect((await call(c, 'list_deals')).text).toBe('Your role does not let you view Plans and campaigns.');
    expect((await call(c, 'search_media', { query: 'harbor' })).isError).toBe(false);
    await c.close();
  });

  it('a role for selected channels only sees those channels', async () => {
    const user = await member(a, 'none@test.example', ['playlist:view'], []);
    const c = await connect(await tokenFor(user.id, a));
    expect((await call(c, 'list_channels')).text).toBe('You cannot open any channel in this company.');
    expect((await call(c, 'get_day_playlist', { channel: 'AURORA' })).text).toContain('No channel "AURORA"');
    await c.close();
  });
});
