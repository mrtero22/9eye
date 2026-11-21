// AI access (decision 0023, docs/design/ai-access-page.md): a person's own tokens, the company's
// policy and token list in Settings, the MCP endpoint following the policy, and Activity filters.

import { uuidv7 } from '@9eye/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { SESSION_COOKIE, createSession } from '../src/auth';
import { platformDb } from '../src/db';
import { tokenHash } from '../src/mcp/auth';
import { auth, makeCompany, resetDb, type Fixture } from './fixtures';

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

/** A signed-in person: a member of `f` with these grants, or a platform admin when f is null. */
async function person(f: Fixture | null, grants: string[] = [], name = 'Dana Ellis') {
  const user = await platformDb.user.create({ data: { id: uuidv7(), email: `${uuidv7()}@test.example`, name, platformAdmin: !f } });
  if (f) {
    const role = await platformDb.role.create({
      data: { id: uuidv7(), tenantId: f.tenantId, name: `Role of ${user.id}`, allChannels: true, grants: { create: grants.map((g) => ({ id: uuidv7(), module: g.split(':')[0], action: g.split(':')[1] })) } },
    });
    await platformDb.membership.create({ data: { id: uuidv7(), tenantId: f.tenantId, userId: user.id, roleId: role.id, status: 'active' } });
  }
  const { token } = await createSession(user.id);
  const cookie = `${SESSION_COOKIE}=${token}`;
  const as = (slug?: string) => ({ Cookie: cookie, ...(slug ? { 'X-Tenant': slug } : {}) });
  return {
    user,
    get: (url: string, slug?: string) => request(app).get(`/api${url}`).set(as(slug)),
    post: (url: string, body: object, slug?: string) => request(app).post(`/api${url}`).set(as(slug)).send(body),
    put: (url: string, body: object, slug?: string) => request(app).put(`/api${url}`).set(as(slug)).send(body),
    del: (url: string, slug?: string) => request(app).delete(`/api${url}`).set(as(slug)),
  };
}

const policy = (f: Fixture, aiAccess: string, maxDays = 90) => platformDb.tenant.update({ where: { id: f.tenantId }, data: { aiAccess, aiTokenMaxDays: maxDays } });
const make = (p: Awaited<ReturnType<typeof person>>, body: object) => p.post('/me/ai-tokens', { company: 'aurora', name: 'Claude on my laptop', limits: { kind: 'read' }, days: 90, ...body });
const same = { limits: { kind: 'same' } };

