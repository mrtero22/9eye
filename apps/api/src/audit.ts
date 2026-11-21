// The audit log (decision 0023, phase 2): who changed what, through the web app or an MCP client.
// REST: every change that succeeded (previews and checks are not changes). MCP: every tool call,
// reads and failures included. Inputs are kept with secrets hidden; a very large one keeps its size.

import type { RequestHandler } from 'express';
import { uuidv7 } from '@9eye/core';
import { signedInUser } from './auth';
import { platformDb } from './db';
import type { Checked } from './rules';

const MAX_INPUT = 50_000;
const SECRET = /password|secret|token|credential|api[-_]?key/i;

function hide(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(hide);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? '[hidden]' : hide(x)]));
  return v;
}

/** What is stored of a body or arguments: null when there is none. */
export function auditInput(v: unknown): object | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return null;
  const clean = hide(v);
  const bytes = JSON.stringify(clean).length;
  if (bytes > MAX_INPUT) return { omitted: 'too large', bytes };
  return typeof clean === 'object' ? (clean as object) : { value: clean };
}

export interface AuditRecord {
  /** Given when the caller names the change before it is written (MCP write tools). */
  id?: string;
  tenantId: string;
  userId: string | null;
  via: 'web' | 'mcp' | 'agent';
  tokenId?: string | null;
  action: string;
  targetId?: string | null;
  channelIds?: string[];
  ok: boolean;
  status?: number | null;
  message?: string | null;
  input?: unknown;
  /** MCP changes: the state before and what the change made (kept whole: undo needs all of it). */
  before?: object | null;
  after?: object | null;
}

export async function record(e: AuditRecord): Promise<string> {
  const input = auditInput(e.input);
  const id = e.id ?? uuidv7();
  await platformDb.auditEvent.create({
    data: {
      id, tenantId: e.tenantId, userId: e.userId, via: e.via, tokenId: e.tokenId ?? null, action: e.action, targetId: e.targetId ?? null,
      channelIds: e.channelIds ?? [], ok: e.ok, status: e.status ?? null, message: e.message ?? null, ...(input ? { input } : {}),
      ...(e.before ? { before: e.before } : {}), ...(e.after ? { after: e.after } : {}),
    },
  });
  return id;
}

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** After the answer is sent: one event for each change through the API that succeeded. */
export const recordChanges: RequestHandler = (req, res, next) => {
  if (!CHANGES.has(req.method)) return next();
  res.on('finish', () => {
    const checked = res.locals.checked as Checked | undefined;
    if (!checked || checked.preview || res.statusCode >= 400) return;
    record({
      tenantId: (res.locals.tenant as { id: string }).id, userId: signedInUser(res).id, via: 'web', action: checked.action,
      targetId: checked.targetId, channelIds: checked.channelIds, ok: true, status: res.statusCode, input: req.body,
    }).catch((err) => console.error('audit', err));
  });
  next();
};
