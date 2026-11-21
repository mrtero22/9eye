// Roles on the REST routes and the audit log (decision 0023, phase 2; roles of decision 0007).

import { uuidv7 } from '@9eye/core';
import { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { SESSION_COOKIE, createSession } from '../src/auth';
import { platformDb } from '../src/db';
import { guarded } from '../src/rules';
import { auth, makeEmptyChannel, makeCompany, resetDb, type Fixture } from './fixtures';

const app = createApp();
let a: Fixture;
let b: Fixture;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
});

afterAll(async () => {
  await platformDb.$disconnect();
});

/** A signed-in member of the company whose role has these grants ("module:action"); channels: null = all. */
async function member(f: Fixture, grants: string[], channelIds: string[] | null = null) {
  const email = `${uuidv7()}@test.example`;
  const user = await platformDb.user.create({ data: { id: uuidv7(), email, name: 'Member' } });
  const role = await platformDb.role.create({
    data: {
      id: uuidv7(), tenantId: f.tenantId, name: `Role ${email}`, allChannels: channelIds === null,
      grants: { create: grants.map((g) => ({ id: uuidv7(), module: g.split(':')[0], action: g.split(':')[1] })) },
      scopes: { create: (channelIds ?? []).map((channelId) => ({ id: uuidv7(), channelId })) },
    },
  });
  await platformDb.membership.create({ data: { id: uuidv7(), tenantId: f.tenantId, userId: user.id, roleId: role.id, status: 'active' } });
  const { token } = await createSession(user.id);
  const headers = { 'X-Tenant': f.slug, Cookie: `${SESSION_COOKIE}=${token}` };
  return {
    user,
    get: (url: string) => request(app).get(`/api${url}`).set(headers),
    post: (url: string, body: object) => request(app).post(`/api${url}`).set(headers).send(body),
    put: (url: string, body: object) => request(app).put(`/api${url}`).set(headers).send(body),
  };
}

const admin = (f: Fixture) => ({
  get: (url: string) => request(app).get(`/api${url}`).set(auth(f.slug)),
  post: (url: string, body: object) => request(app).post(`/api${url}`).set(auth(f.slug)).send(body),
});

/** Audit events are written just after the answer: wait for them. */
async function events(f: Fixture, count: number) {
  for (let i = 0; i < 50; i++) {
    const rows = await platformDb.auditEvent.findMany({ where: { tenantId: f.tenantId }, orderBy: { createdAt: 'asc' } });
    if (rows.length >= count) return rows;
    await new Promise((r) => setTimeout(r, 40));
  }
  return platformDb.auditEvent.findMany({ where: { tenantId: f.tenantId }, orderBy: { createdAt: 'asc' } });
}

const DAY = '2030-06-01';

describe('route rules', () => {
  it('every route of a company needs a rule, and every rule a route', () => {
    const g = guarded(Router());
    expect(() => g.get('/no-such-route', (_req, res) => res.end())).toThrow('No access rule for GET /no-such-route');
    expect(() => g.done()).toThrow('Access rules for routes that do not exist');
  });

  it('a route needs its module and action in the role', async () => {
    const viewer = await member(a, ['playlist:view', 'templates:view']);
    await viewer.get(`/channels/${a.channelId}/days/${DAY}?kind=main`).expect(200);
    const save = await viewer.put(`/days/${uuidv7()}`, { version: 1, blocks: [] }).expect(403);
    expect(save.body.error).toBe('Your role does not let you change Playlist.');
    expect((await viewer.post(`/days/${uuidv7()}/publish`, { version: 1 }).expect(403)).body.error).toBe('Your role does not let you approve Playlist.');
    expect((await viewer.get('/commercials/contracts').expect(403)).body.error).toBe('Your role does not let you view Plans and campaigns.');
    expect((await viewer.get('/admin/users').expect(403)).body.error).toBe('Your role does not let you view Settings.');
    // The shared Media picker opens for anyone who places media.
    await viewer.get('/catalog/search?q=x').expect(200);
    expect((await viewer.get('/catalog/lookups').expect(403)).body.error).toBe('Your role does not let you view Media.');
  });

  it('a role for selected channels reaches only those, also through layouts and lists', async () => {
    const second = await makeEmptyChannel(a, 'Second');
    const m = await member(a, ['playlist:view', 'templates:view', 'templates:edit'], [second]);
    expect((await m.get('/channels').expect(200)).body.map((c: { id: string }) => c.id)).toEqual([second]);
    expect((await m.get(`/channels/${a.channelId}/days/${DAY}?kind=main`).expect(403)).body.error).toBe('Your role does not let you view Playlist on this channel.');
    await m.get(`/channels/${second}/days/${DAY}?kind=main`).expect(200);
    // The layout belongs to the first channel: found through the layout, not the address.
    expect((await m.get(`/templates/${a.mainTemplateId}`).expect(403)).body.error).toBe('Your role does not let you view Layouts on this channel.');
    const types = (await m.get('/block-types').expect(200)).body as { channelId: string }[];
    expect(types.length).toBe(0);
    expect((await admin(a).get('/block-types').expect(200)).body.length).toBeGreaterThan(0);
    // An id of another company is simply not found.
    await m.get(`/templates/${b.mainTemplateId}`).expect(404);
  });

  it('platform admins may do everything; a company list shows only one’s own companies', async () => {
    const settings = await member(a, ['admin:view', 'admin:edit']);
    const list = (await settings.get('/admin/companies').expect(200)).body as { slug: string }[];
    expect(list.map((c) => c.slug)).toEqual(['aurora']);
    expect((await settings.post('/admin/companies', { name: 'Mine', slug: 'mine' }).expect(403)).body.error).toBe('Only a platform admin can do this.');
    expect((await admin(a).get('/admin/companies').expect(200)).body.map((c: { slug: string }) => c.slug).sort()).toEqual(['aurora', 'other']);
    await admin(a).post('/admin/companies', { name: 'Mine', slug: 'mine' }).expect(201);
  });
});

