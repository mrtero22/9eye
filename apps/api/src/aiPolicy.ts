// What AI may do (decision 0025): one table of parts × actions, each cell Allowed ("on"), Ask first
// ("ask") or Off. The company sets it (Settings › AI access); a token can be narrower; agents follow
// the company's table for what is Off (they always ask first). A person's role bounds it all.

import type { ModuleKey, ActionKey } from '@9eye/core';
import { can, type Access } from './access';

export const AI_PARTS = ['media', 'layouts', 'scheduling', 'playlist', 'ads', 'channels'] as const;
export type AiPart = (typeof AI_PARTS)[number];
export const AI_ACTIONS = ['read', 'change', 'create', 'approve', 'export'] as const;
export type AiAction = (typeof AI_ACTIONS)[number];
export type AiCell = 'on' | 'ask' | 'off';
export type AiTable = Record<AiPart, Partial<Record<AiAction, AiCell>>>;
export type AiPreset = 'read' | 'drafts' | 'full' | 'custom';

const RANK: Record<AiCell, number> = { off: 0, ask: 1, on: 2 };

/** The parts, in the table's order: what each holds, the actions it has, and what a cell means when it is not plain. */
export const PART_INFO: Record<AiPart, { label: string; holds: string; actions: AiAction[]; notes?: Partial<Record<AiAction, string>> }> = {
  media: { label: 'Media', holds: 'Categories, titles, items, rotation lists', actions: ['read', 'change', 'create'] },
  layouts: { label: 'Layouts', holds: 'Layouts, block types, break lists', actions: ['read', 'change', 'create'] },
  scheduling: { label: 'Scheduling', holds: 'Plans and their airings', actions: ['read', 'change', 'create', 'approve'], notes: { approve: 'Confirm a plan' } },
  playlist: {
    label: 'Playlist', holds: 'Weeks and day playlists', actions: ['read', 'change', 'create', 'approve', 'export'],
    notes: { approve: 'Approve or reopen a day for air', export: 'A day’s playout file' },
  },
  ads: { label: 'Ads', holds: 'Clients, deals, campaigns, bookings', actions: ['read', 'change', 'create', 'approve'], notes: { approve: 'Confirm a campaign' } },
  channels: { label: 'Channels', holds: 'New channels, channel settings, break positions', actions: ['read', 'change', 'create'] },
};

export const ACTION_INFO: Record<AiAction, { label: string; hint: string }> = {
  read: { label: 'Read', hint: 'Look things up' },
  change: { label: 'Change', hint: 'What exists' },
  create: { label: 'Create and delete', hint: 'New things, or take away' },
  approve: { label: 'Approve', hint: 'Confirm, or put on air' },
  export: { label: 'Export', hint: 'Files out of 9eye' },
};

export function preset(id: Exclude<AiPreset, 'custom'>): AiTable {
  const t = {} as AiTable;
  for (const part of AI_PARTS) {
    const row: Partial<Record<AiAction, AiCell>> = {};
    for (const a of PART_INFO[part].actions) {
      if (id === 'full') row[a] = 'on';
      else if (a === 'read') row[a] = 'on';
      // Drafts: weeks, days and bookings — Playlist change and create, Ads change (no clients, deals or campaigns made or deleted)
      else if (id === 'drafts' && ((part === 'playlist' && (a === 'change' || a === 'create')) || (part === 'ads' && a === 'change'))) row[a] = 'on';
      else row[a] = 'off';
    }
    t[part] = row;
  }
  return t;
}

const same = (a: AiTable, b: AiTable) => AI_PARTS.every((p) => PART_INFO[p].actions.every((a2) => a[p][a2] === b[p][a2]));

export function presetOf(t: AiTable): AiPreset {
  for (const id of ['read', 'drafts', 'full'] as const) if (same(t, preset(id))) return id;
  return 'custom';
}

