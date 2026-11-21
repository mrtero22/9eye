// MCP write tools (decision 0023, phase 3): offered only to --edit tokens, the role still decides,
// preview first, apply with the version, every applied change in the audit log, and undo_change.

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { uuidv7 } from '@9eye/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { newAccessToken } from '../src/mcp/auth';
import { ALL, auth, block, makeCatalog, makeCompany, resetDb, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
let server: Server;
let url: URL;
let a: Fixture;
let cat: CatalogFixture;

const SAT = '2030-06-01'; // the fixture channel's week starts on Saturday
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

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

const get = (u: string) => request(app).get(`/api${u}`).set(auth(a.slug));
const post = (u: string, body: object) => request(app).post(`/api${u}`).set(auth(a.slug)).send(body);
const put = (u: string, body: object) => request(app).put(`/api${u}`).set(auth(a.slug)).send(body);

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  cat = await makeCatalog(a);
  // The company lets AI apps change drafts (Settings › AI access; the default is read only).
  await platformDb.tenant.update({ where: { id: a.tenantId }, data: { aiAccess: 'edit' } });
  // Saturdays: Run Block 1 06:00 with the breaks Billboard 1 06:00 and Ad Pod 06:30, then Half Block 07:00
  const blocks = [block(6, a.types.run1, 0, 60, [a.breaks['Billboard 1 06'], a.breaks['AB 06']]), block(6, a.types.half, 60, 30)];
  await put(`/templates/${a.mainTemplateId}`, { version: 1, name: 'MAIN', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL, blocks }).expect(200);
});

async function tokenFor(userId: string, access: 'read' | 'edit' = 'edit') {
  const { token, hash } = newAccessToken();
  await platformDb.accessToken.create({ data: { id: uuidv7(), userId, tenantId: a.tenantId, name: 'test', tokenHash: hash, expiresAt: new Date(Date.now() + 86_400_000), access } });
  return token;
}

async function admin(access: 'read' | 'edit' = 'edit') {
  const user = await platformDb.user.create({ data: { id: uuidv7(), email: `${uuidv7()}@test.example`, name: 'Admin', platformAdmin: true } });
  return connect(await tokenFor(user.id, access));
}

async function connect(token: string) {
  const client = new Client({ name: '9eye-test', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: { token: async () => token } }));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  return { text: (r.content as { text: string }[]).map((c) => c.text).join('\n'), isError: !!r.isError };
}

const changeOf = (text: string) => /Change id ([0-9a-f-]{36})/.exec(text)?.[1] ?? '';
const weeks = () => platformDb.week.count({ where: { playlist: { channelId: a.channelId } } });

/** A confirmed campaign of the two first idents, with no bookings yet. */
async function campaign(status: 'confirmed' | 'draft' = 'confirmed') {
  const empty = { type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null };
  const { id: clientId } = (await post('/commercials/clients', { name: 'Clearwater', ...empty }).expect(201)).body;
  const { id: dealId } = (await post('/commercials/contracts', { clientId, name: 'Clearwater', startDate: '2030-05-25', endDate: '2030-06-30', currency: 'USD', totalAgreed: 0, notes: '', channelIds: [a.channelId] }).expect(201)).body;
  const { ids } = (await post(`/commercials/contracts/${dealId}/orders`, { channelIds: [a.channelId], startDate: '2030-05-25' }).expect(201)).body;
  const o = (await get(`/commercials/orders/${ids[0]}`).expect(200)).body;
  await put(`/commercials/orders/${ids[0]}`, { version: o.version, name: o.name, status, startDate: o.startDate, endDate: o.endDate, items: [{ id: null, productionId: cat.identItems[0] }, { id: null, productionId: cat.identItems[1] }] }).expect(200);
  return ids[0] as string;
}

const version = async (id: string) => (await get(`/commercials/orders/${id}`).expect(200)).body.version as number;
const booked = (id: string) => platformDb.airingItem.count({ where: { airing: { orderId: id } } });

describe('who gets the write tools', () => {
  it('a read token has none; an edit token has them, and the role still decides each call', async () => {
    const read = await admin('read');
    expect((await read.listTools()).tools.map((t) => t.name)).not.toContain('fill_day');
    await read.close();

    const edit = await admin('edit');
    const { tools } = await edit.listTools();
    const writes = tools.filter((t) => ['create_weeks', 'fill_day', 'book_campaign_spots', 'undo_change'].includes(t.name));
    expect(writes).toHaveLength(4);
    for (const t of writes) expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(edit.getInstructions()).toContain('apply: false first');
    expect(edit.getInstructions()).toContain('follow the table too (Playlist › Approve, Playlist › Export)');
    await edit.close();

    const user = await platformDb.user.create({ data: { id: uuidv7(), email: 'viewer@test.example', name: 'Viewer' } });
    const role = await platformDb.role.create({
      data: { id: uuidv7(), tenantId: a.tenantId, name: 'Viewer', allChannels: true, grants: { create: [{ id: uuidv7(), module: 'playlist', action: 'view' }] } },
    });
    await platformDb.membership.create({ data: { id: uuidv7(), tenantId: a.tenantId, userId: user.id, roleId: role.id, status: 'active' } });
    const viewer = await connect(await tokenFor(user.id, 'edit'));
    expect(await call(viewer, 'create_weeks', { channel: 'AURORA', from_week: SAT })).toEqual({ isError: true, text: 'Your role does not let you change Playlist.' });
    await viewer.close();
  });
});

