// The change tools of decision 0024, phase C1 — also offered to MCP clients with an edit token, but
// approving and reopening a day only to agents (their approvals wait for a person, who approves a
// day for air twice; decision 0023 keeps that out of AI apps):
//   Playlist  edit_day (rows by hand), approve_day, reopen_day
//   Layouts   get_layout (read), edit_layout
//   Media     edit_media (an item's fields), add_to_rotation_list
//   Ads       confirm_campaign, remove_campaign_spots
// Each previews first, applies at the version the preview showed (all or nothing), and keeps what
// was there before, so undo_change (writes.ts, then undoMore here) puts it back while nobody has
// changed it since.

import { z } from 'zod';
import {
  draftBlocks, formatClock, formatTc, frameRate, layoutDay, offsetFromClock, parseTc, uuidv7, validateDay, weekOrder,
  type BlockDraft, type DraftRow, type FrameRate,
} from '@9eye/core';
import type { AuditEvent } from '@prisma/client';
import { demand } from '../access';
import { db, fromIsoDate, toIsoDate } from '../db';
import { HttpError } from '../errors';
import { deleteItems, addListItems } from '../services/catalogOps';
import { getItem } from '../services/catalogItems';
import { getCommercialOrder, saveCommercialOrder, saveCommercialWeek, type BookingDto } from '../services/commercialOrders';
import { catalogRows, getDay, rotationLists, runStep, saveDay, setPublished, type CatalogRowDto } from '../services/days';
import { getTemplateFull, listTemplates, saveTemplate, templateProblems, type TemplateFullDto } from '../services/templates';
import { campaignRef } from './ads';
import type { Principal } from './auth';
import {
  APPLY, ROW_KIND, STATE, UNDO_HINT, WEEKDAYS, capped, channelArg, checkText, dateArg, dayHead, draftRow, findChannel, isoDate, missingText, playlistArg,
  plural, quote, range, rowRef, type DefineTool, type ToolResult,
} from './common';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MAX_DAYS = 62;
const version = z.number().int().optional();
const apply = z.boolean().default(false).describe(APPLY);
const rowArg = z.string().trim().min(4).max(40).describe('A row code, as get_day_playlist shows it ("row 3f9a1c2e").');
const blockArg = z.string().trim().min(4).max(40).describe('A block code, as get_layout shows it ("block 7c0d2e11").');
const code = (ref: string) => ref.trim().toLowerCase().replace(/^(row|block)\s+/, '');

function checkVersion(applying: boolean, asked: number | undefined, now: number, what: string) {
  if (!applying) return;
  if (asked === undefined) throw new HttpError(400, 'Apply needs the version the preview showed.');
  if (asked !== now) throw new HttpError(409, `The ${what} changed since the preview (version ${asked}, now ${now}): preview it again.`);
}

/** A clock time of the channel ("HH:MM" or "HH:MM:SS:FF") as an offset from the broadcast-day start. */
function clockArg(s: string, r: FrameRate, dayStart: number): number {
  const f = parseTc(s.trim(), r);
  if (f === null) throw new HttpError(400, `"${s}" is not a clock time (HH:MM or HH:MM:SS:FF).`);
  return offsetFromClock(f, dayStart, r);
}
function lengthArg(s: string, r: FrameRate): number {
  const f = parseTc(s.trim(), r);
  if (f === null || f <= 0) throw new HttpError(400, `"${s}" is not a length (HH:MM:SS:FF).`);
  return f;
}

// ---------------------------------------------------------------- a day changed by hand

const placeArgs = {
  after: rowArg.optional().describe('The row it goes after.'),
  block: z.string().trim().max(200).optional().describe('Or the block it goes at the end of: its name or its planned start (HH:MM).'),
};
const dayEditArgs = z.object({
  channel: channelArg,
  date: dateArg,
  playlist: playlistArg,
  changes: z
    .array(
      z.discriminatedUnion('op', [
        z.object({ op: z.literal('replace'), row: rowArg, item: z.uuid().describe('The item that airs instead (search_media gives item ids).') }),
        z.object({ op: z.literal('remove'), row: rowArg }),
        z.object({ op: z.literal('add'), item: z.uuid().describe('The item to put in (search_media gives item ids).'), ...placeArgs }),
        z.object({ op: z.literal('move'), row: rowArg, ...placeArgs }),
      ]),
    )
    .min(1)
    .max(50)
    .describe('Done in this order.'),
  version,
  apply,
});
type DayEditArgs = z.infer<typeof dayEditArgs>;

const STRUCTURAL = new Set(['linked-break', 'gap-compensator']);

