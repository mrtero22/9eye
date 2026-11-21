// The parts of 9eye an agent works on (decision 0024), the tools each part gives, and what an agent
// may do: never more than its role, its parts and channels, and the person it works for allow.

import type { ModuleKey } from '@9eye/core';
import type { Access } from '../access';
import { platformDb } from '../db';
import { HttpError } from '../errors';

export const PART_KEYS = ['scheduling', 'playlist', 'ads', 'media', 'layouts'] as const;
export type PartKey = (typeof PART_KEYS)[number];
export type PartLevel = 'read' | 'edit';
export type Parts = Partial<Record<PartKey, PartLevel>>;

export interface Part {
  key: PartKey;
  label: string;
  module: ModuleKey;
  /** Tools it gives with "read", and the ones "edit" adds (their changes wait for a person). */
  read: string[];
  edit: string[];
}

export const PARTS: Part[] = [
  {
    key: 'scheduling', label: 'Scheduling', module: 'orders', read: ['list_plans', 'get_plan'],
    edit: ['create_plan', 'edit_plan', 'place_airings', 'remove_airings', 'shift_episodes', 'replace_items', 'move_airings', 'duplicate_plan', 'split_plan', 'delete_plan', 'confirm_plan'],
  },
  {
    key: 'playlist', label: 'Playlist', module: 'playlist', read: ['get_day_playlist', 'check_day', 'list_weeks', 'export_day'],
    edit: ['create_weeks', 'fill_day', 'edit_day', 'approve_day', 'reopen_day', 'rename_week', 'delete_week'],
  },
  {
    key: 'ads', label: 'Ads', module: 'orders', read: ['list_deals', 'get_deal', 'get_campaign', 'list_clients'],
    edit: [
      'book_campaign_spots', 'confirm_campaign', 'remove_campaign_spots', 'create_client', 'edit_client', 'delete_client', 'create_deal', 'edit_deal', 'delete_deal',
      'create_campaigns', 'edit_campaign', 'delete_campaign',
    ],
  },
  {
    key: 'media', label: 'Media', module: 'catalog', read: ['search_media', 'list_categories', 'get_title', 'get_rotation_lists'],
    edit: [
      'edit_media', 'add_to_rotation_list', 'create_category', 'edit_category', 'create_title', 'edit_title', 'create_item', 'create_episodes', 'delete_media',
      'create_cut', 'recut', 'create_rotation_list', 'clone_rotation_list', 'edit_rotation_list', 'shuffle_rotation_list', 'delete_rotation_list', 'edit_relations',
    ],
  },
  {
    key: 'layouts', label: 'Layouts', module: 'templates', read: ['get_layout'],
    edit: ['edit_layout', 'create_layout', 'clone_layout', 'rename_layout', 'delete_layout', 'create_block_type', 'edit_block_type', 'delete_block_type', 'create_break_list', 'edit_break_list', 'delete_break_list'],
  },
];

/** Every agent may list the channels it reaches. */
export const ALWAYS = ['list_channels'];

export function partsOf(v: unknown): Parts {
  const out: Parts = {};
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if ((PART_KEYS as readonly string[]).includes(k) && (x === 'read' || x === 'edit')) out[k as PartKey] = x;
    }
  }
  return out;
}

/** The tools the parts give; `canChange` false keeps only the reading ones. */
export function toolNames(parts: Parts, canChange: boolean): Set<string> {
  const names = new Set(ALWAYS);
  for (const p of PARTS) {
    const level = parts[p.key];
    if (!level) continue;
    p.read.forEach((n) => names.add(n));
    if (level === 'edit' && canChange) p.edit.forEach((n) => names.add(n));
  }
  return names;
}