describe('a person’s own tokens', () => {
  it('lists the companies one can open with the policy, the role and whether it can change', async () => {
    const p = await person(a, ['playlist:view', 'playlist:edit']);
    await policy(a, 'edit', 30);
    const r = (await p.get('/me/ai-access').expect(200)).body;
    expect(r.tokens).toEqual([]);
    expect(r.companies).toEqual([expect.objectContaining({ slug: 'aurora', on: true, preset: 'drafts', maxDays: 30, canEdit: true, role: expect.stringContaining('Role of') })]);
    expect(r.companies[0].roleCan.playlist).toMatchObject({ read: true, change: true, approve: false });
    expect(r.companies[0].roleCan.layouts).toMatchObject({ read: false, change: false });
    expect(r.shape.parts.map((x: { key: string }) => x.key)).toEqual(['media', 'layouts', 'scheduling', 'playlist', 'ads', 'channels']);
    const admin = await person(null);
    expect((await admin.get('/me/ai-access').expect(200)).body.companies.map((c: { slug: string; role: string }) => [c.slug, c.role])).toEqual([
      ['aurora', 'Platform admin'],
      ['other', 'Platform admin'],
    ]);
  });

  it('makes a token shown once, keeps only its hash, lists it and revokes it', async () => {
    const p = await person(a, ['playlist:view']);
    const r = (await make(p, {}).expect(201)).body;
    expect(r.token).toMatch(/^9eye_pat_[A-Za-z0-9_-]{40,}$/);
    expect(r.row).toMatchObject({ name: 'Claude on my laptop', access: 'read', limits: 'read', limitsText: 'Read only', state: 'ok', company: { slug: 'aurora' } });
    const row = await platformDb.accessToken.findUniqueOrThrow({ where: { id: r.row.id } });
    expect(row.tokenHash).toBe(tokenHash(r.token));
    expect(JSON.stringify((await p.get('/me/ai-access').expect(200)).body)).not.toContain(r.token);

    // kept in the company's activity, without the token
    const ev = await platformDb.auditEvent.findFirstOrThrow({ where: { tenantId: a.tenantId, action: 'POST /me/ai-tokens' } });
    expect(ev).toMatchObject({ targetId: r.row.id, userId: p.user.id, input: { name: 'Claude on my laptop', limits: 'read', days: 90 } });

    const other = await person(a, ['playlist:view'], 'Omar Haddad');
    await other.del(`/me/ai-tokens/${r.row.id}`).expect(404);
    await p.del(`/me/ai-tokens/${r.row.id}`).expect(204);
    expect((await p.get('/me/ai-access').expect(200)).body.tokens[0].state).toBe('revoked');
  });

  it('follows the company: off, never wider than its table, the longest life, and the role', async () => {
    const viewer = await person(a, ['playlist:view']);
    await policy(a, 'off');
    expect((await make(viewer, {}).expect(409)).body.error).toBe('AI access is off for aurora: a company admin can turn it on in Settings › AI access.');
    await policy(a, 'read');
    const wider = { limits: { kind: 'custom', table: { playlist: { read: 'on', change: 'on' } } } };
    expect((await make(viewer, wider).expect(409)).body.error).toBe('aurora does not allow this much: Playlist › Change.');
    await policy(a, 'edit', 30);
    expect((await make(viewer, { days: 90 }).expect(422)).body.error).toBe('aurora allows tokens of up to 30 days.');
    // a token that follows the company (its role still decides each step: this one cannot change anything)
    expect((await make(viewer, { ...same, days: 30 }).expect(201)).body.row).toMatchObject({ access: 'edit', limits: 'same', limitsText: 'Drafts · follows the company' });
    const editor = await person(a, ['playlist:view', 'playlist:edit'], 'Lena Park');
    expect((await make(editor, { ...same, days: 30 }).expect(201)).body.row.access).toBe('edit');
    const custom = (await make(editor, { ...wider, days: 30 }).expect(201)).body.row;
    expect(custom).toMatchObject({ access: 'edit', limits: 'custom', limitsText: 'Playlist: change; the rest read' });
    // the older form still works: access edit = the same as the company
    expect((await make(editor, { limits: undefined, access: 'edit', days: 30 }).expect(201)).body.row.limits).toBe('same');
    expect((await make(editor, { company: 'other' }).expect(403)).body.error).toBe('You cannot open that company.');
  });
});