/** Works out a day edit (nothing is saved): the rows after it, in words, and what is wrong. */
export async function planDayEdit(p: Principal, a: Omit<DayEditArgs, 'apply' | 'version'>) {
  const c = await findChannel(p, a.channel);
  demand(p.access, 'playlist', 'edit', c.id);
  const d = await getDay(c.id, a.playlist, a.date ?? c.today);
  if (!d.day) throw new HttpError(409, `${dayHead(d)}\n${missingText(d)} create_weeks makes it.`);
  if (d.day.state !== 'draft') throw new HttpError(409, `${dayHead(d)}\nThis day is ${STATE[d.day.state] ?? d.day.state}: a person must reopen it before it changes.`);
  const day = d.day;
  const r = frameRate(d.channel.frameRate);
  const clock = (f: number) => formatClock(f, d.channel.dayStartFrames, r);
  const tc = (f: number) => formatTc(f, r);
  const before = day.blocks.map((b) => ({ id: b.id, rows: b.events.map(draftRow) }));
  const next = before.map((b) => ({ id: b.id, rows: [...b.rows] }));
  const events = new Map(day.blocks.flatMap((b) => b.events.map((e) => [e.id, e] as const)));
  const items = new Map((await catalogRows([...new Set(a.changes.flatMap((x) => ('item' in x ? [x.item] : [])))])).map((x) => [x.productionId, x]));
  const added = new Map<string, CatalogRowDto>();
  const changed = new Set<string>();

  const label = (row: DraftRow) => `${row.title || ROW_KIND[row.kind] || row.kind}`;
  const at = (id: string) => {
    for (const b of next) {
      const i = b.rows.findIndex((x) => x.id === id);
      if (i >= 0) return { b, i, row: b.rows[i] };
    }
    return null;
  };
  const findRow = (ref: string) => {
    const k = code(ref);
    const hits = next.flatMap((b) => b.rows.filter((x) => rowRef(x.id) === k).map((x) => x.id));
    if (hits.length !== 1) throw new HttpError(404, `No row "${ref}" in ${dayHead(d)}: get_day_playlist shows each row's code.`);
    const found = at(hits[0])!;
    if (STRUCTURAL.has(found.row.kind)) throw new HttpError(422, `"${label(found.row)}" is ${found.row.kind === 'linked-break' ? 'a break' : 'a gap holder'}: it stays as it is.`);
    return found;
  };
  const itemOf = (id: string) => {
    const it = items.get(id);
    if (!it) throw new HttpError(404, `No item ${id} in the catalog: search_media gives item ids.`);
    return it;
  };
  const startOf = (id: string) => {
    const e = events.get(id);
    return e ? `${clock(e.startFrames)} ` : '';
  };
  const blockOf = (ref: string) => {
    const k = ref.trim().toLowerCase();
    const hit = day.blocks.filter((b) => b.name.toLowerCase() === k || clock(b.plannedStartFrames).startsWith(k));
    if (hit.length !== 1) throw new HttpError(404, hit.length ? `"${ref}" fits ${hit.length} blocks: name its start (HH:MM).` : `No block "${ref}" in this day.`);
    return hit[0];
  };
  const place = (row: DraftRow, where: { after?: string; block?: string }): string => {
    if (where.after) {
      const t = findRow(where.after);
      if (t.row.relatedEventId) throw new HttpError(422, `"${label(t.row)}" is a spot inside a break: rows go after a programme, trailer or note.`);
      t.b.rows.splice(t.i + 1, 0, row);
      return `after ${startOf(t.row.id)}${label(t.row)}`;
    }
    if (where.block) {
      const b = blockOf(where.block);
      const nb = next.find((x) => x.id === b.id)!;
      const g = nb.rows.findIndex((x) => x.kind === 'gap-compensator');
      if (g >= 0) nb.rows.splice(g, 0, row);
      else nb.rows.push(row);
      return `at the end of ${clock(b.plannedStartFrames)} ${b.name}`;
    }
    throw new HttpError(400, 'Say where it goes: after a row (after), or at the end of a block (block).');
  };

  const lines: string[] = [];
  for (const x of a.changes) {
    if (x.op === 'replace') {
      const t = findRow(x.row);
      const it = itemOf(x.item);
      t.b.rows[t.i] = {
        ...t.row, kind: it.kind, title: it.title, lengthFrames: it.lengthFrames ?? 0, productionId: it.productionId, segmentId: null, tcInFrames: 0,
        tcOutFrames: it.lengthFrames ?? 0, orderId: null, rotationListId: null, airingItemId: null,
      };
      added.set(t.row.id, it);
      changed.add(t.row.id);
      lines.push(`- ${startOf(t.row.id)}${label(t.row)} → ${it.title}${it.episode ? ` (ep ${it.episode})` : ''} · ${it.lengthFrames === null ? 'no length' : tc(it.lengthFrames)}`);
    } else if (x.op === 'remove') {
      const t = findRow(x.row);
      t.b.rows.splice(t.i, 1);
      lines.push(`- take out ${startOf(t.row.id)}${label(t.row)}`);
    } else if (x.op === 'add') {
      const it = itemOf(x.item);
      const row: DraftRow = {
        id: uuidv7(), kind: it.kind, title: it.title, lengthFrames: it.lengthFrames ?? 0, productionId: it.productionId, segmentId: null, tcInFrames: 0,
        tcOutFrames: it.lengthFrames ?? 0, fixed: false, hold: false, autoAdjust: false, note: '', breakTypeId: null, relatedEventId: null, orderId: null,
        rotationListId: null, airingItemId: null,
      };
      const where = place(row, x);
      added.set(row.id, it);
      changed.add(row.id);
      lines.push(`- put in ${it.title}${it.episode ? ` (ep ${it.episode})` : ''} · ${it.lengthFrames === null ? 'no length' : tc(it.lengthFrames)} ${where}`);
    } else {
      const t = findRow(x.row);
      t.b.rows.splice(t.i, 1);
      const where = place(t.row, x);
      changed.add(t.row.id);
      lines.push(`- move ${startOf(t.row.id)}${label(t.row)} ${where}`);
    }
  }

  const problems = validateDay({ blocks: next }, { blockIds: day.blocks.map((b) => b.id), allowsBreaks: d.kind === 'main' && !!d.channel.adsPlaylistId });
  for (const [id, it] of added) if (it.lengthFrames === null && at(id)) problems.push({ code: 'length', message: `${it.title} has no length in the catalog: give it one first (edit_media).` } as never);
  const planned = day.blocks.map((b) => ({ id: b.id, startFrames: b.plannedStartFrames, lengthFrames: b.plannedLengthFrames }));
  const laid = layoutDay(draftBlocks({ blocks: next }, planned));
  const touched = next.filter((b, i) => JSON.stringify(b.rows) !== JSON.stringify(before[i].rows)).map((b) => b.id);
  const state = (g: number) => (g < 0 ? `${tc(-g)} short` : g > 0 ? `${tc(g)} over` : 'full');
  const blockLines = touched.map((id) => {
    const b = day.blocks.find((x) => x.id === id)!;
    const lb = laid.blocks.find((x) => x.id === id)!;
    return `- ${clock(b.plannedStartFrames)} ${b.name}: ${state(lb.gapFrames)} (was ${state(b.gapFrames)})`;
  });
  return { c, d, day, before, next, lines, blockLines, problems: problems as { message: string }[], added, changed };
}

