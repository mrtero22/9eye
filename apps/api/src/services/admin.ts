// Admin → Organisation and Output: companies, users, roles (decision 0007) and connections
// (plugins and MAM, decisions 0005 / 0008). Platform admins are company admins of every company; a
// database without one gets the "Local user" (decision 0021: it signs in once it has a password).

import { ALL_GRANTS, CONNECTION_KINDS, EXPORTERS, SYSTEM_ROLES, connectionLabel, grantApplies, uuidv7 } from '@9eye/core';
import type { Prisma } from '@prisma/client';
import { currentTenantId, db, platformDb, withTenant } from '../db';
import { HttpError, notFound } from '../errors';
import { encryptSecret } from '../secrets';

const LOCAL_USER = { email: 'local.user@localhost', name: 'Local user' };
const ROLE_ORDER: string[] = SYSTEM_ROLES.map((r) => r.key);

/** Every company starts with the built-in roles and the platform admins as its company admins. */
export async function ensureCompanyBasics() {
  for (const r of SYSTEM_ROLES) {
    const found = await db.role.findFirst({ where: { systemKey: r.key } });
    if (found) continue;
    const id = uuidv7();
    await db.role.create({ data: { id, name: r.name, description: r.description, systemKey: r.key } as Prisma.RoleUncheckedCreateInput });
    await platformDb.roleGrant.createMany({ data: r.grants.map((x) => ({ id: uuidv7(), roleId: id, module: x.module, action: x.action })) });
  }
  let admins = await platformDb.user.findMany({ where: { platformAdmin: true } });
  if (!admins.length) {
    admins = [await platformDb.user.upsert({ where: { email: LOCAL_USER.email }, update: { platformAdmin: true }, create: { id: uuidv7(), ...LOCAL_USER, platformAdmin: true, mfaEnabled: false } })];
  }
  for (const user of admins) {
    if (await db.membership.findFirst({ where: { userId: user.id } })) continue;
    const admin = await db.role.findFirst({ where: { systemKey: 'company-admin' } });
    await db.membership.create({ data: { id: uuidv7(), userId: user.id, roleId: admin!.id, status: 'active' } as Prisma.MembershipUncheckedCreateInput });
  }
}

// ---------------------------------------------------------------- companies

export async function listCompanies() {
  const current = currentTenantId();
  const rows = await platformDb.tenant.findMany({
    orderBy: { name: 'asc' },
    include: { channels: { where: { deletedAt: null }, select: { defaultExport: true, playlists: { select: { _count: { select: { templates: { where: { deletedAt: null } } } } } } } } },
  });
  return rows.map((t) => {
    const exports = [...new Set(t.channels.map((c) => c.defaultExport).filter((x): x is string => !!x))].map((c) => EXPORTERS.find((e) => e.code === c)?.label ?? c);
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      current: t.id === current,
      channelCount: t.channels.length,
      templateCount: t.channels.reduce((n, c) => n + c.playlists.reduce((m, p) => m + p._count.templates, 0), 0),
      exports,
    };
  });
}

export async function createCompany(input: { name: string; slug: string }) {
  const name = input.name.trim();
  const slug = input.slug.trim();
  if (!name || name.length > 80) throw new HttpError(422, 'The company name is required and has at most 80 characters.');
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) throw new HttpError(422, 'The short name is 2–40 lower-case letters, digits and "-".');
  if (await platformDb.tenant.findUnique({ where: { slug } })) throw new HttpError(422, `The short name ${slug} is already used.`);
  const t = await platformDb.tenant.create({ data: { id: uuidv7(), name, slug } });
  await withTenant(t.id, ensureCompanyBasics);
  return { id: t.id, name: t.name, slug: t.slug };
}

// ---------------------------------------------------------------- roles

export const PLATFORM_ADMIN_ID = 'platform-admin';