describe('Settings › AI access', () => {
  it('reads and saves the policy with Settings view / edit', async () => {
    const viewer = await person(a, ['admin:view']);
    const read = (await viewer.get('/admin/ai-access', 'aurora').expect(200)).body;
    expect(read).toMatchObject({ on: true, preset: 'read', maxDays: 90, dayChoices: [30, 90, 180, 365] });
    expect(read.table.playlist).toEqual({ read: 'on', change: 'off', create: 'off', approve: 'off', export: 'off' });
    expect(read.table.media).toEqual({ read: 'on', change: 'off', create: 'off' });
    const full = { media: { read: 'on', change: 'on', create: 'on' }, layouts: { read: 'on', change: 'on', create: 'on' }, scheduling: { read: 'on', change: 'on', create: 'on', approve: 'on' }, playlist: { read: 'on', change: 'on', create: 'on', approve: 'on', export: 'on' }, ads: { read: 'on', change: 'on', create: 'on', approve: 'on' }, channels: { read: 'on', change: 'on', create: 'on' } };
    await viewer.put('/admin/ai-access', { on: true, table: full, maxDays: 30 }, 'aurora').expect(403);
    const admin = await person(a, ['admin:view', 'admin:edit']);
    await admin.put('/admin/ai-access', { on: true, table: full, maxDays: 45 }, 'aurora').expect(422);
    expect((await admin.put('/admin/ai-access', { on: true, table: full, maxDays: 30 }, 'aurora').expect(200)).body).toMatchObject({ on: true, preset: 'full', maxDays: 30 });
    // a cell left out is Off; Read cannot be Ask first
    const custom = (await admin.put('/admin/ai-access', { on: true, table: { layouts: { read: 'ask', change: 'ask' } }, maxDays: 30 }, 'aurora').expect(200)).body;
    expect(custom).toMatchObject({ preset: 'custom', table: { layouts: { read: 'on', change: 'ask', create: 'off' }, media: { read: 'off' } } });
    expect((await admin.put('/admin/ai-access', { on: false, table: full, maxDays: 30 }, 'aurora').expect(200)).body.on).toBe(false);
    expect((await platformDb.tenant.findUniqueOrThrow({ where: { id: b.tenantId } })).aiAccess).toBe('read');
  });

  it('lists every token of the company with its state, and revokes one', async () => {
    const dana = await person(a, ['playlist:view'], 'Dana Ellis');
    const kept = (await make(dana, { name: 'Laptop' }).expect(201)).body.row;
    const gone = (await make(dana, { name: 'Old' }).expect(201)).body.row;
    await platformDb.accessToken.update({ where: { id: gone.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const kai = await person(a, ['playlist:view'], 'Kai Morgan');
    const left = (await make(kai, { name: 'Test' }).expect(201)).body.row;
    await platformDb.membership.deleteMany({ where: { userId: kai.user.id } });
    const elsewhere = await person(b, ['playlist:view'], 'Sam Rivera');
    const theirs = (await make(elsewhere, { company: 'other' }).expect(201)).body.row;

    const admin = await person(a, ['admin:view', 'admin:edit']);
    const list = (await admin.get('/admin/ai-tokens', 'aurora').expect(200)).body as { id: string; state: string; person: { name: string } }[];
    expect(list.map((t) => [t.person.name, t.state]).sort()).toEqual([
      ['Dana Ellis', 'expired'],
      ['Dana Ellis', 'ok'],
      ['Kai Morgan', 'left'],
    ]);
    await admin.del(`/admin/ai-tokens/${theirs.id}`, 'aurora').expect(404);
    await admin.del(`/admin/ai-tokens/${kept.id}`, 'aurora').expect(204);
    expect((await platformDb.accessToken.findUniqueOrThrow({ where: { id: kept.id } })).revokedAt).not.toBeNull();
    expect(left.id).toBeTruthy();
  });
});

describe('the MCP endpoint follows the company', () => {
  it('off refuses every token; read only hides the write tools of an edit token', async () => {
    const editor = await person(a, ['playlist:view', 'playlist:edit']);
    await policy(a, 'edit');
    const { token } = (await make(editor, same).expect(201)).body;
    const list = () => request(app).post('/api/mcp').set({ Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' }).send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const names = (r: request.Response) => {
      const text = r.text.includes('data:') ? r.text.split('\n').find((l) => l.startsWith('data:'))!.slice(5) : r.text;
      return (JSON.parse(text).result.tools as { name: string }[]).map((t) => t.name);
    };
    expect(names(await list().expect(200))).toContain('fill_day');
    await policy(a, 'read');
    expect(names(await list().expect(200))).not.toContain('fill_day');
    await policy(a, 'off');
    expect((await list().expect(403)).body.error).toBe('AI access is off for aurora: a company admin can turn it on in Settings › AI access.');
  });
});

describe('the table: Off hides a tool, Ask first leaves the change waiting in 9eye (decision 0025)', () => {
  const rpc = (token: string, method: string, params: object) =>
    request(app).post('/api/mcp').set({ Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' }).send({ jsonrpc: '2.0', id: 1, method, params });
  const result = (r: request.Response) => JSON.parse(r.text.includes('data:') ? r.text.split('\n').find((l) => l.startsWith('data:'))!.slice(5) : r.text).result;

  it('a token works under the company table and its own; an Ask first change waits until a person approves it', async () => {
    const admin = await person(a, ['admin:view', 'admin:edit']);
    await admin.put('/admin/ai-access', { on: true, table: { layouts: { read: 'on', change: 'on', create: 'ask' }, playlist: { read: 'on' }, channels: { read: 'on' } }, maxDays: 90 }, 'aurora').expect(200);
    const lena = await person(a, ['templates:view', 'templates:edit', 'playlist:view'], 'Lena Park');
    const { token } = (await make(lena, same).expect(201)).body;
    const tools = result(await rpc(token, 'tools/list', {}).expect(200)).tools as { name: string; description: string }[];
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['get_layout', 'edit_layout', 'create_layout', 'get_channel', 'undo_change']));
    expect(names).not.toContain('fill_day');
    expect(names).not.toContain('create_channel');
    expect(names).not.toContain('search_media');
    expect(tools.find((t) => t.name === 'create_layout')!.description).toContain('a person approves this in 9eye first');
    expect(tools.find((t) => t.name === 'edit_layout')!.description).not.toContain('a person approves this in 9eye first');

    // a token of its own, narrower: no layout changes at all
    const { token: narrow } = (await make(lena, { limits: { kind: 'custom', table: { layouts: { read: 'on' } } } }).expect(201)).body;
    expect((result(await rpc(narrow, 'tools/list', {}).expect(200)).tools as { name: string }[]).map((t) => t.name)).not.toContain('create_layout');

    // Ask first: applying only leaves it waiting
    const layouts = () => platformDb.template.count({ where: { tenantId: a.tenantId, deletedAt: null } });
    const before = await layouts();
    const args = { channel: 'AURORA', name: 'WINTER', valid_from: '2030-01-05', valid_to: '2030-03-29', apply: true };
    const asked = result(await rpc(token, 'tools/call', { name: 'create_layout', arguments: args }).expect(200));
    expect(asked.content[0].text).toContain('This now waits for a person in 9eye (Agents › Waiting for you): aurora asks first for this.');
    expect(await layouts()).toBe(before);
    const again = result(await rpc(token, 'tools/call', { name: 'create_layout', arguments: args }).expect(200));
    expect(again.content[0].text).toContain('This same change is already waiting');
    const waiting = await platformDb.agentChange.findMany({ where: { tenantId: a.tenantId, status: 'waiting' } });
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ agentId: null, runId: null, userId: lena.user.id, tool: 'create_layout' });

    // in Waiting for you, from the app and whose token; a person who may change Layouts approves it
    const [card] = (await request(app).get('/api/agents/changes').set(auth('aurora')).expect(200)).body;
    expect(card).toMatchObject({ title: 'Create a layout', status: 'waiting', from: { kind: 'app', token: 'Claude on my laptop', person: 'Lena Park' }, agent: { name: 'Lena Park', mark: 'LP' } });
    const viewer = await person(a, ['templates:view'], 'Omar Haddad');
    await viewer.post(`/agents/changes/${card.id}/approve`, {}, 'aurora').expect(403);
    const done = (await request(app).post(`/api/agents/changes/${card.id}/approve`).set(auth('aurora')).send({}).expect(200)).body;
    expect(done).toMatchObject({ status: 'approved', canUndo: true });
    expect(await layouts()).toBe(before + 1);
    const ev = (await platformDb.auditEvent.findMany({ where: { action: 'tool create_layout', ok: true } })).find((e) => e.message === null)!;
    expect(ev).toMatchObject({ via: 'mcp', tokenId: waiting[0].tokenId });

    // Allowed cells apply at once
    const winter = await platformDb.template.findFirstOrThrow({ where: { name: 'WINTER' } });
    const renamed = result(await rpc(token, 'tools/call', { name: 'rename_layout', arguments: { channel: 'AURORA', layout: 'WINTER', name: 'WINTER 2030', apply: true, version: winter.version } }).expect(200));
    expect(renamed.content[0].text).toContain('saved as version');
  });
});

describe('Activity filters', () => {
  it('filters by person and day, and names the token of an MCP event', async () => {
    const dana = await person(a, ['playlist:view'], 'Dana Ellis');
    const { row } = (await make(dana, { name: 'Laptop' }).expect(201)).body;
    const omar = await person(a, ['playlist:view'], 'Omar Haddad');
    await make(omar, { name: 'Desk' }).expect(201);
    await platformDb.auditEvent.create({ data: { id: uuidv7(), tenantId: a.tenantId, userId: dana.user.id, via: 'mcp', tokenId: row.id, action: 'tool list_channels', ok: true } });
    await platformDb.auditEvent.create({ data: { id: uuidv7(), tenantId: a.tenantId, userId: omar.user.id, via: 'web', action: 'PUT /days/:id', ok: true, createdAt: new Date('2030-06-01T10:00:00Z') } });

    const get = (q: string) => request(app).get(`/api/admin/activity${q}`).set(auth('aurora')).expect(200);
    const mine = (await get(`?person=${dana.user.id}`)).body as { action: string; tokenName: string | null; person: { name: string } }[];
    expect(mine.map((e) => [e.action, e.tokenName])).toEqual([
      ['tool list_channels', 'Laptop'],
      ['POST /me/ai-tokens', null],
    ]);
    expect((await get('?day=2030-06-01')).body.map((e: { action: string }) => e.action)).toEqual(['PUT /days/:id']);
    expect((await get('?via=mcp')).body).toHaveLength(1);
  });
});