/** The day as an edit would leave it, for the day page's preview (nothing is saved). */
export async function dayEditPreview(p: Principal, a: Omit<DayEditArgs, 'apply' | 'version'>) {
  const plan = await planDayEdit(p, a);
  const events = new Map(plan.day.blocks.flatMap((b) => b.events.map((e) => [e.id, e] as const)));
  const keep = new Set(plan.next.flatMap((b) => b.rows.map((r) => r.id)));
  return {
    blocks: plan.next.map((b) => ({
      id: b.id,
      events: b.rows.map((row) => {
        const it = plan.added.get(row.id);
        const old = events.get(row.id);
        return it
          ? { ...(old ?? {}), ...row, color: it.color, contentType: it.contentType, media: it.media, episode: it.episode, breakName: null, inBreak: false, startFrames: 0, sequence: 0 }
          : { ...old!, ...row };
      }),
    })),
    changed: [...plan.changed],
    removed: [...events.keys()].filter((id) => !keep.has(id)).length,
    problems: plan.problems.map((x) => x.message),
  };
}

/** What a fill step would leave in the day (nothing is saved), for the day page's preview. */
export async function fillDayPreview(p: Principal, a: { channel: string; date?: string; playlist: 'main' | 'ads'; step: string; mode: 'missing' | 'all' }) {
  const c = await findChannel(p, a.channel);
  demand(p.access, 'playlist', 'view', c.id);
  const d = await getDay(c.id, a.playlist, a.date ?? c.today);
  if (!d.day) throw new HttpError(409, `${dayHead(d)}\n${missingText(d)}`);
  const step = ({ programs: 'programs', breaks: 'breaks', rotation: 'rotation', campaigns: 'commercials' } as const)[a.step as 'programs'];
  if (!step) throw new HttpError(422, `No fill step "${a.step}".`);
  const before = d.day.blocks.map((b) => ({ id: b.id, rows: b.events.map(draftRow) }));
  const run = await runStep(d.day.id, { step, mode: a.mode, version: d.day.version, blocks: before });
  const old = new Set(before.flatMap((b) => b.rows.map((r) => r.id)));
  const now = new Set(run.blocks.flatMap((b) => b.events.map((e) => e.id)));
  return {
    blocks: run.blocks,
    changed: [...now].filter((id) => !old.has(id)),
    removed: [...old].filter((id) => !now.has(id)).length,
    problems: run.report.notPlaced.map((x) => `${x.block} · ${x.title}${x.detail ? ` · ${x.detail}` : ''}`),
  };
}

// ---------------------------------------------------------------- media

/**
 * Writes only these fields of an item (title, episode, length, dates, media state, notes) at its
 * version — not the whole form, so an item the Media page would ask more of still takes them.
 */
async function patchItem(id: string, version: number, fields: Record<string, unknown>): Promise<number> {
  const data: Record<string, unknown> = { ...fields };
  for (const k of ['starts', 'expires']) if (k in data) data[k] = data[k] ? fromIsoDate(data[k] as string) : null;
  const r = await db.production.updateMany({ where: { id, version, deletedAt: null }, data: { ...data, version: { increment: 1 } } });
  if (r.count !== 1) throw new HttpError(409, 'Someone changed this item since the preview: preview it again.');
  return version + 1;
}

// ---------------------------------------------------------------- layouts

async function layoutOf(p: Principal, channel: string, kind: 'main' | 'ads', ref: string | undefined): Promise<TemplateFullDto> {
  const c = await findChannel(p, channel);
  const all = (await listTemplates(c.id)).filter((t) => t.kind === kind);
  if (!all.length) throw new HttpError(404, `${c.name} has no ${kind} layout.`);
  let t = all[0];
  if (ref) {
    const k = ref.trim().toLowerCase();
    const hit = all.filter((x) => x.id === ref.trim() || x.name.toLowerCase() === k);
    if (hit.length !== 1) throw new HttpError(404, `No ${kind} layout "${ref}" on ${c.name}: ${all.map((x) => quote(x.name)).join(', ')}.`);
    t = hit[0];
  } else {
    const today = c.today;
    t = all.find((x) => x.validFrom <= today && today <= x.validTo) ?? all[all.length - 1];
  }
  return getTemplateFull(t.id);
}

async function typeNames(full: TemplateFullDto) {
  const ids = [...new Set(full.blocks.flatMap((b) => [b.blockTypeId, ...b.breaks]))];
  const rows = await db.blockType.findMany({ where: { OR: [{ id: { in: ids } }, { playlistId: full.template.playlistId, deletedAt: null }] }, select: { id: true, name: true, lengthFrames: true, playlistId: true } });
  return new Map(rows.map((x) => [x.id, x]));
}

