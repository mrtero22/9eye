// The tools of Channels and Layouts (decision 0025, first group): a channel's settings, a new channel;
// layouts (create, clone, rename and dates, delete), block types and break lists (create, change,
// delete), the company's break positions. Each previews first, applies at the version it showed
// where the item has one, and undo_change puts it back (undoSetup) while nobody changed it since.

import { z } from 'zod';
import { FRAME_RATES, formatTc, frameRate, parseTc, weekOrder, type FrameRateCode } from '@9eye/core';
import type { AuditEvent } from '@prisma/client';
import { demand } from '../access';
import { db, toIsoDate } from '../db';
import { HttpError } from '../errors';
import { createBlockTypes, deleteBlockType, updateBlockType } from '../services/blockTypes';
import { createBreakList, deleteBreakList, listBreakLists, updateBreakList } from '../services/breakLists';
import { listBreakPositions, saveBreakPositions } from '../services/breakPositions';
import { createChannel, getChannel, updateChannel, type ChannelSettings } from '../services/channels';
import { cloneTemplate, createTemplate, deleteTemplate, getTemplateFull, listTemplates, saveTemplate } from '../services/templates';
import type { Principal } from './auth';
import { APPLY, UNDO_HINT, WEEKDAYS, channelArg, findChannel, isoDate, playlistArg, plural, quote, range, type DefineTool, type ToolResult } from './common';

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const version = z.number().int().optional();
const apply = z.boolean().default(false).describe(APPLY);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour as #RRGGBB');

function checkVersion(applying: boolean, asked: number | undefined, now: number, what: string) {
  if (!applying) return;
  if (asked === undefined) throw new HttpError(400, 'Apply needs the version the preview showed.');
  if (asked !== now) throw new HttpError(409, `The ${what} changed since the preview (version ${asked}, now ${now}): preview it again.`);
}
const weekdayIndex = (s: string) => {
  const i = WEEKDAYS.findIndex((w) => w.toLowerCase() === s.trim().toLowerCase() || w.slice(0, 3).toLowerCase() === s.trim().toLowerCase());
  if (i < 0) throw new HttpError(400, `"${s}" is not a weekday.`);
  return i;
};
const timeArg = (s: string, rateCode: string) => {
  const f = parseTc(s.trim(), frameRate(rateCode));
  if (f === null) throw new HttpError(400, `"${s}" is not a time (HH:MM or HH:MM:SS:FF).`);
  return f;
};
const preview = (applying: boolean, what = 'nothing is saved') => (applying ? '' : ` — preview, ${what}`);

/** A layout of a channel's playlist by name or id. */
async function layoutRef(p: Principal, channel: string, kind: 'main' | 'ads', ref: string) {
  const c = await findChannel(p, channel);
  const all = (await listTemplates(c.id)).filter((t) => t.kind === kind);
  const k = ref.trim().toLowerCase();
  const hit = all.filter((t) => t.id === ref.trim() || t.name.toLowerCase() === k);
  if (hit.length !== 1) throw new HttpError(404, `No ${kind} layout ${quote(ref)} on ${c.name}${all.length ? `: ${all.map((t) => quote(t.name)).join(', ')}` : ''}.`);
  return { c, t: hit[0] };
}

/** A block type of a channel's playlist by name or id. */
async function blockTypeRef(p: Principal, channel: string, kind: 'main' | 'ads', ref: string) {
  const c = await findChannel(p, channel);
  const playlistId = kind === 'main' ? c.mainPlaylistId : c.adsPlaylistId;
  if (!playlistId) throw new HttpError(404, `${c.name} has no ${kind} playlist.`);
  const k = ref.trim().toLowerCase();
  const rows = await db.blockType.findMany({ where: { playlistId, deletedAt: null }, include: { group: true } });
  const hit = rows.filter((x) => x.id === ref.trim() || x.name.toLowerCase() === k);
  if (hit.length !== 1) throw new HttpError(404, `No block type ${quote(ref)} in the ${kind} playlist of ${c.name}.`);
  return { c, b: hit[0], playlistId };
}

async function breakListRef(p: Principal, channel: string, ref: string) {
  const c = await findChannel(p, channel);
  const lists = await listBreakLists(c.id);
  const k = ref.trim().toLowerCase();
  const hit = lists.filter((l) => l.id === ref.trim() || l.name.toLowerCase() === k);
  if (hit.length !== 1) throw new HttpError(404, `No break list ${quote(ref)} on ${c.name}${lists.length ? `: ${lists.map((l) => quote(l.name)).join(', ')}` : ''}.`);
  return { c, l: hit[0] };
}