describe('create_weeks', () => {
  it('previews, creates all or nothing, and undo deletes what it made', async () => {
    const c = await admin();
    const preview = await call(c, 'create_weeks', { channel: 'AURORA', from_week: SAT });
    expect(preview.text).toContain('AURORA TV · 2 weeks to create (preview — nothing is created)');
    expect(preview.text).toMatch(/main playlist · 2030-06-01 → 2030-06-07 · layout "MAIN"/);
    expect(await weeks()).toBe(0);

    const monday = await call(c, 'create_weeks', { channel: 'AURORA', from_week: '2030-06-03', apply: true });
    expect(monday.isError).toBe(true);
    expect(monday.text).toContain('A week starts on a Saturday');
    expect(await weeks()).toBe(0);

    const made = await call(c, 'create_weeks', { channel: 'AURORA', from_week: SAT, apply: true });
    expect(made.text).toContain('2 weeks created. Change id');
    expect(await weeks()).toBe(2);
    const change = changeOf(made.text);
    const e = await platformDb.auditEvent.findUniqueOrThrow({ where: { id: change } });
    expect(e).toMatchObject({ action: 'tool create_weeks', via: 'mcp', ok: true, channelIds: [a.channelId] });
    expect((e.after as { weekIds: string[] }).weekIds).toHaveLength(2);

    expect((await call(c, 'undo_change', { change })).text).toBe(`Deleted 2 weeks that change ${change} made.`);
    expect(await weeks()).toBe(0);
    expect((await call(c, 'undo_change', { change })).text).toMatch(/^That change was undone already \(change [0-9a-f-]{36}\)\.$/);
    await c.close();
  });
});

describe('fill_day', () => {
  const args = { channel: 'AURORA', date: SAT, playlist: 'ads', step: 'campaigns' };
  const spots = () => platformDb.playlistEvent.count({ where: { airingItemId: { not: null } } });

  /** Saturday's weeks, and a confirmed campaign with ident 1 booked in Billboard 1 06:00 and ident 2 in Ad Pod 06:30. */
  async function bookedSaturday() {
    await post(`/channels/${a.channelId}/weeks`, { kinds: ['main', 'ads'], fromWeek: SAT, toWeek: SAT }).expect(201);
    const id = await campaign();
    const items = (await get(`/commercials/orders/${id}`).expect(200)).body.items.map((i: { id: string }) => i.id);
    const at = (breakTypeId: string, orderItemId: string) => ({ date: SAT, blockTypeId: a.types.run1, breakTypeId, orderItemId, positionId: null, passes: 1 });
    await put(`/commercials/orders/${id}/week`, { version: await version(id), from: '2030-05-25', to: SAT, bookings: [at(a.breaks['Billboard 1 06'], items[0]), at(a.breaks['AB 06'], items[1])] }).expect(200);
  }

  it('previews, saves only the version it previewed, and undo puts the day back', async () => {
    await bookedSaturday();
    const c = await admin();
    const preview = await call(c, 'fill_day', args);
    expect(preview.text).toMatch(/^AURORA TV · Ads playlist · Saturday 2030-06-01 · Draft · version (\d+) — preview, nothing is saved\nCampaigns: 2 placed/);
    expect(preview.text).toContain('- Billboard 1 06:00 · LumenPlus_Ident_1');
    expect(await spots()).toBe(0);
    const dayVersion = Number(/version (\d+)/.exec(preview.text)![1]);

    expect((await call(c, 'fill_day', { ...args, apply: true })).text).toBe('Apply needs the version the preview showed.');
    expect((await call(c, 'fill_day', { ...args, apply: true, version: dayVersion + 1 })).text).toContain('The day changed since the preview');

    const saved = await call(c, 'fill_day', { ...args, apply: true, version: dayVersion });
    expect(saved.text).toContain(`saved as version ${dayVersion + 1}. Change id`);
    expect(await spots()).toBe(2);
    const change = changeOf(saved.text);
    const e = await platformDb.auditEvent.findUniqueOrThrow({ where: { id: change } });
    expect(e.before).toMatchObject({ version: dayVersion });

    const undone = await call(c, 'undo_change', { change });
    expect(undone.text).toContain(`is back as it was before change ${change}`);
    expect(await spots()).toBe(0);

    // An approved day is a person's to reopen: no tool changes it.
    const day = (await get(`/channels/${a.channelId}/days/${SAT}?kind=ads`).expect(200)).body.day;
    await post(`/days/${day.id}/publish`, { version: day.version }).expect(200);
    const refused = await call(c, 'fill_day', args);
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain('approved');
    await c.close();
  });

  it('undo refuses when a person saved the day after the change; a step with nothing to do saves nothing', async () => {
    await bookedSaturday();
    const c = await admin();
    const preview = await call(c, 'fill_day', args);
    const dayVersion = Number(/version (\d+)/.exec(preview.text)![1]);
    const change = changeOf((await call(c, 'fill_day', { ...args, apply: true, version: dayVersion })).text);
    expect(await spots()).toBe(2);

    // a person saves the day again as it is
    const keys = ['id', 'kind', 'title', 'lengthFrames', 'productionId', 'segmentId', 'tcInFrames', 'tcOutFrames', 'fixed', 'hold', 'autoAdjust', 'note', 'breakTypeId', 'relatedEventId', 'orderId', 'rotationListId', 'airingItemId'];
    const day = (await get(`/channels/${a.channelId}/days/${SAT}?kind=ads`).expect(200)).body.day;
    const blocks = day.blocks.map((b: { id: string; events: Record<string, unknown>[] }) => ({
      id: b.id, rows: b.events.map((e) => ({ ...Object.fromEntries(keys.map((k) => [k, e[k]])), lengthFrames: e.kind === 'linked-break' ? 0 : e.lengthFrames })),
    }));
    await put(`/days/${day.id}`, { version: day.version, blocks }).expect(200);

    const refused = await call(c, 'undo_change', { change });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('The day changed after that change, so undo would overwrite newer work: nothing was changed.');
    expect(await spots()).toBe(2);

    const again = await call(c, 'fill_day', args);
    expect(again.text).toContain('Campaigns: 0 placed');
    expect(again.text).toContain('Nothing would change.');
    await c.close();
  });
});

