// Orders of the Scheduling page (data model §7): the shapes shared by
// the API and the page, the save rules, and the operations that only rearrange one order's airings —
// Copy week to the whole order, quick placement, rotation, auto-place, replace items, shift, split.
// Dates are broadcast days ("YYYY-MM-DD"); a repeat's distance counts broadcast days (0004).

import { WEEKDAYS, addDays, formatDate, isIsoDate, weekStartOn, weekdayOf } from './week';
import { uuidv7 } from './ids';

export type OrderMode = 'series' | 'programmes' | 'promos' | 'jingles' | 'graphics';
export const ORDER_MODES: OrderMode[] = ['series', 'programmes', 'promos', 'jingles', 'graphics'];
/** Modes that place programmes: two of them in one block are warned and listed as an issue. */
export const PROGRAMME_MODES: OrderMode[] = ['series', 'programmes'];
export type OrderStatus = 'confirmed' | 'draft';
export type Jingle = 'pre' | 'post';

export interface TimeWindow {
  /** Index = weekday (0 = Sunday). */
  weekdays: boolean[];
  /** Offsets in the broadcast day. */
  fromFrames: number;
  toFrames: number;
}
export interface TimeWindows {
  allowed: TimeWindow[];
  rejected: TimeWindow[];
}

export interface OrderItemDraft {
  id: string;
  productionId: string;
  lengthFrames: number | null;
}
export interface AiringItemDraft {
  itemId: string;
  passes: number;
  jingle: Jingle | null;
}
export interface AiringDraft {
  id: string;
  channelId: string;
  /** Broadcast day. */
  date: string;
  blockTypeId: string;
  passes: number;
  repeatOfId: string | null;
  repeatIndex: number;
  blockColor: string | null;
  items: AiringItemDraft[];
}
export interface OrderChannelDraft {
  channelId: string;
  templateId: string;
}
export interface OrderDraft {
  name: string;
  mode: OrderMode;
  status: OrderStatus;
  startDate: string;
  endDate: string;
  color: string;
  firstItemId: string | null;
  reuseInLoop: boolean;
  maxAirings: number | null;
  totalAirings: number | null;
  timeWindows: TimeWindows;
  channels: OrderChannelDraft[];
  items: OrderItemDraft[];
  airings: AiringDraft[];
}

/** One weekday of a template: block type → where its block sits in the broadcast day. */
export type TemplateDay = Map<string, { startFrames: number; lengthFrames: number }>;
/** Per channel of the order: its template's 7 weekdays (0 = Sunday) and the length of a broadcast day. */
export interface OrderRuleContext {
  templates: Map<string, TemplateDay[]>;
  dayFrames: number;
}

export interface OrderProblem {
  code: string;
  message: string;
  airingId?: string;
}

export const NO_WINDOWS: TimeWindows = { allowed: [], rejected: [] };
const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_PROBLEMS = 50;

/** "Sat 17 Oct 2026" */
export const dayLabel = (d: string) => `${WEEKDAYS[weekdayOf(d)].short} ${formatDate(d)}`;

/** Days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const isRepeat = (a: Pick<AiringDraft, 'repeatOfId'>) => a.repeatOfId !== null;
export const cellKey = (channelId: string, date: string, blockTypeId: string) => `${channelId}|${date}|${blockTypeId}`;

/** "same broadcast day", "+1 day", "+3 days" */
export function distanceText(days: number): string {
  return days === 0 ? 'same broadcast day' : days === 1 ? '+1 day' : `+${days} days`;
}

/**
 * How many airings an order holds: first airings for a series (each placed
 * episode), passes for the other modes — never rows.
 */
export function airingCount(d: Pick<OrderDraft, 'mode' | 'airings'>): number {
  if (d.mode === 'series') return d.airings.filter((a) => !isRepeat(a)).reduce((n, a) => n + Math.max(1, a.items.length), 0);
  return d.airings.reduce((n, a) => n + (isRepeat(a) ? 0 : a.passes), 0);
}

/** Is the block inside the order's time windows (allowed ones if any, never a rejected one)? */
export function inWindows(w: TimeWindows, weekday: number, startFrames: number): boolean {
  const hit = (x: TimeWindow) => x.weekdays[weekday] && (x.fromFrames <= x.toFrames ? startFrames >= x.fromFrames && startFrames < x.toFrames : startFrames >= x.fromFrames || startFrames < x.toFrames);
  if (w.rejected.some(hit)) return false;
  return !w.allowed.length || w.allowed.some(hit);
}

// ---------------------------------------------------------------- save rules (all-or-nothing)

