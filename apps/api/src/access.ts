// Who may do what in a company (decision 0007): a role grants module × action, on every channel or on
// selected ones; platform admins may do everything. One place for these checks: the MCP tools use it
// now (decision 0023), the REST routes move onto it later (0023, phase 2).

import type { User } from '@prisma/client';
import { MODULES, type ActionKey, type ModuleKey } from '@9eye/core';
import { platformDb } from './db';
import { HttpError } from './errors';

export interface Access {
  /** A platform admin: everything, on every channel. */
  all: boolean;
  /** "module:action" */
  grants: Set<string>;
  /** null = every channel. */
  channelIds: Set<string> | null;
}

/** What the person may do in the company; null when they may not open it at all. */
export async function accessOf(user: Pick<User, 'id' | 'platformAdmin'>, tenantId: string): Promise<Access | null> {
  if (user.platformAdmin) return { all: true, grants: new Set(), channelIds: null };
  const m = await platformDb.membership.findFirst({
    where: { tenantId, userId: user.id, status: 'active' },
    include: { role: { include: { grants: true, scopes: true } } },
  });
  if (!m) return null;
  return {
    all: false,
    grants: new Set(m.role.grants.map((g) => `${g.module}:${g.action}`)),
    channelIds: m.role.allChannels ? null : new Set(m.role.scopes.map((s) => s.channelId)),
  };
}

/** The channel is one the role reaches (any module). */
export const reachesChannel = (a: Access, channelId: string) => a.all || !a.channelIds || a.channelIds.has(channelId);

export function can(a: Access, module: ModuleKey, action: ActionKey, channelId?: string): boolean {
  if (a.all) return true;
  if (!a.grants.has(`${module}:${action}`)) return false;
  return !channelId || reachesChannel(a, channelId);
}

const ACTION_WORD: Record<ActionKey, string> = { view: 'view', edit: 'change', approve: 'approve', export: 'export' };

/** Throws 403 unless the role allows it. */
export function demand(a: Access, module: ModuleKey, action: ActionKey, channelId?: string): void {
  if (can(a, module, action, channelId)) return;
  const label = MODULES.find((m) => m.key === module)?.label ?? module;
  const where = channelId && a.grants.has(`${module}:${action}`) ? ' on this channel' : '';
  throw new HttpError(403, `Your role does not let you ${ACTION_WORD[action]} ${label}${where}.`);
}