const settingsOf = (c: Awaited<ReturnType<typeof getChannel>>): ChannelSettings => ({
  version: c.version, name: c.name, code: c.code, frameRate: c.frameRate, dayStartFrames: c.dayStartFrames, weekStart: c.weekStart, timeZone: c.timeZone,
  dateLocale: c.dateLocale, hasAds: !!c.adsPlaylistId, ageLogoPosition: c.ageLogoPosition, defaultBreakListId: c.defaultBreakListId,
  shortestBreakFrames: c.shortestBreakFrames, defaultExport: c.defaultExport, allowedExports: c.allowedExports, epgTypes: c.epgTypes, bxfTimesUtc: c.bxfTimesUtc,
  reconcileTolerance: c.reconcileTolerance,
});

export function registerSetupRead(tool: DefineTool, p: Principal) {
  tool(
    'get_channel',
    'Channel settings',
    "One channel's settings (name, code, frame rate, day start, first weekday, time zone, ads playlist, default break list, shortest break, version), its layouts with their dates and versions, and its break lists.",
    z.object({ channel: channelArg }),
    async (a) => {
      const c = await getChannel((await findChannel(p, a.channel)).id);
      const r = frameRate(c.frameRate);
      const layouts = await listTemplates(c.id);
      const lists = c.adsPlaylistId ? await listBreakLists(c.id) : [];
      return [
        `${c.name} · code ${c.code} · version ${c.version}`,
        `${r.label} · day starts ${formatTc(c.dayStartFrames, r)} · week starts ${WEEKDAYS[c.weekStart]} · time zone ${c.timeZone ?? 'not set'} · dates ${c.dateLocale}`,
        `${c.adsPlaylistId ? 'main + ads playlists' : 'main playlist only'} · shortest break ${formatTc(c.shortestBreakFrames, r)} · default break list ${lists.find((l) => l.id === c.defaultBreakListId)?.name ?? 'none'}`,
        '', 'Layouts:',
        ...(layouts.length ? layouts.map((t) => `- ${quote(t.name)} · ${t.kind} · ${range(t.validFrom, t.validTo)} · version ${t.version}`) : ['- none']),
        ...(c.adsPlaylistId ? ['', 'Break lists:', ...(lists.length ? lists.map((l) => `- ${quote(l.name)} · positions ${l.positions.join(', ') || 'none'}`) : ['- none'])] : []),
      ].join('\n');
    },
  );
}