export function validateOrder(d: OrderDraft, ctx: OrderRuleContext): OrderProblem[] {
  const out: OrderProblem[] = [];
  const add = (p: OrderProblem) => {
    if (out.length < MAX_PROBLEMS) out.push(p);
  };
  const name = d.name.trim();
  if (!name || name.length > 200) add({ code: 'name', message: 'The name is required and has at most 200 characters.' });
  if (!ORDER_MODES.includes(d.mode)) add({ code: 'mode', message: 'Unknown mode.' });
  if (d.status !== 'confirmed' && d.status !== 'draft') add({ code: 'status', message: 'The status is Confirmed or Draft.' });
  if (!isIsoDate(d.startDate) || !isIsoDate(d.endDate)) add({ code: 'dates', message: 'The dates are not valid.' });
  else if (d.startDate > d.endDate) add({ code: 'dates', message: `The end (${dayLabel(d.endDate)}) is before the start (${dayLabel(d.startDate)}).` });
  if (!HEX.test(d.color)) add({ code: 'color', message: 'The colour is not valid.' });
  if (!d.channels.length) add({ code: 'channel', message: 'A plan needs a channel.' });
  const channelIds = new Set<string>();
  for (const c of d.channels) {
    if (channelIds.has(c.channelId)) add({ code: 'channel', message: 'A channel is in the plan twice.' });
    channelIds.add(c.channelId);
    if (!ctx.templates.has(c.channelId)) add({ code: 'template', message: 'The channel has no main layout for this plan.' });
  }
  const itemIds = new Set<string>();
  for (const i of d.items) {
    if (itemIds.has(i.id)) add({ code: 'items', message: 'An item is in the list twice.' });
    itemIds.add(i.id);
  }
  if (d.firstItemId && !itemIds.has(d.firstItemId)) add({ code: 'first', message: 'The first episode to place is not in the list.' });
  for (const [k, v] of [['maxAirings', d.maxAirings], ['totalAirings', d.totalAirings]] as const) {
    if (v !== null && (!Number.isInteger(v) || v < 1)) add({ code: k, message: 'Airing limits are whole numbers from 1, or empty.' });
  }
  for (const w of [...d.timeWindows.allowed, ...d.timeWindows.rejected]) {
    if (w.weekdays.length !== 7 || !w.weekdays.some(Boolean) || w.fromFrames < 0 || w.toFrames > ctx.dayFrames || w.fromFrames === w.toFrames) {
      add({ code: 'windows', message: 'A time window needs at least one day and a start before its end inside the broadcast day.' });
    }
  }

  const byId = new Map<string, AiringDraft>();
  const cells = new Set<string>();
  for (const a of d.airings) {
    if (byId.has(a.id)) add({ code: 'airing', message: 'An airing is in the plan twice.', airingId: a.id });
    byId.set(a.id, a);
  }
  const datesOk = isIsoDate(d.startDate) && isIsoDate(d.endDate);
  for (const a of d.airings) {
    const days = ctx.templates.get(a.channelId);
    if (!channelIds.has(a.channelId) || !days) {
      add({ code: 'airing', message: 'An airing is on a channel the plan does not have.', airingId: a.id });
      continue;
    }
    if (!isIsoDate(a.date)) {
      add({ code: 'airing', message: 'An airing has no valid date.', airingId: a.id });
      continue;
    }
    if (datesOk && (a.date < d.startDate || a.date > d.endDate)) {
      add({ code: 'outside', message: `${dayLabel(a.date)} is outside the plan's dates (${dayLabel(d.startDate)} → ${dayLabel(d.endDate)}).`, airingId: a.id });
    }
    if (!days[weekdayOf(a.date)].has(a.blockTypeId)) {
      add({ code: 'block', message: `The plan's layout has no such block on ${WEEKDAYS[weekdayOf(a.date)].long}s (${dayLabel(a.date)}).`, airingId: a.id });
    }
    const key = cellKey(a.channelId, a.date, a.blockTypeId);
    if (cells.has(key)) add({ code: 'twice', message: `Two airings of this plan in one block on ${dayLabel(a.date)}.`, airingId: a.id });
    cells.add(key);
    if (!Number.isInteger(a.passes) || a.passes < 0) add({ code: 'passes', message: 'Plays are whole numbers from 0.', airingId: a.id });
    if (a.repeatOfId !== null) {
      const f = byId.get(a.repeatOfId);
      if (!f || f.repeatOfId !== null || f.channelId !== a.channelId) {
        add({ code: 'repeat', message: `A repeat on ${dayLabel(a.date)} does not point at a first airing of this plan.`, airingId: a.id });
      } else if (f.date > a.date) {
        add({ code: 'repeat', message: `A repeat on ${dayLabel(a.date)} comes before its first airing (${dayLabel(f.date)}).`, airingId: a.id });
      }
      if (a.items.length) add({ code: 'repeat', message: 'A repeat takes the item of its first airing and has none of its own.', airingId: a.id });
    } else {
      if (PROGRAMME_MODES.includes(d.mode) && !a.items.length) add({ code: 'item', message: `A first airing on ${dayLabel(a.date)} has no item.`, airingId: a.id });
      for (const it of a.items) {
        if (!itemIds.has(it.itemId)) add({ code: 'item', message: `An airing on ${dayLabel(a.date)} uses an item that is not in the plan's list.`, airingId: a.id });
        if (!Number.isInteger(it.passes) || it.passes < 0) add({ code: 'passes', message: 'Plays are whole numbers from 0.', airingId: a.id });
      }
    }
  }
  if (d.maxAirings !== null) {
    const n = airingCount(d);
    if (n > d.maxAirings) add({ code: 'limit', message: `Only ${d.maxAirings} airings can be placed; this plan has ${n}.` });
  }
  return out;
}