function layoutText(full: TemplateFullDto, types: Map<string, { name: string; lengthFrames: number; playlistId: string }>) {
  const r = frameRate(full.channel.frameRate);
  const clock = (f: number) => formatClock(f, full.channel.dayStartFrames, r);
  const tc = (f: number) => formatTc(f, r);
  const t = full.template;
  const on = weekOrder(full.channel.weekStart).filter((d) => t.activeWeekdays[d]).map((d) => SHORT_DAYS[d]);
  const out = [
    `${full.channel.name} · ${t.kind} layout ${quote(t.name)} · ${range(t.validFrom, t.validTo)} · ${on.length === 7 ? 'every day' : on.join(' ')} · version ${t.version}`,
    `Clock times are times of day; lengths are timecode at ${r.label}. Weeks made already keep their blocks; new weeks are made from this.`,
  ];
  for (const d of weekOrder(full.channel.weekStart)) {
    const blocks = full.blocks.filter((b) => b.weekday === d).sort((a, b) => a.startFrames - b.startFrames);
    out.push('', `${WEEKDAYS[d]}:`);
    if (!blocks.length) out.push('- no blocks');
    for (const b of blocks) {
      out.push(
        [
          `- ${clock(b.startFrames)} ${types.get(b.blockTypeId)?.name ?? 'Unknown block type'}`,
          tc(b.lengthFrames),
          b.fillGaps ? 'fills gaps' : null,
          b.breaks.length ? `breaks: ${b.breaks.map((x) => types.get(x)?.name ?? '?').join(', ')}` : null,
          b.note ? `note: ${b.note}` : null,
          `block ${rowRef(b.id)}`,
        ].filter(Boolean).join(' · '),
      );
    }
  }
  const own = [...types.values()].filter((x) => x.playlistId === t.playlistId);
  out.push('', 'Block types it can use:', ...capped(own.map((x) => `- ${x.name} · ${tc(x.lengthFrames)}`), 'and more', 60));
  return out.join('\n');
}

// ---------------------------------------------------------------- the tools

