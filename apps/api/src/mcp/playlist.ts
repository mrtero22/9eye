// The rest of Playlist (decision 0025, group 6.2): the weeks of a channel (list, rename, delete) and a
// day's playout file (export_day, the Export cell: it changes nothing in 9eye). Creating weeks,
// filling and changing days, approving and reopening a day are in writes.ts and changes.ts. Rename and
// delete preview first and apply at the version the preview showed; undo_change puts them back
// (undoPlaylist) while nobody changed them since.

import { z } from 'zod';
import { STRUCTURAL_EVENT_KINDS, addDays, checkWeekName, weekDeleteBlockers, weekStartOn } from '@9eye/core';
import type { AuditEvent } from '@prisma/client';
import { demand } from '../access';
import { db, fromIsoDate, toIsoDate } from '../db';
import { HttpError } from '../errors';
import { exportDay } from '../services/exports';
import { createWeeks, deleteWeek, listWeeks, renameWeek, type WeekDto } from '../services/weeks';
import type { Principal } from './auth';
import { APPLY, UNDO_HINT, WEEKDAYS, capped, channelArg, findChannel, isoDate, playlistArg, plural, quote, range, type DefineTool, type ToolResult } from './common';

const apply = z.boolean().default(false).describe(APPLY);
const version = z.number().int().optional().describe('With apply: the week version the preview showed.');
const weekDate = isoDate.describe('Any day of the week, YYYY-MM-DD.');
const pv = (applying: boolean, what = 'nothing is saved') => (applying ? '' : ` — preview, ${what}`);
/** The longest playout file a tool hands over as text. */
const MAX_FILE = 400_000;

function checkVersion(applying: boolean, asked: number | undefined, now: number) {
  if (!applying) return;
  if (asked === undefined) throw new HttpError(400, 'Apply needs the version the preview showed.');
  if (asked !== now) throw new HttpError(409, `The week changed since the preview (version ${asked}, now ${now}): preview it again.`);
}

const dayWords = (w: WeekDto) => {
  const n = (s: string) => w.days.filter((d) => d.state === s).length;
  return [
    n('published') ? `${n('published')} approved` : null, n('reconciled') ? `${n('reconciled')} reconciled` : null, n('draft') ? plural(n('draft'), 'draft') : null,
    n('not-active') ? `${n('not-active')} off` : null,
  ].filter(Boolean).join(', ');
};
const weekLine = (w: WeekDto) =>
  `Week ${w.number} ${quote(w.name)} · ${w.kind} · ${range(w.firstDate, w.lastDate)} · layout ${quote(w.templateName)} · days: ${dayWords(w)} · version ${w.version} · id ${w.id}`;

/** The week of a channel's playlist that holds a day. */
async function weekOf(p: Principal, channel: string, kind: 'main' | 'ads', date: string) {
  const c = await findChannel(p, channel);
  const weeks = await listWeeks(c.id, kind, addDays(date, -6), date);
  const w = weeks.find((x) => x.firstDate <= date && date <= x.lastDate);
  if (!w) throw new HttpError(404, `${c.name} has no ${kind} week holding ${date}: create_weeks makes it.`);
  return { c, w };
}

/** Why a week cannot be deleted (a day approved, reconciled or holding rows). */
async function blockersOf(weekId: string) {
  const days = await db.dayPlaylist.findMany({
    where: { weekId },
    select: { date: true, published: true, reconciled: true, blocks: { select: { _count: { select: { events: { where: { kind: { notIn: [...STRUCTURAL_EVENT_KINDS] } } } } } } } },
  });
  return weekDeleteBlockers(days.map((d) => ({ date: toIsoDate(d.date), published: d.published, reconciled: d.reconciled, placedEvents: d.blocks.reduce((n, b) => n + b._count.events, 0) })));
}

// ---------------------------------------------------------------- read

