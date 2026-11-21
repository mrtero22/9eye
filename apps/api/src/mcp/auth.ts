// MCP clients sign in with a personal access token (decision 0023): `Authorization: Bearer 9eye_pat_…`.
// A token names one person in one company; on every request the person must still be able to open
// that company, and the role they have now is what the tools may do.

import { createHash, randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { Tenant, User } from '@prisma/client';
import { accessOf, type Access } from '../access';
import { aiOn, canChange, companyTable, narrower, tokenTable, type AiTable } from '../aiPolicy';
import { platformDb } from '../db';

export const TOKEN_PREFIX = '9eye_pat_';
export const TOKEN_DAYS = 90;
export const TOKEN_MAX_DAYS = 365;

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function newAccessToken(): { token: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: tokenHash(token) };
}

/** Who a tool call runs as: a person's MCP token, or an agent (with its role; the person who asked, if any). */
export interface Principal {
  user: { id: string | null; name: string };
  tenant: Tenant;
  tokenId: string | null;
  /** How the audit log names it: an MCP client, an agent (decision 0024), or a person in the web app (undoing an agent's change). */
  via: 'mcp' | 'agent' | 'web';
  agentId?: string;
  access: Access;
  /** The table allows some change (decision 0025): the write tools are offered (the table and the role still decide each). */
  canWrite: boolean;
  /** What AI may do here (decision 0025): the company's table, narrowed by the token's own; unset = no limit (inside 9eye). */
  policy?: AiTable;
  /** A person approved this change in 9eye: it applies, even where the table says Ask first. */
  approved?: boolean;
}

/** The SDK passes `req.auth` through to the server factory as `authInfo`. */
interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  extra?: Record<string, unknown>;
}

export function principalOf(auth: AuthInfo | undefined): Principal {
  const p = auth?.extra?.principal as Principal | undefined;
  if (!p) throw new Error('MCP request without a checked access token');
  return p;
}

function refuse(res: Response, status: 401 | 403, message: string) {
  if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="9eye"');
  res.status(status).json({ error: message, problems: [] });
}

/** Last-used is written at most once a minute per token. */
const TOUCH_MS = 60_000;

export type TokenCheck =
  | { ok: true; principal: Principal; access: string; expiresAt: Date }
  | { ok: false; status: 401 | 403; message: string };

/**
 * Who a personal access token runs as, checked now: known, not expired or revoked, AI on for its
 * company, the person still a member. Shared by the HTTP endpoint and the stdio server.
 */
export async function checkAccessToken(token: string): Promise<TokenCheck> {
  const now = new Date();
  const row = await platformDb.accessToken.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true, tenant: true } });
  if (!row || row.revokedAt || row.expiresAt <= now) return { ok: false, status: 401, message: 'This access token is not valid: it is unknown, has expired or was revoked.' };
  // The company decides first (Settings › AI access): off refuses every token, read only hides the write tools.
  if (!aiOn(row.tenant)) return { ok: false, status: 403, message: `AI access is off for ${row.tenant.name}: a company admin can turn it on in Settings › AI access.` };
  const access = await accessOf(row.user, row.tenantId);
  if (!access) return { ok: false, status: 403, message: 'You are not a member of this company any more.' };
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_MS) {
    await platformDb.accessToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  }
  // what AI may do: the company's table, narrowed by the token's own (decision 0025)
  const own = tokenTable(row);
  const policy = own ? narrower(own, companyTable(row.tenant)) : companyTable(row.tenant);
  const principal: Principal = { user: row.user, tenant: row.tenant, tokenId: row.id, via: 'mcp', access, canWrite: canChange(policy), policy };
  return { ok: true, principal, access: row.access, expiresAt: row.expiresAt };
}

export const requireAccessToken: RequestHandler = async (req: Request, res, next) => {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.header('authorization') ?? '');
  if (!m) return refuse(res, 401, 'Send a personal access token: "Authorization: Bearer <token>".');
  const checked = await checkAccessToken(m[1]);
  if (!checked.ok) return refuse(res, checked.status, checked.message);
  const { principal } = checked;
  const auth: AuthInfo = { token: m[1], clientId: principal.tokenId!, scopes: [checked.access], expiresAt: Math.floor(checked.expiresAt.getTime() / 1000), extra: { principal } };
  (req as Request & { auth?: AuthInfo }).auth = auth;
  next();
};