export async function listRoles() {
  await ensureCompanyBasics();
  const roles = await db.role.findMany({ include: { grants: true, scopes: true, _count: { select: { memberships: true } } } });
  const platformAdmins = await platformDb.user.count({ where: { platformAdmin: true } });
  const rank = (k: string | null) => (k ? ROLE_ORDER.indexOf(k) : ROLE_ORDER.length);
  roles.sort((a, b) => rank(a.systemKey) - rank(b.systemKey) || a.name.localeCompare(b.name));
  return [
    { id: PLATFORM_ADMIN_ID, name: 'Platform admin', description: 'All companies, all modules', fixed: true, system: true, members: platformAdmins, grants: ALL_GRANTS, allChannels: true, channelIds: [], version: 0 },
    ...roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      fixed: r.systemKey === 'company-admin',
      system: !!r.systemKey,
      members: r._count.memberships,
      grants: r.grants.map((x) => ({ module: x.module, action: x.action })),
      allChannels: r.allChannels,
      channelIds: r.scopes.map((s) => s.channelId),
      version: r.version,
    })),
  ];
}

export async function createRole(input: { name: string; description: string }) {
  await ensureCompanyBasics();
  const name = input.name.trim();
  if (!name || name.length > 60) throw new HttpError(422, 'The role name is required and has at most 60 characters.');
  if (await db.role.findFirst({ where: { name } })) throw new HttpError(422, `There is already a role called ${name}.`);
  const r = await db.role.create({ data: { id: uuidv7(), name, description: input.description.trim() } as Prisma.RoleUncheckedCreateInput });
  return r.id;
}

export async function updateRole(id: string, input: { version: number; grants: { module: string; action: string }[]; allChannels: boolean; channelIds: string[] }) {
  if (id === PLATFORM_ADMIN_ID) throw new HttpError(409, 'Platform admins can do everything in every company; the role cannot be changed.');
  const role = await db.role.findFirst({ where: { id } });
  if (!role) throw notFound('Role');
  if (role.systemKey === 'company-admin') throw new HttpError(409, 'The company admin can do everything in this company; the role cannot be changed.');
  const bad = input.grants.filter((x) => !grantApplies(x.module, x.action));
  if (bad.length) throw new HttpError(422, `Not a permission: ${bad.map((x) => `${x.module} · ${x.action}`).join(', ')}.`);
  const channelIds = [...new Set(input.channelIds)];
  if (!input.allChannels) {
    if (!channelIds.length) throw new HttpError(422, 'Pick at least one channel, or choose All channels.');
    const found = await db.channel.count({ where: { id: { in: channelIds }, deletedAt: null } });
    if (found !== channelIds.length) throw new HttpError(422, 'Some channels do not belong to this company.');
  }
  const grants = [...new Map(input.grants.map((x) => [`${x.module}.${x.action}`, x])).values()];
  await db.$transaction(async (tx) => {
    const updated = await tx.role.updateMany({ where: { id, version: input.version }, data: { allChannels: input.allChannels, version: { increment: 1 } } });
    if (updated.count !== 1) throw new HttpError(409, 'Someone else changed this role since you opened it. Reload to see the changes.');
    await tx.roleGrant.deleteMany({ where: { roleId: id } });
    await tx.roleScope.deleteMany({ where: { roleId: id } });
    if (grants.length) await tx.roleGrant.createMany({ data: grants.map((x) => ({ id: uuidv7(), roleId: id, module: x.module, action: x.action })) });
    if (!input.allChannels) await tx.roleScope.createMany({ data: channelIds.map((channelId) => ({ id: uuidv7(), roleId: id, channelId })) });
  });
}

// ---------------------------------------------------------------- users