/** A stored table made whole: every applicable cell set (missing → off), read only on or off. */
export function normalize(v: unknown): AiTable {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, Record<string, unknown>>;
  const t = {} as AiTable;
  for (const part of AI_PARTS) {
    const row: Partial<Record<AiAction, AiCell>> = {};
    for (const a of PART_INFO[part].actions) {
      const x = src[part]?.[a];
      const cell: AiCell = x === 'on' || x === 'ask' || x === 'off' ? x : 'off';
      // Read and Export are Allowed or Off: a read asked first is Allowed, an export asked first is Off
      row[a] = cell === 'ask' && a === 'read' ? 'on' : cell === 'ask' && a === 'export' ? 'off' : cell;
    }
    t[part] = row;
  }
  return t;
}

/** Whether AI works in the company at all (Settings › AI access › AI on). */
export const aiOn = (t: { aiAccess: string }) => t.aiAccess !== 'off';

/** The company's table: stored, or from its choice before 0025 ("edit" → Drafts, else Read only). */
export function companyTable(t: { aiAccess: string; aiPolicy: unknown }): AiTable {
  if (t.aiPolicy && typeof t.aiPolicy === 'object') return normalize(t.aiPolicy);
  return t.aiAccess === 'edit' ? preset('drafts') : preset('read');
}

/** A token's own table; null = the same as the company (a token made before 0025 with "read" reads only). */
export function tokenTable(row: { policy: unknown; access: string }): AiTable | null {
  if (row.policy && typeof row.policy === 'object') return normalize(row.policy);
  return row.access === 'read' ? preset('read') : null;
}

/** Cell by cell, the smaller of the two. */
export function narrower(a: AiTable, b: AiTable): AiTable {
  const t = {} as AiTable;
  for (const part of AI_PARTS) {
    const row: Partial<Record<AiAction, AiCell>> = {};
    for (const x of PART_INFO[part].actions) {
      const p = a[part][x] ?? 'off';
      const q = b[part][x] ?? 'off';
      row[x] = RANK[p] <= RANK[q] ? p : q;
    }
    t[part] = row;
  }
  return t;
}

/** The cells of `inner` that are wider than `outer` ("Layouts › Change"). */
export function widerCells(inner: AiTable, outer: AiTable): string[] {
  const out: string[] = [];
  for (const part of AI_PARTS) {
    for (const a of PART_INFO[part].actions) {
      if (RANK[inner[part][a] ?? 'off'] > RANK[outer[part][a] ?? 'off']) out.push(`${PART_INFO[part].label} › ${ACTION_INFO[a].label}`);
    }
  }
  return out;
}

/** A table that lets AI change something (some cell other than Read is not Off). */
export const canChange = (t: AiTable) => AI_PARTS.some((p) => PART_INFO[p].actions.some((a) => a !== 'read' && t[p][a] !== 'off'));

// ---------------------------------------------------------------- the tools' cells

