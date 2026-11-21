// Shared by the MCP tools (decision 0023): 9eye's words, text formats, argument schemas, lookups and
// the shape of a tool. The read tools are in tools.ts, the write tools in writes.ts.

import { z } from 'zod';
import { dayChecks, formatClock, formatTc, frameRate, type ActionKey, type DayDraft, type DraftRow, type ModuleKey } from '@9eye/core';
import { Prisma } from '@prisma/client';
import { reachesChannel } from '../access';
import { db } from '../db';
import { HttpError } from '../errors';
import type { Family } from '../services/catalog';
import type { DayDto } from '../services/days';
import { channelDto, type ChannelDto } from '../services/dto';
import type { Principal } from './auth';

// ---------------------------------------------------------------- words and formats

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

export const STATE: Record<string, string> = { draft: 'Draft', published: 'Approved', reconciled: 'Reconciled' };
export const ROW_KIND: Record<string, string> = {
  program: 'Programme', commercial: 'Ad', promo: 'Trailer', filler: 'Filler', ident: 'Ident', jingle: 'Sting',
  'linked-break': 'Break', 'gap-compensator': 'Gap holder', note: 'Note',
};
export const PLAN_MODE: Record<string, string> = { series: 'Series', programmes: 'Programmes', promos: 'Trailers', jingles: 'Stings', graphics: 'Graphics' };
export const STATUS: Record<string, string> = { confirmed: 'Confirmed', draft: 'Draft' };
export const FAMILY: Record<string, Family> = { programmes: 'program', trailers_and_stings: 'filling', ads: 'advert' };

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const quote = (s: string) => `"${s}"`;
export const range = (from: string, to: string) => `${from} → ${to}`;

/** Lists longer than this are cut, with a line saying how many more there are. */
const MAX_LINES = 100;
export function capped(lines: string[], hint: string, max = MAX_LINES): string[] {
  return lines.length <= max ? lines : [...lines.slice(0, max), `… ${lines.length - max} more — ${hint}`];
}

/** A few channel names, else how many. */
export const channelList = (names: string[]) => (names.length <= 3 ? `channels ${names.join(', ')}` : `${names.length} channels`);

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
export const channelArg = z.string().min(1).max(200).describe('The channel: its name, code or id (list_channels shows them).');
export const dateArg = isoDate.optional().describe("The broadcast day, YYYY-MM-DD. Default: the channel's current broadcast day.");
export const playlistArg = z.enum(['main', 'ads']).default('main').describe('main = programmes, trailers and breaks; ads = the spots of each break.');

// ---------------------------------------------------------------- lookups

const CHANNEL_INCLUDE = { playlists: { include: { _count: { select: { templates: { where: { deletedAt: null } } } } } } } as const;

/** The channels the person's role reaches. */
export async function myChannels(p: Principal): Promise<ChannelDto[]> {
  const rows = await db.channel.findMany({ where: { deletedAt: null }, include: CHANNEL_INCLUDE, orderBy: { name: 'asc' } });
  return rows.filter((c) => reachesChannel(p.access, c.id)).map(channelDto);
}

/** A channel by id, code or name (exact, else one that contains the words). */
export async function findChannel(p: Principal, ref: string): Promise<ChannelDto> {
  const r = ref.trim();
  const low = r.toLowerCase();
  const all = await myChannels(p);
  const exact = all.find((c) => c.id === r || c.code.toLowerCase() === low) ?? all.filter((c) => c.name.toLowerCase() === low)[0];
  if (exact) return exact;
  const near = all.filter((c) => c.name.toLowerCase().includes(low) || c.code.toLowerCase().includes(low));
  if (near.length === 1) return near[0];
  if (near.length > 1) throw new HttpError(400, `"${r}" fits ${near.length} channels: ${near.map((c) => `${c.name} (${c.code})`).join(', ')}. Name one of them.`);
  throw new HttpError(404, `No channel "${r}". list_channels shows the channels you can open.`);
}

// ---------------------------------------------------------------- day playlist

export function dayHead(d: DayDto): string {
  const head = `${d.channel.name} · ${d.kind === 'main' ? 'Main playlist' : 'Ads playlist'} · ${weekdayOf(d.date)} ${d.date}`;
  return d.day ? `${head} · ${STATE[d.day.state] ?? d.day.state}` : head;
}

export const missingText = (d: DayDto) =>
  `No day playlist yet: ${d.missing === 'no-week' ? 'the week of this day has not been created' : 'this weekday is switched off in its week'}.`;

// ---------------------------------------------------------------- tools

