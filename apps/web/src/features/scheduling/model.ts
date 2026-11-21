// The Scheduling page's working model: the open order as an editable draft with Undo / Redo, the
// rule context from its templates, and what the week grid, the table and the side panels show.

import {
  WEEKDAYS,
  addDays,
  daysBetween,
  distanceText,
  formatClockShort,
  frameRate,
  framesPerDay,
  framesPerHour,
  isRepeat,
  weekStartOn,
  weekdayOf,
  type AiringDraft,
  type FrameRate,
  type OrderDraft,
  type OrderMode,
  type OrderRuleContext,
  type TemplateDay,
} from '@9eye/core';
import type { Channel, CompactTemplate, OrderFull, OrderItem, WeekAiring } from '@/lib/types';

export const MODE_LABEL: Record<OrderMode, string> = { series: 'Series', programmes: 'Programmes', promos: 'Trailers', jingles: 'Stings', graphics: 'Graphics' };
export const MODE_HINT: Record<OrderMode, string> = {
  series: 'Items air in list order (series)',
  programmes: 'Chosen items on chosen days and blocks (films, shows, news)',
  promos: 'Trailers, idents, music clips rotated through blocks',
  jingles: 'Opening and closing elements around programmes',
  graphics: 'Logos, tickers, age ratings from Media → Graphics',
};
export const MODE_GROUP_HINT: Record<OrderMode, string> = {
  series: 'episodes in list order',
  programmes: 'chosen days and blocks',
  promos: 'trailers, idents and music clips',
  jingles: 'around programmes',
  graphics: 'on-screen graphics',
};
export const isProgrammeMode = (m: OrderMode) => m === 'series' || m === 'programmes';
/** Catalog families an order of this mode picks from (catalog-picker.md). */
export const familiesFor = (m: OrderMode): ('program' | 'filling' | 'graphics')[] => (isProgrammeMode(m) ? ['program'] : m === 'graphics' ? ['graphics'] : ['filling']);

// ---------------------------------------------------------------- draft and history

export function toDraft(full: OrderFull): OrderDraft {
  const o = full.order;
  return {
    name: o.name, mode: o.mode, status: o.status, startDate: o.startDate, endDate: o.endDate, color: o.color, firstItemId: o.firstItemId,
    reuseInLoop: o.reuseInLoop, maxAirings: o.maxAirings, totalAirings: o.totalAirings, timeWindows: o.timeWindows,
    channels: full.channels.map((c) => ({ channelId: c.channel.id, templateId: c.template.id })),
    items: full.items.map((i) => ({ id: i.id, productionId: i.productionId, lengthFrames: i.lengthFrames })),
    airings: full.airings,
  };
}

export interface EditorState {
  orderId: string | null;
  version: number;
  base: OrderDraft | null;
  present: OrderDraft | null;
  past: OrderDraft[];
  future: OrderDraft[];
}
export type EditorAction =
  | { type: 'load'; orderId: string; version: number; draft: OrderDraft }
  | { type: 'change'; draft: OrderDraft }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'discard' };

export const emptyEditor: EditorState = { orderId: null, version: 0, base: null, present: null, past: [], future: [] };

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'load':
      return { orderId: a.orderId, version: a.version, base: a.draft, present: a.draft, past: [], future: [] };
    case 'change':
      if (!s.present || a.draft === s.present) return s;
      return { ...s, present: a.draft, past: [...s.past, s.present].slice(-100), future: [] };
    case 'undo':
      if (!s.past.length || !s.present) return s;
      return { ...s, present: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.present, ...s.future] };
    case 'redo':
      if (!s.future.length || !s.present) return s;
      return { ...s, present: s.future[0], past: [...s.past, s.present], future: s.future.slice(1) };
    case 'discard':
      return { ...s, present: s.base, past: [], future: [] };
  }
}

export const isDirty = (s: EditorState) => s.present !== s.base && JSON.stringify(s.present) !== JSON.stringify(s.base);

// ---------------------------------------------------------------- templates and time

export function templateDays(t: CompactTemplate): TemplateDay[] {
  const days: TemplateDay[] = Array.from({ length: 7 }, () => new Map());
  for (const b of t.blocks) days[b.weekday].set(b.blockTypeId, { startFrames: b.startFrames, lengthFrames: b.lengthFrames });
  return days;
}

export function ruleContext(channels: { channel: Channel; template: CompactTemplate }[]): OrderRuleContext {
  return {
    templates: new Map(channels.map((c) => [c.channel.id, templateDays(c.template)])),
    dayFrames: Math.max(0, ...channels.map((c) => framesPerDay(frameRate(c.channel.frameRate)))),
  };
}