// ---------------------------------------------------------------- helpers on one order

/** Weekly first days (channel week) of every week that touches the order's dates. */
export function orderWeeks(start: string, end: string, weekStart: number): string[] {
  const out: string[] = [];
  for (let w = weekStartOn(start, weekStart); w <= end; w = addDays(w, 7)) out.push(w);
  return out;
}

/** The first complete channel week inside the dates (null when there is none). */
export function firstCompleteWeek(start: string, end: string, weekStart: number): string | null {
  const w = weekStartOn(start, weekStart);
  const first = w === start ? w : addDays(w, 7);
  return addDays(first, 6) <= end ? first : null;
}

const startOf = (ctx: OrderRuleContext, channelId: string, date: string, bt: string) => ctx.templates.get(channelId)?.[weekdayOf(date)]?.get(bt)?.startFrames ?? 0;

/** First airings of a channel in airing order (date, then the block's start). */
export function firstsInOrder(d: Pick<OrderDraft, 'airings'>, ctx: OrderRuleContext, channelId: string): AiringDraft[] {
  return d.airings
    .filter((a) => a.channelId === channelId && !isRepeat(a))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : startOf(ctx, channelId, a.date, a.blockTypeId) - startOf(ctx, channelId, b.date, b.blockTypeId)));
}

/**
 * Series: the item a new first airing at (date, block) takes — the one after the item of the
 * latest first airing before it, else the first episode to place; null when the list ran out.
 */
export function nextItemFor(d: OrderDraft, ctx: OrderRuleContext, channelId: string, date: string, blockTypeId: string): string | null {
  if (!d.items.length) return null;
  const at = startOf(ctx, channelId, date, blockTypeId);
  const before = firstsInOrder(d, ctx, channelId).filter((a) => a.date < date || (a.date === date && startOf(ctx, channelId, a.date, a.blockTypeId) < at));
  const last = before[before.length - 1];
  const lastItem = last?.items[last.items.length - 1]?.itemId;
  if (!lastItem) return d.firstItemId ?? d.items[0].id;
  const i = d.items.findIndex((x) => x.id === lastItem);
  if (i < 0) return d.firstItemId ?? d.items[0].id;
  if (i + 1 < d.items.length) return d.items[i + 1].id;
  return d.reuseInLoop ? d.items[0].id : null;
}

// ---------------------------------------------------------------- Copy week to the whole order

export interface CopyWeekResult {
  ok: boolean;
  /** Why it cannot run. */
  reason?: string;
  airings: AiringDraft[];
  /** Weeks other than the reference week. */
  otherWeeks: number;
  firsts: number;
  repeats: number;
  passes: number;
  /** Series: the first and last item placed, and the day of the last first airing. */
  firstItemId: string | null;
  lastItemId: string | null;
  lastFirstDate: string | null;
  /** First airings left out because the item list ran out (series without "start again"). */
  ranOut: number;
  /** Airings that would fall outside the order's dates. */
  outside: number;
  /** Repeats whose first airing does not exist in that week. */
  withoutFirst: number;
  /** Repeats of the reference week that replay an airing of the week before it. */
  spill: number;
  /** Items of the list that no first airing takes (series). */
  notPlaced: number;
}

/**
 * Copies one complete channel week of a channel over every other week of the order. The other
 * weeks' airings on that channel are replaced. Series: the first airings of all
 * weeks, in airing order, take the items of the list from the first episode to place; repeats follow
 * their first airing — also repeats that replay the week before the reference week, so one pass does
 * it all. All-or-nothing: the result replaces the airings only when `ok`.
 */
