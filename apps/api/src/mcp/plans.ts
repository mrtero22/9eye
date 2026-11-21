// The tools of Scheduling (decision 0025, group 6.3; decision 0024, phase C2): one plan in full;
// create, duplicate, split and delete a plan; change its settings and items; place airings (auto,
// copy a week, rotation, block by block, repeats), take airings out, move episodes along the airing
// days, replace items, move airings to another plan; confirm a plan. Each previews first, applies at
// the version the preview showed, and undo_change puts the plan back (undoPlans) while nobody
// changed it since.

import { z } from 'zod';
import {
  PROGRAMME_MODES, addDays, autoPlace, copyWeek, formatClockShort, formatTc, frameRate, framesPerDay, nextItemFor, offsetFromClock, parseTc,
  replaceItems, rotate, shiftAirings, splitOrder, uuidv7, validateOrder, weekStartOn, weekdayOf as weekdayNo,
  type AiringDraft, type FrameRate, type OrderDraft, type OrderMode, type OrderRuleContext, type TimeWindow, type TimeWindows,
} from '@9eye/core';
import type { AuditEvent } from '@prisma/client';
import { demand } from '../access';
import { db } from '../db';
import { HttpError } from '../errors';
import type { ChannelDto } from '../services/dto';
import {
  createOrder, deleteOrder, duplicate, getOrderFull, mainTemplateFor, moveAirings, moveTargets, occupiedCells, restoreOrders, ruleContext, saveOrder, split,
  type CompactTemplate, type OrderFullDto,
} from '../services/orders';
import type { Principal } from './auth';
import { APPLY, PLAN_MODE, STATUS, UNDO_HINT, WEEKDAYS, capped, channelArg, findChannel, isUuid, isoDate, plural, quote, range, rowRef, type DefineTool, type ToolResult } from './common';

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KIND: Record<'series' | 'programmes' | 'trailers' | 'stings' | 'graphics', OrderMode> = {
  series: 'series', programmes: 'programmes', trailers: 'promos', stings: 'jingles', graphics: 'graphics',
};
const apply = z.boolean().default(false).describe(APPLY);
const version = z.number().int().optional().describe('With apply: the plan version the preview showed.');
const planArg = z.string().trim().min(1).max(300).describe('The plan: its name or id (list_plans shows them).');
const airingArg = z.string().trim().min(4).max(40).describe('An airing code, as get_plan shows it ("airing 3f9a1c2e").');
const itemArg = z.string().trim().min(1).max(300).describe('An item of the plan: "item 3" (its place in the list, as get_plan shows it), its id, code or title.');
const mediaArg = z.string().trim().min(1).max(300).describe('An item of Media by id or code, or a title by id or name (then all its items, episodes in order). search_media finds them.');
const blockArg = z.string().trim().min(1).max(200).describe("A block of the plan's layout by name, as get_plan lists them.");
const windowArg = z.object({
  days: z.array(z.string().max(12)).min(1).max(7).describe('Weekdays ("Sat", "Sunday"), or ["every day"].'),
  from: z.string().max(11).describe('HH:MM, the time the window opens.'),
  to: z.string().max(11).describe('HH:MM, the time it closes (it may pass midnight).'),
});
const windowsDescribe = 'Replaces the list. Times are clock times of the channel; a block is inside when it starts inside.';
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour as #RRGGBB');

const isProgrammes = (m: OrderMode) => PROGRAMME_MODES.includes(m);
const pv = (applying: boolean, what = 'nothing is saved') => (applying ? '' : ` — preview, ${what}`);

function checkVersion(applying: boolean, asked: number | undefined, now: number, what = 'plan') {
  if (!applying) return;
  if (asked === undefined) throw new HttpError(400, 'Apply needs the version the preview showed.');
  if (asked !== now) throw new HttpError(409, `The ${what} changed since the preview (version ${asked}, now ${now}): preview it again.`);
}

const weekdayIndex = (s: string) => {
  const k = s.trim().toLowerCase();
  const i = WEEKDAYS.findIndex((w) => w.toLowerCase() === k || w.slice(0, 3).toLowerCase() === k);
  if (i < 0) throw new HttpError(400, `"${s}" is not a weekday.`);
  return i;
};

// ---------------------------------------------------------------- a plan

interface Plan {
  id: string;
  full: OrderFullDto;
  /** The plan as saved. */
  d: OrderDraft;
  ctx: OrderRuleContext;
  /** The channel asked for (one of the plan's) and its layout. */
  ch: ChannelDto;
  t: CompactTemplate;
  r: FrameRate;
  channelIds: string[];
}

const toDraft = (full: OrderFullDto): OrderDraft => {
  const o = full.order;
  return {
    name: o.name, mode: o.mode, status: o.status, startDate: o.startDate, endDate: o.endDate, color: o.color, firstItemId: o.firstItemId,
    reuseInLoop: o.reuseInLoop, maxAirings: o.maxAirings, totalAirings: o.totalAirings, timeWindows: o.timeWindows,
    channels: full.channels.map((c) => ({ channelId: c.channel.id, templateId: c.template.id })),
    items: full.items.map((i) => ({ id: i.id, productionId: i.productionId, lengthFrames: i.lengthFrames })),
    airings: full.airings,
  };
};

