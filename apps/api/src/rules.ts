// Who may call which API route (decision 0023, phase 2; roles of decision 0007). Every route of a
// company has one rule here: the grants it needs (any one of them) and where the channels it touches
// come from, whose scope the role must reach. A route without a rule stops the API from starting.
//
// Channel scope applies to what belongs to a channel: channels, layouts, block types, break lists,
// weeks, days, plans and campaigns. Media, clients, deals and Settings belong to the whole company.

import { Router, type Request, type RequestHandler } from 'express';
import type { ActionKey, ModuleKey } from '@9eye/core';
import { can, demand, reachesChannel, type Access } from './access';
import { db } from './db';
import { HttpError } from './errors';

export type Grant = `${ModuleKey}:${ActionKey}`;

export interface Rule {
  /** Any one of these grants; "member" = every member of the company; "platform-admin" = only them. */
  need: Grant | Grant[] | 'member' | 'platform-admin';
  /** The channels the request touches. */
  channels?: (req: Request) => Promise<string[]>;
  /** A POST that changes nothing (a preview or a check): not written to the audit log. */
  preview?: true | ((req: Request) => boolean);
}

/** What the guard found, read by the audit log. */
export interface Checked {
  action: string;
  targetId: string | null;
  channelIds: string[];
  preview: boolean;
}

// ---------------------------------------------------------------- where the channels come from

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A well-formed id, else null: the route's own parsing answers 400 for the rest. */
const uuid = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
const unique = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

/** By id within the current company: an id of another company finds nothing (the route then answers 404). */
const playlistChannel = async (id: string | null) =>
  id ? ((await db.channelPlaylist.findFirst({ where: { id }, select: { channelId: true } }))?.channelId ?? null) : null;
const orderChannels = async (id: string | null) =>
  id ? ((await db.order.findFirst({ where: { id }, select: { channels: { select: { channelId: true } } } }))?.channels.map((c) => c.channelId) ?? []) : [];

const from = {
  param: async (req: Request) => unique([uuid(req.params.id)]),
  bodyPlaylist: async (req: Request) => unique([await playlistChannel(uuid(req.body?.playlistId))]),
  bodyChannels: async (req: Request) => unique(Array.isArray(req.body?.channelIds) ? req.body.channelIds.map(uuid) : []),
  template: async (req: Request) => {
    const id = uuid(req.params.id);
    return unique([id ? (await db.template.findFirst({ where: { id }, select: { playlist: { select: { channelId: true } } } }))?.playlist.channelId : null]);
  },
  week: async (req: Request) => {
    const id = uuid(req.params.id);
    return unique([id ? (await db.week.findFirst({ where: { id }, select: { playlist: { select: { channelId: true } } } }))?.playlist.channelId : null]);
  },
  day: async (req: Request) => {
    const id = uuid(req.params.id);
    return unique([id ? (await db.dayPlaylist.findFirst({ where: { id }, select: { playlist: { select: { channelId: true } } } }))?.playlist.channelId : null]);
  },
  blockType: async (req: Request) => {
    const id = uuid(req.params.id);
    return unique([id ? (await db.blockType.findFirst({ where: { id }, select: { playlist: { select: { channelId: true } } } }))?.playlist.channelId : null]);
  },
  breakList: async (req: Request) => {
    const id = uuid(req.params.id);
    return unique([id ? (await db.breakList.findFirst({ where: { id }, select: { channelId: true } }))?.channelId : null]);
  },
  /** A plan or a campaign. */
  order: async (req: Request) => unique(await orderChannels(uuid(req.params.id))),
  /** Moving airings: the plan they leave and the one they go to. */
  orderAndTarget: async (req: Request) => unique([...(await orderChannels(uuid(req.params.id))), ...(await orderChannels(uuid(req.body?.targetId)))]),
};

// ---------------------------------------------------------------- the rules

/** The shared Media picker is read from every page that places media. */
const PICKER: Grant[] = ['catalog:view', 'playlist:view', 'orders:view', 'templates:view', 'admin:view'];