export function copyWeek(d: OrderDraft, ctx: OrderRuleContext, channelId: string, refStart: string): CopyWeekResult {
  const ws = refStart;
  const we = addDays(ws, 6);
  const empty: CopyWeekResult = {
    ok: false, airings: d.airings, otherWeeks: 0, firsts: 0, repeats: 0, passes: 0, firstItemId: null, lastItemId: null, lastFirstDate: null,
    ranOut: 0, outside: 0, withoutFirst: 0, spill: 0, notPlaced: 0,
  };
  if (ws < d.startDate || we > d.endDate) {
    return { ...empty, reason: `Not a complete week of the plan (${dayLabel(d.startDate)} → ${dayLabel(d.endDate)}). Pick a week with all seven days inside.` };
  }
  const weekStart = weekdayOf(ws);
  const mine = d.airings.filter((a) => a.channelId === channelId);
  const byId = new Map(d.airings.map((a) => [a.id, a]));
  const inRef = (a: AiringDraft) => a.date >= ws && a.date <= we;
  const refFirsts = mine.filter((a) => !isRepeat(a) && inRef(a));
  const refRepeats = mine.filter((a) => isRepeat(a) && inRef(a));
  const weeks = orderWeeks(d.startDate, d.endDate, weekStart);
  const inside = (date: string) => date >= d.startDate && date <= d.endDate;

  // 1 · first airings of every week
  const cands: { ref: AiringDraft; date: string; week: string }[] = [];
  let outside = 0;
  for (const w of weeks) {
    for (const a of refFirsts) {
      const date = addDays(w, daysBetween(ws, a.date));
      if (inside(date)) cands.push({ ref: a, date, week: w });
      else outside++;
    }
  }
  cands.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : startOf(ctx, channelId, x.date, x.ref.blockTypeId) - startOf(ctx, channelId, y.date, y.ref.blockTypeId)));

  // 2 · items (series: the next ones of the list)
  const firsts: AiringDraft[] = [];
  const firstAt = new Map<string, AiringDraft>();
  let p = d.firstItemId ? Math.max(0, d.items.findIndex((x) => x.id === d.firstItemId)) : 0;
  let ranOut = 0;
  const used = new Set<string>();
  let firstItemId: string | null = null;
  let lastItemId: string | null = null;
  let lastFirstDate: string | null = null;
  for (const c of cands) {
    let items: AiringItemDraft[];
    if (d.mode === 'series') {
      items = [];
      const n = Math.max(1, c.ref.items.length);
      for (let j = 0; j < n; j++) {
        if (p >= d.items.length) {
          if (!d.reuseInLoop || !d.items.length) break;
          p = 0;
        }
        const it = d.items[p++];
        items.push({ itemId: it.id, passes: c.ref.items[j]?.passes ?? 0, jingle: c.ref.items[j]?.jingle ?? null });
        used.add(it.id);
        firstItemId ??= it.id;
        lastItemId = it.id;
      }
      if (!items.length) {
        ranOut++;
        continue;
      }
      lastFirstDate = c.date;
    } else items = c.ref.items.map((x) => ({ ...x }));
    const a: AiringDraft = {
      id: c.week === ws ? c.ref.id : uuidv7(),
      channelId, date: c.date, blockTypeId: c.ref.blockTypeId, passes: d.mode === 'series' ? items.length : c.ref.passes,
      repeatOfId: null, repeatIndex: 0, blockColor: c.ref.blockColor, items,
    };
    firsts.push(a);
    firstAt.set(`${a.date}|${a.blockTypeId}`, a);
  }

  // 3 · repeats follow their first airing
  const repeats: AiringDraft[] = [];
  let withoutFirst = 0;
  let spill = 0;
  for (const r of refRepeats) {
    const f = byId.get(r.repeatOfId!);
    if (f && f.date < ws) spill++;
  }
  for (const w of weeks) {
    const shift = daysBetween(ws, w);
    for (const r of refRepeats) {
      const f = byId.get(r.repeatOfId!);
      if (!f) continue;
      const date = addDays(r.date, shift);
      if (!inside(date)) {
        outside++;
        continue;
      }
      const target = firstAt.get(`${addDays(f.date, shift)}|${f.blockTypeId}`);
      if (!target) {
        withoutFirst++;
        continue;
      }
      repeats.push({ id: w === ws ? r.id : uuidv7(), channelId, date, blockTypeId: r.blockTypeId, passes: 0, repeatOfId: target.id, repeatIndex: r.repeatIndex, blockColor: r.blockColor, items: [] });
    }
  }
  // two airings in one cell: a repeat never takes a block a first airing holds
  const taken = new Set(firsts.map((a) => `${a.date}|${a.blockTypeId}`));
  const keptRepeats = repeats.filter((r) => {
    const k = `${r.date}|${r.blockTypeId}`;
    if (taken.has(k)) return false;
    taken.add(k);
    return true;
  });
  const airings = [...d.airings.filter((a) => a.channelId !== channelId), ...firsts, ...keptRepeats];
  const result: CopyWeekResult = {
    ok: true, airings, otherWeeks: weeks.length - 1, firsts: firsts.length, repeats: keptRepeats.length,
    passes: firsts.reduce((n, a) => n + a.passes, 0), firstItemId, lastItemId, lastFirstDate, ranOut, outside, withoutFirst, spill,
    notPlaced: d.mode === 'series' ? d.items.filter((i) => !used.has(i.id)).length : 0,
  };
  if (d.maxAirings !== null) {
    const n = airingCount({ mode: d.mode, airings });
    if (n > d.maxAirings) return { ...empty, reason: `Only ${d.maxAirings} airings can be placed; copying gives ${n}.` };
  }
  return result;
}

