// AI access (decisions 0023, 0025; docs/design/ai-access-page.md): each person's own personal access
// tokens, each with its own limits (the same as the company, read only, or custom — never wider than
// the company); and what AI may do in a company — AI on or off, and a table of parts × actions, each
// Allowed, Ask first or Off — with the longest token life, set by its admin.

import type { AccessToken, Tenant, User } from '@prisma/client';
import { uuidv7 } from '@9eye/core';
import { accessOf, type Access } from '../access';
import {
  ACTION_INFO, AI_PARTS, PART_INFO, aiOn, canChange, companyTable, narrower, normalize, preset, presetOf, roleTable, tableWords, tokenTable, widerCells,
  type AiAction, type AiPart, type AiPreset, type AiTable,
} from '../aiPolicy';
import { record } from '../audit';
import { platformDb } from '../db';
import { HttpError, notFound } from '../errors';
import { TOKEN_MAX_DAYS, newAccessToken } from '../mcp/auth';

export const TOKEN_DAY_CHOICES = [30, 90, 180, 365] as const;

/** working · expired · revoked · left (the person may not open the company any more). */
export type TokenState = 'ok' | 'expired' | 'revoked' | 'left';
/** same: follows the company's table · read: reads only · custom: its own table. */
export type TokenLimits = 'same' | 'read' | 'custom';

export interface AiTokenDto {
  id: string;
  name: string;
  /** read: its limits change nothing; edit: they let it change something (the role still decides each step). */
  access: 'read' | 'edit';
  limits: TokenLimits;
  /** Its limits in words ("Drafts · follows the company", "Read only", "Layouts, Playlist: change; the rest read"). */
  limitsText: string;
  /** Its own table (custom), or null. */
  table: AiTable | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  state: TokenState;
  company: { id: string; slug: string; name: string };
  person: { id: string; name: string; email: string };
}

/** A role that can change something: a token that changes is possible. */
const canEdit = (a: Access) => a.all || [...a.grants].some((g) => g.endsWith(':edit'));

function limitsOf(t: AccessToken): { limits: TokenLimits; table: AiTable | null } {
  const own = tokenTable(t);
  if (!own) return { limits: 'same', table: null };
  return presetOf(own) === 'read' ? { limits: 'read', table: null } : { limits: 'custom', table: own };
}

function tokenDto(t: AccessToken & { tenant: Tenant; user: User }, open: boolean, now = new Date()): AiTokenDto {
  const state: TokenState = t.revokedAt ? 'revoked' : t.expiresAt <= now ? 'expired' : open ? 'ok' : 'left';
  const { limits, table } = limitsOf(t);
  const company = companyTable(t.tenant);
  const limitsText = limits === 'same' ? `${tableWords(company)} · follows the company` : limits === 'read' ? 'Read only' : tableWords(narrower(table!, company));
  const effective = table ? narrower(table, company) : limits === 'read' ? preset('read') : company;
  return {
    id: t.id, name: t.name, access: canChange(effective) ? 'edit' : 'read', limits, limitsText, table, createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null, expiresAt: t.expiresAt.toISOString(), revokedAt: t.revokedAt?.toISOString() ?? null, state,
    company: { id: t.tenant.id, slug: t.tenant.slug, name: t.tenant.name }, person: { id: t.user.id, name: t.user.name, email: t.user.email },
  };
}

/** The rows and columns of the table, for the pages (labels, what a part holds, what a cell means). */
export interface AiTableShape {
  parts: { key: AiPart; label: string; holds: string; actions: AiAction[]; notes: Partial<Record<AiAction, string>> }[];
  actions: { key: AiAction; label: string; hint: string }[];
}

export const TABLE_SHAPE: AiTableShape = {
  parts: AI_PARTS.map((key) => ({ key, label: PART_INFO[key].label, holds: PART_INFO[key].holds, actions: PART_INFO[key].actions, notes: PART_INFO[key].notes ?? {} })),
  actions: (Object.keys(ACTION_INFO) as AiAction[]).map((key) => ({ key, ...ACTION_INFO[key] })),
};

// ---------------------------------------------------------------- a person's own tokens

export interface MyCompanyDto {
  id: string;
  slug: string;
  name: string;
  /** AI is on in the company. */
  on: boolean;
  /** What AI may do there: no token can be wider. */
  table: AiTable;
  preset: AiPreset;
  maxDays: number;
  /** The person's role there, in words. */
  role: string;
  /** The role can change something. */
  canEdit: boolean;
  /** For each cell, the person's role allows it (a token never does more). */
  roleCan: Record<AiPart, Partial<Record<AiAction, boolean>>>;
}

/** The person's tokens (newest first) and the companies they can make one for. */
export async function myAiAccess(user: User): Promise<{ tokens: AiTokenDto[]; companies: MyCompanyDto[]; shape: AiTableShape }> {
  const tenants = await platformDb.tenant.findMany({
    where: user.platformAdmin ? {} : { memberships: { some: { userId: user.id, status: 'active' } } },
    include: { memberships: { where: { userId: user.id, status: 'active' }, include: { role: true } } },
    orderBy: { name: 'asc' },
  });
  const companies: MyCompanyDto[] = [];
  for (const t of tenants) {
    const a = await accessOf(user, t.id);
    if (!a) continue;
    const table = companyTable(t);
    companies.push({
      id: t.id, slug: t.slug, name: t.name, on: aiOn(t), table, preset: presetOf(table), maxDays: Math.min(t.aiTokenMaxDays, TOKEN_MAX_DAYS),
      role: user.platformAdmin ? 'Platform admin' : (t.memberships[0]?.role.name ?? 'Member'), canEdit: canEdit(a), roleCan: roleTable(a),
    });
  }
  const open = new Set(companies.map((c) => c.id));
  const rows = await platformDb.accessToken.findMany({ where: { userId: user.id }, include: { tenant: true, user: true }, orderBy: { createdAt: 'desc' } });
  return { tokens: rows.map((r) => tokenDto(r, open.has(r.tenantId))), companies, shape: TABLE_SHAPE };
}