/** The write tools' titles (src/mcp/writes.ts), for change cards. */
export const WRITE_TITLE: Record<string, string> = {
  create_weeks: 'Create weeks', fill_day: 'Fill a day', edit_day: 'Change rows of a day', approve_day: 'Approve a day for air', reopen_day: 'Reopen a day',
  edit_layout: 'Change a layout', edit_media: 'Change a media item', add_to_rotation_list: 'Add items to a rotation list', book_campaign_spots: 'Book campaign spots',
  confirm_campaign: 'Confirm a campaign', remove_campaign_spots: 'Take out campaign spots',
  create_channel: 'Create a channel', edit_channel: 'Change a channel', edit_break_positions: 'Change break positions', create_layout: 'Create a layout',
  clone_layout: 'Clone a layout', rename_layout: 'Rename a layout, or change its dates', delete_layout: 'Delete a layout', create_block_type: 'Create a block type',
  edit_block_type: 'Change a block type', delete_block_type: 'Delete a block type', create_break_list: 'Create a break list', edit_break_list: 'Change a break list',
  delete_break_list: 'Delete a break list',
  create_plan: 'Create a plan', edit_plan: 'Change a plan', place_airings: 'Place airings', remove_airings: 'Take out airings',
  shift_episodes: 'Move episodes along the airing days', replace_items: 'Replace items in a plan', move_airings: 'Move airings to another plan',
  duplicate_plan: 'Duplicate a plan', split_plan: 'Split a plan', delete_plan: 'Delete a plan', confirm_plan: 'Confirm a plan',
  create_client: 'Create a client', edit_client: 'Change a client', delete_client: 'Delete a client', create_deal: 'Create a deal', edit_deal: 'Change a deal',
  delete_deal: 'Delete a deal', create_campaigns: 'Create campaigns', edit_campaign: 'Change a campaign', delete_campaign: 'Delete a campaign',
  create_category: 'Create a category', edit_category: 'Change a category', create_title: 'Create a title', edit_title: 'Change a title',
  create_item: 'Create an item', create_episodes: 'Create episodes', delete_media: 'Delete from Media', create_cut: 'Create a cut', recut: 'Recut',
  create_rotation_list: 'Create a rotation list', clone_rotation_list: 'Clone a rotation list', edit_rotation_list: 'Change a rotation list',
  shuffle_rotation_list: 'Shuffle a rotation list', delete_rotation_list: 'Delete a rotation list', edit_relations: 'Change relations',
  rename_week: 'Rename a week', delete_week: 'Delete a week',
};

/** The part a write tool belongs to. */
export const partOfTool = (tool: string) => PARTS.find((p) => p.read.includes(tool) || p.edit.includes(tool)) ?? null;

// ---------------------------------------------------------------- access

/** What a role allows (as a member with that role would have it). */
export async function roleAccess(roleId: string): Promise<Access> {
  const role = await platformDb.role.findUnique({ where: { id: roleId }, include: { grants: true, scopes: true } });
  if (!role) throw new HttpError(409, 'The role this agent acts with does not exist any more: pick another in its settings.');
  return {
    all: false,
    grants: new Set(role.grants.map((g) => `${g.module}:${g.action}`)),
    channelIds: role.allChannels ? null : new Set(role.scopes.map((s) => s.channelId)),
  };
}

/** Only what both allow. */
export function intersect(a: Access, b: Access): Access {
  if (a.all) return b;
  if (b.all) return a;
  const channelIds = !a.channelIds ? b.channelIds : !b.channelIds ? a.channelIds : new Set([...a.channelIds].filter((c) => b.channelIds!.has(c)));
  return { all: false, grants: new Set([...a.grants].filter((g) => b.grants.has(g))), channelIds };
}

/**
 * What the parts and channels of an agent allow: viewing, and changing where a part is "edit" —
 * on Playlist that includes approving and reopening a day (phase C1; a person approves it twice).
 * Never exporting.
 */
export function partsAccess(parts: Parts, channelIds: string[]): Access {
  const grants = new Set<string>();
  for (const p of PARTS) {
    const level = parts[p.key];
    if (!level) continue;
    grants.add(`${p.module}:view`);
    if (level === 'edit') grants.add(`${p.module}:edit`);
    if (level === 'edit' && p.key === 'playlist') grants.add('playlist:approve');
  }
  return { all: false, grants, channelIds: channelIds.length ? new Set(channelIds) : null };
}

