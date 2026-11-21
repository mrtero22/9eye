import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/auth';
import { platformDb } from '../src/db';
import { checkNewPerson, createPerson } from '../src/services/people';
import { makeCompany, resetDb } from './fixtures';

const PASSWORD = 'correct horse battery';

beforeEach(async () => {
  await resetDb();
  await makeCompany('aurora-media');
});
afterAll(() => platformDb.$disconnect());

describe('making a person from the terminal (user:create)', () => {
  it('makes a platform admin who can sign in, without a membership', async () => {
    const made = await createPerson({ email: ' Lena.Park@Example.org ', name: 'Lena Park', password: PASSWORD, platformAdmin: true });
    expect(made).toMatchObject({ email: 'lena.park@example.org', company: null, role: null });
    const user = await platformDb.user.findUniqueOrThrow({ where: { email: 'lena.park@example.org' }, include: { memberships: true } });
    expect(user.platformAdmin).toBe(true);
    expect(user.memberships).toEqual([]);
    expect(await verifyPassword(PASSWORD, user.passwordHash!)).toBe(true);
  });

  it('makes an active member of one company with a built-in role (viewer by default)', async () => {
    const traffic = await createPerson({ email: 'desk@example.org', name: 'Night desk', password: PASSWORD, platformAdmin: false, companySlug: 'aurora-media', roleKey: 'traffic' });
    expect(traffic).toMatchObject({ company: 'aurora-media', role: 'Traffic operator' });
    const viewer = await createPerson({ email: 'guest@example.org', name: 'Guest', password: PASSWORD, platformAdmin: false, companySlug: 'aurora-media' });
    expect(viewer.role).toBe('Viewer');
    const m = await platformDb.membership.findFirstOrThrow({ where: { userId: traffic.id }, include: { role: true } });
    expect(m).toMatchObject({ status: 'active', role: { systemKey: 'traffic' } });
  });

  it('lists every problem and writes nothing', async () => {
    const problems = await checkNewPerson({ email: 'not-an-email', name: ' ', password: 'short', platformAdmin: false, companySlug: 'nowhere', roleKey: 'boss' });
    expect(problems).toEqual([
      'Type a valid e-mail address.',
      'A name is required.',
      'The password needs at least 12 characters.',
      'No company with the short name nowhere.',
      'No built-in role boss; use one of company-admin, traffic, scheduler, sales, viewer.',
    ]);
    expect(await checkNewPerson({ email: 'a@example.org', name: 'A', password: PASSWORD, platformAdmin: false })).toEqual([
      'Give --admin (every company) or --company <short name>.',
    ]);
    const before = await platformDb.user.count();
    await expect(createPerson({ email: 'a@example.org', name: 'A', password: 'short', platformAdmin: true })).rejects.toThrow('at least 12');
    expect(await platformDb.user.count()).toBe(before);
  });

  it('refuses an e-mail that exists already', async () => {
    await createPerson({ email: 'lena@example.org', name: 'Lena', password: PASSWORD, platformAdmin: true });
    await expect(createPerson({ email: 'LENA@example.org', name: 'Lena again', password: PASSWORD, platformAdmin: true })).rejects.toThrow(
      'lena@example.org already exists',
    );
  });
});