export interface MakeTokenInput {
  company: string;
  name: string;
  /** same as the company · read only · its own table (never wider than the company). */
  limits: { kind: 'same' } | { kind: 'read' } | { kind: 'custom'; table?: unknown };
  days: number;
}

/** Makes a token: the only time its text is seen. Kept in the company's activity. */
export async function makeToken(user: User, input: MakeTokenInput): Promise<{ token: string; row: AiTokenDto }> {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new HttpError(422, 'The name is required and has at most 100 characters.');
  const tenant = await platformDb.tenant.findUnique({ where: { slug: input.company } });
  const a = tenant ? await accessOf(user, tenant.id) : null;
  if (!tenant || !a) throw new HttpError(403, 'You cannot open that company.');
  if (!aiOn(tenant)) throw new HttpError(409, `AI access is off for ${tenant.name}: a company admin can turn it on in Settings › AI access.`);
  const company = companyTable(tenant);
  let own: AiTable | null = null;
  if (input.limits.kind === 'read') own = preset('read');
  if (input.limits.kind === 'custom') {
    own = normalize(input.limits.table);
    const wider = widerCells(own, company);
    if (wider.length) throw new HttpError(409, `${tenant.name} does not allow this much: ${wider.join(', ')}.`);
  }
  const maxDays = Math.min(tenant.aiTokenMaxDays, TOKEN_MAX_DAYS);
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > maxDays) throw new HttpError(422, `${tenant.name} allows tokens of up to ${maxDays} days.`);
  // "read" marks a read-only token (as before 0025); anything else follows its table — the company's, or its own
  const access = input.limits.kind === 'read' ? 'read' : 'edit';
  const { token, hash } = newAccessToken();
  const row = await platformDb.accessToken.create({
    data: {
      id: uuidv7(), userId: user.id, tenantId: tenant.id, name, tokenHash: hash, access, expiresAt: new Date(Date.now() + input.days * 86_400_000),
      ...(own ? { policy: own } : {}),
    },
    include: { tenant: true, user: true },
  });
  await record({ tenantId: tenant.id, userId: user.id, via: 'web', action: 'POST /me/ai-tokens', targetId: row.id, ok: true, status: 201, input: { name, limits: input.limits.kind, days: input.days } });
  return { token, row: tokenDto(row, true) };
}

/** Revokes one of the person's own tokens. */
export async function revokeMine(user: User, id: string): Promise<void> {
  const t = await platformDb.accessToken.findFirst({ where: { id, userId: user.id } });
  if (!t) throw notFound('Token');
  if (t.revokedAt) return;
  await platformDb.accessToken.update({ where: { id }, data: { revokedAt: new Date() } });
  await record({ tenantId: t.tenantId, userId: user.id, via: 'web', action: 'DELETE /me/ai-tokens/:id', targetId: id, ok: true, status: 204, input: { name: t.name } });
}

// ---------------------------------------------------------------- the company (Settings › AI access)

export interface AiPolicyDto {
  /** AI is on: tokens work and agents run. */
  on: boolean;
  table: AiTable;
  preset: AiPreset;
  maxDays: number;
  /** The choices for the longest token life. */
  dayChoices: number[];
  shape: AiTableShape;
}

export async function companyPolicy(tenantId: string): Promise<AiPolicyDto> {
  const t = await platformDb.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const table = companyTable(t);
  return { on: aiOn(t), table, preset: presetOf(table), maxDays: t.aiTokenMaxDays, dayChoices: [...TOKEN_DAY_CHOICES], shape: TABLE_SHAPE };
}

export async function savePolicy(tenantId: string, input: { on: boolean; table: unknown; maxDays: number }): Promise<AiPolicyDto> {
  if (!(TOKEN_DAY_CHOICES as readonly number[]).includes(input.maxDays)) throw new HttpError(422, `The longest token life is one of ${TOKEN_DAY_CHOICES.join(', ')} days.`);
  const table = normalize(input.table);
  await platformDb.tenant.update({ where: { id: tenantId }, data: { aiAccess: input.on ? 'on' : 'off', aiPolicy: table, aiTokenMaxDays: input.maxDays } });
  return companyPolicy(tenantId);
}

/** Every token of the company, newest first. */
export async function companyTokens(tenantId: string): Promise<AiTokenDto[]> {
  const rows = await platformDb.accessToken.findMany({ where: { tenantId }, include: { tenant: true, user: true }, orderBy: { createdAt: 'desc' } });
  const open = new Map<string, boolean>();
  for (const r of rows) if (!open.has(r.userId)) open.set(r.userId, !!(await accessOf(r.user, tenantId)));
  return rows.map((r) => tokenDto(r, open.get(r.userId)!));
}

export async function revokeInCompany(tenantId: string, id: string): Promise<void> {
  const t = await platformDb.accessToken.findFirst({ where: { id, tenantId } });
  if (!t) throw notFound('Token');
  if (!t.revokedAt) await platformDb.accessToken.update({ where: { id }, data: { revokedAt: new Date() } });
}
