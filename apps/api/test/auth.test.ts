import { uuidv7 } from '@9eye/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createSession, hashPassword } from '../src/auth';
import { platformDb } from '../src/db';
import { auth, makeCompany, resetDb, type Fixture } from './fixtures';

const app = createApp();
const PASSWORD = 'correct horse battery';
let a: Fixture;
let b: Fixture;

async function person(email: string, opts: { platformAdmin?: boolean; password?: string | null } = {}) {
  return platformDb.user.create({
    data: {
      id: uuidv7(),
      email,
      name: email.split('@')[0],
      platformAdmin: opts.platformAdmin ?? false,
      passwordHash: opts.password === null ? null : await hashPassword(opts.password ?? PASSWORD),
    },
  });
}

const signIn = (email: string, password: string) => request(app).post('/api/auth/sign-in').send({ email, password });
const cookieOf = (r: request.Response) => String(r.headers['set-cookie']?.[0] ?? '');
const sessionOf = (r: request.Response) => cookieOf(r).split(';')[0];

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
});

afterAll(async () => {
  await platformDb.$disconnect();
});

describe('sign-in', () => {
  it('keeps every route but health and sign-in closed without a session', async () => {
    await request(app).get('/api/health').expect(200);
    expect((await request(app).get('/api/tenants').expect(401)).body.error).toBe('Sign in to continue.');
    await request(app).get('/api/channels').set('X-Tenant', a.slug).expect(401);
    await request(app).get('/api/channels').set({ 'X-Tenant': a.slug, Cookie: 'nineeye_session=made-up' }).expect(401);
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/channels').set(auth(a.slug)).expect(200);
  });

  it('signs in with e-mail and password, sets an http-only cookie, and signs out', async () => {
    await person('night.desk@example.org');
    const wrong = await signIn('night.desk@example.org', 'not it').expect(401);
    expect(wrong.body.error).toBe('Email or password is not right.');
    expect(wrong.headers['set-cookie']).toBeUndefined();
    await signIn('nobody@example.org', PASSWORD).expect(401);

    const r = await signIn('  Night.Desk@Example.org ', PASSWORD).expect(200);
    expect(r.body).toMatchObject({ email: 'night.desk@example.org', name: 'night.desk', platformAdmin: false });
    expect(cookieOf(r)).toMatch(/^nineeye_session=[\w-]{43}; Path=\/; Expires=.+; HttpOnly; SameSite=Lax$/);
    const cookie = sessionOf(r);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200)).body.email).toBe('night.desk@example.org');
    expect((await platformDb.user.findUnique({ where: { email: 'night.desk@example.org' } }))?.lastActiveAt).not.toBeNull();

    await request(app).post('/api/auth/sign-out').set('Cookie', cookie).expect(204);
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('marks the cookie secure behind an https proxy on this machine', async () => {
    await person('night.desk@example.org');
    const r = await signIn('night.desk@example.org', PASSWORD).set('X-Forwarded-Proto', 'https').expect(200);
    expect(cookieOf(r)).toContain('; Secure');
  });

  it('refuses people without a password and sessions that ran out', async () => {
    const invited = await person('invited@example.org', { password: null });
    await signIn('invited@example.org', '').expect(401);
    const s = await createSession(invited.id, -1000);
    await request(app).get('/api/auth/me').set('Cookie', `nineeye_session=${s.token}`).expect(401);
  });

  it('locks the sign-in for 15 minutes after five wrong passwords', async () => {
    await person('night.desk@example.org');
    for (let i = 0; i < 4; i++) await signIn('night.desk@example.org', 'wrong').expect(401);
    expect((await signIn('night.desk@example.org', 'wrong').expect(429)).body.error).toBe('Too many tries. Try again in 15 minutes.');
    await signIn('night.desk@example.org', PASSWORD).expect(429);
    await platformDb.user.update({ where: { email: 'night.desk@example.org' }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await signIn('night.desk@example.org', PASSWORD).expect(200);
    expect((await platformDb.user.findUnique({ where: { email: 'night.desk@example.org' } }))?.failedSignIns).toBe(0);
  });
});

describe('companies of the signed-in person', () => {
  it('opens only the companies a person is an active member of; a platform admin opens all', async () => {
    const member = await person('member@example.org');
    const viewer = (await request(app).get('/api/admin/roles').set(auth(a.slug)).expect(200)).body.find((r: { name: string }) => r.name === 'Viewer');
    await platformDb.membership.create({ data: { id: uuidv7(), tenantId: a.tenantId, userId: member.id, roleId: viewer.id, status: 'active' } });
    const cookie = sessionOf(await signIn('member@example.org', PASSWORD).expect(200));
    expect((await request(app).get('/api/tenants').set('Cookie', cookie).expect(200)).body.map((t: { slug: string }) => t.slug)).toEqual(['aurora']);
    await request(app).get('/api/channels').set({ 'X-Tenant': a.slug, Cookie: cookie }).expect(200);
    expect((await request(app).get('/api/channels').set({ 'X-Tenant': b.slug, Cookie: cookie }).expect(403)).body.error).toBe('You are not a member of this company.');

    await platformDb.membership.updateMany({ where: { userId: member.id }, data: { status: 'invited' } });
    await request(app).get('/api/channels').set({ 'X-Tenant': a.slug, Cookie: cookie }).expect(403);

    await person('root@example.org', { platformAdmin: true });
    const admin = sessionOf(await signIn('root@example.org', PASSWORD).expect(200));
    expect((await request(app).get('/api/tenants').set('Cookie', admin).expect(200)).body.map((t: { slug: string }) => t.slug)).toEqual(['aurora', 'other']);
    await request(app).get('/api/channels').set({ 'X-Tenant': b.slug, Cookie: admin }).expect(200);
  });
});