export function registerChangeTools(tool: DefineTool, p: Principal) {
  tool(
    'edit_day',
    'Change rows of a day',
    `Change rows of one day playlist by hand, as on the day page: replace the item of a row, take rows out, put a catalog item in after a row (or at the end of a block), move a row. Rows are named by the code get_day_playlist shows ("row 3f9a1c2e"), items by their id (search_media). Breaks and gap holders stay as they are. Preview first: it lists every change, the blocks that end short or over, and what stops it. Apply saves only if the day is still at the version the preview showed. ${UNDO_HINT}`,
    dayEditArgs,
    async (a, { changeId }) => {
      const plan = await planDayEdit(p, a);
      const { c, d, day } = plan;
      checkVersion(a.apply, a.version, day.version, 'day');
      const out = [`${dayHead(d)} · version ${day.version}${a.apply ? '' : ' — preview, nothing is saved'}`, 'Changes:', ...plan.lines, '', 'Blocks it changes:', ...(plan.blockLines.length ? plan.blockLines : ['- none'])];
      if (plan.problems.length) {
        out.push('', 'Problems — nothing can be saved until they are solved:', ...plan.problems.map((x) => `- ${x.message}`));
        if (a.apply) throw new HttpError(422, out.join('\n'));
        return out.join('\n');
      }
      if (!a.apply) {
        out.push('', `To save it: edit_day with the same changes, apply: true and version ${day.version}.`);
        return { text: out.join('\n'), applyWith: { apply: true, version: day.version, date: d.date } };
      }
      const saved = await saveDay(day.id, { version: day.version, blocks: plan.next });
      const v = saved.day!.version;
      out[0] = `${dayHead(d)} — saved as version ${v}. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: day.id, channelIds: [c.id], before: { dayId: day.id, version: day.version, blocks: plan.before }, after: { dayId: day.id, version: v } } };
    },
    'write',
  );

  // Approving and reopening a day: agents, and AI apps where the company's table has Playlist › Approve
  // (decision 0025; an agent's approval, and an app's that asks first, is approved twice by a person).
  {
    const dayArgs = { channel: channelArg, date: dateArg, playlist: playlistArg, version, apply };
    const setDay = async (a: { channel: string; date?: string; playlist: 'main' | 'ads'; version?: number; apply: boolean }, changeId: string, publish: boolean): Promise<ToolResult> => {
      const c = await findChannel(p, a.channel);
      demand(p.access, 'playlist', 'approve', c.id);
      const d = await getDay(c.id, a.playlist, a.date ?? c.today);
      if (!d.day) throw new HttpError(409, `${dayHead(d)}\n${missingText(d)}`);
      if (d.day.state === 'reconciled') throw new HttpError(409, `${dayHead(d)}\nIt is reconciled with what was aired: it cannot change.`);
      if (publish && d.day.state === 'published') return `${dayHead(d)}\nIt is approved already.`;
      if (!publish && d.day.state === 'draft') return `${dayHead(d)}\nIt is a draft already.`;
      checkVersion(a.apply, a.version, d.day.version, 'day');
      if (!a.apply) {
        const out = publish
          ? [`${dayHead(d)} · version ${d.day.version} — preview: approving puts this day on air (it becomes read-only, ready to export).`, '', checkText(d), '', `To approve it: approve_day with apply: true and version ${d.day.version}. A person approves a day for air twice.`]
          : [`${dayHead(d)} · version ${d.day.version} — preview: reopening makes it a draft again, so it can change; it must be approved again before it airs.`, '', `To reopen it: reopen_day with apply: true and version ${d.day.version}.`];
        return { text: out.join('\n'), applyWith: { apply: true, version: d.day.version, date: d.date } };
      }
      const r = await setPublished(d.day.id, { publish, version: d.day.version });
      return {
        text: `${dayHead(d)} is ${publish ? 'approved for air' : 'reopened: a draft again'} (version ${r.version}). Change id ${changeId} — undo_change ${publish ? 'reopens it' : 'approves it again'} while nobody changes it since.`,
        change: { targetId: d.day.id, channelIds: [c.id], before: { dayId: d.day.id, version: d.day.version, published: !publish }, after: { dayId: d.day.id, version: r.version, published: publish } },
      };
    };
    tool(
      'approve_day',
      'Approve a day for air',
      'Approve one day playlist for air, as Approve on the day page: it becomes read-only, ready to export. Preview first: it shows what is still wrong with the day; apply only after the person agrees. Where the change waits for a person in 9eye, they approve a day for air twice. undo_change reopens it while nobody changes it since.',
      z.object(dayArgs),
      async (a, { changeId }) => setDay(a, changeId, true),
      'write',
    );
    tool(
      'reopen_day',
      'Reopen a day',
      'Reopen an approved day playlist, so it can change again (it must be approved again before it airs). Preview first. undo_change approves it again while nobody changes it since.',
      z.object(dayArgs),
      async (a, { changeId }) => setDay(a, changeId, false),
      'write',
    );
  }

  tool(
    'edit_layout',
    'Change a layout',
    `Change the blocks of a channel's layout: add a block of a block type at a time on chosen weekdays, take a block out, move it to another time, or change its length. Blocks are named by the code get_layout shows ("block 7c0d2e11"). Weeks made already keep their blocks; the weeks made from now on follow the layout. Preview first: it lists the changes and every problem. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      playlist: playlistArg,
      layout: z.string().max(300).optional().describe('Its name or id. Default: the layout valid today.'),
      changes: z
        .array(
          z.discriminatedUnion('op', [
            z.object({
              op: z.literal('add'),
              block_type: z.string().max(200).describe('Its name, as get_layout lists the block types.'),
              at: z.string().max(11).describe('Planned start: HH:MM or HH:MM:SS:FF.'),
              weekdays: z.array(z.enum(SHORT_DAYS)).min(1).max(7),
              length: z.string().max(11).optional().describe('HH:MM:SS:FF. Default: the block type length.'),
            }),
            z.object({ op: z.literal('remove'), block: blockArg }),
            z.object({ op: z.literal('move'), block: blockArg, at: z.string().max(11).describe('New planned start: HH:MM or HH:MM:SS:FF.') }),
            z.object({ op: z.literal('length'), block: blockArg, length: z.string().max(11).describe('New length, HH:MM:SS:FF.') }),
          ]),
        )
        .min(1)
        .max(50)
        .describe('Done in this order.'),
      version,
      apply,
    }),
    async (a, { changeId }) => {
      const full = await layoutOf(p, a.channel, a.playlist, a.layout);
      demand(p.access, 'templates', 'edit', full.channel.id);
      checkVersion(a.apply, a.version, full.template.version, 'layout');
      const types = await typeNames(full);
      const r = frameRate(full.channel.frameRate);
      const clock = (f: number) => formatClock(f, full.channel.dayStartFrames, r);
      const tc = (f: number) => formatTc(f, r);
      const t = full.template;
      const before = { name: t.name, validFrom: t.validFrom, validTo: t.validTo, activeWeekdays: t.activeWeekdays, blocks: full.blocks };
      const blocks: BlockDraft[] = full.blocks.map((b) => ({ ...b }));
      const find = (ref: string) => {
        const hit = blocks.filter((b) => rowRef(b.id) === code(ref));
        if (hit.length !== 1) throw new HttpError(404, `No block "${ref}" in layout ${quote(t.name)}: get_layout shows each block's code.`);
        return hit[0];
      };
      const name = (b: BlockDraft) => `${SHORT_DAYS[b.weekday]} ${clock(b.startFrames)} ${types.get(b.blockTypeId)?.name ?? 'block'}`;
      const lines: string[] = [];
      for (const x of a.changes) {
        if (x.op === 'add') {
          const k = x.block_type.trim().toLowerCase();
          const type = [...types.entries()].find(([, v]) => v.playlistId === t.playlistId && v.name.toLowerCase() === k);
          if (!type) throw new HttpError(404, `No block type ${quote(x.block_type)} in this layout's playlist: get_layout lists them.`);
          const start = clockArg(x.at, r, full.channel.dayStartFrames);
          const length = x.length ? lengthArg(x.length, r) : type[1].lengthFrames;
          for (const wd of x.weekdays) {
            blocks.push({ id: uuidv7(), weekday: SHORT_DAYS.indexOf(wd), blockTypeId: type[0], startFrames: start, lengthFrames: length, fillGaps: true, opensWithBreak: false, note: '', rotationListId: null, limitsPerContentType: [], breaks: [] });
          }
          lines.push(`- add ${type[1].name} at ${clock(start)} for ${tc(length)} on ${x.weekdays.join(' ')}`);
        } else if (x.op === 'remove') {
          const b = find(x.block);
          blocks.splice(blocks.indexOf(b), 1);
          lines.push(`- take out ${name(b)}`);
        } else if (x.op === 'move') {
          const b = find(x.block);
          const start = clockArg(x.at, r, full.channel.dayStartFrames);
          lines.push(`- move ${name(b)} to ${clock(start)}`);
          b.startFrames = start;
        } else {
          const b = find(x.block);
          const length = lengthArg(x.length, r);
          lines.push(`- ${name(b)}: ${tc(b.lengthFrames)} → ${tc(length)}`);
          b.lengthFrames = length;
        }
      }
      const draft = { ...before, blocks };
      const problems = await templateProblems(t.id, draft);
      const out = [`${full.channel.name} · ${t.kind} layout ${quote(t.name)} · version ${t.version}${a.apply ? '' : ' — preview, nothing is saved'}`, 'Changes:', ...lines];
      if (problems.length) {
        out.push('', 'Problems — nothing can be saved until they are solved:', ...problems.map((x) => `- ${x.message}`));
        if (a.apply) throw new HttpError(422, out.join('\n'));
        return out.join('\n');
      }
      out.push('', 'Weeks made already keep their blocks; the weeks made from now on follow it.');
      if (!a.apply) {
        out.push(`To save it: edit_layout with the same changes, apply: true and version ${t.version}.`);
        return { text: out.join('\n'), applyWith: { apply: true, version: t.version, layout: t.id } };
      }
      const saved = await saveTemplate(t.id, { ...draft, version: t.version });
      out[0] = `${full.channel.name} · ${t.kind} layout ${quote(t.name)} — saved as version ${saved.template.version}. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: t.id, channelIds: [full.channel.id], before: { templateId: t.id, draft: before }, after: { templateId: t.id, version: saved.template.version } } };
    },
    'write',
  );

  tool(
    'edit_media',
    'Change a media item',
    `Change fields of one item (an episode or version of a title): its title, episode number, length, the days it may air (starts / expires), its media state, notes. Preview first. ${UNDO_HINT}`,
    z.object({
      item: z.uuid().describe('The item id (search_media).'),
      title: z.string().trim().min(1).max(400).optional(),
      episode: z.number().int().min(0).max(1_000_000).optional(),
      length: z.string().max(11).optional().describe('HH:MM:SS:FF at the catalog frame rate.'),
      starts: isoDate.nullable().optional().describe('First day it may air; null = no limit.'),
      expires: isoDate.nullable().optional().describe('Last day it may air; null = no limit.'),
      media: z.enum(['ready', 'not-ready', 'unknown']).optional(),
      notes: z.string().max(20000).optional(),
      version,
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const item = await getItem('production', a.item);
      const v = item.version as number;
      checkVersion(a.apply, a.version, v, 'item');
      const r = frameRate(p.tenant.catalogFrameRate);
      const set: Record<string, unknown> = {};
      if (a.title !== undefined) set.title = a.title;
      if (a.episode !== undefined) set.chapter = a.episode;
      if (a.length !== undefined) set.lengthFrames = lengthArg(a.length, r);
      if (a.starts !== undefined) set.starts = a.starts;
      if (a.expires !== undefined) set.expires = a.expires;
      if (a.media !== undefined) set.mediaStatus = a.media === 'unknown' ? null : a.media;
      if (a.notes !== undefined) set.notes = a.notes;
      const words: Record<string, string> = { title: 'title', chapter: 'episode', lengthFrames: 'length', starts: 'starts', expires: 'expires', mediaStatus: 'media', notes: 'notes' };
      const show = (k: string, x: unknown) => (x === null || x === undefined || x === '' ? '—' : k === 'lengthFrames' ? formatTc(x as number, r) : k === 'title' || k === 'notes' ? quote(String(x)) : String(x));
      const diff = Object.keys(set).filter((k) => JSON.stringify(item[k] ?? null) !== JSON.stringify(set[k]));
      const out = [`Item ${quote(String(item.title))} of ${quote(String(item.contentTitle))} · version ${v}${a.apply ? '' : ' — preview, nothing is saved'}`];
      if (!diff.length) return [...out, 'Nothing would change.'].join('\n');
      out.push(...diff.map((k) => `- ${words[k]}: ${show(k, item[k])} → ${show(k, set[k])}`));
      if (!a.apply) {
        out.push(`To save it: edit_media with the same fields, apply: true and version ${v}.`);
        return { text: out.join('\n'), applyWith: { apply: true, version: v } };
      }
      const now = await patchItem(a.item, v, Object.fromEntries(diff.map((k) => [k, set[k]])));
      out[0] = `Item ${quote(String(set.title ?? item.title))} — saved as version ${now}. Change id ${changeId} — ${UNDO_HINT}`;
      const before = Object.fromEntries(diff.map((k) => [k, item[k] ?? null]));
      return { text: out.join('\n'), change: { targetId: a.item, channelIds: [], before: { itemId: a.item, fields: before }, after: { itemId: a.item, version: now } } };
    },
    'write',
  );

  tool(
    'add_to_rotation_list',
    'Add items to a rotation list',
    `Put catalog items at the end of a rotation list (the lists that fill the free time of blocks). Preview first. ${UNDO_HINT}`,
    z.object({
      list: z.string().trim().min(1).max(300).describe("The list's name or id."),
      items: z.array(z.uuid()).min(1).max(100).describe('Item ids (search_media).'),
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'catalog', 'edit');
      const lists = await rotationLists();
      const k = a.list.trim().toLowerCase();
      const list = lists.find((l) => l.id === a.list.trim() || l.name.toLowerCase() === k);
      if (!list) throw new HttpError(404, `No rotation list ${quote(a.list)}: ${capped(lists.map((l) => quote(l.name)), 'and more', 20).join(', ')}.`);
      const items = await catalogRows(a.items);
      if (items.length !== new Set(a.items).size) throw new HttpError(404, 'Some of the items are not in the catalog: search_media gives item ids.');
      const inList = await db.rotationListItem.findMany({ where: { listId: list.id, productionId: { in: a.items } }, select: { name: true } });
      const r = frameRate(p.tenant.catalogFrameRate);
      const out = [`Rotation list ${quote(list.name)} · ${plural(list.items, 'item')}${a.apply ? '' : ' — preview, nothing is added'}`, ...items.map((x) => `- ${x.title}${x.episode ? ` (ep ${x.episode})` : ''} · ${x.lengthFrames === null ? 'no length' : formatTc(x.lengthFrames, r)}`)];
      if (inList.length) {
        out.push('', `In the list already: ${inList.map((x) => quote(x.name)).join(', ')}. Leave them out.`);
        if (a.apply) throw new HttpError(409, out.join('\n'));
        return out.join('\n');
      }
      if (!a.apply) {
        out.push(`To add them: add_to_rotation_list with the same items and apply: true.`);
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      await addListItems(list.id, a.items);
      const made = await db.rotationListItem.findMany({ where: { listId: list.id, productionId: { in: a.items } }, select: { id: true } });
      out[0] = `Rotation list ${quote(list.name)} — ${plural(made.length, 'item')} added at its end. Change id ${changeId} — ${UNDO_HINT}`;
      return { text: out.join('\n'), change: { targetId: list.id, channelIds: [], before: null, after: { listId: list.id, itemIds: made.map((x) => x.id) } } };
    },
    'write',
  );

  tool(
    'confirm_campaign',
    'Confirm a campaign',
    `Confirm a draft campaign, so the ads playlists take its booked spots (fill_day, step campaigns). Preview first. ${UNDO_HINT}`,
    z.object({ campaign: z.string().trim().min(1).max(300).describe('The campaign: its id or name (get_deal lists them).'), version, apply }),
    async (a, { changeId }) => {
      const o = await campaignRef(p, a.campaign, 'edit');
      const head = `Campaign ${quote(o.name)} of ${o.contract.clientName} · ${o.channel.name} · ${range(o.startDate, o.endDate)} · version ${o.version}`;
      if (o.status === 'confirmed') return `${head}\nIt is confirmed already.`;
      checkVersion(a.apply, a.version, o.version, 'campaign');
      if (!a.apply) {
        const text = [`${head} — preview: confirming lets the ads playlists take its ${plural(o.booked, 'booked spot')}.`, `To confirm it: confirm_campaign with apply: true and version ${o.version}.`].join('\n');
        return { text, applyWith: { apply: true, version: o.version } };
      }
      const r = await saveCommercialOrder(o.id, { version: o.version, name: o.name, status: 'confirmed', startDate: o.startDate, endDate: o.endDate, items: o.items.map((i) => ({ id: i.id, productionId: i.productionId })) });
      return {
        text: `${head} — confirmed (version ${r.version}). Change id ${changeId} — undo_change makes it a draft again while nobody changes it since.`,
        change: { targetId: o.id, channelIds: [o.channel.id], before: { campaignId: o.id, status: 'draft' }, after: { campaignId: o.id, version: r.version, status: 'confirmed' } },
      };
    },
    'write',
  );

  tool(
    'remove_campaign_spots',
    'Take out campaign spots',
    `Take a campaign's booked spots out of breaks over a date range (at most ${MAX_DAYS} days at a time): every booking it has there, or only in some breaks or weekdays. Preview first: it lists what goes. Apply needs the campaign version. ${UNDO_HINT}`,
    z.object({
      campaign: z.string().trim().min(1).max(300).describe('The campaign: its id or name (get_deal lists them).'),
      from: isoDate.optional().describe('First day. Default: the campaign start.'),
      to: isoDate.optional().describe('Last day. Default: the campaign end.'),
      breaks: z.array(z.string().max(200)).max(500).optional().describe('Only these breaks, by name (get_campaign lists them).'),
      break_name_contains: z.string().max(100).optional().describe('Only breaks whose name contains these words.'),
      weekdays: z.array(z.enum(SHORT_DAYS)).min(1).max(7).optional().describe('Only these weekdays. Default: every day.'),
      version,
      apply,
    }),
    async (a, { changeId }) => {
      const o = await campaignRef(p, a.campaign, 'edit');
      checkVersion(a.apply, a.version, o.version, 'campaign');
      const from = a.from ?? o.startDate;
      const to = a.to ?? o.endDate;
      if (to < from) throw new HttpError(400, 'The range ends before it starts.');
      if (fromIsoDate(to).getTime() - fromIsoDate(from).getTime() > (MAX_DAYS - 1) * 86_400_000) throw new HttpError(400, `At most ${MAX_DAYS} days at a time.`);
      const breakName = new Map(o.breaks.map((b) => [b.breakTypeId, b.name]));
      const items = await db.airingItem.findMany({
        where: { airing: { orderId: o.id, date: { gte: fromIsoDate(from), lte: fromIsoDate(to) } } },
        include: { airing: { select: { date: true, blockTypeId: true } } },
      });
      const all: BookingDto[] = items.map((i) => ({ date: toIsoDate(i.airing.date), blockTypeId: i.airing.blockTypeId, breakTypeId: i.breakTypeId ?? '', orderItemId: i.orderItemId, positionId: i.positionId, passes: i.passes }));
      const names = a.breaks ? new Set(a.breaks.map((x) => x.trim().toLowerCase())) : null;
      const goes = (b: BookingDto) => {
        const n = (breakName.get(b.breakTypeId) ?? '').toLowerCase();
        if (names && !names.has(n)) return false;
        if (a.break_name_contains && !n.includes(a.break_name_contains.trim().toLowerCase())) return false;
        if (a.weekdays && !a.weekdays.includes(SHORT_DAYS[fromIsoDate(b.date).getUTCDay()])) return false;
        return true;
      };
      const out = all.filter(goes);
      const kept = all.filter((b) => !goes(b));
      const cr = frameRate(p.tenant.catalogFrameRate);
      const len = (b: BookingDto) => (o.items.find((x) => x.id === b.orderItemId)?.lengthFrames ?? 0) * b.passes;
      const v = (b: BookingDto) => `V${o.items.findIndex((x) => x.id === b.orderItemId) + 1}`;
      const text = [
        `Campaign ${quote(o.name)} · ${o.channel.name} · ${range(from, to)} · version ${o.version}${a.apply ? '' : ' — preview, nothing is taken out'}`,
        `${plural(out.length, 'spot')} ${a.apply ? 'taken out' : 'to take out'} (${formatTc(out.reduce((n, b) => n + len(b), 0), cr)}); ${plural(kept.length, 'spot')} in that range stay.`,
        ...capped(out.map((b) => `- ${b.date} · ${breakName.get(b.breakTypeId) ?? 'break'} · ${v(b)}`), 'and more', 40),
      ];
      if (!out.length) return [...text, 'Nothing would change.'].join('\n');
      if (!a.apply) {
        text.push(`To take them out: remove_campaign_spots with the same choice, apply: true and version ${o.version}.`);
        return { text: text.join('\n'), applyWith: { apply: true, version: o.version, from, to } };
      }
      const r = await saveCommercialWeek(o.id, { version: o.version, from, to, bookings: kept });
      text.push(`Campaign version now ${r.version}. Change id ${changeId} — ${UNDO_HINT}`);
      return { text: text.join('\n'), change: { targetId: o.id, channelIds: [o.channel.id], before: { bookings: all }, after: { campaignId: o.id, version: r.version, from, to } } };
    },
    'write',
  );
}

