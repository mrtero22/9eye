import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { decryptSecret } from '../src/secrets';
import { auth, makeCompany, resetDb, type Fixture } from './fixtures';

const app = createApp();
let a: Fixture;
let b: Fixture;
const as = (f: Fixture) => ({
  get: (u: string) => request(app).get(`/api${u}`).set(auth(f.slug)),
  post: (u: string, body: object) => request(app).post(`/api${u}`).set(auth(f.slug)).send(body),
  put: (u: string, body: object) => request(app).put(`/api${u}`).set(auth(f.slug)).send(body),
  patch: (u: string, body: object) => request(app).patch(`/api${u}`).set(auth(f.slug)).send(body),
  del: (u: string) => request(app).delete(`/api${u}`).set(auth(f.slug)),
});

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
});

afterAll(async () => {
  await platformDb.$disconnect();
});

describe('companies', () => {
  it('lists every company with its channels, and adds one with the built-in roles', async () => {
    const list = (await as(a).get('/admin/companies').expect(200)).body;
    expect(list.map((c: { slug: string; current: boolean }) => [c.slug, c.current])).toEqual([['aurora', true], ['other', false]]);
    expect(list[0]).toMatchObject({ channelCount: 1, templateCount: 2 });
    await as(a).post('/admin/companies', { name: 'Third', slug: 'Bad Slug' }).expect(422);
    const r = await as(a).post('/admin/companies', { name: 'Third', slug: 'third' }).expect(201);
    expect(r.body.slug).toBe('third');
    const roles = (await request(app).get('/api/admin/roles').set(auth('third')).expect(200)).body;
    expect(roles.map((x: { name: string }) => x.name)).toEqual(['Platform admin', 'Company admin', 'Traffic operator', 'Program scheduler', 'Sales', 'Viewer']);
  });
});

describe('roles', () => {
  it('starts with the built-in roles; the local user is the company admin', async () => {
    const roles = (await as(a).get('/admin/roles').expect(200)).body;
    const admin = roles.find((r: { name: string }) => r.name === 'Company admin');
    expect(admin).toMatchObject({ fixed: true, members: 1, allChannels: true });
    expect(admin.grants).toHaveLength(25);
    expect(roles.find((r: { name: string }) => r.name === 'Traffic operator').grants).toContainEqual({ module: 'orders', action: 'approve' });
  });

  it('changes grants and the channel scope all-or-nothing; the admin roles stay fixed', async () => {
    const roles = (await as(a).get('/admin/roles').expect(200)).body;
    const traffic = roles.find((r: { name: string }) => r.name === 'Traffic operator');
    const admin = roles.find((r: { name: string }) => r.name === 'Company admin');
    await as(a).put(`/admin/roles/${admin.id}`, { version: admin.version, grants: [], allChannels: true, channelIds: [] }).expect(409);
    await as(a).put('/admin/roles/platform-admin', { version: 0, grants: [], allChannels: true, channelIds: [] }).expect(409);
    await as(a).put(`/admin/roles/${traffic.id}`, { version: traffic.version, grants: [{ module: 'admin', action: 'export' }], allChannels: true, channelIds: [] }).expect(422);
    await as(a).put(`/admin/roles/${traffic.id}`, { version: traffic.version, grants: [], allChannels: false, channelIds: [] }).expect(422);
    await as(a).put(`/admin/roles/${traffic.id}`, { version: traffic.version, grants: [], allChannels: false, channelIds: [b.channelId] }).expect(422);
    await as(a).put(`/admin/roles/${traffic.id}`, { version: traffic.version, grants: [{ module: 'playlist', action: 'view' }], allChannels: false, channelIds: [a.channelId] }).expect(204);
    const after = (await as(a).get('/admin/roles').expect(200)).body.find((r: { id: string }) => r.id === traffic.id);
    expect(after).toMatchObject({ grants: [{ module: 'playlist', action: 'view' }], allChannels: false, channelIds: [a.channelId], version: traffic.version + 1 });
    await as(a).put(`/admin/roles/${traffic.id}`, { version: traffic.version, grants: [], allChannels: true, channelIds: [] }).expect(409);
    const created = await as(a).post('/admin/roles', { name: 'Night desk', description: 'Overnight playlists' }).expect(201);
    await as(a).post('/admin/roles', { name: 'Night desk', description: '' }).expect(422);
    expect((await as(a).get('/admin/roles').expect(200)).body.at(-1)).toMatchObject({ id: created.body.id, name: 'Night desk', grants: [], fixed: false, system: false });
  });
});