export interface TimeCtx {
  channel: Channel;
  rate: FrameRate;
  fph: number;
  /** "15:00" from an offset in the broadcast day. */
  clock: (offset: number) => string;
}

export function timeCtx(channel: Channel): TimeCtx {
  const rate = frameRate(channel.frameRate);
  return { channel, rate, fph: framesPerHour(rate), clock: (offset) => formatClockShort(offset, channel.dayStartFrames, rate) };
}

export const hourLabels = (t: TimeCtx) => Array.from({ length: 24 }, (_, i) => t.clock(i * t.fph));

/** "Sat 17 Oct" */
export const shortDay = (d: string) => {
  const [, m, day] = d.split('-').map(Number);
  return `${WEEKDAYS[weekdayOf(d)].short} ${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
};

/** A block's time with the calendar day for hours after midnight: "03:00 (Sun)". */
export function timeWithDay(t: TimeCtx, date: string, start: number): string {
  const clockFrames = t.channel.dayStartFrames + start;
  const nextDay = clockFrames >= framesPerDay(t.rate);
  return `${t.clock(start)}${nextDay ? ` (${WEEKDAYS[(weekdayOf(date) + 1) % 7].short})` : ''}`;
}

/** Template blocks of one day, in time order, with names and colours. */
export function dayBlocks(t: CompactTemplate, date: string) {
  const wd = weekdayOf(date);
  return t.blocks
    .filter((b) => b.weekday === wd)
    .sort((a, b) => a.startFrames - b.startFrames)
    .map((b) => ({ ...b, name: t.blockTypes[b.blockTypeId]?.name ?? 'Block', color: t.blockTypes[b.blockTypeId]?.color ?? null }));
}

/** The week to open: the one of today when it is inside the order, else its first (complete) week. */
export function defaultWeek(start: string, end: string, today: string, weekStart: number): string {
  if (today >= start && today <= end) return weekStartOn(today, weekStart);
  const w = weekStartOn(start, weekStart);
  return w === start || addDays(w, 7) > end ? w : addDays(w, 7);
}

// ---------------------------------------------------------------- items

export interface ItemInfo {
  title: string;
  chapter: number | null;
  code: string;
  contentId: string;
  contentTitle: string;
  catalogLengthFrames: number | null;
}

/** Display info of the order's items: the saved ones and those picked from the catalog since. */
export function itemInfo(full: OrderFull, picked: Map<string, ItemInfo>): Map<string, ItemInfo> {
  const m = new Map<string, ItemInfo>();
  for (const i of full.items) m.set(i.productionId, { title: i.title, chapter: i.chapter, code: i.code, contentId: i.contentId, contentTitle: i.contentTitle, catalogLengthFrames: i.catalogLengthFrames });
  for (const [k, v] of picked) if (!m.has(k)) m.set(k, v);
  return m;
}

export type ItemsById = Map<string, { item: OrderDraft['items'][number]; info: ItemInfo | undefined; position: number }>;

export function itemsById(d: OrderDraft, info: Map<string, ItemInfo>): ItemsById {
  return new Map(d.items.map((item, position) => [item.id, { item, info: info.get(item.productionId), position }]));
}

export const itemTitle = (items: ItemsById, id: string | undefined) => (id ? items.get(id)?.info?.title ?? 'Unknown item' : '');

/** The item a first airing shows (a repeat: its first airing's). */
export function airingTitle(a: AiringDraft, byId: Map<string, AiringDraft>, items: ItemsById): string {
  const src = a.repeatOfId ? byId.get(a.repeatOfId) : a;
  const its = src?.items ?? [];
  const i = a.repeatOfId ? its[a.repeatIndex] ?? its[0] : its[0];
  if (!i) return a.passes ? `${a.passes} plays` : '';
  return its.length > 1 && !a.repeatOfId ? `${itemTitle(items, i.itemId)} + ${its.length - 1} more` : itemTitle(items, i.itemId);
}

// ---------------------------------------------------------------- the week

export const weekDates = (ws: string) => Array.from({ length: 7 }, (_, i) => addDays(ws, i));

/** Days list "Sat–Thu" when consecutive, else "Sat Mon Wed" — in the channel's week order. */
export function daysText(dates: string[], weekStart: number): string {
  const idx = [...new Set(dates.map((d) => (weekdayOf(d) - weekStart + 7) % 7))].sort((a, b) => a - b);
  const name = (i: number) => WEEKDAYS[(i + weekStart) % 7].short;
  if (idx.length >= 3 && idx[idx.length - 1] - idx[0] === idx.length - 1) return `${name(idx[0])}–${name(idx[idx.length - 1])}`;
  return idx.map(name).join(' ');
}

export interface PatternRow {
  what: string;
  text: string;
}

/** Series: the week's first airings, regular repeats by day distance, other repeats (Order details). */
export function seriesPattern(airings: AiringDraft[], byId: Map<string, AiringDraft>, t: TimeCtx, ws: string, days: TemplateDay[]): PatternRow[] {
  const we = addDays(ws, 6);
  const inWeek = airings.filter((a) => a.date >= ws && a.date <= we);
  const firsts = inWeek.filter((a) => !isRepeat(a));
  const reps = inWeek.filter(isRepeat);
  if (!firsts.length && !reps.length) return [{ what: 'This week', text: 'No airings in this week' }];
  const start = (a: AiringDraft) => days[weekdayOf(a.date)]?.get(a.blockTypeId)?.startFrames ?? 0;
  const rows: PatternRow[] = [];
  const byClock = new Map<string, string[]>();
  for (const f of firsts.sort((a, b) => start(a) - start(b))) {
    const c = t.clock(start(f));
    byClock.set(c, [...(byClock.get(c) ?? []), f.date]);
  }
  for (const [c, ds] of byClock) rows.push({ what: 'First airings', text: `${daysText(ds, t.channel.weekStart)} · ${c}` });
  const groups = new Map<string, AiringDraft[]>();
  for (const r of reps) {
    const f = byId.get(r.repeatOfId!);
    if (!f) continue;
    const k = `${daysBetween(f.date, r.date)}|${start(r)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const regular = [...groups.entries()].filter(([, g]) => g.length >= 3).sort(([a], [b]) => {
    const [da, sa] = a.split('|').map(Number);
    const [db, sb] = b.split('|').map(Number);
    return da - db || sa - sb;
  });
  const other = [...groups.values()].filter((g) => g.length < 3).flat();
  const byDist = new Map<number, string[]>();
  for (const [k] of regular) {
    const [d, s] = k.split('|').map(Number);
    byDist.set(d, [...(byDist.get(d) ?? []), t.clock(s)]);
  }
  for (const [d, cs] of byDist) rows.push({ what: 'Repeats', text: `${d === 0 ? 'Same day' : d === 1 ? 'Next day' : `+${d} days`} ${cs.join(', ')}` });
  if (other.length) {
    const early = other.some((r) => (byId.get(r.repeatOfId!)?.date ?? ws) < ws);
    const wds = [...new Set(other.map((r) => WEEKDAYS[weekdayOf(r.date)].short))];
    rows.push({ what: 'Other repeats', text: `${other.length} on ${wds.join(', ')}${early ? ' (some replay last week)' : ''}` });
  }
  return rows;
}

/** What the order holds in one block (the side panel and the cells). */
export function cellOf(d: OrderDraft, channelId: string, date: string, blockTypeId: string): AiringDraft | undefined {
  return d.airings.find((a) => a.channelId === channelId && a.date === date && a.blockTypeId === blockTypeId);
}

/** Other orders' airings in a block (from the channel's week). */
export const othersIn = (week: WeekAiring[], orderId: string | null, date: string, blockTypeId: string) => week.filter((w) => w.orderId !== orderId && w.date === date && w.blockTypeId === blockTypeId);

export const programmeOf = (others: WeekAiring[]) => others.find((w) => isProgrammeMode(w.mode));

export function repeatText(r: AiringDraft, f: AiringDraft | undefined, ws: string): string {
  if (!f) return 'Repeat';
  const dd = daysBetween(f.date, r.date);
  const before = f.date < ws ? `last ${WEEKDAYS[weekdayOf(f.date)].short}` : WEEKDAYS[weekdayOf(f.date)].short;
  return `Repeat · first aired ${before}${dd > 0 ? '' : ''} · ${distanceText(dd)}`;
}

export function chapterLabel(items: ItemsById, itemId: string | undefined, count: number): string {
  if (!itemId) return '';
  const x = items.get(itemId);
  if (!x) return '';
  const n = x.info?.chapter ?? x.position + 1;
  return `episode ${n} of ${count}`;
}

export const SWATCHES = ['#0284c7', '#4f46e5', '#e11d48', '#d97706', '#059669', '#9333ea', '#0d9488', '#a1a1aa'];