export function registerPlaylistRead(tool: DefineTool, p: Principal) {
  tool(
    'list_weeks',
    'List weeks',
    "A channel's weeks: number, name, playlist, dates, layout, how many days are approved, drafts or switched off, version and id.",
    z.object({
      channel: channelArg,
      playlist: z.enum(['main', 'ads']).optional().describe('Default: both.'),
      from: isoDate.optional().describe('Weeks from the one holding this day. Default: this week.'),
      weeks: z.number().int().min(1).max(52).default(8),
    }),
    async (a) => {
      const c = await findChannel(p, a.channel);
      demand(p.access, 'playlist', 'view', c.id);
      const from = weekStartOn(a.from ?? c.today, c.weekStart);
      const to = addDays(from, 7 * a.weeks - 1);
      const kinds = a.playlist ? [a.playlist] : c.adsPlaylistId ? (['main', 'ads'] as const) : (['main'] as const);
      const rows = (await Promise.all(kinds.map((k) => listWeeks(c.id, k, from, to)))).flat().sort((x, y) => (x.firstDate < y.firstDate ? -1 : x.firstDate > y.firstDate ? 1 : x.kind.localeCompare(y.kind)));
      return [`${c.name} · weeks ${range(from, to)} · ${plural(rows.length, 'week')}`, ...(rows.length ? capped(rows.map((w) => `- ${weekLine(w)}`), 'ask for fewer weeks') : ['- none: create_weeks makes them'])].join('\n');
    },
  );

  tool(
    'export_day',
    "A day's playout file",
    "The playout file of one broadcast day (Playout XML), made from its saved main playlist with the ads in it, as text the app can save under the file name it gives. It changes nothing in 9eye. A draft day can be exported, but only an approved day is ready for air.",
    z.object({ channel: channelArg, date: isoDate.describe('The broadcast day, YYYY-MM-DD.'), format: z.enum(['playout-xml']).default('playout-xml') }),
    async (a) => {
      const c = await findChannel(p, a.channel);
      demand(p.access, 'playlist', 'export', c.id);
      const f = await exportDay(c.id, a.date, a.format);
      const out = [
        `${c.name} · ${WEEKDAYS[new Date(`${a.date}T00:00:00Z`).getUTCDay()]} ${a.date} · ${f.fileName} · ${plural(f.items, 'item')}${f.draft ? ' · THE DAY IS A DRAFT: not approved for air yet' : ' · approved'}`,
        ...(f.noFile.length ? [`Rows without a playout file (written with an empty path): ${capped(f.noFile.map(quote), 'and more', 20).join(', ')}`] : []),
      ];
      if (f.content.length > MAX_FILE) return [...out, `The file is ${Math.round(f.content.length / 1000)} kB, too long to hand over here: download it from the day page (Export).`].join('\n');
      return [...out, '', `File ${f.fileName}:`, '```xml', f.content, '```'].join('\n');
    },
  );
}

// ---------------------------------------------------------------- writes