/** The read tool of Layouts. */
export function registerLayoutRead(tool: DefineTool, p: Principal) {
  tool(
    'get_layout',
    'Layout',
    "A channel's layout: its blocks on each weekday (start, length, block type, gap filling, linked breaks, and the code edit_layout names it by), the block types it can use, its version. Default: the layout valid today.",
    z.object({ channel: channelArg, playlist: playlistArg, layout: z.string().max(300).optional().describe('Its name or id.') }),
    async (a) => {
      const full = await layoutOf(p, a.channel, a.playlist, a.layout);
      demand(p.access, 'templates', 'view', full.channel.id);
      return layoutText(full, await typeNames(full));
    },
  );
}

// ---------------------------------------------------------------- undo

type ChangedSince = (what: string) => (err: unknown) => never;

/** Puts back what a change of these tools made; null for a tool that is not one of them. */
export async function undoMore(e: AuditEvent, change: string, changedSince: ChangedSince): Promise<ToolResult | null> {
  const after = (e.after ?? {}) as Record<string, unknown>;
  const before = (e.before ?? {}) as Record<string, unknown>;
  const moved = (b: object, a: object) => ({ targetId: change, channelIds: e.channelIds, before: b, after: a });
  switch (e.action) {
    case 'tool approve_day':
    case 'tool reopen_day': {
      const publish = e.action === 'tool reopen_day';
      const dayId = after.dayId as string;
      const r = await setPublished(dayId, { publish, version: after.version as number }).catch(changedSince('day'));
      return { text: `The day is ${publish ? 'approved again' : 'a draft again'}, as before change ${change} (version ${r.version}).`, change: moved({ dayId, version: after.version }, { dayId, version: r.version, published: publish }) };
    }
    case 'tool edit_layout': {
      const templateId = after.templateId as string;
      const draft = before.draft as Parameters<typeof saveTemplate>[1];
      const saved = await saveTemplate(templateId, { ...draft, version: after.version as number }).catch(changedSince('layout'));
      return { text: `Layout ${quote(saved.template.name)} is back as it was before change ${change} (version ${saved.template.version}).`, change: moved({ templateId, version: after.version }, { templateId, version: saved.template.version }) };
    }
    case 'tool edit_media': {
      const itemId = after.itemId as string;
      const item = await getItem('production', itemId);
      if (item.version !== after.version) throw new HttpError(409, `The item changed after change ${change} (version ${after.version}, now ${item.version}), so undo would overwrite newer work: nothing was changed.`);
      const now = await patchItem(itemId, item.version as number, before.fields as Record<string, unknown>);
      return { text: `The item is back as it was before change ${change} (version ${now}).`, change: moved({ itemId, version: after.version }, { itemId, version: now }) };
    }
    case 'tool add_to_rotation_list': {
      const ids = after.itemIds as string[];
      const still = await db.rotationListItem.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (still.length) await deleteItems('list-item', still.map((x) => x.id));
      return { text: `Took the ${plural(still.length, 'item')} of change ${change} out of the list again.`, change: moved({ itemIds: ids }, { removed: still.length }) };
    }
    case 'tool confirm_campaign': {
      const campaignId = after.campaignId as string;
      const o = await getCommercialOrder(campaignId);
      if (o.version !== after.version) throw new HttpError(409, `The campaign changed after change ${change}, so undo would overwrite newer work: nothing was changed.`);
      const r = await saveCommercialOrder(o.id, { version: o.version, name: o.name, status: 'draft', startDate: o.startDate, endDate: o.endDate, items: o.items.map((i) => ({ id: i.id, productionId: i.productionId })) });
      return { text: `Campaign ${quote(o.name)} is a draft again, as before change ${change} (version ${r.version}).`, change: moved({ campaignId, version: after.version }, { campaignId, version: r.version }) };
    }
    default:
      return null;
  }
}