/** The cell each tool belongs to; a tool not listed is always there (list_channels, undo_change). */
export const TOOL_CELL: Record<string, [AiPart, AiAction]> = {
  get_day_playlist: ['playlist', 'read'], check_day: ['playlist', 'read'], list_weeks: ['playlist', 'read'],
  rename_week: ['playlist', 'change'], delete_week: ['playlist', 'create'], export_day: ['playlist', 'export'],
  create_weeks: ['playlist', 'create'], fill_day: ['playlist', 'change'], edit_day: ['playlist', 'change'],
  approve_day: ['playlist', 'approve'], reopen_day: ['playlist', 'approve'],
  search_media: ['media', 'read'], edit_media: ['media', 'change'], add_to_rotation_list: ['media', 'change'],
  list_categories: ['media', 'read'], get_title: ['media', 'read'], get_rotation_lists: ['media', 'read'],
  create_category: ['media', 'create'], create_title: ['media', 'create'], create_item: ['media', 'create'], create_episodes: ['media', 'create'],
  delete_media: ['media', 'create'], create_cut: ['media', 'create'], create_rotation_list: ['media', 'create'], clone_rotation_list: ['media', 'create'],
  delete_rotation_list: ['media', 'create'],
  edit_category: ['media', 'change'], edit_title: ['media', 'change'], recut: ['media', 'change'], edit_rotation_list: ['media', 'change'],
  shuffle_rotation_list: ['media', 'change'], edit_relations: ['media', 'change'],
  list_plans: ['scheduling', 'read'], get_plan: ['scheduling', 'read'],
  create_plan: ['scheduling', 'create'], duplicate_plan: ['scheduling', 'create'], split_plan: ['scheduling', 'create'], delete_plan: ['scheduling', 'create'],
  edit_plan: ['scheduling', 'change'], place_airings: ['scheduling', 'change'], remove_airings: ['scheduling', 'change'], shift_episodes: ['scheduling', 'change'],
  replace_items: ['scheduling', 'change'], move_airings: ['scheduling', 'change'], confirm_plan: ['scheduling', 'approve'],
  list_deals: ['ads', 'read'], get_deal: ['ads', 'read'], get_campaign: ['ads', 'read'], list_clients: ['ads', 'read'],
  create_client: ['ads', 'create'], delete_client: ['ads', 'create'], create_deal: ['ads', 'create'], delete_deal: ['ads', 'create'],
  create_campaigns: ['ads', 'create'], delete_campaign: ['ads', 'create'],
  edit_client: ['ads', 'change'], edit_deal: ['ads', 'change'], edit_campaign: ['ads', 'change'],
  book_campaign_spots: ['ads', 'change'], remove_campaign_spots: ['ads', 'change'], confirm_campaign: ['ads', 'approve'],
  get_layout: ['layouts', 'read'], edit_layout: ['layouts', 'change'], rename_layout: ['layouts', 'change'],
  create_layout: ['layouts', 'create'], clone_layout: ['layouts', 'create'], delete_layout: ['layouts', 'create'],
  create_block_type: ['layouts', 'create'], edit_block_type: ['layouts', 'change'], delete_block_type: ['layouts', 'create'],
  create_break_list: ['layouts', 'create'], edit_break_list: ['layouts', 'change'], delete_break_list: ['layouts', 'create'],
  get_channel: ['channels', 'read'], create_channel: ['channels', 'create'], edit_channel: ['channels', 'change'],
  edit_break_positions: ['channels', 'change'],
};

export function cellOf(t: AiTable | undefined, tool: string): AiCell {
  const c = TOOL_CELL[tool];
  if (!t || !c) return 'on';
  return t[c[0]][c[1]] ?? 'off';
}

// ---------------------------------------------------------------- the role

/** What a role needs for each cell (a role is checked again by every tool). */
const ROLE_NEED: Record<AiPart, Partial<Record<AiAction, [ModuleKey, ActionKey]>>> = {
  media: { read: ['catalog', 'view'], change: ['catalog', 'edit'], create: ['catalog', 'edit'] },
  layouts: { read: ['templates', 'view'], change: ['templates', 'edit'], create: ['templates', 'edit'] },
  scheduling: { read: ['orders', 'view'], change: ['orders', 'edit'], create: ['orders', 'edit'], approve: ['orders', 'edit'] },
  playlist: { read: ['playlist', 'view'], change: ['playlist', 'edit'], create: ['playlist', 'edit'], approve: ['playlist', 'approve'], export: ['playlist', 'export'] },
  ads: { read: ['orders', 'view'], change: ['orders', 'edit'], create: ['orders', 'edit'], approve: ['orders', 'edit'] },
  channels: { read: ['admin', 'view'], change: ['admin', 'edit'], create: ['admin', 'edit'] },
};

/** For each cell: the role allows it. */
export function roleTable(a: Access): Record<AiPart, Partial<Record<AiAction, boolean>>> {
  const t = {} as Record<AiPart, Partial<Record<AiAction, boolean>>>;
  for (const part of AI_PARTS) {
    t[part] = {};
    for (const x of PART_INFO[part].actions) {
      const need = ROLE_NEED[part][x]!;
      t[part][x] = part === 'channels' && x === 'read' ? true : can(a, need[0], need[1]);
    }
  }
  return t;
}

/** The table in words, for a token's line ("Playlist and Ads: change; the rest read"). */
export function tableWords(t: AiTable): string {
  const p = presetOf(t);
  if (p === 'read') return 'Read only';
  if (p === 'drafts') return 'Drafts';
  if (p === 'full') return 'Full';
  const changing = AI_PARTS.filter((x) => PART_INFO[x].actions.some((a) => a !== 'read' && t[x][a] !== 'off')).map((x) => PART_INFO[x].label);
  return changing.length ? `${changing.join(', ')}: change; the rest read` : 'Read only';
}