// ---------------------------------------------------------------- rotation (promos)

export interface RotationPlan {
  passesPerDay: number;
  /** Item id → share in percent; the shares add up to 100. */
  shares: { itemId: string; percent: number }[];
}
export interface RotationResult {
  ok: boolean;
  reason?: string;
  airings: AiringDraft[];
  /** Item id → passes a day. */
  perItem: Map<string, number>;
  days: number;
  blocksPerDay: number;
}

/** Largest-remainder split of n into parts by weight. */
function splitByShare(n: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const exact = weights.map((w) => (n * w) / total);
  const base = exact.map(Math.floor);
  let left = n - base.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    base[i]++;
    left--;
  }
  return base;
}

/**
 * Promos: spreads the passes of each day over the day's blocks (inside the time windows), each item
 * by its share. The channel's current placement is replaced on every day of the order.
 */
export function rotate(d: OrderDraft, ctx: OrderRuleContext, channelId: string, plan: RotationPlan): RotationResult {
  const fail = (reason: string): RotationResult => ({ ok: false, reason, airings: d.airings, perItem: new Map(), days: 0, blocksPerDay: 0 });
  const total = plan.shares.reduce((s, x) => s + x.percent, 0);
  if (Math.abs(total - 100) > 0.01) return fail(`The shares add up to ${Math.round(total * 100) / 100} %, not 100 %.`);
  if (!Number.isInteger(plan.passesPerDay) || plan.passesPerDay < 1) return fail('Plays per day are a whole number from 1.');
  const days = ctx.templates.get(channelId);
  if (!days) return fail('The channel has no layout for this plan.');
  const shares = plan.shares.filter((s) => s.percent > 0);
  const counts = splitByShare(plan.passesPerDay, shares.map((s) => s.percent));
  const perItem = new Map(shares.map((s, i) => [s.itemId, counts[i]]));
  // one day's sequence of passes, items interleaved by share
  const seq: string[] = [];
  const done = shares.map(() => 0);
  for (let k = 0; k < plan.passesPerDay; k++) {
    let best = -1;
    let bestGap = -Infinity;
    shares.forEach((_, i) => {
      if (done[i] >= counts[i]) return;
      const gap = (k + 1) * (counts[i] / plan.passesPerDay) - done[i];
      if (gap > bestGap) {
        bestGap = gap;
        best = i;
      }
    });
    if (best < 0) break;
    seq.push(shares[best].itemId);
    done[best]++;
  }
  const out = d.airings.filter((a) => a.channelId !== channelId);
  let nDays = 0;
  let maxBlocks = 0;
  for (let date = d.startDate; date <= d.endDate; date = addDays(date, 1)) {
    const wd = weekdayOf(date);
    const blocks = [...days[wd].entries()].filter(([, b]) => inWindows(d.timeWindows, wd, b.startFrames)).sort((a, b) => a[1].startFrames - b[1].startFrames);
    if (!blocks.length) continue;
    nDays++;
    maxBlocks = Math.max(maxBlocks, blocks.length);
    const per = splitByShare(seq.length, blocks.map(() => 1));
    let at = 0;
    blocks.forEach(([bt], i) => {
      const part = seq.slice(at, at + per[i]);
      at += per[i];
      if (!part.length) return;
      const items: AiringItemDraft[] = [];
      for (const id of part) {
        const x = items.find((y) => y.itemId === id);
        if (x) x.passes++;
        else items.push({ itemId: id, passes: 1, jingle: null });
      }
      out.push({ id: uuidv7(), channelId, date, blockTypeId: bt, passes: part.length, repeatOfId: null, repeatIndex: 0, blockColor: null, items });
    });
  }
  if (!nDays) return fail('No block of the layout is inside the plan’s time windows.');
  return { ok: true, airings: out, perItem, days: nDays, blocksPerDay: maxBlocks };
}