export const RULES: Record<string, Rule> = {
  // Channels and their settings
  'GET /channels': { need: 'member' }, // the list holds only the channels the role reaches
  'POST /channels': { need: 'admin:edit' },
  'GET /channels/:id': { need: 'member', channels: from.param },
  'GET /channels/:id/usage': { need: 'admin:view', channels: from.param },
  'PUT /channels/:id': { need: 'admin:edit', channels: from.param },

  // Layouts
  'GET /channels/:id/templates': { need: ['templates:view', 'playlist:view'], channels: from.param },
  'POST /templates': { need: 'templates:edit', channels: from.bodyPlaylist },
  'GET /templates/:id': { need: 'templates:view', channels: from.template },
  'PUT /templates/:id': { need: 'templates:edit', channels: from.template },
  'POST /templates/:id/clone': { need: 'templates:edit', channels: from.template },
  'DELETE /templates/:id': { need: 'templates:edit', channels: from.template },
  'GET /block-types': { need: 'templates:view' }, // the list holds only the channels the role reaches
  'GET /block-groups': { need: 'templates:view' },
  'POST /block-types': { need: 'templates:edit', channels: from.bodyPlaylist },
  'POST /block-types/bulk': { need: 'templates:edit', channels: from.bodyPlaylist },
  'PATCH /block-types/:id': { need: 'templates:edit', channels: from.blockType },
  'DELETE /block-types/:id': { need: 'templates:edit', channels: from.blockType },
  'GET /channels/:id/break-lists': { need: ['templates:view', 'admin:view'], channels: from.param },
  'POST /channels/:id/break-lists': { need: 'templates:edit', channels: from.param },
  'PATCH /break-lists/:id': { need: 'templates:edit', channels: from.breakList },
  'DELETE /break-lists/:id': { need: 'templates:edit', channels: from.breakList },

  // Playlist: weeks and days
  'GET /channels/:id/weeks': { need: 'playlist:view', channels: from.param },
  'POST /channels/:id/weeks/check': { need: 'playlist:edit', channels: from.param, preview: true },
  'POST /channels/:id/weeks': { need: 'playlist:edit', channels: from.param },
  'GET /weeks/:id': { need: 'playlist:view', channels: from.week },
  'PATCH /weeks/:id': { need: 'playlist:edit', channels: from.week },
  'DELETE /weeks/:id': { need: 'playlist:edit', channels: from.week },
  'GET /channels/:id/days/:date': { need: 'playlist:view', channels: from.param },
  'GET /channels/:id/days/:date/export': { need: 'playlist:export', channels: from.param },
  'POST /days/catalog-rows': { need: 'playlist:edit', preview: true },
  'PUT /days/:id': { need: 'playlist:edit', channels: from.day },
  'POST /days/:id/run': { need: 'playlist:edit', channels: from.day, preview: true },
  'GET /rotation-lists': { need: 'playlist:view' },
  'POST /days/:id/publish': { need: 'playlist:approve', channels: from.day },
  'POST /days/:id/unpublish': { need: 'playlist:approve', channels: from.day },

  // Media
  'GET /catalog/types': { need: PICKER },
  'GET /catalog/types/:id/contents': { need: PICKER },
  'GET /catalog/contents/:id/productions': { need: PICKER },
  'GET /catalog/search': { need: PICKER },
  'GET /catalog/lookups': { need: 'catalog:view' },
  'GET /catalog/columns/:level': { need: 'catalog:view' },
  'GET /catalog/items/:level/:id': { need: 'catalog:view' },
  'POST /catalog/items/:level': { need: 'catalog:edit' },
  'PUT /catalog/items/:level/:id': { need: 'catalog:edit' },
  'POST /catalog/delete-check/:level': { need: 'catalog:edit', preview: true },
  'POST /catalog/delete/:level': { need: 'catalog:edit' },
  'POST /catalog/bulk-edit/:level': { need: 'catalog:edit' },
  'GET /catalog/contents/:id/next-episode': { need: 'catalog:view' },
  'POST /catalog/contents/:id/series': { need: 'catalog:edit' },
  'POST /catalog/productions/:id/segmentations': { need: 'catalog:edit' },
  'POST /catalog/segmentations/:id/regenerate': { need: 'catalog:edit' },
  'POST /catalog/rotation-lists/:id/clone': { need: 'catalog:edit' },
  'POST /catalog/rotation-lists/:id/items': { need: 'catalog:edit' },
  'POST /catalog/rotation-lists/:id/shuffle': { need: 'catalog:edit' },
  'GET /catalog/relations/:level/:id': { need: 'catalog:view' },
  'PUT /catalog/relations/:level/:id': { need: 'catalog:edit' },

  // Scheduling plans
  'GET /channels/:id/orders': { need: 'orders:view', channels: from.param },
  'GET /channels/:id/schedule-week': { need: 'orders:view', channels: from.param },
  'GET /channels/:id/main-template': { need: 'orders:view', channels: from.param },
  'POST /orders': { need: 'orders:edit', channels: from.bodyChannels },
  'GET /orders/:id': { need: 'orders:view', channels: from.order },
  'PUT /orders/:id': { need: 'orders:edit', channels: from.order },
  'DELETE /orders/:id': { need: 'orders:edit', channels: from.order },
  'GET /orders/:id/occupied': { need: 'orders:view', channels: from.order },
  'POST /orders/:id/duplicate': { need: 'orders:edit', channels: from.order },
  'POST /orders/:id/split': { need: 'orders:edit', channels: from.order },
  'GET /orders/:id/move-targets': { need: 'orders:view', channels: from.order },
  'POST /orders/:id/move': { need: 'orders:edit', channels: from.orderAndTarget },

  // Clients, deals and campaigns
  'GET /commercials/clients': { need: 'orders:view' },
  'POST /commercials/clients': { need: 'orders:edit' },
  'PUT /commercials/clients/:id': { need: 'orders:edit' },
  'DELETE /commercials/clients/:id': { need: 'orders:edit' },
  'GET /commercials/contracts': { need: 'orders:view' },
  'POST /commercials/contracts': { need: 'orders:edit' },
  'GET /commercials/contracts/:id': { need: 'orders:view' },
  'PUT /commercials/contracts/:id': { need: 'orders:edit' },
  'DELETE /commercials/contracts/:id': { need: 'orders:edit' },
  'POST /commercials/contracts/:id/orders': { need: 'orders:edit', channels: from.bodyChannels },
  'GET /commercials/orders/:id': { need: 'orders:view', channels: from.order },
  'PUT /commercials/orders/:id': { need: 'orders:edit', channels: from.order },
  'DELETE /commercials/orders/:id': { need: 'orders:edit', channels: from.order },
  'GET /commercials/orders/:id/week': { need: 'orders:view', channels: from.order },
  'PUT /commercials/orders/:id/week': { need: 'orders:edit', channels: from.order },
  'POST /commercials/orders/:id/book': { need: 'orders:edit', channels: from.order, preview: (req) => req.body?.apply === false },

  // Settings
  'GET /admin/companies': { need: 'admin:view' }, // the list holds only the companies the person can open
  'POST /admin/companies': { need: 'platform-admin' },
  'GET /admin/roles': { need: 'admin:view' },
  'POST /admin/roles': { need: 'admin:edit' },
  'PUT /admin/roles/:id': { need: 'admin:edit' },
  'GET /admin/users': { need: 'admin:view' },
  'POST /admin/users': { need: 'admin:edit' },
  'PATCH /admin/users/:id': { need: 'admin:edit' },
  'DELETE /admin/users/:id': { need: 'admin:edit' },
  'GET /admin/connections': { need: 'admin:view' },
  'POST /admin/connections': { need: 'admin:edit' },
  'PUT /admin/connections/:id': { need: 'admin:edit' },
  'DELETE /admin/connections/:id': { need: 'admin:edit' },
  'GET /admin/break-positions': { need: ['admin:view', 'orders:view'] },
  'PUT /admin/break-positions': { need: 'admin:edit' },
  'GET /admin/activity': { need: 'admin:view' },
  'GET /admin/ai-access': { need: 'admin:view' },
  'PUT /admin/ai-access': { need: 'admin:edit' },
  'GET /admin/ai-tokens': { need: 'admin:view' },
  'DELETE /admin/ai-tokens/:id': { need: 'admin:edit' },

  // Agents (decision 0024): every member works with them — chat, rooms, change cards (their role
  // decides each change); people who can change Settings manage agents, rooms and provider keys.
  // Messages and stops change no 9eye data: the agents keep them, not the audit log.
  'GET /admin/ai-providers': { need: 'admin:view' },
  'PUT /admin/ai-providers/:provider': { need: 'admin:edit' },
  'DELETE /admin/ai-providers/:provider': { need: 'admin:edit' },
  'GET /agents': { need: 'member' },
  'POST /agents': { need: 'admin:edit' },
  'GET /agents/changes': { need: 'member' },
  'POST /agents/changes/:id/approve': { need: 'member' },
  'POST /agents/changes/:id/reject': { need: 'member' },
  'POST /agents/changes/:id/undo': { need: 'member' },
  'GET /agents/changes/:id/day': { need: 'member' },
  'POST /agents/messages/:id/skill': { need: 'member', preview: (req) => req.body?.choice !== 'save' },
  'POST /agents/runs/:id/stop': { need: 'member', preview: true },
  'POST /agents/rooms': { need: 'admin:edit' },
  'GET /agents/rooms/:id': { need: 'member' },
  'PUT /agents/rooms/:id': { need: 'admin:edit' },
  'DELETE /agents/rooms/:id': { need: 'admin:edit' },
  'POST /agents/rooms/:id/messages': { need: 'member', preview: true },
  'GET /agents/:id': { need: 'member' },
  'PUT /agents/:id': { need: 'admin:edit' },
  'DELETE /agents/:id': { need: 'admin:edit' },
  'DELETE /agents/:id/memory/:memoryId': { need: 'admin:edit' },
  'GET /agents/:id/chat': { need: 'member' },
  'POST /agents/:id/chat': { need: 'member', preview: true },
  'GET /agents/:id/runs': { need: 'member' },
  // Routines (phase B): every member makes their own (it works for them, with their role); its maker
  // or someone who can change Settings changes it. Running one now changes no 9eye data.
  'GET /agents/:id/routines': { need: 'member' },
  'POST /agents/:id/routines': { need: 'member' },
  'PUT /agents/routines/:id': { need: 'member' },
  'DELETE /agents/routines/:id': { need: 'member' },
  'POST /agents/routines/:id/run': { need: 'member', preview: true },
};

