// Making a person from the terminal (scripts/create-user.ts, decision 0021): the first platform admin
// of a fresh install, or an active member of one company with a built-in role. The web app invites
// people (Settings › Users); this is for when nobody can sign in yet.

import { SYSTEM_ROLES, uuidv7 } from '@9eye/core';
import { MIN_PASSWORD, hashPassword } from '../auth';
import { db, platformDb, withTenant } from '../db';
import { ensureCompanyBasics } from './admin';

export interface NewPerson {
  email: string;
  name: string;
  password: string;
  /** A platform admin may do everything in every company and needs no membership. */
  platformAdmin: boolean;
  /** A company's short name (slug): the person becomes an active member there with `roleKey`. */
  companySlug?: string;
  /** A built-in role (see ROLE_KEYS); the default is "viewer". */
  roleKey?: string;
}

/** The built-in roles a new member can get: company-admin, traffic, scheduler, sales, viewer. */
export const ROLE_KEYS: readonly string[] = SYSTEM_ROLES.map((r) => r.key);
export const DEFAULT_ROLE = 'viewer';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalEmail = (email: string) => email.trim().toLowerCase();

/** Every reason the person cannot be made, in plain words; empty = it can be made. */
export async function checkNewPerson(p: NewPerson): Promise<string[]> {
  const problems: string[] = [];
  const email = normalEmail(p.email);
  if (!EMAIL.test(email)) problems.push('Type a valid e-mail address.');
  else if (await platformDb.user.findUnique({ where: { email } })) problems.push(`${email} already exists — set a new password with user:password.`);
  if (!p.name.trim()) problems.push('A name is required.');
  else if (p.name.trim().length > 120) problems.push('The name has at most 120 characters.');
  if (p.password.length < MIN_PASSWORD) problems.push(`The password needs at least ${MIN_PASSWORD} characters.`);
  if (!p.platformAdmin && !p.companySlug) problems.push('Give --admin (every company) or --company <short name>.');
  if (p.companySlug && !(await platformDb.tenant.findUnique({ where: { slug: p.companySlug } }))) problems.push(`No company with the short name ${p.companySlug}.`);
  if (p.roleKey && !ROLE_KEYS.includes(p.roleKey)) problems.push(`No built-in role ${p.roleKey}; use one of ${ROLE_KEYS.join(', ')}.`);
  if (p.roleKey && !p.companySlug) problems.push('A role needs --company.');
  return problems;
}

/** Makes the person (and the membership) in one transaction; nothing is written when a check fails. */
export async function createPerson(p: NewPerson): Promise<{ id: string; email: string; company: string | null; role: string | null }> {
  const problems = await checkNewPerson(p);
  if (problems.length) throw new Error(problems.join('\n'));
  const email = normalEmail(p.email);
  const passwordHash = await hashPassword(p.password);

  let member: { tenantId: string; tenantName: string; roleId: string; roleName: string } | null = null;
  if (p.companySlug) {
    const tenant = (await platformDb.tenant.findUnique({ where: { slug: p.companySlug } }))!;
    const roleKey = p.roleKey ?? DEFAULT_ROLE;
    const role = await withTenant(tenant.id, async () => {
      await ensureCompanyBasics(); // the built-in roles exist from here on
      return db.role.findFirst({ where: { systemKey: roleKey } });
    });
    if (!role) throw new Error(`The company ${p.companySlug} has no role ${roleKey}.`);
    member = { tenantId: tenant.id, tenantName: tenant.name, roleId: role.id, roleName: role.name };
  }

  const id = uuidv7();
  await platformDb.$transaction(async (tx) => {
    await tx.user.create({ data: { id, email, name: p.name.trim(), platformAdmin: p.platformAdmin, passwordHash } });
    if (member) await tx.membership.create({ data: { id: uuidv7(), tenantId: member.tenantId, userId: id, roleId: member.roleId, status: 'active' } });
  });
  return { id, email, company: member?.tenantName ?? null, role: member?.roleName ?? null };
}