export function registerPlaylistTools(tool: DefineTool, p: Principal) {
  tool(
    'rename_week',
    'Rename a week',
    `Give a week of a channel's playlist a new name. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({ channel: channelArg, date: weekDate, playlist: playlistArg, name: z.string().trim().min(1).max(200), apply, version }),
    async (a, { changeId }) => {
      const { c, w } = await weekOf(p, a.channel, a.playlist, a.date);
      demand(p.access, 'playlist', 'edit', c.id);
      checkVersion(a.apply, a.version, w.version);
      const head = `${c.name} · Week ${w.number} · ${a.playlist} · ${range(w.firstDate, w.lastDate)} · version ${w.version}${pv(a.apply)}`;
      if (a.name === w.name) return `${head}\nIt is called ${quote(w.name)} already.`;
      const problem = checkWeekName(a.name);
      const lines = [head, `- name: ${quote(w.name)} → ${quote(a.name)}`];
      if (problem) {
        lines.push(`Cannot: ${problem} Nothing was changed.`);
        if (a.apply) throw new HttpError(422, lines.join('\n'));
        return lines.join('\n');
      }
      if (!a.apply) return { text: [...lines, `To rename it: rename_week with the same arguments, apply: true and version ${w.version}.`].join('\n'), applyWith: { apply: true, version: w.version } };
      const now = await renameWeek(w.id, { name: a.name, version: w.version }, p.user.id);
      return { text: [`Week ${w.number} is now ${quote(now.name)} (version ${now.version}). Change id ${changeId} — ${UNDO_HINT}`].join('\n'), change: { targetId: w.id, channelIds: [c.id], before: { weekId: w.id, name: w.name }, after: { weekId: w.id, version: now.version } } };
    },
    'write',
  );

  tool(
    'delete_week',
    'Delete a week',
    `Delete a week of a channel's playlist with its day playlists — refused while a day of it is approved, reconciled or holds rows. Preview first; apply needs the version the preview showed. ${UNDO_HINT} (undo makes the week again from its layout, with its name)`,
    z.object({ channel: channelArg, date: weekDate, playlist: playlistArg, apply, version }),
    async (a, { changeId }) => {
      const { c, w } = await weekOf(p, a.channel, a.playlist, a.date);
      demand(p.access, 'playlist', 'edit', c.id);
      checkVersion(a.apply, a.version, w.version);
      const head = [`Delete ${weekLine(w).replace(/ · id .*$/, '')} on ${c.name}${pv(a.apply, 'nothing is deleted')}`];
      const blockers = await blockersOf(w.id);
      if (blockers.length) {
        const text = [...head, 'Cannot: the week is in use. Nothing was changed.', ...blockers.map((b) => `- ${b.message}`)].join('\n');
        if (a.apply) throw new HttpError(409, text);
        return text;
      }
      if (!a.apply) return { text: [...head, `To delete it: delete_week with the same arguments, apply: true and version ${w.version}.`].join('\n'), applyWith: { apply: true, version: w.version } };
      await deleteWeek(w.id);
      return {
        text: `Week ${w.number} ${quote(w.name)} (${a.playlist}, ${range(w.firstDate, w.lastDate)}) is deleted. Change id ${changeId} — undo_change makes it again from its layout.`,
        change: { targetId: w.id, channelIds: [c.id], before: { channelId: c.id, kind: w.kind, firstDate: w.firstDate, templateId: w.templateId, name: w.name }, after: { weekId: w.id, deleted: true } },
      };
    },
    'write',
  );
}

// ---------------------------------------------------------------- undo

/** Puts back what a change of these tools made; null for a tool that is not one of them. */
export async function undoPlaylist(e: AuditEvent, change: string, userId: string | null): Promise<ToolResult | null> {
  const after = (e.after ?? {}) as Record<string, unknown>;
  const before = (e.before ?? {}) as Record<string, unknown>;
  const done = (text: string, a: object): ToolResult => ({ text, change: { targetId: change, channelIds: e.channelIds, before: null, after: a } });
  switch (e.action) {
    case 'tool rename_week': {
      const now = await renameWeek(after.weekId as string, { name: before.name as string, version: after.version as number }, userId).catch((err: unknown) => {
        if (err instanceof HttpError && err.status === 409) throw new HttpError(409, `The week changed after change ${change}, so undo would overwrite newer work: nothing was changed.`);
        throw err;
      });
      return done(`The week is called ${quote(now.name)} again.`, { weekId: now.id, version: now.version });
    }
    case 'tool delete_week': {
      const channelId = before.channelId as string;
      const kind = before.kind as 'main' | 'ads';
      const firstDate = before.firstDate as string;
      const there = await db.week.findFirst({ where: { playlist: { channelId, kind }, firstDate: { gt: fromIsoDate(addDays(firstDate, -7)), lte: fromIsoDate(addDays(firstDate, 6)) } } });
      if (there) throw new HttpError(409, `A week holding ${firstDate} was made since change ${change}: nothing was changed.`);
      const made = await createWeeks(channelId, { kinds: [kind], fromWeek: firstDate, toWeek: firstDate, templates: { main: kind === 'main' ? (before.templateId as string) : null, ads: kind === 'ads' ? (before.templateId as string) : null } }, userId);
      const w = made.weeks[0];
      const named = w && w.name !== before.name ? await renameWeek(w.id, { name: before.name as string, version: w.version }, userId) : w;
      return done(`Week ${named?.number ?? ''} ${quote(String(before.name))} is made again from its layout (${firstDate}).`, { weekId: named?.id ?? null });
    }
    default:
      return null;
  }
}