export async function agentAccess(agent: { roleId: string; parts: unknown; channelIds: string[] }): Promise<Access> {
  return intersect(await roleAccess(agent.roleId), partsAccess(partsOf(agent.parts), agent.channelIds));
}

// ---------------------------------------------------------------- the gallery

export interface AgentTemplate {
  key: string;
  name: string;
  mark: string;
  color: string;
  job: string;
  parts: Parts;
  skill: string;
}

export const TEMPLATES: AgentTemplate[] = [
  {
    key: 'playlist-checker', name: 'Playlist checker', mark: 'PC', color: 'm1',
    job: "Checks the coming days' playlists of every channel and says what is wrong: short or long blocks, missing media, rows that clash.",
    parts: { playlist: 'read', media: 'read' },
    skill: [
      '1. list_channels, then check_day for tomorrow on each channel (main playlist, and the ads playlist where there is one).',
      '2. Report every problem as a short list: channel, block, what is wrong, and by how much.',
      '3. Missing or unready media: hand it to the Media fixer if you work with one. Short blocks: hand them to the Gap filler if you work with one.',
      '4. When a day is fine, say so in one line.',
    ].join('\n'),
  },
  {
    key: 'gap-filler', name: 'Gap filler', mark: 'GF', color: 'm2',
    job: 'Fills the free time of short blocks from the rotation lists.',
    parts: { playlist: 'edit' },
    skill: [
      '1. check_day to see which blocks are short.',
      '2. Preview fill_day with the rotation step (mode missing).',
      '3. Say how much time the preview fills and what stays short; the change waits for a person.',
    ].join('\n'),
  },
  {
    key: 'media-fixer', name: 'Media fixer', mark: 'MF', color: 'm3',
    job: 'Looks into missing or wrong media in a playlist and finds the item that should air.',
    parts: { media: 'read', playlist: 'edit' },
    skill: [
      '1. get_day_playlist to see the rows with missing or unready media.',
      '2. search_media for each title: say which item should air and why (version, length).',
      '3. If the programme placements step of fill_day puts it in, preview it; otherwise say exactly what a person must change.',
    ].join('\n'),
  },
  {
    key: 'ads-booker', name: 'Ads booker', mark: 'AB', color: 'm4',
    job: "Books campaigns' ads into the breaks of the ads playlist.",
    parts: { ads: 'edit' },
    skill: [
      '1. list_deals or get_deal to find the campaign, then get_campaign for its ads and the breaks it can book.',
      '2. Preview book_campaign_spots for what was asked.',
      '3. Say how many spots and their total length; the booking waits for a person.',
    ].join('\n'),
  },
  {
    key: 'weeks-builder', name: 'Weeks builder', mark: 'WB', color: 'm5',
    job: 'Creates the coming weeks of each channel from its layouts.',
    parts: { playlist: 'edit', layouts: 'read' },
    skill: [
      "1. list_channels, then preview create_weeks for the first week that does not exist yet.",
      '2. Explain every problem in words a scheduler understands, and what would solve it.',
    ].join('\n'),
  },
  {
    key: 'day-reporter', name: 'Day reporter', mark: 'DR', color: 'm1',
    job: 'Writes a short report of a broadcast day: what airs, which ads, and what is still wrong.',
    parts: { playlist: 'read', ads: 'read', scheduling: 'read' },
    skill: [
      '1. get_day_playlist (blocks only) and check_day for the day asked.',
      '2. Write five lines at most: the main programmes, the ads time, and the problems left.',
    ].join('\n'),
  },
];

export const EMPTY_TEMPLATE: AgentTemplate = { key: 'empty', name: 'New agent', mark: 'NA', color: 'm2', job: '', parts: {}, skill: '' };