describe('users', () => {
  it('invites people with a role, changes it, and keeps one company admin', async () => {
    const roles = (await as(a).get('/admin/roles').expect(200)).body;
    const viewer = roles.find((r: { name: string }) => r.name === 'Viewer');
    const admin = roles.find((r: { name: string }) => r.name === 'Company admin');
    const local = (await as(a).get('/admin/users').expect(200)).body[0];
    expect(local).toMatchObject({ name: 'Local user', platformAdmin: true, status: 'active', roleId: admin.id });

    await as(a).post('/admin/users', { name: 'Day traffic', email: 'nope', roleId: viewer.id }).expect(422);
    const r = await as(a).post('/admin/users', { name: 'Day traffic', email: 'Day@Example.org', roleId: viewer.id }).expect(201);
    await as(a).post('/admin/users', { name: 'Again', email: 'day@example.org', roleId: viewer.id }).expect(422);
    // the same person in another company
    const otherViewer = (await as(b).get('/admin/roles').expect(200)).body.find((x: { name: string }) => x.name === 'Viewer');
    await as(b).post('/admin/users', { name: 'Day traffic', email: 'day@example.org', roleId: otherViewer.id }).expect(201);
    const users = (await as(a).get('/admin/users').expect(200)).body;
    const day = users.find((u: { id: string }) => u.id === r.body.id);
    expect(day).toMatchObject({ email: 'day@example.org', status: 'invited', mfaEnabled: false });
    expect(day.memberships).toEqual([{ company: 'aurora', role: 'Viewer', current: true }, { company: 'other', role: 'Viewer', current: false }]);

    await as(a).patch(`/admin/users/${r.body.id}`, { roleId: otherViewer.id }).expect(422);
    await as(a).patch(`/admin/users/${r.body.id}`, { roleId: admin.id }).expect(204);
    await as(a).patch(`/admin/users/${local.id}`, { roleId: viewer.id }).expect(204);
    await as(a).del(`/admin/users/${r.body.id}`).expect(409);
    await as(a).patch(`/admin/users/${local.id}`, { roleId: admin.id }).expect(204);
    await as(a).del(`/admin/users/${r.body.id}`).expect(204);
    expect((await as(a).get('/admin/users').expect(200)).body.map((u: { name: string }) => u.name)).toEqual(['Local user']);
  });
});

describe('connections', () => {
  it('keeps credentials encrypted and never sends them back', async () => {
    await as(a).post('/admin/connections', { kind: 'mam', adapter: 'playout-xml', detail: '', address: '', userName: '' }).expect(422);
    const r = await as(a).post('/admin/connections', { kind: 'mam', adapter: 'compact-mam', detail: 'Files', address: 'https://mam.example', userName: 'api', credentials: 's3cret' }).expect(201);
    const list = (await as(a).get('/admin/connections').expect(200)).body;
    expect(list).toEqual([{ id: r.body.id, kind: 'mam', adapter: 'compact-mam', label: 'MAM · Compact MAM', detail: 'Files', channelCount: 0, address: 'https://mam.example', userName: 'api', hasCredentials: true, status: 'set-up' }]);
    expect(JSON.stringify(list)).not.toContain('s3cret');
    const row = await platformDb.connection.findUnique({ where: { id: r.body.id } });
    expect(row!.secret).not.toContain('s3cret');
    expect(decryptSecret(row!.secret!)).toBe('s3cret');
    await as(a).put(`/admin/connections/${r.body.id}`, { kind: 'mam', adapter: 'compact-mam', detail: 'Files and trims', address: 'https://mam.example', userName: 'api' }).expect(200);
    expect(decryptSecret((await platformDb.connection.findUnique({ where: { id: r.body.id } }))!.secret!)).toBe('s3cret');
    await as(b).del(`/admin/connections/${r.body.id}`).expect(404);
    await as(a).del(`/admin/connections/${r.body.id}`).expect(204);
  });
});