export function registerSetupTools(tool: DefineTool, p: Principal) {
  // ---------------------------------------------------------------- channels
  tool(
    'create_channel',
    'Create a channel',
    `Create a channel with its main playlist (and an ads playlist when it has ads). Preview first. ${UNDO_HINT} (undo removes it while nothing uses it)`,
    z.object({
      name: z.string().trim().min(1).max(80),
      code: z.string().trim().min(1).max(20).describe('1–20 letters, digits, "-" or "_": used in export file names.'),
      frame_rate: z.enum(Object.keys(FRAME_RATES) as [FrameRateCode, ...FrameRateCode[]]).default('25'),
      day_start: z.string().max(11).default('06:00').describe('When its broadcast day starts, HH:MM.'),
      week_start: z.string().max(10).default('Saturday').describe('The first weekday of its weeks.'),
      ads: z.boolean().default(true).describe('It has an ads playlist (breaks with spots).'),
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'admin', 'edit');
      const dayStartFrames = timeArg(a.day_start, a.frame_rate);
      const weekStart = weekdayIndex(a.week_start);
      const clash = await db.channel.findFirst({ where: { deletedAt: null, OR: [{ name: { equals: a.name, mode: 'insensitive' } }, { code: { equals: a.code, mode: 'insensitive' } }] } });
      const r = frameRate(a.frame_rate);
      const out = [`New channel ${quote(a.name)} · code ${a.code} · ${r.label} · day starts ${formatTc(dayStartFrames, r)} · week starts ${WEEKDAYS[weekStart]} · ${a.ads ? 'main + ads playlists' : 'main playlist only'}${preview(a.apply, 'nothing is made')}`];
      if (clash) {
        out.push(`There is a channel ${quote(clash.name)} (code ${clash.code}) already: pick another name and code.`);
        if (a.apply) throw new HttpError(409, out.join('\n'));
        return out.join('\n');
      }
      if (!a.apply) {
        out.push('Next: create_layout makes its first layout, then create_weeks its weeks.', 'To make it: create_channel with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const c = await createChannel({ name: a.name, code: a.code, frameRate: a.frame_rate, dayStartFrames, weekStart, hasAds: a.ads });
      out[0] = `Channel ${quote(c.name)} made (code ${c.code}). Change id ${changeId} — undo_change removes it while nothing uses it.`;
      return { text: out.join('\n'), change: { targetId: c.id, channelIds: [c.id], before: null, after: { channelId: c.id } } };
    },
    'write',
  );

  tool(
    'edit_channel',
    'Change a channel',
    `Change a channel's settings: name, code, time zone, date format, day start, first weekday, shortest break, default break list. Preview first; applying checks it against the channel's layouts and weeks (a change they do not allow is refused, with why). ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      name: z.string().trim().min(1).max(80).optional(),
      code: z.string().trim().min(1).max(20).optional(),
      time_zone: z.string().max(100).nullable().optional().describe('An IANA time zone, e.g. Asia/Tehran; null = none.'),
      date_locale: z.string().max(20).optional(),
      day_start: z.string().max(11).optional().describe('HH:MM'),
      week_start: z.string().max(10).optional(),
      shortest_break: z.string().max(11).optional().describe('HH:MM:SS:FF'),
      default_break_list: z.string().max(200).nullable().optional().describe('A break list name or id; null = none.'),
      version,
      apply,
    }),
    async (a, { changeId }) => {
      const ref = await findChannel(p, a.channel);
      demand(p.access, 'admin', 'edit', ref.id);
      const c = await getChannel(ref.id);
      checkVersion(a.apply, a.version, c.version, 'channel');
      const r = frameRate(c.frameRate);
      const before = settingsOf(c);
      const next: ChannelSettings = { ...before };
      if (a.name !== undefined) next.name = a.name;
      if (a.code !== undefined) next.code = a.code;
      if (a.time_zone !== undefined) next.timeZone = a.time_zone;
      if (a.date_locale !== undefined) next.dateLocale = a.date_locale;
      if (a.day_start !== undefined) next.dayStartFrames = timeArg(a.day_start, c.frameRate);
      if (a.week_start !== undefined) next.weekStart = weekdayIndex(a.week_start);
      if (a.shortest_break !== undefined) next.shortestBreakFrames = timeArg(a.shortest_break, c.frameRate);
      if (a.default_break_list !== undefined) next.defaultBreakListId = a.default_break_list === null ? null : (await breakListRef(p, ref.id, a.default_break_list)).l.id;
      const show: Record<string, (s: ChannelSettings) => string> = {
        name: (s) => quote(s.name), code: (s) => s.code, timeZone: (s) => s.timeZone ?? 'none', dateLocale: (s) => s.dateLocale,
        dayStartFrames: (s) => formatTc(s.dayStartFrames, r), weekStart: (s) => WEEKDAYS[s.weekStart], shortestBreakFrames: (s) => formatTc(s.shortestBreakFrames ?? 0, r),
        defaultBreakListId: (s) => s.defaultBreakListId ?? 'none',
      };
      const diff = Object.keys(show).filter((k) => show[k](before) !== show[k](next));
      const out = [`${c.name} · version ${c.version}${preview(a.apply)}`];
      if (!diff.length) return [...out, 'Nothing would change.'].join('\n');
      out.push(...diff.map((k) => `- ${k}: ${show[k](before)} → ${show[k](next)}`));
      if (!a.apply) {
        out.push(`To save it: edit_channel with the same settings, apply: true and version ${c.version}. The channel's layouts and weeks are checked when it is applied.`);
        return { text: out.join('\n'), applyWith: { apply: true, version: c.version } };
      }
      const saved = await updateChannel(c.id, next);
      out[0] = `${saved.name} — saved as version ${saved.version}. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: c.id, channelIds: [c.id], before: { settings: before }, after: { channelId: c.id, version: saved.version } } };
    },
    'write',
  );

  // ---------------------------------------------------------------- layouts
  tool(
    'create_layout',
    'Create a layout',
    `Create an empty layout for a channel's playlist, valid between two dates (whole weeks: from the channel's first weekday to the day before). Then edit_layout puts blocks in it. Preview first. ${UNDO_HINT}`,
    z.object({
      channel: channelArg, playlist: playlistArg, name: z.string().trim().min(1).max(100),
      valid_from: isoDate.describe("First day, the channel's first weekday."), valid_to: isoDate.describe('Last day, the day before the first weekday.'), apply,
    }),
    async (a, { changeId }) => {
      const c = await findChannel(p, a.channel);
      demand(p.access, 'templates', 'edit', c.id);
      const playlistId = a.playlist === 'main' ? c.mainPlaylistId : c.adsPlaylistId;
      if (!playlistId) throw new HttpError(404, `${c.name} has no ${a.playlist} playlist.`);
      const out = [`New ${a.playlist} layout ${quote(a.name)} for ${c.name} · ${range(a.valid_from, a.valid_to)} · every day, no blocks yet${preview(a.apply, 'nothing is made')}`];
      if (!a.apply) {
        out.push('To make it: create_layout with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const t = await createTemplate({ playlistId, name: a.name, validFrom: a.valid_from, validTo: a.valid_to });
      out[0] = `Layout ${quote(t.template.name)} made for ${c.name} (${range(t.template.validFrom, t.template.validTo)}). Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: t.template.id, channelIds: [c.id], before: null, after: { templateId: t.template.id } } };
    },
    'write',
  );

  tool(
    'clone_layout',
    'Clone a layout',
    `Copy a layout with all its blocks under a new name and dates. Preview first. ${UNDO_HINT}`,
    z.object({ channel: channelArg, playlist: playlistArg, layout: z.string().max(300).describe('The layout to copy: its name or id.'), name: z.string().trim().min(1).max(100), valid_from: isoDate, valid_to: isoDate, apply }),
    async (a, { changeId }) => {
      const { c, t } = await layoutRef(p, a.channel, a.playlist, a.layout);
      demand(p.access, 'templates', 'edit', c.id);
      const full = await getTemplateFull(t.id);
      const out = [`Copy of ${quote(t.name)} (${plural(full.blocks.length, 'block')}) as ${quote(a.name)} · ${range(a.valid_from, a.valid_to)}${preview(a.apply, 'nothing is made')}`];
      if (!a.apply) {
        out.push('To make it: clone_layout with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const made = await cloneTemplate(t.id, { name: a.name, validFrom: a.valid_from, validTo: a.valid_to });
      out[0] = `Layout ${quote(made.template.name)} made from ${quote(t.name)}. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: made.template.id, channelIds: [c.id], before: null, after: { templateId: made.template.id } } };
    },
    'write',
  );

  tool(
    'rename_layout',
    'Rename a layout, or change its dates',
    `Change a layout's name, the dates it is valid, or the weekdays it is active. Its blocks stay. Preview first. ${UNDO_HINT}`,
    z.object({
      channel: channelArg, playlist: playlistArg, layout: z.string().max(300).describe('Its name or id.'),
      name: z.string().trim().min(1).max(100).optional(), valid_from: isoDate.optional(), valid_to: isoDate.optional(),
      weekdays: z.array(z.enum(SHORT)).min(1).max(7).optional().describe('The weekdays it is active.'), version, apply,
    }),
    async (a, { changeId }) => {
      const { c, t } = await layoutRef(p, a.channel, a.playlist, a.layout);
      demand(p.access, 'templates', 'edit', c.id);
      checkVersion(a.apply, a.version, t.version, 'layout');
      const full = await getTemplateFull(t.id);
      const before = { name: t.name, validFrom: t.validFrom, validTo: t.validTo, activeWeekdays: t.activeWeekdays, blocks: full.blocks };
      const next = {
        ...before, name: a.name ?? t.name, validFrom: a.valid_from ?? t.validFrom, validTo: a.valid_to ?? t.validTo,
        activeWeekdays: a.weekdays ? SHORT.map((d) => a.weekdays!.includes(d)) : t.activeWeekdays,
      };
      const days = (on: boolean[]) => (on.every(Boolean) ? 'every day' : weekOrder(c.weekStart).filter((d) => on[d]).map((d) => SHORT[d]).join(' '));
      const lines = [
        next.name !== before.name ? `- name: ${quote(before.name)} → ${quote(next.name)}` : null,
        next.validFrom !== before.validFrom || next.validTo !== before.validTo ? `- dates: ${range(before.validFrom, before.validTo)} → ${range(next.validFrom, next.validTo)}` : null,
        days(next.activeWeekdays) !== days(before.activeWeekdays) ? `- active: ${days(before.activeWeekdays)} → ${days(next.activeWeekdays)}` : null,
      ].filter((x): x is string => !!x);
      const out = [`Layout ${quote(t.name)} of ${c.name} · version ${t.version}${preview(a.apply)}`, ...(lines.length ? lines : ['Nothing would change.'])];
      if (!lines.length) return out.join('\n');
      if (!a.apply) {
        out.push(`To save it: rename_layout with the same arguments, apply: true and version ${t.version}.`);
        return { text: out.join('\n'), applyWith: { apply: true, version: t.version } };
      }
      const saved = await saveTemplate(t.id, { ...next, version: t.version });
      out[0] = `Layout ${quote(saved.template.name)} — saved as version ${saved.template.version}. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: t.id, channelIds: [c.id], before: { templateId: t.id, draft: before }, after: { templateId: t.id, version: saved.template.version } } };
    },
    'write',
  );

  tool(
    'delete_layout',
    'Delete a layout',
    `Delete a layout. Weeks made from it keep their blocks. Preview first. undo_change brings it back.`,
    z.object({ channel: channelArg, playlist: playlistArg, layout: z.string().max(300).describe('Its name or id.'), apply }),
    async (a, { changeId }) => {
      const { c, t } = await layoutRef(p, a.channel, a.playlist, a.layout);
      demand(p.access, 'templates', 'edit', c.id);
      const weeks = await db.week.count({ where: { templateId: t.id } });
      const out = [`Delete layout ${quote(t.name)} of ${c.name} · ${range(t.validFrom, t.validTo)}${preview(a.apply, 'nothing is deleted')}`, weeks ? `${plural(weeks, 'week')} made from it keep their blocks.` : 'No week was made from it.'];
      if (!a.apply) {
        out.push('To delete it: delete_layout with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      await deleteTemplate(t.id);
      out[0] = `Layout ${quote(t.name)} deleted. Change id ${changeId} — undo_change brings it back.`;
      return { text: out.join('\n'), change: { targetId: t.id, channelIds: [c.id], before: { templateId: t.id }, after: { templateId: t.id, deleted: true } } };
    },
    'write',
  );

  // ---------------------------------------------------------------- block types
  const typeFields = {
    length: z.string().max(11).describe('HH:MM:SS:FF'),
    color: hex.optional(),
    valid_from: isoDate.optional(), valid_to: isoDate.optional(),
    weekdays: z.array(z.enum(SHORT)).min(1).max(7).optional().describe('The weekdays it may be used on. Default: every day.'),
    fill_gaps: z.boolean().optional().describe('Its free time is filled from a rotation list.'),
    opens_with_break: z.boolean().optional(),
    note: z.string().max(1000).optional(),
  };
  tool(
    'create_block_type',
    'Create a block type',
    `Create a block type for a channel's playlist (what a layout's blocks are made of): a name, a length, a group. Preview first. ${UNDO_HINT}`,
    z.object({
      channel: channelArg, playlist: playlistArg, name: z.string().trim().min(1).max(100),
      group: z.string().trim().min(1).max(100).describe('Its block group: an existing one by name, or a new one.'), ...typeFields, apply,
    }),
    async (a, { changeId }) => {
      const c = await findChannel(p, a.channel);
      demand(p.access, 'templates', 'edit', c.id);
      const playlistId = a.playlist === 'main' ? c.mainPlaylistId : c.adsPlaylistId;
      if (!playlistId) throw new HttpError(404, `${c.name} has no ${a.playlist} playlist.`);
      const r = frameRate(c.frameRate);
      const lengthFrames = timeArg(a.length, c.frameRate);
      const group = await db.blockGroup.findFirst({ where: { deletedAt: null, name: { equals: a.group, mode: 'insensitive' } } });
      const same = await db.blockType.findFirst({ where: { playlistId, deletedAt: null, name: { equals: a.name, mode: 'insensitive' } } });
      const out = [`New block type ${quote(a.name)} · ${c.name} ${a.playlist} · ${formatTc(lengthFrames, r)} · group ${quote(group?.name ?? a.group)}${group ? '' : ' (new)'}${preview(a.apply, 'nothing is made')}`];
      if (same) {
        out.push(`There is a block type ${quote(same.name)} in this playlist already.`);
        if (a.apply) throw new HttpError(409, out.join('\n'));
        return out.join('\n');
      }
      if (!a.apply) {
        out.push('To make it: create_block_type with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const color = a.color ?? group?.color ?? '#4a90e2';
      const made = await createBlockTypes({
        playlistId, ...(group ? { groupId: group.id } : { newGroupName: a.group }), names: [a.name], color, textColor: '#ffffff', lengthFrames,
        validFrom: a.valid_from ?? '2000-01-01', validTo: a.valid_to ?? '2099-12-31', validWeekdays: a.weekdays ? SHORT.map((d) => a.weekdays!.includes(d)) : [true, true, true, true, true, true, true],
        fillGaps: a.fill_gaps ?? true, opensWithBreak: a.opens_with_break ?? false, note: a.note ?? '',
      });
      out[0] = `Block type ${quote(made[0].name)} made. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: made[0].id, channelIds: [c.id], before: null, after: { blockTypeId: made[0].id } } };
    },
    'write',
  );

  tool(
    'edit_block_type',
    'Change a block type',
    `Change a block type: its name, length, colour, dates, weekdays, gap filling, note. Layouts' blocks keep their own length. Preview first. ${UNDO_HINT}`,
    z.object({ channel: channelArg, playlist: playlistArg, block_type: z.string().max(200).describe('Its name or id.'), name: z.string().trim().min(1).max(100).optional(), ...typeFields, length: typeFields.length.optional(), apply }),
    async (a, { changeId }) => {
      const { c, b } = await blockTypeRef(p, a.channel, a.playlist, a.block_type);
      demand(p.access, 'templates', 'edit', c.id);
      const r = frameRate(c.frameRate);
      const before = {
        name: b.name, color: b.color, lengthFrames: b.lengthFrames, validFrom: toIsoDate(b.validFrom), validTo: toIsoDate(b.validTo), validWeekdays: b.validWeekdays,
        fillGaps: b.fillGaps, opensWithBreak: b.opensWithBreak, note: b.note,
      };
      const next = {
        ...before, ...(a.name !== undefined ? { name: a.name } : {}), ...(a.color !== undefined ? { color: a.color } : {}), ...(a.length !== undefined ? { lengthFrames: timeArg(a.length, c.frameRate) } : {}),
        ...(a.valid_from !== undefined ? { validFrom: a.valid_from } : {}), ...(a.valid_to !== undefined ? { validTo: a.valid_to } : {}),
        ...(a.weekdays ? { validWeekdays: SHORT.map((d) => a.weekdays!.includes(d)) } : {}), ...(a.fill_gaps !== undefined ? { fillGaps: a.fill_gaps } : {}),
        ...(a.opens_with_break !== undefined ? { opensWithBreak: a.opens_with_break } : {}), ...(a.note !== undefined ? { note: a.note } : {}),
      };
      const show = (k: string, v: unknown) => (k === 'lengthFrames' ? formatTc(v as number, r) : Array.isArray(v) ? SHORT.filter((_, i) => v[i]).join(' ') : String(v));
      const diff = Object.keys(next).filter((k) => JSON.stringify(next[k as keyof typeof next]) !== JSON.stringify(before[k as keyof typeof before]));
      const out = [`Block type ${quote(b.name)} of ${c.name}${preview(a.apply)}`];
      if (!diff.length) return [...out, 'Nothing would change.'].join('\n');
      out.push(...diff.map((k) => `- ${k}: ${show(k, before[k as keyof typeof before])} → ${show(k, next[k as keyof typeof next])}`));
      if (!a.apply) {
        out.push('To save it: edit_block_type with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      await updateBlockType(b.id, Object.fromEntries(diff.map((k) => [k, next[k as keyof typeof next]])));
      out[0] = `Block type ${quote(next.name)} saved. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: b.id, channelIds: [c.id], before: { blockTypeId: b.id, fields: Object.fromEntries(diff.map((k) => [k, before[k as keyof typeof before]])) }, after: { blockTypeId: b.id } } };
    },
    'write',
  );

  tool(
    'delete_block_type',
    'Delete a block type',
    'Delete a block type that no layout uses. Preview first. undo_change brings it back.',
    z.object({ channel: channelArg, playlist: playlistArg, block_type: z.string().max(200).describe('Its name or id.'), apply }),
    async (a, { changeId }) => {
      const { c, b } = await blockTypeRef(p, a.channel, a.playlist, a.block_type);
      demand(p.access, 'templates', 'edit', c.id);
      const used = (await db.templateBlock.count({ where: { blockTypeId: b.id } })) + (await db.linkedBreak.count({ where: { breakTypeId: b.id } }));
      const out = [`Delete block type ${quote(b.name)} of ${c.name}${preview(a.apply, 'nothing is deleted')}`];
      if (used) {
        out.push(`It is used by ${plural(used, 'block')} in layouts: take them out first (edit_layout).`);
        if (a.apply) throw new HttpError(409, out.join('\n'));
        return out.join('\n');
      }
      if (!a.apply) {
        out.push('To delete it: delete_block_type with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      await deleteBlockType(b.id);
      out[0] = `Block type ${quote(b.name)} deleted. Change id ${changeId} — undo_change brings it back.`;
      return { text: out.join('\n'), change: { targetId: b.id, channelIds: [c.id], before: { blockTypeId: b.id }, after: { blockTypeId: b.id, deleted: true } } };
    },
    'write',
  );

  // ---------------------------------------------------------------- break lists
  const positions = z.array(z.number().int().min(1).max(99)).max(99).describe('The break positions of the list, in order (1 = first).');
  tool(
    'create_break_list',
    'Create a break list',
    `Create a break list for a channel with an ads playlist (which linked breaks a block offers). Preview first. ${UNDO_HINT}`,
    z.object({ channel: channelArg, name: z.string().trim().min(1).max(100), positions, apply }),
    async (a, { changeId }) => {
      const c = await findChannel(p, a.channel);
      demand(p.access, 'templates', 'edit', c.id);
      const out = [`New break list ${quote(a.name)} for ${c.name} · positions ${a.positions.join(', ') || 'none'}${preview(a.apply, 'nothing is made')}`];
      if (!a.apply) {
        out.push('To make it: create_break_list with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const l = await createBreakList(c.id, { name: a.name, positions: a.positions });
      out[0] = `Break list ${quote(l.name)} made. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: l.id, channelIds: [c.id], before: null, after: { breakListId: l.id } } };
    },
    'write',
  );

  tool(
    'edit_break_list',
    'Change a break list',
    `Rename a break list or change its positions. Preview first. ${UNDO_HINT}`,
    z.object({ channel: channelArg, list: z.string().max(200).describe('Its name or id.'), name: z.string().trim().min(1).max(100).optional(), positions: positions.optional(), apply }),
    async (a, { changeId }) => {
      const { c, l } = await breakListRef(p, a.channel, a.list);
      demand(p.access, 'templates', 'edit', c.id);
      const next = { name: a.name ?? l.name, positions: a.positions ?? l.positions };
      const lines = [
        next.name !== l.name ? `- name: ${quote(l.name)} → ${quote(next.name)}` : null,
        next.positions.join(',') !== l.positions.join(',') ? `- positions: ${l.positions.join(', ') || 'none'} → ${next.positions.join(', ') || 'none'}` : null,
      ].filter((x): x is string => !!x);
      const out = [`Break list ${quote(l.name)} of ${c.name}${preview(a.apply)}`, ...(lines.length ? lines : ['Nothing would change.'])];
      if (!lines.length) return out.join('\n');
      if (!a.apply) {
        out.push('To save it: edit_break_list with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      await updateBreakList(l.id, next);
      out[0] = `Break list ${quote(next.name)} saved. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: l.id, channelIds: [c.id], before: { breakListId: l.id, name: l.name, positions: l.positions }, after: { breakListId: l.id } } };
    },
    'write',
  );

  tool(
    'delete_break_list',
    'Delete a break list',
    'Delete a break list. Preview first. undo_change makes it again.',
    z.object({ channel: channelArg, list: z.string().max(200).describe('Its name or id.'), apply }),
    async (a, { changeId }) => {
      const { c, l } = await breakListRef(p, a.channel, a.list);
      demand(p.access, 'templates', 'edit', c.id);
      const isDefault = c.defaultBreakListId === l.id;
      const out = [`Delete break list ${quote(l.name)} of ${c.name}${preview(a.apply, 'nothing is deleted')}`, ...(isDefault ? ['It is the channel’s default break list: the channel then has none.'] : [])];
      if (!a.apply) {
        out.push('To delete it: delete_break_list with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      await deleteBreakList(l.id);
      out[0] = `Break list ${quote(l.name)} deleted. Change id ${changeId} — undo_change makes it again.`;
      return { text: out.join('\n'), change: { targetId: l.id, channelIds: [c.id], before: { breakListId: l.id, channelId: c.id, name: l.name, positions: l.positions, wasDefault: isDefault }, after: { deleted: true } } };
    },
    'write',
  );

  // ---------------------------------------------------------------- break positions (the company's)
  tool(
    'edit_break_positions',
    'Change break positions',
    `Change the company's break positions (where in a break a spot may be booked: "First", "Last", …): add one, rename one, make one the default, or take one out that no booking uses. Preview first. ${UNDO_HINT}`,
    z.object({
      add: z.array(z.string().trim().min(1).max(100)).max(20).optional().describe('New positions, by name, at the end.'),
      rename: z.array(z.object({ from: z.string().max(100), to: z.string().trim().min(1).max(100) })).max(20).optional(),
      remove: z.array(z.string().max(100)).max(20).optional().describe('Positions to take out, by name.'),
      default: z.string().max(100).optional().describe('The position that is the default.'),
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'admin', 'edit');
      const now = await listBreakPositions();
      const find = (n: string) => {
        const hit = now.find((x) => x.name.toLowerCase() === n.trim().toLowerCase());
        if (!hit) throw new HttpError(404, `No break position ${quote(n)}: ${now.map((x) => quote(x.name)).join(', ') || 'there are none'}.`);
        return hit;
      };
      const removed = new Set((a.remove ?? []).map((n) => find(n).id));
      const renamed = new Map((a.rename ?? []).map((x) => [find(x.from).id, x.to]));
      const def = a.default ? (now.find((x) => x.name.toLowerCase() === a.default!.toLowerCase())?.id ?? null) : undefined;
      const rows = [
        ...now.filter((x) => !removed.has(x.id)).map((x) => ({
          id: x.id, version: x.version, name: renamed.get(x.id) ?? x.name, isDefault: def === undefined ? x.isDefault : x.id === def, color: x.color, priceModifier: x.priceModifier, contentTypeIds: x.contentTypeIds,
        })),
        ...(a.add ?? []).map((name) => ({ id: null, version: null, name, isDefault: a.default?.toLowerCase() === name.toLowerCase(), color: null, priceModifier: 0, contentTypeIds: [] as string[] })),
      ];
      const lines = [
        ...(a.add ?? []).map((n) => `- add ${quote(n)}`),
        ...[...renamed].map(([id, to]) => `- rename ${quote(now.find((x) => x.id === id)!.name)} → ${quote(to)}`),
        ...[...removed].map((id) => `- take out ${quote(now.find((x) => x.id === id)!.name)}`),
        ...(a.default ? [`- default: ${quote(a.default)}`] : []),
      ];
      const out = [`Break positions of ${p.tenant.name}: ${now.map((x) => x.name).join(', ') || 'none'}${preview(a.apply)}`, ...(lines.length ? lines : ['Nothing would change.'])];
      if (!lines.length) return out.join('\n');
      if (!a.apply) {
        out.push('To save it: edit_break_positions with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const saved = await saveBreakPositions({ rows, deletedIds: [...removed] });
      out[0] = `Break positions saved: ${saved.map((x) => x.name).join(', ')}. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: null, channelIds: [], before: { positions: now }, after: { ids: saved.map((x) => x.id) } } };
    },
    'write',
  );
}

// ---------------------------------------------------------------- undo

type ChangedSince = (what: string) => (err: unknown) => never;

/** Puts back what a change of these tools made; null for a tool that is not one of them. */
export async function undoSetup(e: AuditEvent, change: string, changedSince: ChangedSince): Promise<ToolResult | null> {
  const after = (e.after ?? {}) as Record<string, unknown>;
  const before = (e.before ?? {}) as Record<string, unknown>;
  const moved = (b: object | null, a: object) => ({ targetId: change, channelIds: e.channelIds, before: b, after: a });
  switch (e.action) {
    case 'tool create_channel': {
      const id = after.channelId as string;
      const used = (await db.template.count({ where: { deletedAt: null, playlist: { channelId: id } } })) + (await db.week.count({ where: { playlist: { channelId: id } } }));
      if (used) throw new HttpError(409, `The channel made by change ${change} has layouts or weeks now: it stays. Nothing was changed.`);
      await db.channel.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      return { text: `The channel made by change ${change} is removed.`, change: moved({ channelId: id }, { removed: true }) };
    }
    case 'tool edit_channel': {
      const id = after.channelId as string;
      const c = await getChannel(id);
      if (c.version !== after.version) throw new HttpError(409, `The channel changed after change ${change}, so undo would overwrite newer work: nothing was changed.`);
      const saved = await updateChannel(id, { ...(before.settings as ChannelSettings), version: c.version }).catch(changedSince('channel'));
      return { text: `${saved.name} is back as it was before change ${change} (version ${saved.version}).`, change: moved({ channelId: id }, { channelId: id, version: saved.version }) };
    }
    case 'tool create_layout':
    case 'tool clone_layout': {
      const id = after.templateId as string;
      if (await db.week.count({ where: { templateId: id } })) throw new HttpError(409, `Weeks were made from the layout of change ${change}: it stays. Nothing was changed.`);
      await deleteTemplate(id);
      return { text: `The layout made by change ${change} is deleted.`, change: moved({ templateId: id }, { deleted: true }) };
    }
    case 'tool rename_layout': {
      const id = after.templateId as string;
      const draft = before.draft as Parameters<typeof saveTemplate>[1];
      const saved = await saveTemplate(id, { ...draft, version: after.version as number }).catch(changedSince('layout'));
      return { text: `Layout ${quote(saved.template.name)} is back as it was before change ${change} (version ${saved.template.version}).`, change: moved({ templateId: id }, { version: saved.template.version }) };
    }
    case 'tool delete_layout': {
      const id = before.templateId as string;
      await db.template.updateMany({ where: { id }, data: { deletedAt: null } });
      return { text: `The layout deleted by change ${change} is back.`, change: moved(null, { templateId: id }) };
    }
    case 'tool create_block_type': {
      await deleteBlockType(after.blockTypeId as string).catch(changedSince('block type'));
      return { text: `The block type made by change ${change} is deleted.`, change: moved({ blockTypeId: after.blockTypeId }, { deleted: true }) };
    }
    case 'tool edit_block_type': {
      await updateBlockType(before.blockTypeId as string, before.fields as never);
      return { text: `The block type is back as it was before change ${change}.`, change: moved({ blockTypeId: before.blockTypeId }, { restored: true }) };
    }
    case 'tool delete_block_type': {
      await db.blockType.updateMany({ where: { id: before.blockTypeId as string }, data: { deletedAt: null } });
      return { text: `The block type deleted by change ${change} is back.`, change: moved(null, { blockTypeId: before.blockTypeId }) };
    }
    case 'tool create_break_list': {
      await deleteBreakList(after.breakListId as string);
      return { text: `The break list made by change ${change} is deleted.`, change: moved({ breakListId: after.breakListId }, { deleted: true }) };
    }
    case 'tool edit_break_list': {
      await updateBreakList(before.breakListId as string, { name: before.name as string, positions: before.positions as number[] });
      return { text: `The break list is back as it was before change ${change}.`, change: moved({ breakListId: before.breakListId }, { restored: true }) };
    }
    case 'tool delete_break_list': {
      const id = before.breakListId as string;
      await db.breakList.create({ data: { id, channelId: before.channelId as string, name: before.name as string, positions: before.positions as number[] } as never });
      if (before.wasDefault) await db.channel.updateMany({ where: { id: before.channelId as string, defaultBreakListId: null }, data: { defaultBreakListId: id } });
      return { text: `The break list deleted by change ${change} is back.`, change: moved(null, { breakListId: id }) };
    }
    case 'tool edit_break_positions': {
      const old = before.positions as { id: string; name: string; isDefault: boolean; color: string | null; priceModifier: number; contentTypeIds: string[] }[];
      const now = await listBreakPositions();
      const keep = new Set(old.map((x) => x.id));
      const rows = old.map((x) => {
        const cur = now.find((n) => n.id === x.id);
        return { id: cur ? x.id : null, version: cur?.version ?? null, name: x.name, isDefault: x.isDefault, color: x.color, priceModifier: x.priceModifier, contentTypeIds: x.contentTypeIds };
      });
      await saveBreakPositions({ rows, deletedIds: now.filter((n) => !keep.has(n.id)).map((n) => n.id) });
      return { text: `The break positions are back as they were before change ${change}.`, change: moved(null, { restored: true }) };
    }
    default:
      return null;
  }
}