/** Turns what a tool throws into an answer the model can read (and act on). */
export function errorText(e: unknown): string {
  if (e instanceof HttpError) return [e.message, ...(e.problems ?? []).map((x) => `- ${x.message}`)].join('\n');
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return 'Not found.';
  console.error('MCP tool failed', e);
  return 'Something went wrong on the server.';
}

/** What an applied change keeps in the audit log: what undo_change needs to put it back. */
export interface Change {
  targetId: string | null;
  channelIds: string[];
  before: object | null;
  after: object;
}

/**
 * A tool's answer; a write tool that applied a change also hands the change over. A preview that
 * can be applied names `applyWith`: the arguments that, added to the call's own, apply exactly what
 * it showed (an agent's change card is applied with them, decision 0024).
 */
export type ToolResult = string | { text: string; change?: Change; applyWith?: Record<string, unknown> };

/** A tool as defined once and used by the MCP endpoint and by the agents. */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  run: (args: never, ctx: { changeId: string }) => Promise<ToolResult>;
  kind: 'read' | 'write';
}

/** Registers a tool. `changeId` is the id its change gets in the audit log, to name in the answer. */
export type DefineTool = <S extends z.ZodObject>(
  name: string,
  title: string,
  description: string,
  input: S,
  run: (args: z.infer<S>, ctx: { changeId: string }) => Promise<ToolResult>,
  kind?: 'read' | 'write',
) => void;

// ---------------------------------------------------------------- shared by the write tools

export const APPLY = 'false (default) = only a preview, nothing changes; true = do it. Show the person the preview and apply only after they agree.';
export const UNDO_HINT = 'undo_change can put it back while nobody changes it since.';

/** A row as the day editor saves it (src/routes.ts dayRowBody); a linked break's own length is 0. */
export const draftRow = (e: DraftRow): DraftRow => ({
  id: e.id, kind: e.kind, title: e.title, lengthFrames: e.kind === 'linked-break' ? 0 : e.lengthFrames, productionId: e.productionId, segmentId: e.segmentId,
  tcInFrames: e.tcInFrames, tcOutFrames: e.tcOutFrames, fixed: e.fixed, hold: e.hold, autoAdjust: e.autoAdjust, note: e.note, breakTypeId: e.breakTypeId,
  relatedEventId: e.relatedEventId, orderId: e.orderId, rotationListId: e.rotationListId, airingItemId: e.airingItemId ?? null,
});

/** A row's code in get_day_playlist (the end of its id): what edit_day names rows by. */
export const rowRef = (id: string) => id.replace(/-/g, '').slice(-8);

/** What is wrong with a day and what fills it (check_day, approve_day). */
export function checkText(d: DayDto): string {
  if (!d.day) return `${dayHead(d)}\n${missingText(d)}`;
  const r = frameRate(d.channel.frameRate);
  const clock = (f: number) => formatClock(f, d.channel.dayStartFrames, r);
  const tc = (f: number) => formatTc(f, r);
  // The same reading of the day as the day page (DayTab): a linked break's own length counts as 0.
  const draft: DayDraft = { blocks: d.day.blocks.map((b) => ({ id: b.id, rows: b.events.map((e) => ({ ...e, lengthFrames: e.kind === 'linked-break' ? 0 : e.lengthFrames })) })) };
  const { steps, issues } = dayChecks(draft, {
    isMain: d.kind === 'main',
    hasAds: !!d.channel.adsPlaylistId,
    placements: d.day.checks.placements,
    adsBreaks: d.day.checks.adsBreaks,
    fillBlocks: d.day.blocks.filter((b) => b.fillGaps).map((b) => ({ id: b.id, listId: b.rotationListId, gapFrames: Math.max(0, -b.gapFrames) })),
    second: r.nominal,
    notReady: d.day.notReady,
    booked: d.day.checks.booked ? d.day.checks.booked.map((b) => ({ id: b.id, passes: b.passes })) : undefined,
  });
  const label = new Map(steps.map((s) => [s.step, s.label]));
  const out = [dayHead(d), ''];
  out.push('Steps that fill the day:');
  if (!steps.length) out.push('- none apply to this day');
  const why = (s: { text: string; why: string | null }) => (s.why && !s.text.toLowerCase().includes(s.why.toLowerCase()) ? ` (cannot run: ${s.why})` : '');
  for (const s of steps) out.push(`- ${s.label}: ${s.text}${why(s)}`);
  out.push('', 'Issues:');
  if (!issues.length) out.push('- none');
  for (const i of issues) out.push(`- ${i.tone === 'red' ? 'Problem' : 'Warning'}: ${i.text}${i.step ? ` — the step "${label.get(i.step) ?? i.step}" fixes it` : ''}`);
  const off = d.day.blocks.filter((b) => b.gapFrames !== 0);
  out.push('', 'Blocks off their planned length:');
  if (!off.length) out.push('- none');
  out.push(...capped(off.map((b) => `- ${clock(b.realStartFrames)} ${b.name}: ${b.gapFrames < 0 ? `${tc(-b.gapFrames)} short` : `${tc(b.gapFrames)} over`}`), 'get_day_playlist with rows: false lists every block', 40));
  const notReady = d.day.blocks.flatMap((b) => b.events.filter((e) => e.media === 'not-ready'));
  out.push('', 'Rows whose media is not ready:');
  if (!notReady.length) out.push('- none');
  out.push(...capped(notReady.map((e) => `- ${clock(e.startFrames)} ${e.title}${e.episode ? ` (ep ${e.episode})` : ''}`), 'see get_day_playlist'));
  return out.join('\n');
}