describe('book_campaign_spots', () => {
  it('previews, books with the version, and undo puts the bookings back', async () => {
    const id = await campaign();
    const c = await admin();
    const one = { campaign: id, from: SAT, to: SAT, break_name_contains: 'billboard 1' };
    const preview = await call(c, 'book_campaign_spots', one);
    expect(preview.text).toContain('Breaks: 1 (06:00:00:00 Billboard 1 06:00)');
    expect(preview.text).toContain('1 spot to book');
    expect(await booked(id)).toBe(0);

    const between = await call(c, 'book_campaign_spots', { campaign: id, from: SAT, to: SAT, between: { from: '06:05', to: '06:20' } });
    expect(between.text).toMatch(/Breaks: 1 \(\d{2}:\d{2}:\d{2}:\d{2} Ad Pod 06:30\)/);
    expect((await call(c, 'book_campaign_spots', { campaign: id, ads: ['V9'] })).text).toContain('No ad "V9"');
    expect((await call(c, 'book_campaign_spots', { campaign: id, from: '2030-05-01', to: '2030-07-15' })).text).toContain('Book at most 62 days at a time');
    expect((await call(c, 'book_campaign_spots', { ...one, apply: true })).text).toContain('Apply needs the campaign version');

    const v = await version(id);
    const done = await call(c, 'book_campaign_spots', { ...one, apply: true, version: v });
    expect(done.text).toContain('1 spot booked');
    expect(done.text).toMatch(UUID);
    expect(await booked(id)).toBe(1);
    expect((await call(c, 'book_campaign_spots', { ...one, apply: true, version: v })).text).toContain('The campaign changed');

    const undone = await call(c, 'undo_change', { change: changeOf(done.text) });
    expect(undone.text).toContain('are back as they were before change');
    expect(await booked(id)).toBe(0);
    await c.close();
  });

  it('undo refuses when the campaign changed after the change', async () => {
    const id = await campaign();
    const c = await admin();
    const done = await call(c, 'book_campaign_spots', { campaign: id, from: SAT, to: SAT, apply: true, version: await version(id) });
    expect(await booked(id)).toBe(2);
    const o = (await get(`/commercials/orders/${id}`).expect(200)).body;
    await put(`/commercials/orders/${id}`, { version: o.version, name: `${o.name} (renamed)`, status: o.status, startDate: o.startDate, endDate: o.endDate, items: o.items.map((i: { id: string; productionId: string }) => ({ id: i.id, productionId: i.productionId })) }).expect(200);
    const refused = await call(c, 'undo_change', { change: changeOf(done.text) });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('undo would overwrite newer work: nothing was changed');
    expect(await booked(id)).toBe(2);
    await c.close();
  });
});