// ---------------------------------------------------------------- the guard

const split = (g: Grant) => g.split(':') as [ModuleKey, ActionKey];

/** The access of the request's person in its company (set by tenantMiddleware). */
export const accessOfRequest = (res: { locals: Record<string, unknown> }) => res.locals.access as Access;

function guard(action: string, rule: Rule): RequestHandler {
  return async (req, res, next) => {
    const a = accessOfRequest(res);
    if (rule.need === 'platform-admin') {
      if (!a.all) throw new HttpError(403, 'Only a platform admin can do this.');
    }
    const grants = typeof rule.need === 'string' ? (rule.need === 'member' || rule.need === 'platform-admin' ? [] : [rule.need]) : rule.need;
    const held = grants.filter((g) => can(a, ...split(g)));
    if (grants.length && !held.length) demand(a, ...split(grants[0]));
    const channelIds = rule.channels ? await rule.channels(req) : [];
    for (const ch of channelIds) {
      if (held.length ? !held.some((g) => can(a, ...split(g), ch)) : !reachesChannel(a, ch)) {
        if (held.length) demand(a, ...split(held[0]), ch);
        throw new HttpError(403, 'Your role does not reach this channel.');
      }
    }
    const preview = typeof rule.preview === 'function' ? rule.preview(req) : !!rule.preview;
    const checked: Checked = { action, targetId: typeof req.params.id === 'string' ? req.params.id : null, channelIds, preview };
    res.locals.checked = checked;
    next();
  };
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Add = (path: string, handler: RequestHandler) => void;

/**
 * Routes of a company, each behind its rule: `g.get('/channels', handler)`. `done()` throws when a
 * rule names a route that does not exist (a renamed or removed route).
 */
export function guarded(r: Router): Record<Method, Add> & { done: () => void } {
  const used = new Set<string>();
  const add = (method: Method): Add => (path, handler) => {
    const key = `${method.toUpperCase()} ${path}`;
    const rule = RULES[key];
    if (!rule) throw new Error(`No access rule for ${key} (src/rules.ts)`);
    used.add(key);
    r[method](path, guard(key, rule), handler);
  };
  return {
    get: add('get'), post: add('post'), put: add('put'), patch: add('patch'), delete: add('delete'),
    done: () => {
      const stale = Object.keys(RULES).filter((k) => !used.has(k));
      if (stale.length) throw new Error(`Access rules for routes that do not exist: ${stale.join(', ')}`);
    },
  };
}