// ---------------------------------------------------------------- auto-place

export interface AutoPlaceResult {
  ok: boolean;
  reason?: string;
  airings: AiringDraft[];
  placed: number;
}

/**
 * Fills the whole order from its settings (automatic scheduling), replacing its airings on the
 * channel. Series / programmes: every free block inside the allowed time windows, day by day, takes
 * the next item (needs at least one allowed window); a block another programme order holds is
 * skipped. Promos / jingles / graphics: `passesPerBlock` passes of the whole list in every block
 * inside the windows. To confirm with operators.
 */
export function autoPlace(
  d: OrderDraft,
  ctx: OrderRuleContext,
  channelId: string,
  opts: { passesPerBlock: number; taken?: Set<string> },
): AutoPlaceResult {
  const days = ctx.templates.get(channelId);
  if (!days) return { ok: false, reason: 'The channel has no layout for this plan.', airings: d.airings, placed: 0 };
  if (!d.items.length) return { ok: false, reason: 'The plan has no items yet.', airings: d.airings, placed: 0 };
  const programmes = PROGRAMME_MODES.includes(d.mode);
  if (programmes && !d.timeWindows.allowed.length) {
    return { ok: false, reason: 'Set at least one allowed time window in Limits first: they say where the episodes go.', airings: d.airings, placed: 0 };
  }
  const out = d.airings.filter((a) => a.channelId !== channelId);
  let p = d.firstItemId ? Math.max(0, d.items.findIndex((x) => x.id === d.firstItemId)) : 0;
  let placed = 0;
  const limit = d.maxAirings ?? Infinity;
  for (let date = d.startDate; date <= d.endDate; date = addDays(date, 1)) {
    const wd = weekdayOf(date);
    const blocks = [...days[wd].entries()].filter(([, b]) => inWindows(d.timeWindows, wd, b.startFrames)).sort((a, b) => a[1].startFrames - b[1].startFrames);
    for (const [bt] of blocks) {
      if (placed >= limit) break;
      if (programmes) {
        if (opts.taken?.has(`${date}|${bt}`)) continue;
        if (p >= d.items.length) {
          if (d.mode !== 'series' || !d.reuseInLoop) break;
          p = 0;
        }
        const it = d.items[p++];
        out.push({ id: uuidv7(), channelId, date, blockTypeId: bt, passes: 1, repeatOfId: null, repeatIndex: 0, blockColor: null, items: [{ itemId: it.id, passes: 0, jingle: null }] });
        placed++;
      } else {
        out.push({
          id: uuidv7(), channelId, date, blockTypeId: bt, passes: opts.passesPerBlock, repeatOfId: null, repeatIndex: 0, blockColor: null,
          items: d.items.map((it) => ({ itemId: it.id, passes: 0, jingle: d.mode === 'jingles' ? ('pre' as const) : null })),
        });
        placed += opts.passesPerBlock;
      }
    }
  }
  return { ok: true, airings: out, placed };
}

// ---------------------------------------------------------------- replace items

export interface ReplaceResult {
  airings: AiringDraft[];
  /** Airings changed. */
  found: number;
  /** Airings of those items left as they are (outside the dates or block types), by reason. */
  ignored: { reason: string; count: number }[];
}

/** Puts `newItemId` in place of the old items, from / to a day, optionally only in some block types. */
export function replaceItems(d: OrderDraft, opts: { oldItemIds: string[]; newItemId: string; from: string; to: string; blockTypeIds?: string[] }): ReplaceResult {
  const olds = new Set(opts.oldItemIds);
  const bts = opts.blockTypeIds?.length ? new Set(opts.blockTypeIds) : null;
  let found = 0;
  let early = 0;
  let late = 0;
  let otherBlock = 0;
  const airings = d.airings.map((a) => {
    if (!a.items.some((x) => olds.has(x.itemId))) return a;
    if (a.date < opts.from) {
      early++;
      return a;
    }
    if (a.date > opts.to) {
      late++;
      return a;
    }
    if (bts && !bts.has(a.blockTypeId)) {
      otherBlock++;
      return a;
    }
    found++;
    const items: AiringItemDraft[] = [];
    for (const x of a.items) {
      const id = olds.has(x.itemId) ? opts.newItemId : x.itemId;
      const same = items.find((y) => y.itemId === id);
      if (same) same.passes += x.passes;
      else items.push({ ...x, itemId: id });
    }
    return { ...a, items };
  });
  const ignored = [
    { reason: 'before the start date', count: early },
    { reason: 'after the end date', count: late },
    { reason: 'in other block types', count: otherBlock },
  ].filter((x) => x.count);
  return { airings, found, ignored };
}

// ---------------------------------------------------------------- shift airings