/** A plan of the channel (not an ads campaign) by id or name: exact, else one whose name has the words. */
async function findPlanId(c: ChannelDto, ref: string): Promise<string> {
  const rows = await db.order.findMany({
    where: { deletedAt: null, mode: { not: 'commercials' }, channels: { some: { channelId: c.id } } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const r = ref.trim();
  const k = r.toLowerCase();
  const exact = rows.filter((o) => o.id === r || o.name.toLowerCase() === k);
  const hit = exact.length ? exact : rows.filter((o) => o.name.toLowerCase().includes(k));
  if (hit.length === 1) return hit[0].id;
  if (hit.length > 1) throw new HttpError(400, `"${r}" fits ${hit.length} plans on ${c.name}: ${hit.slice(0, 10).map((o) => `${quote(o.name)} (id ${o.id})`).join(', ')}. Name one by its id.`);
  throw new HttpError(404, `No plan ${quote(r)} on ${c.name}. list_plans shows its plans.`);
}

async function loadPlan(p: Principal, channel: string, ref: string, need: 'view' | 'edit'): Promise<Plan> {
  const c = await findChannel(p, channel);
  demand(p.access, 'orders', need, c.id);
  const id = await findPlanId(c, ref);
  const full = await getOrderFull(id);
  for (const x of full.channels) demand(p.access, 'orders', need, x.channel.id);
  const d = toDraft(full);
  const here = full.channels.find((x) => x.channel.id === c.id) ?? full.channels[0];
  return {
    id, full, d, ctx: await ruleContext(d.channels), ch: here.channel, t: here.template, r: frameRate(here.channel.frameRate), channelIds: full.channels.map((x) => x.channel.id),
  };
}

// ---------------------------------------------------------------- words

type Label = (itemId: string) => string;

const itemWords = (i: { chapter: number | null; title: string }) => `${i.chapter ? `ep ${i.chapter} ` : ''}${quote(i.title)}`;

function labeler(full: OrderFullDto, more: Map<string, string> = new Map()): Label {
  const m = new Map(full.items.map((i) => [i.id, itemWords(i)]));
  return (id) => more.get(id) ?? m.get(id) ?? 'an item';
}

const clockOf = (ch: ChannelDto, r: FrameRate) => (f: number) => formatClockShort(f, ch.dayStartFrames, r);
const startOf = (pl: Plan, a: Pick<AiringDraft, 'channelId' | 'date' | 'blockTypeId'>) =>
  pl.ctx.templates.get(a.channelId)?.[weekdayNo(a.date)]?.get(a.blockTypeId)?.startFrames ?? 0;
const blockName = (pl: Plan, id: string) => pl.t.blockTypes[id]?.name ?? 'a block';
const where = (pl: Plan, a: Pick<AiringDraft, 'channelId' | 'date' | 'blockTypeId'>) =>
  `${SHORT[weekdayNo(a.date)]} ${a.date} ${clockOf(pl.ch, pl.r)(startOf(pl, a))} ${blockName(pl, a.blockTypeId)}`;
const inOrder = (pl: Plan) => (a: AiringDraft, b: AiringDraft) => (a.date < b.date ? -1 : a.date > b.date ? 1 : startOf(pl, a) - startOf(pl, b));

function whatAirs(mode: OrderMode, a: AiringDraft, label: Label): string {
  if (isProgrammes(mode)) return a.items.map((x) => label(x.itemId)).join(' + ') || 'no item';
  const turn = a.items.every((x) => x.passes === 0);
  return `${plural(a.passes, 'play')} · ${turn ? `the list in turn (${plural(a.items.length, 'item')})` : a.items.filter((x) => x.passes).map((x) => `${label(x.itemId)} ×${x.passes}`).join(', ')}`;
}

function airingLine(pl: Plan, mode: OrderMode, a: AiringDraft, byId: Map<string, AiringDraft>, label: Label): string {
  const code = `airing ${rowRef(a.id)}`;
  if (a.repeatOfId) {
    const f = byId.get(a.repeatOfId);
    return `${where(pl, a)} · repeat of ${f ? `${where(pl, f)}${f.items[0] ? ` (${label(f.items[0].itemId)})` : ''}` : 'a first airing'} · ${code}`;
  }
  return `${where(pl, a)} · ${isProgrammes(mode) ? 'first airing · ' : ''}${whatAirs(mode, a, label)} · ${code}`;
}

/** What a change does to the airings: new ones (+), the ones taken out (−) and the changed ones (~). */
function diffText(pl: Plan, before: OrderDraft, after: OrderDraft, label: Label): { lines: string[]; changed: boolean } {
  const was = new Map(before.airings.map((a) => [a.id, a]));
  const now = new Map(after.airings.map((a) => [a.id, a]));
  const sig = (a: AiringDraft) => JSON.stringify([a.date, a.blockTypeId, a.passes, a.repeatOfId, a.items]);
  const order = inOrder(pl);
  const added = after.airings.filter((a) => !was.has(a.id)).sort(order);
  const gone = before.airings.filter((a) => !now.has(a.id)).sort(order);
  const changed = after.airings.filter((a) => was.has(a.id) && sig(was.get(a.id)!) !== sig(a)).sort(order);
  const firsts = added.filter((a) => !a.repeatOfId).length;
  const head = [
    added.length ? `${plural(firsts, 'new first airing')}${added.length - firsts ? `, ${plural(added.length - firsts, 'new repeat')}` : ''}` : null,
    gone.length ? `${plural(gone.length, 'airing')} taken out` : null,
    changed.length ? `${plural(changed.length, 'airing')} changed` : null,
  ].filter(Boolean);
  const lines = [`Airings: ${head.join(' · ') || 'no change'}`];
  lines.push(...capped(added.map((a) => `+ ${airingLine(pl, after.mode, a, now, label)}`), 'and more', 30));
  lines.push(...capped(gone.map((a) => `− ${airingLine(pl, before.mode, a, was, label)}`), 'and more', 30));
  lines.push(...capped(changed.map((a) => `~ ${airingLine(pl, after.mode, a, now, label)} (was ${whatAirs(before.mode, was.get(a.id)!, label)})`), 'and more', 30));
  return { lines, changed: head.length > 0 };
}

function windowWords(clock: (f: number) => string, x: TimeWindow) {
  return `${x.weekdays.every(Boolean) ? 'every day' : SHORT.filter((_, i) => x.weekdays[i]).join(' ')} ${clock(x.fromFrames)}–${clock(x.toFrames)}`;
}

function windowsText(clock: (f: number) => string, w: TimeWindows): string[] {
  return [
    `Allowed times: ${w.allowed.length ? w.allowed.map((x) => windowWords(clock, x)).join('; ') : 'any'}`,
    ...(w.rejected.length ? [`Never at: ${w.rejected.map((x) => windowWords(clock, x)).join('; ')}`] : []),
  ];
}

function limitsText(d: OrderDraft, label: Label): string {
  return [
    d.mode === 'series' ? `first episode to place: ${d.firstItemId ? label(d.firstItemId) : 'the first of the list'}` : null,
    d.mode === 'series' ? `start again when the list runs out: ${d.reuseInLoop ? 'yes' : 'no'}` : null,
    `most airings: ${d.maxAirings ?? 'no limit'}`,
    `total airings: ${d.totalAirings ?? 'not set'}`,
  ].filter(Boolean).join(' · ');
}

/** Time windows from clock times of the channel. */
function windowsArg(ch: ChannelDto, r: FrameRate, list: z.infer<typeof windowArg>[]): TimeWindow[] {
  const dayFrames = framesPerDay(r);
  const at = (s: string) => {
    const f = parseTc(s.trim(), r, { maxHours: 24 });
    if (f === null) throw new HttpError(400, `"${s}" is not a time (HH:MM).`);
    return offsetFromClock(f, ch.dayStartFrames, r);
  };
  return list.map((w) => {
    const weekdays = [false, false, false, false, false, false, false];
    for (const s of w.days) {
      if (/^(every ?day|all|daily)$/i.test(s.trim())) weekdays.fill(true);
      else weekdays[weekdayIndex(s)] = true;
    }
    const fromFrames = at(w.from);
    const to = at(w.to);
    return { weekdays, fromFrames, toFrames: to === 0 ? dayFrames : to };
  });
}

// ---------------------------------------------------------------- lookups

export interface MediaItem {
  id: string;
  title: string;
  chapter: number | null;
  lengthFrames: number | null;
}

/** Items of Media: by item id or code, or a title by id or name (all its items, in episode order). */
export async function mediaItems(refs: string[]): Promise<MediaItem[]> {
  const out: MediaItem[] = [];
  const live = { deletedAt: null, isTemplate: false };
  const pick = { id: true, title: true, chapter: true, lengthFrames: true } as const;
  const ofTitle = async (contentId: string, title: string) => {
    const eps = await db.production.findMany({ where: { ...live, contentId }, select: pick, orderBy: [{ chapter: 'asc' }, { title: 'asc' }] });
    if (!eps.length) throw new HttpError(404, `The title ${quote(title)} has no items.`);
    return eps;
  };
  for (const ref of refs) {
    const r = ref.trim();
    if (isUuid(r)) {
      const item = await db.production.findFirst({ where: { ...live, id: r }, select: pick });
      if (item) {
        out.push(item);
        continue;
      }
      const title = await db.content.findFirst({ where: { id: r, deletedAt: null } });
      if (title) {
        out.push(...(await ofTitle(title.id, title.title)));
        continue;
      }
      throw new HttpError(404, `Nothing in Media has the id ${r}.`);
    }
    const byCode = await db.production.findMany({ where: { ...live, code: { equals: r, mode: 'insensitive' } }, select: pick, take: 5 });
    if (byCode.length === 1) {
      out.push(byCode[0]);
      continue;
    }
    const titles = await db.content.findMany({ where: { deletedAt: null, title: { equals: r, mode: 'insensitive' } }, take: 5 });
    const named = await db.production.findMany({ where: { ...live, title: { equals: r, mode: 'insensitive' } }, select: pick, take: 5 });
    if (!byCode.length && titles.length === 1 && !named.length) {
      out.push(...(await ofTitle(titles[0].id, titles[0].title)));
      continue;
    }
    if (!byCode.length && !titles.length && named.length === 1) {
      out.push(named[0]);
      continue;
    }
    if (byCode.length + titles.length + named.length > 1) throw new HttpError(400, `"${r}" fits several titles or items in Media: name it by its id (search_media shows ids).`);
    throw new HttpError(404, `Nothing in Media is called "${r}": search_media finds titles and items.`);
  }
  return out;
}

/** An item of the plan's list: "item 3", its id, its Media item's id, code or title. */
function planItem(pl: Plan, d: OrderDraft, ref: string): string {
  const r = ref.trim();
  const k = r.toLowerCase();
  const n = /^(?:item\s+)?#?(\d{1,5})$/i.exec(r);
  if (n) {
    const i = d.items[Number(n[1]) - 1];
    if (!i) throw new HttpError(404, `The plan has ${plural(d.items.length, 'item')}: there is no item ${n[1]}.`);
    return i.id;
  }
  const info = new Map(pl.full.items.map((i) => [i.id, i]));
  const hit = d.items.filter((i) => {
    const x = info.get(i.id);
    return i.id === r || i.productionId === r || (!!x && (x.code.toLowerCase() === k || x.title.toLowerCase() === k));
  });
  if (hit.length === 1) return hit[0].id;
  if (hit.length > 1) throw new HttpError(400, `"${r}" fits ${hit.length} items of the plan: name it as "item N".`);
  throw new HttpError(404, `No item ${quote(r)} in the plan: get_plan lists its items.`);
}

function blockOf(pl: Plan, ref: string): string {
  const k = ref.trim().toLowerCase();
  const hit = Object.entries(pl.t.blockTypes).filter(([id, b]) => id === ref.trim() || b.name.toLowerCase() === k);
  if (hit.length === 1) return hit[0][0];
  const names = Object.values(pl.t.blockTypes).map((b) => quote(b.name));
  throw new HttpError(404, `No block ${quote(ref)} in layout ${quote(pl.t.name)}${names.length ? `: ${names.join(', ')}` : ''}.`);
}

function airingOf(d: OrderDraft, ref: string): AiringDraft {
  const k = ref.trim().toLowerCase().replace(/^airing\s+/, '');
  const hit = d.airings.filter((a) => a.id === k || rowRef(a.id) === k);
  if (hit.length !== 1) throw new HttpError(404, `No airing ${quote(ref)} in the plan: get_plan shows each airing's code.`);
  return hit[0];
}

/** The blocks of the plan's layout on its channel: name, start, weekdays. */
function layoutBlocks(pl: Plan): string[] {
  const clock = clockOf(pl.ch, pl.r);
  const by = new Map<string, Map<number, number[]>>();
  for (const b of pl.t.blocks) {
    const starts = by.get(b.blockTypeId) ?? new Map<number, number[]>();
    starts.set(b.startFrames, [...(starts.get(b.startFrames) ?? []), b.weekday]);
    by.set(b.blockTypeId, starts);
  }
  return [...by.entries()]
    .sort((a, b) => Math.min(...a[1].keys()) - Math.min(...b[1].keys()))
    .map(([id, starts]) => `- ${quote(blockName(pl, id))} · ${[...starts.entries()].map(([f, wds]) => `${clock(f)} ${wds.length === 7 ? 'every day' : wds.sort().map((w) => SHORT[w]).join(' ')}`).join('; ')}`);
}

// ---------------------------------------------------------------- saving one plan

/** Shows the new plan (preview), or saves it at the version the preview showed and keeps the old one for undo. */
async function finish(pl: Plan, a: { apply: boolean }, changeId: string, tool: string, next: OrderDraft, head: string[]): Promise<ToolResult> {
  const out = [...head];
  const problems = validateOrder(next, pl.ctx);
  if (problems.length) {
    out.push('Problems — nothing can be saved until they are solved:', ...problems.map((x) => `- ${x.message}`));
    if (a.apply) throw new HttpError(422, out.join('\n'));
    return out.join('\n');
  }
  const v = pl.full.order.version;
  if (!a.apply) {
    out.push(`To save it: ${tool} with the same arguments, apply: true and version ${v}.`);
    return { text: out.join('\n'), applyWith: { apply: true, version: v } };
  }
  const saved = await saveOrder(pl.id, { ...next, version: v });
  out.push(`Saved: ${quote(saved.order.name)} is at version ${saved.order.version}. Change id ${changeId} — ${UNDO_HINT}`);
  return { text: out.join('\n'), change: { targetId: pl.id, channelIds: pl.channelIds, before: { draft: pl.d }, after: { orderId: pl.id, version: saved.order.version } } };
}

const refuse = (applying: boolean, head: string[], why: string): ToolResult => {
  const text = [...head, `Cannot: ${why} Nothing was changed.`].join('\n');
  if (applying) throw new HttpError(422, text);
  return text;
};

const versionOf = async (id: string) => (await db.order.findUniqueOrThrow({ where: { id }, select: { version: true } })).version;

// ---------------------------------------------------------------- read

export function registerPlanRead(tool: DefineTool, p: Principal) {
  tool(
    'get_plan',
    'Plan',
    'One Scheduling plan in full: its settings (kind, status, dates, limits, time windows), its items with their places ("item 3"), the blocks of its layout, and its airings in a span of days, each with its code ("airing 3f9a1c2e") — the names the plan tools take.',
    z.object({
      channel: channelArg,
      plan: planArg,
      from: isoDate.optional().describe("The first day of airings to list. Default: this week, or the plan's first or last week when it is not running."),
      days: z.number().int().min(1).max(42).default(7).describe('How many days of airings to list.'),
    }),
    async (a) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'view');
      const { d, full } = pl;
      const label = labeler(full);
      const clock = clockOf(pl.ch, pl.r);
      const ws = weekStartOn(pl.ch.today, pl.ch.weekStart);
      const from = a.from ?? (ws < d.startDate ? d.startDate : ws > d.endDate ? (addDays(d.endDate, -6) < d.startDate ? d.startDate : addDays(d.endDate, -6)) : ws);
      const to = addDays(from, a.days - 1);
      const mine = d.airings.filter((x) => x.channelId === pl.ch.id);
      const byId = new Map(d.airings.map((x) => [x.id, x]));
      const firsts = mine.filter((x) => !x.repeatOfId);
      const uses = new Map<string, number>();
      for (const f of firsts) for (const it of f.items) uses.set(it.itemId, (uses.get(it.itemId) ?? 0) + 1);
      const cr = frameRate(p.tenant.catalogFrameRate);
      const shown = mine.filter((x) => x.date >= from && x.date <= to).sort(inOrder(pl));
      return [
        `${quote(d.name)} · ${PLAN_MODE[d.mode] ?? d.mode} · ${STATUS[d.status] ?? d.status} · ${range(d.startDate, d.endDate)} · colour ${d.color} · version ${full.order.version} · id ${pl.id}`,
        `Channels: ${full.channels.map((x) => `${x.channel.name} (layout ${quote(x.template.name)})`).join(', ')}`,
        limitsText(d, label),
        ...windowsText(clock, d.timeWindows),
        ...(full.issue ? [`Issue: ${full.issue.text}`] : []),
        '',
        `Items (${d.items.length}):`,
        ...(full.items.length
          ? capped(
              full.items.map((i, n) =>
                [
                  `- item ${n + 1} · ${itemWords(i)}`,
                  i.code ? `code ${i.code}` : null,
                  i.lengthFrames !== null ? formatTc(i.lengthFrames, cr) : 'no length',
                  i.mediaStatus === 'not-ready' ? 'MEDIA NOT READY' : null,
                  isProgrammes(d.mode) ? (uses.get(i.id) ? `${plural(uses.get(i.id)!, 'first airing')}` : 'not placed') : null,
                ].filter(Boolean).join(' · '),
              ),
              'and more',
              80,
            )
          : ['- none']),
        '',
        `Blocks of layout ${quote(pl.t.name)} on ${pl.ch.name}:`,
        ...(pl.t.blocks.length ? layoutBlocks(pl) : ['- none']),
        '',
        `Airings on ${pl.ch.name} in the whole plan: ${plural(firsts.length, 'first airing')}, ${plural(mine.length - firsts.length, 'repeat')}${isProgrammes(d.mode) ? '' : `, ${plural(firsts.reduce((n, x) => n + x.passes, 0), 'play')}`}.`,
        `${range(from, to)}:`,
        ...(shown.length ? capped(shown.map((x) => `- ${airingLine(pl, d.mode, x, byId, label)}`), 'get_plan with a later from', 150) : ['- none']),
      ].join('\n');
    },
  );
}

// ---------------------------------------------------------------- writes

export function registerPlanTools(tool: DefineTool, p: Principal) {
  tool(
    'create_plan',
    'Create a plan',
    `Create a Scheduling plan on a channel: a draft, born with its items and no airings (place_airings places them). Preview first. ${UNDO_HINT} (undo deletes it)`,
    z.object({
      channel: channelArg,
      name: z.string().trim().min(1).max(200),
      kind: z.enum(['series', 'programmes', 'trailers', 'stings', 'graphics']).describe('series: episodes in order, one in each first airing, with repeats; programmes: titles placed block by block; trailers, stings, graphics: played in turn in the blocks.'),
      from: isoDate.describe('The first day, YYYY-MM-DD.'),
      to: isoDate.describe('The last day, YYYY-MM-DD.'),
      items: z.array(mediaArg).max(200).default([]),
      first_item: mediaArg.optional().describe('Series: the episode to place first (one of the items). Default: the first.'),
      start_again: z.boolean().default(false).describe('Series: start the list again when it runs out.'),
      max_airings: z.number().int().min(1).nullable().default(null).describe('The most airings it may place (series: first airings; else plays).'),
      total_airings: z.number().int().min(1).nullable().default(null),
      allowed_times: z.array(windowArg).max(20).default([]).describe(`Where its airings may go; series and programmes need one to place automatically. ${windowsDescribe}`),
      never_times: z.array(windowArg).max(20).default([]).describe(`Where they never go. ${windowsDescribe}`),
      apply,
    }),
    async (a, { changeId }) => {
      const c = await findChannel(p, a.channel);
      demand(p.access, 'orders', 'edit', c.id);
      demand(p.access, 'catalog', 'view');
      if (a.from > a.to) throw new HttpError(400, `The last day (${a.to}) is before the first (${a.from}).`);
      const layout = await mainTemplateFor(c.id, a.from, a.to);
      if (!layout) throw new HttpError(422, `${c.name} has no main layout for ${range(a.from, a.to)}: create_layout makes one.`);
      const r = frameRate(c.frameRate);
      const mode = KIND[a.kind];
      const items = await mediaItems(a.items);
      const seen = new Set<string>();
      const unique = items.filter((i) => !seen.has(i.id) && seen.add(i.id));
      const first = a.first_item ? (await mediaItems([a.first_item]))[0] : null;
      if (first && !unique.some((i) => i.id === first.id)) throw new HttpError(400, `The first episode ${itemWords(first)} is not one of the items.`);
      const timeWindows = { allowed: windowsArg(c, r, a.allowed_times), rejected: windowsArg(c, r, a.never_times) };
      const clash = await db.order.findFirst({ where: { deletedAt: null, mode: { not: 'commercials' }, channels: { some: { channelId: c.id } }, name: { equals: a.name, mode: 'insensitive' } } });
      const label: Label = (id) => itemWords(unique.find((i) => i.id === id) ?? { chapter: null, title: 'an item' });
      const draftish = { mode, firstItemId: first?.id ?? null, reuseInLoop: a.start_again, maxAirings: a.max_airings, totalAirings: a.total_airings } as OrderDraft;
      const out = [
        `New plan ${quote(a.name)} on ${c.name} · ${PLAN_MODE[mode]} · Draft · ${range(a.from, a.to)} · layout ${quote(layout.name)}${pv(a.apply, 'nothing is made')}`,
        `Items (${unique.length}): ${unique.length ? capped(unique.map((i) => itemWords(i)), 'and more', 20).join(', ') : 'none yet'}`,
        limitsText(draftish, label),
        ...windowsText(clockOf(c, r), timeWindows),
      ];
      if (clash) out.push(`Note: ${c.name} has a plan ${quote(clash.name)} already; the tools will need this one's id.`);
      if (isProgrammes(mode) && !timeWindows.allowed.length) out.push('Note: without an allowed time, place_airings cannot place it automatically (block by block works).');
      if (!a.apply) {
        out.push('To make it: create_plan with the same arguments and apply: true. Then place_airings places its airings.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const full = await createOrder({
        name: a.name, mode, channelIds: [c.id], startDate: a.from, endDate: a.to, productionIds: unique.map((i) => i.id), firstProductionId: first?.id ?? null,
        reuseInLoop: a.start_again, maxAirings: a.max_airings, totalAirings: a.total_airings, timeWindows,
      });
      out[0] = `Plan ${quote(full.order.name)} made on ${c.name} (draft, no airings yet; id ${full.order.id}). Change id ${changeId} — undo_change deletes it while nobody changed it since.`;
      return { text: out.join('\n'), change: { targetId: full.order.id, channelIds: [c.id], before: null, after: { orderId: full.order.id, version: full.order.version } } };
    },
    'write',
  );

  tool(
    'edit_plan',
    'Change a plan',
    `Change a plan's settings and items: name, dates, colour, the first episode, start again, limits, time windows; add items from Media or take out items no airing uses. Only what is given changes. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      plan: planArg,
      name: z.string().trim().min(1).max(200).optional(),
      from: isoDate.optional().describe('A new first day.'),
      to: isoDate.optional().describe('A new last day.'),
      colour: hex.optional(),
      first_item: z.string().trim().min(1).max(300).optional().describe('Series: the episode to place first ("item 3", …), or "none" for the first of the list.'),
      start_again: z.boolean().optional(),
      max_airings: z.number().int().min(1).nullable().optional().describe('null = no limit.'),
      total_airings: z.number().int().min(1).nullable().optional().describe('null = not set.'),
      allowed_times: z.array(windowArg).max(20).optional().describe(windowsDescribe),
      never_times: z.array(windowArg).max(20).optional().describe(windowsDescribe),
      add_items: z.array(mediaArg).max(200).optional().describe('Items of Media to add at the end of the list.'),
      remove_items: z.array(itemArg).max(200).optional().describe('Items of the plan to take out (only ones no airing uses).'),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'edit');
      checkVersion(a.apply, a.version, pl.full.order.version);
      const d: OrderDraft = { ...pl.d, timeWindows: { ...pl.d.timeWindows }, items: [...pl.d.items] };
      const more = new Map<string, string>();
      const changes: string[] = [];
      const head = [`${quote(pl.d.name)} on ${pl.ch.name} · change the plan${pv(a.apply)}`];
      const clock = clockOf(pl.ch, pl.r);
      if (a.name !== undefined && a.name !== d.name) {
        changes.push(`- name: ${quote(d.name)} → ${quote(a.name)}`);
        d.name = a.name;
      }
      if (a.from !== undefined || a.to !== undefined) {
        const from = a.from ?? d.startDate;
        const to = a.to ?? d.endDate;
        if (from !== d.startDate || to !== d.endDate) {
          const outside = d.airings.filter((x) => x.date < from || x.date > to).length;
          if (outside) return refuse(a.apply, head, `${plural(outside, 'airing')} fall outside ${range(from, to)}: take them out first with remove_airings (or split_plan).`);
          changes.push(`- dates: ${range(d.startDate, d.endDate)} → ${range(from, to)}`);
          d.startDate = from;
          d.endDate = to;
        }
      }
      if (a.colour !== undefined && a.colour.toLowerCase() !== d.color.toLowerCase()) {
        changes.push(`- colour: ${d.color} → ${a.colour.toLowerCase()}`);
        d.color = a.colour.toLowerCase();
      }
      if (a.add_items?.length) {
        demand(p.access, 'catalog', 'view');
        const found = await mediaItems(a.add_items);
        const added: string[] = [];
        for (const m of found) {
          if (d.items.some((i) => i.productionId === m.id)) continue;
          const id = uuidv7();
          d.items.push({ id, productionId: m.id, lengthFrames: m.lengthFrames });
          more.set(id, itemWords(m));
          added.push(`item ${d.items.length} ${itemWords(m)}`);
        }
        if (added.length) changes.push(`- items added: ${capped(added, 'and more', 20).join(', ')}`);
        if (found.length > added.length) changes.push(`- ${plural(found.length - added.length, 'item')} already in the list`);
      }
      const label = labeler(pl.full, more);
      if (a.remove_items?.length) {
        const ids = [...new Set(a.remove_items.map((x) => planItem(pl, d, x)))];
        const used = ids.filter((id) => d.airings.some((x) => x.items.some((y) => y.itemId === id)));
        if (used.length) return refuse(a.apply, head, `${used.map(label).join(', ')} ${used.length === 1 ? 'has' : 'have'} airings: take them out first with remove_airings, or use replace_items.`);
        d.items = d.items.filter((i) => !ids.includes(i.id));
        if (d.firstItemId && ids.includes(d.firstItemId)) d.firstItemId = null;
        changes.push(`- items taken out: ${ids.map(label).join(', ')}`);
      }
      if (a.first_item !== undefined) {
        const id = /^none$/i.test(a.first_item.trim()) ? null : planItem(pl, d, a.first_item);
        if (id !== d.firstItemId) {
          changes.push(`- first episode to place: ${d.firstItemId ? label(d.firstItemId) : 'the first of the list'} → ${id ? label(id) : 'the first of the list'}`);
          d.firstItemId = id;
        }
      }
      if (a.start_again !== undefined && a.start_again !== d.reuseInLoop) {
        changes.push(`- start again when the list runs out: ${d.reuseInLoop ? 'yes' : 'no'} → ${a.start_again ? 'yes' : 'no'}`);
        d.reuseInLoop = a.start_again;
      }
      if (a.max_airings !== undefined && a.max_airings !== d.maxAirings) {
        changes.push(`- most airings: ${d.maxAirings ?? 'no limit'} → ${a.max_airings ?? 'no limit'}`);
        d.maxAirings = a.max_airings;
      }
      if (a.total_airings !== undefined && a.total_airings !== d.totalAirings) {
        changes.push(`- total airings: ${d.totalAirings ?? 'not set'} → ${a.total_airings ?? 'not set'}`);
        d.totalAirings = a.total_airings;
      }
      for (const [key, arg, word] of [['allowed', a.allowed_times, 'allowed times'], ['rejected', a.never_times, 'never at']] as const) {
        if (arg === undefined) continue;
        const next = windowsArg(pl.ch, pl.r, arg);
        if (JSON.stringify(next) === JSON.stringify(d.timeWindows[key])) continue;
        const words = (ws: TimeWindow[]) => (ws.length ? ws.map((x) => windowWords(clock, x)).join('; ') : key === 'allowed' ? 'any' : 'none');
        changes.push(`- ${word}: ${words(d.timeWindows[key])} → ${words(next)}`);
        d.timeWindows = { ...d.timeWindows, [key]: next };
      }
      if (!changes.length) return [...head, 'Nothing to change: the plan is like that already.'].join('\n');
      return finish(pl, a, changeId, 'edit_plan', d, [...head, ...changes]);
    },
    'write',
  );

  tool(
    'place_airings',
    'Place airings',
    `Place a plan's airings on a channel — auto: every free block inside its time windows takes the next item (trailers, stings, graphics: plays of the whole list in every block), replacing its airings on that channel; copy_week: one complete week copied over every other week of the plan; rotation (trailers, stings, graphics): plays a day spread over the blocks, each item by its share; blocks: first airings in chosen blocks; repeats: repeats of one first airing. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      plan: planArg,
      how: z.enum(['auto', 'copy_week', 'rotation', 'blocks', 'repeats']),
      plays_per_block: z.number().int().min(1).max(50).default(1).describe('auto, for trailers, stings and graphics: plays of the list in every block.'),
      week: isoDate.optional().describe('copy_week: the first day of a complete week of the plan, whose airings are copied over every other week.'),
      plays_per_day: z.number().int().min(1).max(500).optional().describe('rotation: plays a day.'),
      shares: z.array(z.object({ item: itemArg, percent: z.number().min(0).max(100) })).max(200).optional().describe('rotation: each item\'s share in percent, adding up to 100. Default: the same for every item.'),
      blocks: z
        .array(z.object({ date: isoDate, block: blockArg, item: itemArg.optional().describe('blocks: this item instead of the next one.'), plays: z.number().int().min(1).max(50).optional().describe('blocks, for trailers, stings and graphics: plays (default 1).') }))
        .max(300)
        .optional()
        .describe('blocks and repeats: the days and blocks.'),
      repeat_of: airingArg.optional().describe('repeats: the first airing to repeat.'),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'edit');
      checkVersion(a.apply, a.version, pl.full.order.version);
      const d = pl.d;
      const ch = pl.ch.id;
      const label = labeler(pl.full);
      const mine = d.airings.filter((x) => x.channelId === ch);
      const head = [`${quote(d.name)} on ${pl.ch.name} · place airings: ${a.how.replace('_', ' ')}${pv(a.apply)}`];
      let next: OrderDraft;
      if (a.how === 'auto') {
        const taken = isProgrammes(d.mode) ? new Set((await occupiedCells(pl.id)).filter((x) => x.channelId === ch).map((x) => `${x.date}|${x.blockTypeId}`)) : undefined;
        const r = autoPlace(d, pl.ctx, ch, { passesPerBlock: a.plays_per_block, taken });
        if (!r.ok) return refuse(a.apply, head, r.reason ?? 'it cannot place.');
        head.push(
          isProgrammes(d.mode) ? 'Every free block inside the allowed times takes the next item, day by day.' : `${plural(a.plays_per_block, 'play')} of the whole list in every block inside the allowed times.`,
          `It replaces the plan's ${plural(mine.length, 'airing')} on ${pl.ch.name}${taken?.size ? `; ${plural(taken.size, 'block')} other programme plans hold are skipped` : ''}.`,
        );
        next = { ...d, airings: r.airings };
      } else if (a.how === 'copy_week') {
        if (!a.week) throw new HttpError(400, 'copy_week needs week: the first day of the week to copy.');
        const r = copyWeek(d, pl.ctx, ch, a.week);
        if (!r.ok) return refuse(a.apply, head, r.reason ?? 'it cannot copy that week.');
        head.push(`The week ${range(a.week, addDays(a.week, 6))} is copied over ${plural(r.otherWeeks, 'other week')}: ${plural(r.firsts, 'first airing')}, ${plural(r.repeats, 'repeat')} in all.`);
        if (r.ranOut) head.push(`Note: ${plural(r.ranOut, 'first airing')} left out: the list ran out (start_again in edit_plan starts it again).`);
        if (r.outside) head.push(`Note: ${plural(r.outside, 'airing')} would fall outside the plan's dates: left out.`);
        if (r.withoutFirst) head.push(`Note: ${plural(r.withoutFirst, 'repeat')} without their first airing in that week: left out.`);
        if (r.notPlaced) head.push(`Note: ${plural(r.notPlaced, 'item')} of the list get no first airing.`);
        next = { ...d, airings: r.airings };
      } else if (a.how === 'rotation') {
        if (isProgrammes(d.mode)) return refuse(a.apply, head, 'rotation is for trailers, stings and graphics; series and programmes use auto, copy_week or blocks.');
        if (!a.plays_per_day) throw new HttpError(400, 'rotation needs plays_per_day.');
        if (!d.items.length) return refuse(a.apply, head, 'the plan has no items yet: edit_plan adds them.');
        const shares = a.shares?.length ? a.shares.map((s) => ({ itemId: planItem(pl, d, s.item), percent: s.percent })) : d.items.map((i) => ({ itemId: i.id, percent: 100 / d.items.length }));
        const r = rotate(d, pl.ctx, ch, { passesPerDay: a.plays_per_day, shares });
        if (!r.ok) return refuse(a.apply, head, r.reason ?? 'it cannot rotate.');
        head.push(
          `${plural(a.plays_per_day, 'play')} a day on ${plural(r.days, 'day')}, over up to ${plural(r.blocksPerDay, 'block')} a day; it replaces the plan's ${plural(mine.length, 'airing')} on ${pl.ch.name}.`,
          `A day: ${[...r.perItem.entries()].map(([id, n]) => `${label(id)} ×${n}`).join(', ')}`,
        );
        next = { ...d, airings: r.airings };
      } else {
        if (!a.blocks?.length) throw new HttpError(400, `${a.how} needs blocks: the days and blocks.`);
        const days = pl.ctx.templates.get(ch)!;
        let airings = [...d.airings];
        const cellTaken = (date: string, bt: string) => airings.some((x) => x.channelId === ch && x.date === date && x.blockTypeId === bt);
        const first = a.how === 'repeats' ? (a.repeat_of ? airingOf(d, a.repeat_of) : null) : null;
        if (a.how === 'repeats') {
          if (!first) throw new HttpError(400, 'repeats needs repeat_of: the first airing to repeat.');
          if (first.repeatOfId) return refuse(a.apply, head, `airing ${rowRef(first.id)} is a repeat: name a first airing.`);
        }
        const others = isProgrammes(d.mode) && a.how === 'blocks' ? await occupiedCells(pl.id) : [];
        for (const cell of a.blocks) {
          const bt = blockOf(pl, cell.block);
          const wd = weekdayNo(cell.date);
          const at = `${SHORT[wd]} ${cell.date} ${blockName(pl, bt)}`;
          if (!days[wd].has(bt)) return refuse(a.apply, head, `layout ${quote(pl.t.name)} has no ${quote(blockName(pl, bt))} on ${WEEKDAYS[wd]}s (${cell.date}).`);
          if (cell.date < d.startDate || cell.date > d.endDate) return refuse(a.apply, head, `${cell.date} is outside the plan's dates (${range(d.startDate, d.endDate)}).`);
          if (cellTaken(cell.date, bt)) return refuse(a.apply, head, `${at} holds an airing of this plan already.`);
          if (first) {
            if (cell.date < first.date) return refuse(a.apply, head, `${at} comes before its first airing (${first.date}): a repeat comes the same broadcast day or later.`);
            airings.push({ id: uuidv7(), channelId: ch, date: cell.date, blockTypeId: bt, passes: 0, repeatOfId: first.id, repeatIndex: 0, blockColor: null, items: [] });
            continue;
          }
          if (!d.items.length) return refuse(a.apply, head, 'the plan has no items yet: edit_plan adds them.');
          if (isProgrammes(d.mode)) {
            const itemId = cell.item ? planItem(pl, d, cell.item) : nextItemFor({ ...d, airings }, pl.ctx, ch, cell.date, bt);
            if (!itemId) return refuse(a.apply, head, `no episode is left in the list for ${at}: add items, or turn on start_again in edit_plan.`);
            airings.push({ id: uuidv7(), channelId: ch, date: cell.date, blockTypeId: bt, passes: 1, repeatOfId: null, repeatIndex: 0, blockColor: null, items: [{ itemId, passes: 0, jingle: null }] });
            const held = others.find((x) => x.channelId === ch && x.date === cell.date && x.blockTypeId === bt);
            if (held) head.push(`Note: ${at} holds ${quote(held.orderName)} too: two programmes in one block are listed as an issue.`);
          } else {
            const plays = cell.plays ?? 1;
            const items = cell.item ? [{ itemId: planItem(pl, d, cell.item), passes: plays, jingle: d.mode === 'jingles' ? ('pre' as const) : null }] : d.items.map((i) => ({ itemId: i.id, passes: 0, jingle: d.mode === 'jingles' ? ('pre' as const) : null }));
            airings.push({ id: uuidv7(), channelId: ch, date: cell.date, blockTypeId: bt, passes: plays, repeatOfId: null, repeatIndex: 0, blockColor: null, items });
          }
        }
        next = { ...d, airings };
      }
      const diff = diffText(pl, d, next, label);
      if (!diff.changed) return [...head, 'Nothing would change.'].join('\n');
      return finish(pl, a, changeId, 'place_airings', next, [...head, ...diff.lines]);
    },
    'write',
  );

  tool(
    'remove_airings',
    'Take out airings',
    `Take airings out of a plan on a channel: by their codes, or every airing in a span of days and/or in some blocks; a first airing takes its repeats with it. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      plan: planArg,
      airings: z.array(airingArg).max(500).optional().describe('The airings, by code.'),
      from: isoDate.optional().describe('Every airing from this day…'),
      to: isoDate.optional().describe('…to this day (default: the plan’s first / last day).'),
      blocks: z.array(blockArg).max(50).optional().describe('Only in these blocks.'),
      repeats_only: z.boolean().default(false).describe('Only repeats; first airings stay.'),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'edit');
      checkVersion(a.apply, a.version, pl.full.order.version);
      const d = pl.d;
      if (!a.airings?.length && !a.from && !a.to && !a.blocks?.length) {
        throw new HttpError(400, 'Name the airings, or a span of days (from, to) and/or blocks: remove_airings never empties a plan by accident.');
      }
      const head = [`${quote(d.name)} on ${pl.ch.name} · take out airings${pv(a.apply)}`];
      let picked: AiringDraft[];
      if (a.airings?.length) picked = a.airings.map((x) => airingOf(d, x));
      else {
        const from = a.from ?? d.startDate;
        const to = a.to ?? d.endDate;
        const bts = a.blocks?.length ? new Set(a.blocks.map((b) => blockOf(pl, b))) : null;
        picked = d.airings.filter((x) => x.channelId === pl.ch.id && x.date >= from && x.date <= to && (!bts || bts.has(x.blockTypeId)));
      }
      if (a.repeats_only) picked = picked.filter((x) => x.repeatOfId);
      const gone = new Set(picked.map((x) => x.id));
      const next = { ...d, airings: d.airings.filter((x) => !gone.has(x.id) && !(x.repeatOfId && gone.has(x.repeatOfId))) };
      const diff = diffText(pl, d, next, labeler(pl.full));
      if (!diff.changed) return [...head, 'Nothing matches: no airing is taken out.'].join('\n');
      return finish(pl, a, changeId, 'remove_airings', next, [...head, ...diff.lines]);
    },
    'write',
  );

  tool(
    'shift_episodes',
    'Move episodes along the airing days',
    `Series and programmes: move the episodes along the plan's airing days — the days and blocks stay, the episodes move. by > 0: the chosen first airing and every one after it go that many airing days later (new days continue the weekly pattern at the end); by < 0: it and every one before it go earlier. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      plan: planArg,
      from_airing: airingArg.describe('The first airing where the move starts.'),
      by: z.number().int().min(-100).max(100).refine((n) => n !== 0, 'by is not 0').describe('Airing days: 2 = two airing days later, -1 = one earlier.'),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'edit');
      checkVersion(a.apply, a.version, pl.full.order.version);
      const d = pl.d;
      const head = [`${quote(d.name)} on ${pl.ch.name} · episodes ${plural(Math.abs(a.by), 'airing day')} ${a.by > 0 ? 'later' : 'earlier'}${pv(a.apply)}`];
      if (!isProgrammes(d.mode)) return refuse(a.apply, head, 'only series and programmes have episodes to move.');
      const from = airingOf(d, a.from_airing);
      if (from.repeatOfId) return refuse(a.apply, head, `airing ${rowRef(from.id)} is a repeat: name a first airing.`);
      const r = shiftAirings(d, pl.ctx, from.channelId, from.id, a.by);
      if (!r.ok) return refuse(a.apply, head, r.reason ?? 'it cannot move them.');
      head.push(
        `${plural(r.moved, 'episode')} move${r.emptied.length ? `; ${plural(r.emptied.length, 'airing day')} left empty go with their repeats` : ''}${r.added.length ? `; ${plural(r.added.length, 'new airing day')} continue the weekly pattern` : ''}${r.outside ? `; ${plural(r.outside, 'repeat')} outside the plan's dates left out` : ''}.`,
      );
      const next = { ...d, airings: r.airings };
      return finish(pl, a, changeId, 'shift_episodes', next, [...head, ...diffText(pl, d, next, labeler(pl.full)).lines]);
    },
    'write',
  );

  tool(
    'replace_items',
    'Replace items',
    `Put one item in place of others in a plan's airings, from / to a day, optionally only in some blocks. The new item may be one of the plan or come from Media (it joins the list). Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      plan: planArg,
      items: z.array(itemArg).min(1).max(50).describe('The items of the plan to replace.'),
      with: z.string().trim().min(1).max(300).describe('The new item: one of the plan ("item 3", …), or an item of Media by id or code.'),
      from: isoDate.optional(),
      to: isoDate.optional(),
      blocks: z.array(blockArg).max(50).optional(),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'edit');
      checkVersion(a.apply, a.version, pl.full.order.version);
      const d: OrderDraft = { ...pl.d, items: [...pl.d.items] };
      const more = new Map<string, string>();
      const head = [`${quote(d.name)} on ${pl.ch.name} · replace items${pv(a.apply)}`];
      const olds = [...new Set(a.items.map((x) => planItem(pl, d, x)))];
      let newId: string;
      try {
        newId = planItem(pl, d, a.with);
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 404) throw e;
        demand(p.access, 'catalog', 'view');
        const found = await mediaItems([a.with]);
        if (found.length !== 1) throw new HttpError(400, `"${a.with}" is a title with ${plural(found.length, 'item')}: name one item.`);
        const have = d.items.find((i) => i.productionId === found[0].id);
        if (have) newId = have.id;
        else {
          newId = uuidv7();
          d.items.push({ id: newId, productionId: found[0].id, lengthFrames: found[0].lengthFrames });
          more.set(newId, itemWords(found[0]));
          head.push(`${itemWords(found[0])} joins the list as item ${d.items.length}.`);
        }
      }
      if (olds.includes(newId)) return refuse(a.apply, head, 'the new item is one of the items to replace.');
      const label = labeler(pl.full, more);
      const r = replaceItems(d, { oldItemIds: olds, newItemId: newId, from: a.from ?? d.startDate, to: a.to ?? d.endDate, blockTypeIds: a.blocks?.map((b) => blockOf(pl, b)) });
      if (!r.found) return [...head, `No airing of ${olds.map(label).join(', ')} is there to replace.`].join('\n');
      head.push(`${olds.map(label).join(', ')} → ${label(newId)} in ${plural(r.found, 'airing')}${r.ignored.length ? `; left as they are: ${r.ignored.map((x) => `${x.count} ${x.reason}`).join(', ')}` : ''}.`);
      const next = { ...d, airings: r.airings };
      return finish(pl, a, changeId, 'replace_items', next, [...head, ...diffText(pl, pl.d, next, label).lines]);
    },
    'write',
  );

  tool(
    'move_airings',
    'Move airings to another plan',
    `Move the airings of some items (their first airings with their repeats) into another plan with the same dates, channels and kind; the items join its list. All or nothing; a block the other plan holds on that day stops it. Preview first; apply needs both versions the preview showed. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      plan: planArg,
      items: z.array(itemArg).min(1).max(200).describe('Items of this plan whose airings move.'),
      to_plan: planArg.describe('The other plan: its name or id.'),
      apply,
      version,
      to_version: version.describe("With apply: the other plan's version the preview showed."),
    }),
    async (a, { changeId }) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'edit');
      const dst = await loadPlan(p, a.channel, a.to_plan, 'edit');
      checkVersion(a.apply, a.version, pl.full.order.version);
      checkVersion(a.apply, a.to_version, dst.full.order.version, 'other plan');
      const d = pl.d;
      const head = [`${quote(d.name)} → ${quote(dst.d.name)} on ${pl.ch.name} · move airings${pv(a.apply)}`];
      if (dst.id === pl.id) return refuse(a.apply, head, 'that is the same plan.');
      const targets = await moveTargets(pl.id);
      if (!targets.some((t) => t.id === dst.id)) {
        return refuse(a.apply, head, `airings move only to a plan with the same dates, channels and kind${targets.length ? `: ${targets.map((t) => quote(t.name)).join(', ')}` : ' — there is none'}.`);
      }
      const chosen = new Set(a.items.map((x) => planItem(pl, d, x)));
      const firsts = d.airings.filter((x) => !x.repeatOfId && x.items.length && x.items.every((y) => chosen.has(y.itemId)));
      const ids = new Set(firsts.map((x) => x.id));
      const moving = d.airings.filter((x) => ids.has(x.id) || (x.repeatOfId && ids.has(x.repeatOfId)));
      if (!moving.length) return refuse(a.apply, head, 'the chosen items have no airings of their own to move.');
      const label = labeler(pl.full);
      const byId = new Map(d.airings.map((x) => [x.id, x]));
      head.push(`${plural(firsts.length, 'first airing')} and ${plural(moving.length - firsts.length, 'repeat')} of ${[...chosen].map(label).join(', ')} move:`, ...capped(moving.sort(inOrder(pl)).map((x) => `- ${airingLine(pl, d.mode, x, byId, label)}`), 'and more', 40));
      if (!a.apply) {
        head.push(`To move them: move_airings with the same arguments, apply: true, version ${pl.full.order.version} and to_version ${dst.full.order.version}.`);
        return { text: head.join('\n'), applyWith: { apply: true, version: pl.full.order.version, to_version: dst.full.order.version } };
      }
      const r = await moveAirings(pl.id, { version: pl.full.order.version, itemIds: [...chosen], targetId: dst.id, targetVersion: dst.full.order.version });
      const [v, tv] = [await versionOf(pl.id), await versionOf(dst.id)];
      head.push(`Moved ${plural(r.moved, 'airing')}. Change id ${changeId} — ${UNDO_HINT}`);
      return {
        text: head.join('\n'),
        change: {
          targetId: pl.id, channelIds: pl.channelIds,
          before: { draft: d, target: { id: dst.id, draft: dst.d } },
          after: { orderId: pl.id, version: v, targetId: dst.id, targetVersion: tv },
        },
      };
    },
    'write',
  );

  tool(
    'duplicate_plan',
    'Duplicate a plan',
    `A new plan with a new name and the same settings, items and airings; it is a draft. Preview first. ${UNDO_HINT} (undo deletes the copy)`,
    z.object({ channel: channelArg, plan: planArg, name: z.string().trim().min(1).max(200), apply }),
    async (a, { changeId }) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'edit');
      const d = pl.d;
      const out = [
        `A copy of ${quote(d.name)} named ${quote(a.name)} on ${pl.ch.name}: ${PLAN_MODE[d.mode]} · Draft · ${range(d.startDate, d.endDate)} · ${plural(d.items.length, 'item')} · ${plural(d.airings.length, 'airing')}${pv(a.apply, 'nothing is made')}`,
      ];
      if (isProgrammes(d.mode) && d.airings.length) out.push('Note: the copy holds the same blocks as the plan: two programmes in one block are listed as an issue until one of them changes.');
      if (!a.apply) {
        out.push('To make it: duplicate_plan with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const made = await duplicate(pl.id, a.name);
      const v = await versionOf(made.id);
      out[0] = `Plan ${quote(a.name)} made as a copy of ${quote(d.name)} (draft; id ${made.id}). Change id ${changeId} — undo_change deletes it while nobody changed it since.`;
      return { text: out.join('\n'), change: { targetId: made.id, channelIds: pl.channelIds, before: null, after: { orderId: made.id, version: v } } };
    },
    'write',
  );

  tool(
    'split_plan',
    'Split a plan',
    `End a plan the day before a date; from that day on, the rest goes into a new plan with the same settings and items. All or nothing. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      plan: planArg,
      date: isoDate.describe('The first day of the new plan.'),
      name: z.string().trim().min(1).max(200).describe('The name of the new plan.'),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'edit');
      checkVersion(a.apply, a.version, pl.full.order.version);
      const d = pl.d;
      const head = [`${quote(d.name)} on ${pl.ch.name} · split on ${a.date}${pv(a.apply)}`];
      const s = splitOrder(d, a.date, a.name);
      if (!s.ok) return refuse(a.apply, head, s.reason ?? 'it cannot split there.');
      head.push(
        `${quote(d.name)} ends on ${addDays(a.date, -1)} and keeps ${plural(s.keep.airings.length, 'airing')}; ${quote(a.name)} runs ${range(a.date, d.endDate)} with ${plural(s.moved, 'airing')}.`,
        ...(s.droppedRepeats ? [`${plural(s.droppedRepeats, 'repeat')} from ${a.date} on whose first airing stays before it are taken out.`] : []),
      );
      const problems = [...validateOrder(s.keep, pl.ctx), ...validateOrder(s.rest, pl.ctx)];
      if (problems.length) {
        head.push('Problems — nothing can be saved until they are solved:', ...problems.map((x) => `- ${x.message}`));
        if (a.apply) throw new HttpError(422, head.join('\n'));
        return head.join('\n');
      }
      if (!a.apply) {
        head.push(`To split it: split_plan with the same arguments, apply: true and version ${pl.full.order.version}.`);
        return { text: head.join('\n'), applyWith: { apply: true, version: pl.full.order.version } };
      }
      const made = await split(pl.id, { version: pl.full.order.version, date: a.date, name: a.name });
      const [v, rv] = [await versionOf(pl.id), await versionOf(made.id)];
      head.push(`Split: the new plan's id is ${made.id}. Change id ${changeId} — ${UNDO_HINT}`);
      return {
        text: head.join('\n'),
        change: { targetId: pl.id, channelIds: pl.channelIds, before: { draft: d }, after: { orderId: pl.id, version: v, restId: made.id, restVersion: rv } },
      };
    },
    'write',
  );

  tool(
    'delete_plan',
    'Delete a plan',
    `Delete a plan with its items and airings. Preview first; apply needs the version the preview showed. ${UNDO_HINT} (undo brings it back)`,
    z.object({ channel: channelArg, plan: planArg, apply, version }),
    async (a, { changeId }) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'edit');
      checkVersion(a.apply, a.version, pl.full.order.version);
      const d = pl.d;
      const out = [
        `Delete ${quote(d.name)} on ${pl.ch.name}: ${PLAN_MODE[d.mode]} · ${STATUS[d.status]} · ${range(d.startDate, d.endDate)} · ${plural(d.items.length, 'item')} · ${plural(d.airings.length, 'airing')}${pv(a.apply, 'nothing is deleted')}`,
      ];
      if (d.status === 'confirmed') out.push('It is Confirmed: filling days will no longer place its airings.');
      if (!a.apply) {
        out.push(`To delete it: delete_plan with the same arguments, apply: true and version ${pl.full.order.version}.`);
        return { text: out.join('\n'), applyWith: { apply: true, version: pl.full.order.version } };
      }
      await deleteOrder(pl.id);
      out[0] = `${quote(d.name)} is deleted. Change id ${changeId} — undo_change brings it back.`;
      return { text: out.join('\n'), change: { targetId: pl.id, channelIds: pl.channelIds, before: { orderId: pl.id }, after: { orderId: pl.id, deleted: true } } };
    },
    'write',
  );

  tool(
    'confirm_plan',
    'Confirm a plan',
    `Confirm a plan, or put it back to Draft. Confirmed: filling a day's Program placements (fill_day, or Import on the day page) places its airings in the playlist; days stay drafts until a person approves them. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      channel: channelArg,
      plan: planArg,
      confirmed: z.boolean().default(true).describe('true = Confirmed; false = back to Draft.'),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      const pl = await loadPlan(p, a.channel, a.plan, 'edit');
      checkVersion(a.apply, a.version, pl.full.order.version);
      const d = pl.d;
      const status = a.confirmed ? 'confirmed' : 'draft';
      const head = [`${quote(d.name)} on ${pl.ch.name} · ${STATUS[d.status]} → ${STATUS[status]}${pv(a.apply)}`];
      if (d.status === status) return [`${quote(d.name)} is ${STATUS[status]} already: nothing to change.`].join('\n');
      const mine = d.airings.filter((x) => x.channelId === pl.ch.id);
      head.push(`${plural(mine.filter((x) => !x.repeatOfId).length, 'first airing')} and ${plural(mine.filter((x) => x.repeatOfId).length, 'repeat')} on ${pl.ch.name}, ${range(d.startDate, d.endDate)}.`);
      if (pl.full.issue && a.confirmed) head.push(`Issue: ${pl.full.issue.text}`);
      if (a.confirmed && !d.airings.length) head.push('Note: it has no airings yet, so it places nothing.');
      return finish(pl, a, changeId, 'confirm_plan', { ...d, status }, head);
    },
    'write',
  );
}

// ---------------------------------------------------------------- undo

/** Puts back what a change of these tools made; null for a tool that is not one of them. */
export async function undoPlans(e: AuditEvent, change: string): Promise<ToolResult | null> {
  const after = (e.after ?? {}) as Record<string, unknown>;
  const before = (e.before ?? {}) as Record<string, unknown>;
  const done = (text: string, b: object | null, a: object): ToolResult => ({ text, change: { targetId: change, channelIds: e.channelIds, before: b, after: a } });
  switch (e.action) {
    case 'tool edit_plan':
    case 'tool place_airings':
    case 'tool remove_airings':
    case 'tool shift_episodes':
    case 'tool replace_items':
    case 'tool confirm_plan': {
      const id = after.orderId as string;
      await restoreOrders([{ id, version: after.version as number, draft: before.draft as OrderDraft }]);
      return done(`The plan is back as it was before change ${change} (version ${await versionOf(id)}).`, { orderId: id, version: after.version }, { orderId: id, version: await versionOf(id) });
    }
    case 'tool move_airings': {
      const target = before.target as { id: string; draft: OrderDraft };
      // the target first: it gives back the airings' ids before the source takes them again
      await restoreOrders([
        { id: target.id, version: after.targetVersion as number, draft: target.draft },
        { id: after.orderId as string, version: after.version as number, draft: before.draft as OrderDraft },
      ]);
      return done(`The airings moved by change ${change} are back in their plan.`, { orderId: after.orderId, targetId: target.id }, { restored: true });
    }
    case 'tool create_plan':
    case 'tool duplicate_plan': {
      await restoreOrders([], [{ id: after.orderId as string, version: after.version as number }]);
      return done(`The plan made by change ${change} is deleted.`, { orderId: after.orderId }, { deleted: true });
    }
    case 'tool split_plan': {
      await restoreOrders([{ id: after.orderId as string, version: after.version as number, draft: before.draft as OrderDraft }], [{ id: after.restId as string, version: after.restVersion as number }]);
      return done(`The plan is whole again, as before change ${change}; the plan the split made is deleted.`, { orderId: after.orderId, restId: after.restId }, { restored: true });
    }
    case 'tool delete_plan': {
      const id = before.orderId as string;
      await db.order.updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null } });
      return done(`The plan deleted by change ${change} is back.`, null, { orderId: id });
    }
    default:
      return null;
  }
}