/** What a write tool needs of a role (module, action): to apply it, undo it, or decide an agent's change of it. */
export const TOOL_GRANT: Record<string, [ModuleKey, ActionKey]> = {
  create_weeks: ['playlist', 'edit'],
  fill_day: ['playlist', 'edit'],
  edit_day: ['playlist', 'edit'],
  approve_day: ['playlist', 'approve'],
  reopen_day: ['playlist', 'approve'],
  edit_layout: ['templates', 'edit'],
  edit_media: ['catalog', 'edit'],
  add_to_rotation_list: ['catalog', 'edit'],
  book_campaign_spots: ['orders', 'edit'],
  confirm_campaign: ['orders', 'edit'],
  remove_campaign_spots: ['orders', 'edit'],
  // Channels and Layouts (decision 0025)
  create_channel: ['admin', 'edit'],
  edit_channel: ['admin', 'edit'],
  edit_break_positions: ['admin', 'edit'],
  create_layout: ['templates', 'edit'],
  clone_layout: ['templates', 'edit'],
  rename_layout: ['templates', 'edit'],
  delete_layout: ['templates', 'edit'],
  create_block_type: ['templates', 'edit'],
  edit_block_type: ['templates', 'edit'],
  delete_block_type: ['templates', 'edit'],
  create_break_list: ['templates', 'edit'],
  edit_break_list: ['templates', 'edit'],
  delete_break_list: ['templates', 'edit'],
  // Scheduling (decision 0025)
  create_plan: ['orders', 'edit'],
  edit_plan: ['orders', 'edit'],
  place_airings: ['orders', 'edit'],
  remove_airings: ['orders', 'edit'],
  shift_episodes: ['orders', 'edit'],
  replace_items: ['orders', 'edit'],
  move_airings: ['orders', 'edit'],
  duplicate_plan: ['orders', 'edit'],
  split_plan: ['orders', 'edit'],
  delete_plan: ['orders', 'edit'],
  confirm_plan: ['orders', 'edit'],
  // Ads (decision 0025)
  create_client: ['orders', 'edit'],
  edit_client: ['orders', 'edit'],
  delete_client: ['orders', 'edit'],
  create_deal: ['orders', 'edit'],
  edit_deal: ['orders', 'edit'],
  delete_deal: ['orders', 'edit'],
  create_campaigns: ['orders', 'edit'],
  edit_campaign: ['orders', 'edit'],
  delete_campaign: ['orders', 'edit'],
  // Media (decision 0025)
  create_category: ['catalog', 'edit'],
  edit_category: ['catalog', 'edit'],
  create_title: ['catalog', 'edit'],
  edit_title: ['catalog', 'edit'],
  create_item: ['catalog', 'edit'],
  create_episodes: ['catalog', 'edit'],
  delete_media: ['catalog', 'edit'],
  create_cut: ['catalog', 'edit'],
  recut: ['catalog', 'edit'],
  create_rotation_list: ['catalog', 'edit'],
  clone_rotation_list: ['catalog', 'edit'],
  edit_rotation_list: ['catalog', 'edit'],
  shuffle_rotation_list: ['catalog', 'edit'],
  delete_rotation_list: ['catalog', 'edit'],
  edit_relations: ['catalog', 'edit'],
  // Playlist (decision 0025)
  rename_week: ['playlist', 'edit'],
  delete_week: ['playlist', 'edit'],
};

/** Changes that put a day on air: a person approves them twice. */
export const TO_AIR = new Set(['approve_day']);