export interface ShiftResult {
  ok: boolean;
  /** Why it cannot run. */
  reason?: string;
  airings: AiringDraft[];
  /** Episodes (items of first airings) that move to another airing day. */
  moved: number;
  /** Airing days left empty: their first airing goes, with this many repeats. */
  emptied: { airing: AiringDraft; repeats: number }[];
  /** Airing days made from the weekly pattern: a new first airing with this many repeats. */
  added: { airing: AiringDraft; repeats: number }[];
  /** Repeats of new airing days left out: outside the order's dates. */
  outside: number;
}

/** An airing day of the pattern: an existing first airing, or one made from `source` some weeks away. */
type ShiftSlot = { first: AiringDraft } | { source: AiringDraft; weeks: number };

/**
 * Moves the episodes along the order's airing days (user, 2026-10-23). The days and
 * blocks — first airings with their repeats — stay as they are, so the pattern never changes; only
 * the items of first airings move, and repeats show their first airing's new episode. Later
 * (`slots` > 0): the chosen first airing and every one after it go `slots` airing days later; the
 * chosen day and the ones after it, up to `slots` days, become empty with their repeats, and new
 * days continue the weekly pattern after the last one, as Copy week does. Earlier (`slots` < 0): the
 * mirror — the chosen first airing and every one before it go back, the chosen day empties and new
 * days continue the weekly pattern before the first one. Past airings move too. All-or-nothing: it
 * stops when the order's dates leave no day for an episode, or when a new airing lands on a block
 * this order already uses.
 */
export function shiftAirings(d: OrderDraft, ctx: OrderRuleContext, channelId: string, fromId: string, slots: number): ShiftResult {
  const firsts = firstsInOrder(d, ctx, channelId);
  const k = firsts.findIndex((a) => a.id === fromId);
  const none: ShiftResult = { ok: false, airings: d.airings, moved: 0, emptied: [], added: [], outside: 0 };
  if (k < 0 || !Number.isInteger(slots) || slots === 0) return none;
  const n = Math.abs(slots);
  const later = slots > 0;
  const key = (a: AiringDraft) => daysBetween(d.startDate, a.date) * ctx.dayFrames + startOf(ctx, channelId, a.date, a.blockTypeId);
  const repeatsOf = new Map<string, AiringDraft[]>();
  for (const a of d.airings) if (a.repeatOfId) repeatsOf.set(a.repeatOfId, [...(repeatsOf.get(a.repeatOfId) ?? []), a]);
  // the episodes that move: from the chosen one to the last (later) or from the first to it (earlier)
  const group = later ? firsts.slice(k) : firsts.slice(0, k + 1);
  const week = 7 * ctx.dayFrames;

  // new airing days: the week of the order's last airing day again and again a week later (later),
  // or the week of its first airing day a week earlier (earlier), while inside the order's dates
  const edge = key(later ? group[group.length - 1] : group[0]);
  const pattern = firsts.filter((f) => (later ? key(f) > edge - week && key(f) <= edge : key(f) >= edge && key(f) < edge + week));
  const made: ShiftSlot[] = [];
  fill: for (let w = 1; made.length < n; w++) {
    for (const t of later ? pattern : [...pattern].reverse()) {
      const date = addDays(t.date, later ? 7 * w : -7 * w);
      if (later ? date > d.endDate : date < d.startDate) break fill;
      made.push({ source: t, weeks: later ? w : -w });
      if (made.length === n) break fill;
    }
  }
  const lost = Math.min(group.length, n - made.length);
  if (lost > 0) {
    const eps = lost === 1 ? '1 episode has' : `${lost} episodes have`;
    return {
      ...none,
      reason: later
        ? `${eps} no airing day before the plan ends (${dayLabel(d.endDate)}). Change the end date first.`
        : `The plan starts on ${dayLabel(d.startDate)}: ${eps} no airing day left. Change the start date first.`,
    };
  }

  // the airing days in order; episode i goes to day i + offset
  const days: ShiftSlot[] = later ? [...group.map((first) => ({ first })), ...made] : [...made.reverse(), ...group.map((first) => ({ first }))];
  const offset = later ? n : 0;
  const drop = new Set<string>();
  const changed = new Map<string, AiringDraft>();
  const fresh: AiringDraft[] = [];
  const emptied: ShiftResult['emptied'] = [];
  const added: ShiftResult['added'] = [];
  let outside = 0;
  days.forEach((slot, j) => {
    const ep = group[j - offset];
    if ('first' in slot) {
      if (ep) changed.set(slot.first.id, { ...slot.first, passes: ep.passes, items: ep.items });
      else {
        const reps = repeatsOf.get(slot.first.id) ?? [];
        drop.add(slot.first.id);
        for (const r of reps) drop.add(r.id);
        emptied.push({ airing: slot.first, repeats: reps.length });
      }
      return;
    }
    if (!ep) return;
    const shift = (date: string) => addDays(date, 7 * slot.weeks);
    const first: AiringDraft = { ...slot.source, id: uuidv7(), date: shift(slot.source.date), passes: ep.passes, items: ep.items };
    const reps = (repeatsOf.get(slot.source.id) ?? []).map((r) => ({ ...r, id: uuidv7(), date: shift(r.date), repeatOfId: first.id })).filter((r) => {
      const inside = r.date >= d.startDate && r.date <= d.endDate;
      if (!inside) outside++;
      return inside;
    });
    fresh.push(first, ...reps);
    added.push({ airing: first, repeats: reps.length });
  });

  const airings = [...d.airings.filter((a) => !drop.has(a.id)).map((a) => changed.get(a.id) ?? a), ...fresh];
  const cells = new Set(airings.filter((a) => !fresh.includes(a)).map((a) => cellKey(a.channelId, a.date, a.blockTypeId)));
  for (const a of fresh) {
    const cell = cellKey(a.channelId, a.date, a.blockTypeId);
    if (cells.has(cell)) return { ...none, reason: `${dayLabel(a.date)}: a new airing day of the pattern falls on a block this plan already uses.` };
    cells.add(cell);
  }
  return { ok: true, airings, moved: group.length, emptied, added, outside };
}