export async function listUsers() {
  await ensureCompanyBasics();
  const memberships = await db.membership.findMany({
    include: {
      role: true,
      user: { include: { memberships: { include: { tenant: true, role: true } } } },
    },
  });
  const tenantId = currentTenantId();
  return memberships
    .map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      platformAdmin: m.user.platformAdmin,
      mfaEnabled: m.user.mfaEnabled,
      lastActiveAt: m.user.lastActiveAt?.toISOString() ?? null,
      status: m.status,
      roleId: m.roleId,
      memberships: m.user.memberships
        .map((x) => ({ company: x.tenant.name, role: x.role.name, current: x.tenantId === tenantId }))
        .sort((a, b) => Number(b.current) - Number(a.current) || a.company.localeCompare(b.company)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function roleOfCompany(roleId: string) {
  const role = await db.role.findFirst({ where: { id: roleId } });
  if (!role) throw new HttpError(422, 'Pick a role of this company.');
  return role;
}

export async function inviteUser(input: { name: string; email: string; roleId: string }) {
  await ensureCompanyBasics();
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, 'Type a valid e-mail address.');
  if (!name) throw new HttpError(422, 'A name is required.');
  const role = await roleOfCompany(input.roleId);
  const user = (await platformDb.user.findUnique({ where: { email } })) ?? (await platformDb.user.create({ data: { id: uuidv7(), email, name } }));
  if (await db.membership.findFirst({ where: { userId: user.id } })) throw new HttpError(422, `${email} is already a member of this company.`);
  await db.membership.create({ data: { id: uuidv7(), userId: user.id, roleId: role.id, status: 'invited' } as Prisma.MembershipUncheckedCreateInput });
  return user.id;
}

async function membershipOf(userId: string) {
  const m = await db.membership.findFirst({ where: { userId }, include: { role: true } });
  if (!m) throw notFound('Member');
  return m;
}

/** A company always keeps at least one company admin. */
async function keepsAnAdmin(userId: string) {
  const admins = await db.membership.count({ where: { role: { systemKey: 'company-admin' }, userId: { not: userId } } });
  if (!admins) throw new HttpError(409, 'The company needs at least one company admin.');
}

export async function changeMemberRole(userId: string, roleId: string) {
  const m = await membershipOf(userId);
  const role = await roleOfCompany(roleId);
  if (m.role.systemKey === 'company-admin' && role.systemKey !== 'company-admin') await keepsAnAdmin(userId);
  await db.membership.update({ where: { id: m.id }, data: { roleId: role.id } });
}

export async function removeMember(userId: string) {
  const m = await membershipOf(userId);
  if (m.role.systemKey === 'company-admin') await keepsAnAdmin(userId);
  await db.membership.delete({ where: { id: m.id } });
}

// ---------------------------------------------------------------- connections

export interface ConnectionInput {
  kind: string;
  adapter: string;
  detail: string;
  address: string;
  userName: string;
  /** Write-only: replaces the stored credentials when not empty. */
  credentials?: string;
}

function checkKind(kind: string, adapter: string) {
  const k = CONNECTION_KINDS.find((x) => x.key === kind);
  if (!k || !(k.adapters as readonly { code: string }[]).some((a) => a.code === adapter)) throw new HttpError(422, 'Pick a kind of connection and a system from the lists.');
}

export async function listConnections() {
  const rows = await db.connection.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] });
  const channels = await db.channel.findMany({ where: { deletedAt: null }, select: { allowedExports: true } });
  return rows.map((c) => {
    const config = (c.config ?? {}) as { address?: string; userName?: string };
    const users = c.kind === 'playout' ? channels.filter((ch) => ch.allowedExports.includes(c.adapter)).length : 0;
    return {
      id: c.id,
      kind: c.kind,
      adapter: c.adapter,
      label: connectionLabel(c.kind, c.adapter),
      detail: c.detail,
      channelCount: users,
      address: config.address ?? '',
      userName: config.userName ?? '',
      hasCredentials: !!c.secret,
      // Nothing is tested yet: a connection is "set up" once it has an address, never "connected".
      status: config.address ? 'set-up' : 'not-connected',
    };
  });
}

export async function saveConnection(id: string | null, input: ConnectionInput) {
  checkKind(input.kind, input.adapter);
  const data = {
    kind: input.kind,
    adapter: input.adapter,
    detail: input.detail.trim(),
    config: { address: input.address.trim(), userName: input.userName.trim() } as Prisma.InputJsonValue,
    ...(input.credentials ? { secret: encryptSecret(input.credentials) } : {}),
  };
  if (id) {
    if (!(await db.connection.findFirst({ where: { id } }))) throw notFound('Connection');
    await db.connection.update({ where: { id }, data });
    return id;
  }
  const c = await db.connection.create({ data: { id: uuidv7(), ...data } as Prisma.ConnectionUncheckedCreateInput });
  return c.id;
}

export async function deleteConnection(id: string) {
  if (!(await db.connection.findFirst({ where: { id } }))) throw notFound('Connection');
  await db.connection.delete({ where: { id } });
}