describe('audit log', () => {
  it('keeps each change that succeeded, with who, what and the input — secrets hidden', async () => {
    const m = await member(a, ['orders:view', 'orders:edit', 'admin:view', 'admin:edit']);
    const client = { name: 'Clearwater Films', type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null };
    const { id } = (await m.post('/commercials/clients', client).expect(201)).body;
    await m.post('/commercials/clients', { ...client, name: '' }).expect(422); // failed: not kept
    await m.get('/commercials/clients').expect(200); // a read: not kept
    await m.post('/admin/connections', { kind: 'mam', adapter: 'compact-mam', detail: 'Files', address: 'https://mam.example', userName: 'api', credentials: 's3cret' }).expect(201);

    const rows = await events(a, 2);
    expect(rows.map((e) => [e.action, e.via, e.ok, e.status, e.userId])).toEqual([
      ['POST /commercials/clients', 'web', true, 201, m.user.id],
      ['POST /admin/connections', 'web', true, 201, m.user.id],
    ]);
    expect(rows[0].input).toMatchObject({ name: 'Clearwater Films', type: 'advertiser' });
    expect(rows[1].input).toMatchObject({ userName: 'api', credentials: '[hidden]' });
    expect(JSON.stringify(rows)).not.toContain('s3cret');
    expect(id).toBeTruthy();
  });

  it('notes the item and its channel; previews and checks are not changes', async () => {
    const m = await member(a, ['playlist:view', 'playlist:edit', 'templates:edit', 'templates:view']);
    await m.post(`/channels/${a.channelId}/weeks/check`, { kinds: ['main'], fromWeek: DAY, toWeek: DAY }).expect(200);
    await m.post('/templates/' + a.mainTemplateId + '/clone', { name: 'MAIN copy', validFrom: '2030-01-05', validTo: '2030-12-27' }).expect(201);
    const [e] = await events(a, 1);
    expect(e).toMatchObject({ action: 'POST /templates/:id/clone', targetId: a.mainTemplateId, channelIds: [a.channelId] });
    expect(await platformDb.auditEvent.count({ where: { tenantId: a.tenantId } })).toBe(1);
  });

  it('Settings shows the log of its own company, newest first', async () => {
    await admin(a).post('/commercials/clients', { name: 'One', type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null }).expect(201);
    await admin(a).post('/commercials/clients', { name: 'Two', type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null }).expect(201);
    await admin(b).post('/commercials/clients', { name: 'Elsewhere', type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null }).expect(201);
    await events(a, 2);
    await events(b, 1);
    const log = (await admin(a).get('/admin/activity').expect(200)).body as { action: string; input: { name: string }; person: { name: string } }[];
    expect(log.map((e) => e.input.name)).toEqual(['Two', 'One']);
    expect(log[0]).toMatchObject({ action: 'POST /commercials/clients', person: { name: 'Local user' } });
    expect((await admin(a).get('/admin/activity?limit=1').expect(200)).body.length).toBe(1);
    const reader = await member(a, ['playlist:view']);
    await reader.get('/admin/activity').expect(403);
  });
});