// ---------------------------------------------------------------- split

export interface SplitResult {
  ok: boolean;
  reason?: string;
  /** This order, ending the day before the split date. */
  keep: OrderDraft;
  /** The new order, from the split date (new ids for its items and airings). */
  rest: OrderDraft;
  moved: number;
  /** Repeats from the split date on whose first airing stays in this order: removed. */
  droppedRepeats: number;
}

/** Ends the order the day before `date`; the rest moves into a new order with the same settings and items. */
export function splitOrder(d: OrderDraft, date: string, newName: string): SplitResult {
  const fail = (reason: string): SplitResult => ({ ok: false, reason, keep: d, rest: d, moved: 0, droppedRepeats: 0 });
  if (!(date > d.startDate && date <= d.endDate)) return fail(`Pick a day after ${dayLabel(d.startDate)} and up to ${dayLabel(d.endDate)}.`);
  if (!newName.trim()) return fail('The new plan needs a name.');
  const itemMap = new Map(d.items.map((i) => [i.id, uuidv7()]));
  const airMap = new Map<string, string>();
  const keep: AiringDraft[] = [];
  const moved: AiringDraft[] = [];
  const byId = new Map(d.airings.map((a) => [a.id, a]));
  let dropped = 0;
  for (const a of d.airings) {
    if (a.date < date) keep.push(a);
    else if (a.repeatOfId && (byId.get(a.repeatOfId)?.date ?? date) < date) dropped++;
    else {
      const id = uuidv7();
      airMap.set(a.id, id);
      moved.push(a);
    }
  }
  const restAirings = moved.map((a) => ({
    ...a,
    id: airMap.get(a.id)!,
    repeatOfId: a.repeatOfId ? airMap.get(a.repeatOfId) ?? null : null,
    items: a.items.map((x) => ({ ...x, itemId: itemMap.get(x.itemId)! })),
  }));
  return {
    ok: true,
    keep: { ...d, endDate: addDays(date, -1), airings: keep },
    rest: {
      ...d,
      name: newName.trim(),
      startDate: date,
      items: d.items.map((i) => ({ ...i, id: itemMap.get(i.id)! })),
      firstItemId: d.firstItemId ? itemMap.get(d.firstItemId) ?? null : null,
      airings: restAirings,
    },
    moved: moved.length,
    droppedRepeats: dropped,
  };
}

/** A copy with new ids for its items and airings (Duplicate order). */
export function duplicateOrder(d: OrderDraft, name: string): OrderDraft {
  const itemMap = new Map(d.items.map((i) => [i.id, uuidv7()]));
  const airMap = new Map(d.airings.map((a) => [a.id, uuidv7()]));
  return {
    ...d,
    name: name.trim(),
    items: d.items.map((i) => ({ ...i, id: itemMap.get(i.id)! })),
    firstItemId: d.firstItemId ? itemMap.get(d.firstItemId) ?? null : null,
    airings: d.airings.map((a) => ({
      ...a,
      id: airMap.get(a.id)!,
      repeatOfId: a.repeatOfId ? airMap.get(a.repeatOfId) ?? null : null,
      items: a.items.map((x) => ({ ...x, itemId: itemMap.get(x.itemId)! })),
    })),
  };
}
