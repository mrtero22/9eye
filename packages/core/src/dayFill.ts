// Filling a day from what exists (docs/design/day-playlist-page.md, part 3): program placements of
// confirmed orders,
// each programme split across its block's linked breaks (§6c); the ads playlist's spots copied in
// under their linked breaks (§5.4); rotation lists in the time a block still has free (§7). Each step
// works on the draft of a day and says what it placed and, in plain words, why the rest was not.
// The steps and issues of a day (what is still to do) are read from the same draft.

import { takesTime } from './day';
import { removeRows, tidyDay, type DayDraft, type DraftBlock, type DraftRow } from './dayEdit';
import { framesPerDay, type FrameRate } from './timecode';
import { weekdayOf } from './week';

export type FillStep = 'programs' | 'breaks' | 'rotation' | 'commercials';
/** "all": take out what the step placed before, then place everything; "missing": only what is not there. */
export type FillMode = 'all' | 'missing';

export const FILL_STEP_LABEL: Record<FillStep, string> = { programs: 'Program placements', breaks: 'Break events', rotation: 'Rotation lists', commercials: 'Campaigns' };

export interface FillLine {
  title: string;
  block: string;
  /** Placed: what went in ("Harbor - Lumen Plus · 4 parts"). Not placed: why, in plain words. */
  detail: string;
  /** The length it adds (placed) or the gap it could not fill (rotation); null = none to show. */
  frames: number | null;
}

export interface FillReport {
  step: FillStep;
  placed: FillLine[];
  notPlaced: FillLine[];
  /** Already in the day and left as they are (mode "missing"). */
  kept: number;
  /** Rows taken out first (mode "all"). */
  removed: number;
  /** What the step leaves to others, said once ("2 airings of draft orders were left out"). */
  notes: string[];
}

export interface FillResult {
  draft: DayDraft;
  report: FillReport;
}

/** A part of a production that plays, in the catalog's frame rate. */
export interface FillSegment {
  /** null = the production has no segments: it plays whole. */
  id: string | null;
  tcInFrames: number;
  tcOutFrames: number;
  lengthFrames: number;
}

/** A production as rows: its kind (from its content type's family) and the segments it plays. */
export interface FillProduction {
  id: string;
  title: string;
  kind: string;
  /** In playing order; empty = nothing to place (no length in the catalog). */
  segments: FillSegment[];
}

const report = (step: FillStep): FillReport => ({ step, placed: [], notPlaced: [], kept: 0, removed: 0, notes: [] });
const parts = (n: number) => (n === 1 ? '1 part' : `${n} parts`);
const sum = (segs: FillSegment[]) => segs.reduce((n, s) => n + s.lengthFrames, 0);

function newRow(over: Partial<DraftRow> & Pick<DraftRow, 'id' | 'kind' | 'title'>): DraftRow {
  return {
    lengthFrames: 0,
    productionId: null,
    segmentId: null,
    tcInFrames: 0,
    tcOutFrames: 0,
    fixed: false,
    hold: false,
    autoAdjust: false,
    note: '',
    breakTypeId: null,
    relatedEventId: null,
    orderId: null,
    rotationListId: null,
    airingItemId: null,
    ...over,
  };
}

/** The rows a production plays as: one per segment. */
export function productionRows(p: FillProduction, newId: () => string, more: Partial<DraftRow> = {}): DraftRow[] {
  return p.segments.map((s) =>
    newRow({ id: newId(), kind: p.kind, title: p.title, productionId: p.id, segmentId: s.id, tcInFrames: s.tcInFrames, tcOutFrames: s.tcOutFrames, lengthFrames: s.lengthFrames, ...more }),
  );
}

/** Rows into a block: before a row, or at its end (before the gap compensator). */
function putRows(block: DraftBlock, beforeId: string | null, rows: DraftRow[]): DraftBlock {
  const gc = block.rows.findIndex((r) => r.kind === 'gap-compensator');
  let at = beforeId ? block.rows.findIndex((r) => r.id === beforeId) : -1;
  if (at < 0) at = gc >= 0 ? gc : block.rows.length;
  return { ...block, rows: [...block.rows.slice(0, at), ...rows, ...block.rows.slice(at)] };
}

const withBlock = (d: DayDraft, b: DraftBlock): DayDraft => ({ blocks: d.blocks.map((x) => (x.id === b.id ? b : x)) });

// ---------------------------------------------------------------- program placements (§6c)

export interface FillBlockInfo {
  id: string;
  name: string;
  /** The block begins with a break: that first break is not a split point. */
  opensWithBreak: boolean;
}

/** One airing of a confirmed order that this day should play. */
export interface ExpectedPlacement {
  airingId: string;
  orderId: string;
  orderName: string;
  /** null = this day has no block of the airing's block type. */
  blockId: string | null;
  blockName: string;
  repeat: boolean;
  /** In placing order: its items, each as often as the passes say. */
  productionIds: string[];
  /** For lists: the titles of those productions. */
  titles: string[];
}

/**
 * The productions an airing places, in order (a sequential order places its list once, any other
 * its passes number of times; a repeat plays the one item of its first airing it points at).
 */
export function airingProductions(
  mode: string,
  airing: { passes: number; productionIds: string[] },
  repeatOf: { productionIds: string[]; repeatIndex: number } | null,
): string[] {
  if (repeatOf) {
    const p = repeatOf.productionIds[repeatOf.repeatIndex] ?? repeatOf.productionIds[0];
    return p ? [p] : [];
  }
  const times = mode === 'series' ? 1 : Math.max(1, airing.passes);
  return Array.from({ length: times }, () => airing.productionIds).flat();
}

const LAST = null;

/**
 * Where a programme's segments go in its block: runs of linked breaks that are not right after a programme are
 * the slots; the slot that fits best takes the segments, segment i right before its i-th break.
 * Returns, per segment, the row it goes before (null = the end of the block).
 */
export function splitTargets(rows: DraftRow[], opensWithBreak: boolean, segments: number): (string | null)[] {
  const slots: (string | null)[][] = [];
  let run: (string | null)[] = [];
  let sawProgram = false;
  rows.forEach((r, i) => {
    if (r.kind === 'program') {
      sawProgram = true;
      if (run.length) {
        run.push(r.id);
        slots.push(run);
        run = [];
      }
    } else if (r.kind === 'linked-break') {
      if (sawProgram || (opensWithBreak && i === 0)) sawProgram = false;
      else run.push(r.id);
    }
  });
  if (run.length) {
    run.push(LAST);
    slots.push(run);
  }
  let chosen = slots[0] ?? [LAST];
  for (const c of slots) {
    const y = c.length - segments;
    if (y === 0) {
      chosen = c;
      break;
    }
    const d = chosen.length - segments;
    if (d > 0 && y > 0 && y < d) chosen = c;
    else if (d < 0 && y > 0) chosen = c;
    else if (d < 0 && y < 0 && c.length > chosen.length) chosen = c;
  }
  return Array.from({ length: segments }, (_, i) => {
    const t = chosen[i];
    if (t !== undefined && t !== LAST) return t;
    const last = chosen[chosen.length - 1];
    return t === undefined && last !== LAST && last !== undefined ? last : null;
  });
}

/** Puts one production in a block, split across its breaks. */
export function placeProduction(draft: DayDraft, block: FillBlockInfo, p: FillProduction, orderId: string | null, newId: () => string): DayDraft {
  const current = draft.blocks.find((b) => b.id === block.id);
  if (!current || !p.segments.length) return draft;
  const targets = splitTargets(current.rows, block.opensWithBreak, p.segments.length);
  const rows = productionRows(p, newId, { orderId });
  let b = current;
  rows.forEach((r, i) => (b = putRows(b, targets[i], [r])));
  return withBlock(draft, b);
}

/**
 * Import program placements: every airing of the day's confirmed programme orders, in its block,
 * each production split across the block's linked breaks.
 */
export function placePrograms(
  draft: DayDraft,
  blocks: FillBlockInfo[],
  expected: ExpectedPlacement[],
  productions: Map<string, FillProduction>,
  mode: FillMode,
  newId: () => string,
): FillResult {
  const out = report('programs');
  let d = draft;
  if (mode === 'all') {
    const ids = d.blocks.flatMap((b) => b.rows.filter((r) => r.orderId).map((r) => r.id));
    out.removed = ids.length;
    d = removeRows(d, ids);
  }
  for (const e of expected) {
    const block = e.blockId ? blocks.find((b) => b.id === e.blockId) : null;
    const titles = e.titles.join(', ') || e.orderName;
    if (!block) {
      out.notPlaced.push({ title: titles, block: e.blockName, detail: `This day has no block “${e.blockName}”: the week was made from another layout.`, frames: null });
      continue;
    }
    if (mode === 'missing' && d.blocks.find((b) => b.id === block.id)?.rows.some((r) => r.orderId === e.orderId)) {
      out.kept++;
      continue;
    }
    e.productionIds.forEach((id, i) => {
      const p = productions.get(id);
      if (!p) {
        out.notPlaced.push({ title: e.titles[i] ?? 'An item', block: block.name, detail: 'Its catalog item does not exist any more.', frames: null });
        return;
      }
      if (!p.segments.length) {
        out.notPlaced.push({ title: p.title, block: block.name, detail: 'It has no length in the catalog.', frames: null });
        return;
      }
      d = placeProduction(d, block, p, e.orderId, newId);
      out.placed.push({ title: p.title, block: block.name, detail: `${e.orderName} · ${parts(p.segments.length)}${e.repeat ? ' · repeat' : ''}`, frames: sum(p.segments) });
    });
  }
  return { draft: tidyDay(d), report: out };
}

// ---------------------------------------------------------------- break events (§5.4)

export interface BreakSpot {
  kind: string;
  title: string;
  lengthFrames: number;
  productionId: string | null;
  segmentId: string | null;
  tcInFrames: number;
  tcOutFrames: number;
}

/** A block of the day's ads playlist: the break a linked-break row names, with its spots in order. */
export interface AdsBreak {
  blockTypeId: string;
  name: string;
  spots: BreakSpot[];
}

const spotKey = (s: { kind: string; productionId: string | null; segmentId: string | null; lengthFrames: number; title: string }) =>
  `${s.kind}|${s.productionId ?? s.title}|${s.segmentId ?? ''}|${s.lengthFrames}`;

/** Do the spots under a linked break match its break in the ads playlist (same items, same order)? */
export function breakMatches(spots: DraftRow[], ads: AdsBreak): boolean {
  return spots.length === ads.spots.length && spots.every((s, i) => spotKey(s) === spotKey(ads.spots[i]));
}

/**
 * Import break events: the spots of each break of the day's ads playlist, copied in under the linked
 * break that names it. `ads` null = the ads playlist has no day here yet.
 */
export function fillBreaks(draft: DayDraft, blocks: { id: string; name: string }[], ads: AdsBreak[] | null, breakNames: Map<string, string>, mode: FillMode, newId: () => string): FillResult {
  const out = report('breaks');
  if (!ads) {
    out.notes.push('The ads playlist has no day here yet: create its week first.');
    return { draft, report: out };
  }
  const byType = new Map(ads.map((a) => [a.blockTypeId, a]));
  let d = draft;
  for (const info of blocks) {
    const breaks = d.blocks.find((b) => b.id === info.id)?.rows.filter((r) => r.kind === 'linked-break') ?? [];
    for (const br of breaks) {
      const src = br.breakTypeId ? byType.get(br.breakTypeId) : undefined;
      const name = src?.name ?? (br.breakTypeId ? breakNames.get(br.breakTypeId) : null) ?? 'Linked break';
      if (!src) {
        out.notPlaced.push({ title: name, block: info.name, detail: 'The ads playlist has no such break on this day.', frames: null });
        continue;
      }
      let b = d.blocks.find((x) => x.id === info.id)!;
      const existing = b.rows.filter((r) => r.relatedEventId === br.id);
      if (mode === 'missing' && existing.length) {
        out.kept++;
        continue;
      }
      out.removed += existing.length;
      const gone = new Set(existing.map((r) => r.id));
      b = { ...b, rows: b.rows.filter((r) => !gone.has(r.id)) };
      const at = b.rows.findIndex((r) => r.id === br.id) + 1;
      const copies = src.spots.map((s) => newRow({ id: newId(), ...s, relatedEventId: br.id }));
      b = { ...b, rows: [...b.rows.slice(0, at), ...copies, ...b.rows.slice(at)] };
      d = withBlock(d, b);
      const frames = src.spots.reduce((n, s) => n + s.lengthFrames, 0);
      out.placed.push({ title: name, block: info.name, detail: src.spots.length === 1 ? '1 spot' : src.spots.length ? `${src.spots.length} spots` : 'No spots in the ads playlist', frames });
    }
  }
  return { draft: tidyDay(d), report: out };
}

// ---------------------------------------------------------------- rotation lists (§7)

export interface RotationItem {
  position: number;
  productionId: string;
  /** The segments of the item's segmentation (or the production's first one). */
  segments: FillSegment[];
  /** The broadcast day it was last put in a playlist ("YYYY-MM-DD"), null = never. */
  insertedAt: string | null;
}

export interface RotationList {
  id: string;
  name: string;
  /** By position. */
  items: RotationItem[];
  /** Position of the last item put in; the rotation resumes after it. */
  lastItemPosition: number | null;
  insertionDaysInterval: number;
  allowSameDayRepeat: boolean;
  randomInsert: boolean;
  applyChannelRestrictions: boolean;
}

/** A time window range on a weekday (0 = Sunday), as a time of day in frames. */
export interface WindowRange {
  weekday: number;
  startFrames: number;
  lengthFrames: number;
}

export interface RotationProduction {
  id: string;
  title: string;
  kind: string;
  /** First and last day it may air ("YYYY-MM-DD"); null = no limit. */
  starts: string | null;
  expires: string | null;
  /** Empty = every channel. */
  channelIds: string[];
  windows: { allowed: WindowRange[]; rejected: WindowRange[] };
}

export interface RotationBlock {
  id: string;
  name: string;
  /** null = no rotation list set for this block. */
  listId: string | null;
  /** Offset from the broadcast-day start. */
  plannedStartFrames: number;
  plannedLengthFrames: number;
}

export interface RotationContext {
  /** The broadcast day. */
  date: string;
  channelId: string;
  dayStartFrames: number;
  rate: FrameRate;
  /** For lists that insert at random; Math.random when not given. */
  random?: () => number;
}

export interface RotationFillResult extends FillResult {
  /** Where each list used stands now: the position of the last item put in. */
  lastItems: { listId: string; position: number | null }[];
}

function daysApart(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));
}

/** Does a block sit inside a production's time windows (allowed ones if any, never a rejected one)? */
export function inTimeWindows(w: RotationProduction['windows'], block: Pick<RotationBlock, 'plannedStartFrames' | 'plannedLengthFrames'>, ctx: Pick<RotationContext, 'date' | 'dayStartFrames' | 'rate'>): boolean {
  if (!w.allowed.length && !w.rejected.length) return true;
  const perDay = framesPerDay(ctx.rate);
  const abs = ctx.dayStartFrames + block.plannedStartFrames;
  const dayIndex = Math.floor(abs / perDay);
  const at = abs - dayIndex * perDay;
  const weekday = (weekdayOf(ctx.date) + dayIndex) % 7;
  const hit = (r: WindowRange) => r.weekday === weekday && at < r.startFrames + r.lengthFrames && r.startFrames < at + block.plannedLengthFrames;
  if (w.rejected.some(hit)) return false;
  return !w.allowed.length || w.allowed.some(hit);
}

/** The five gates an item passes before it goes in. */
function mayInsert(list: RotationList, item: RotationItem, p: RotationProduction | undefined, present: Set<string>, block: RotationBlock, ctx: RotationContext): boolean {
  if (!p) return false;
  if (!list.allowSameDayRepeat) {
    if (present.has(p.id)) return false;
    if (list.insertionDaysInterval > 0 && item.insertedAt && daysApart(ctx.date, item.insertedAt) <= list.insertionDaysInterval) return false;
  }
  if (p.expires && !(ctx.date < p.expires)) return false;
  if (p.starts && ctx.date < p.starts) return false;
  if (list.applyChannelRestrictions && p.channelIds.length && !p.channelIds.includes(ctx.channelId)) return false;
  return inTimeWindows(p.windows, block, ctx);
}

function shuffle<T>(xs: T[], random: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Import rotation lists (fill gaps): in block order, the time each block still has free is filled
 * from its rotation list, walking the list from where it left off and taking every item that fits.
 * A block's length counts in whole seconds; a main block's
 * length is a target, so the free time is the planned length minus what its rows play.
 */
export function fillRotation(
  draft: DayDraft,
  blocks: RotationBlock[],
  lists: Map<string, RotationList>,
  productions: Map<string, RotationProduction>,
  ctx: RotationContext,
  mode: FillMode,
  newId: () => string,
): RotationFillResult {
  const out = report('rotation');
  const random = ctx.random ?? Math.random;
  const second = ctx.rate.nominal;
  let d = draft;
  if (mode === 'all') {
    const want = new Set(blocks.map((b) => b.id));
    const ids = d.blocks.filter((b) => want.has(b.id)).flatMap((b) => b.rows.filter((r) => r.rotationListId).map((r) => r.id));
    out.removed = ids.length;
    d = removeRows(d, ids);
  }
  const last = new Map<string, number | null>();
  for (const block of blocks) {
    const current = d.blocks.find((b) => b.id === block.id);
    if (!current) continue;
    const list = block.listId ? lists.get(block.listId) : undefined;
    if (!list) {
      out.notPlaced.push({ title: 'No rotation list', block: block.name, detail: block.listId ? 'Its rotation list does not exist any more.' : 'No rotation list is set for this block.', frames: null });
      continue;
    }
    const playing = current.rows.reduce((n, r) => n + (takesTime(r.kind) ? r.lengthFrames : 0), 0);
    let gap = block.plannedLengthFrames - (block.plannedLengthFrames % second) - playing;
    if (gap < second) continue;
    const startGap = gap;
    if (!last.has(list.id)) last.set(list.id, list.lastItemPosition);
    const items = list.randomInsert ? shuffle(list.items, random) : list.items;
    const present = new Set(d.blocks.flatMap((b) => b.rows.filter((r) => r.rotationListId === list.id && r.productionId).map((r) => r.productionId!)));
    const added: DraftRow[] = [];
    let count = 0;
    for (let round = 0; round < 1000 && items.length; round++) {
      const at = items.findIndex((i) => i.position === last.get(list.id));
      const start = at >= 0 && at < items.length - 1 ? at + 1 : 0;
      const tried: number[] = [];
      for (let u = 0; u < items.length; u++) {
        const item = items[(start + u) % items.length];
        const length = sum(item.segments);
        const p = productions.get(item.productionId);
        if (length < second || !mayInsert(list, item, p, present, block, ctx)) continue;
        tried.push(length);
        if (length <= gap) {
          added.push(...productionRows({ id: p!.id, title: p!.title, kind: p!.kind, segments: item.segments }, newId, { rotationListId: list.id }));
          count++;
          gap -= length;
          present.add(p!.id);
          last.set(list.id, items.find((i) => i.productionId === item.productionId)!.position);
        }
      }
      if (!(gap > 0 && tried.some((t) => t <= gap))) break;
    }
    if (added.length) {
      d = withBlock(d, putRows(d.blocks.find((b) => b.id === block.id)!, null, added));
      out.placed.push({ title: list.name, block: block.name, detail: count === 1 ? '1 item' : `${count} items`, frames: startGap - gap });
    } else {
      out.notPlaced.push({ title: list.name, block: block.name, detail: 'Nothing in the list fits the gap or may go in here (already in the day, its dates, channels or time windows).', frames: startGap });
    }
  }
  return { draft: tidyDay(d), report: out, lastItems: [...last].map(([listId, position]) => ({ listId, position })) };
}

// ---------------------------------------------------------------- commercial orders (§6)

/** A booked spot of a confirmed commercial order airing on the day (an airing item). */
export interface BookedSpot {
  id: string;
  orderId: string;
  orderName: string;
  /** The ad break it is booked into: an ads-playlist block type. */
  breakTypeId: string;
  breakName: string;
  /** The spot, played whole (its segments, or none when it has no length). */
  production: FillProduction;
  /** Its break position's order (1 = first in the break); the default position's when it has none. */
  positionOrder: number;
  positionName: string;
  passes: number;
}

/** An ads-playlist block of the day: one ad break. */
export interface AdsDayBlock {
  id: string;
  name: string;
  blockTypeId: string;
  /** What its rows may fill. */
  lengthFrames: number;
}

export interface CommercialsContext {
  /** Break-position order of booked spots already in the day (rows of other runs or by hand). */
  orderOfSpot: Map<string, number>;
  /** The order of a row that is not a booked spot (it falls back to the default position). */
  defaultOrder: number;
  random?: () => number;
}

type Reject = 'no-break' | 'full' | 'same' | 'position' | 'length';
const REJECT_TEXT: Record<Reject, string> = {
  'no-break': 'The ads playlist has no such break on this day.',
  full: 'The break has no room left for it.',
  same: 'It would air right after itself.',
  position: 'Its break position does not fit the order of the spots already there.',
  length: 'It has no length in the catalog.',
};

/** May a spot of position order `o` go into gap `p` (before `orders[p]`) and keep the break in order? */
export function fitsPosition(orders: number[], p: number, o: number): boolean {
  const n = orders.length;
  if (!n) return true;
  if (p === 0) return o <= orders[0];
  if (p >= n) return o >= orders[n - 1];
  return orders[p - 1] <= o && o <= orders[p];
}

/**
 * Import commercials (automatic placement of booked spots): every booked spot of the
 * day's confirmed commercial orders goes into an ads-playlist block of its ad break, once per pass,
 * while the block has room, never right next to the same spot, keeping the spots in break-position
 * order (1 first). Spots, blocks and gaps are tried in random order, and the whole pass repeats until
 * it places nothing more; the reason reported for a spot is the first one met.
 */
export function fillCommercials(draft: DayDraft, blocks: AdsDayBlock[], spots: BookedSpot[], ctx: CommercialsContext, mode: FillMode, newId: () => string): FillResult {
  const out = report('commercials');
  const random = ctx.random ?? Math.random;
  let d = draft;
  const want = new Set(blocks.map((b) => b.id));
  if (mode === 'all') {
    const ids = d.blocks.filter((b) => want.has(b.id)).flatMap((b) => b.rows.filter((r) => r.airingItemId).map((r) => r.id));
    out.removed = ids.length;
    d = removeRows(d, ids);
  }
  const byId = new Map(spots.map((s) => [s.id, s]));
  const already = new Map<string, number>();
  for (const b of d.blocks) for (const r of b.rows) if (r.airingItemId) already.set(r.airingItemId, (already.get(r.airingItemId) ?? 0) + 1);
  const left = new Map(spots.map((s) => [s.id, Math.max(0, s.passes - (already.get(s.id) ?? 0))]));
  out.kept = spots.reduce((n, s) => n + Math.min(s.passes, already.get(s.id) ?? 0), 0);
  const orderOf = (r: DraftRow) => (r.airingItemId ? (byId.get(r.airingItemId)?.positionOrder ?? ctx.orderOfSpot.get(r.airingItemId) ?? ctx.defaultOrder) : ctx.defaultOrder);
  const byType = new Map<string, AdsDayBlock[]>();
  for (const b of blocks) byType.set(b.blockTypeId, [...(byType.get(b.blockTypeId) ?? []), b]);
  const errors = new Map<string, Reject>();
  const into = new Map<string, AdsDayBlock[]>();
  const fail = (s: BookedSpot, e: Reject) => {
    if (!errors.has(s.id)) errors.set(s.id, e);
  };

  for (let round = 0; round < 1000; round++) {
    let changed = false;
    for (const s of shuffle(spots, random)) {
      if (!((left.get(s.id) ?? 0) > 0)) continue;
      const length = sum(s.production.segments);
      if (!length) {
        fail(s, 'length');
        continue;
      }
      const candidates = shuffle(byType.get(s.breakTypeId) ?? [], random);
      if (!candidates.length) {
        fail(s, 'no-break');
        continue;
      }
      let local: Reject | null = null;
      let done = false;
      for (const b of candidates) {
        const block = d.blocks.find((x) => x.id === b.id);
        if (!block) continue;
        const events = block.rows.filter((r) => r.kind !== 'gap-compensator' && takesTime(r.kind));
        if (events.reduce((n, r) => n + r.lengthFrames, 0) + length > b.lengthFrames) {
          local = 'full';
          continue;
        }
        const orders = events.map(orderOf);
        let err: Reject | null = null;
        let at = -1;
        for (const p of shuffle(Array.from({ length: events.length + 1 }, (_, i) => i), random)) {
          if (events[p]?.productionId === s.production.id || events[p - 1]?.productionId === s.production.id) {
            err = 'same';
            continue;
          }
          if (!fitsPosition(orders, p, s.positionOrder)) {
            err = 'position';
            continue;
          }
          at = p;
          break;
        }
        if (at < 0) {
          local = err ?? 'position';
          continue;
        }
        const rows = productionRows(s.production, newId, { orderId: s.orderId, airingItemId: s.id });
        d = withBlock(d, putRows(block, at < events.length ? events[at].id : null, rows));
        left.set(s.id, (left.get(s.id) ?? 0) - 1);
        into.set(s.id, [...(into.get(s.id) ?? []), b]);
        changed = done = true;
        break;
      }
      if (!done && local) fail(s, local);
    }
    if (!changed) break;
  }

  // the report reads like the day: by break time, then break position, then title
  const rank = new Map(blocks.map((b, i) => [b.id, i]));
  const firstAt = (s: BookedSpot) => Math.min(...(into.get(s.id) ?? byType.get(s.breakTypeId) ?? []).map((b) => rank.get(b.id) ?? Infinity), Infinity);
  const sorted = [...spots].sort((a, b) => firstAt(a) - firstAt(b) || a.positionOrder - b.positionOrder || a.production.title.localeCompare(b.production.title));
  for (const s of sorted) {
    const placedIn = [...(into.get(s.id) ?? [])].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    const names = placedIn.map((b) => b.name);
    const length = sum(s.production.segments);
    if (names.length) {
      out.placed.push({ title: s.production.title, block: [...new Set(names)].join(', '), detail: `${s.orderName} · ${s.positionName}${names.length > 1 ? ` · ${names.length} plays` : ''}`, frames: length * names.length });
    }
    const missing = left.get(s.id) ?? 0;
    if (missing > 0) {
      const done = s.passes - missing;
      out.notPlaced.push({
        title: s.production.title,
        block: s.breakName,
        detail: `${REJECT_TEXT[errors.get(s.id) ?? 'full']}${done ? ` ${done} of ${s.passes} plays placed.` : ''} ${s.orderName}.`,
        frames: length || null,
      });
    }
  }
  return { draft: tidyDay(d), report: out };
}

// ---------------------------------------------------------------- steps and issues of a day

export type StepTone = 'none' | 'todo' | 'partial' | 'done';

export interface DayStep {
  step: FillStep;
  label: string;
  tone: StepTone;
  /** "8 of 12 placed" */
  text: string;
  /** The step has put rows in this day before (running it again asks what to do with them). */
  ran: boolean;
  /** null = it can run; else why not. */
  why: string | null;
}

export interface DayIssue {
  key: string;
  text: string;
  tone: 'amber' | 'red';
  /** The step that resolves it, if one does. */
  step: FillStep | null;
}

export interface DayCheckInput {
  isMain: boolean;
  /** The channel has an ads playlist. */
  hasAds: boolean;
  placements: ExpectedPlacement[];
  /** null = the ads playlist has no day here yet. */
  adsBreaks: AdsBreak[] | null;
  /** Blocks that fill their gaps from a rotation list, with their gap now (planned − real, ≥ 0). */
  fillBlocks: { id: string; listId: string | null; gapFrames: number }[];
  /** Frames in a second (whole seconds count as a gap). */
  second: number;
  notReady: number;
  /** Ads playlist: the booked spots of the day's confirmed commercial orders (undefined on main). */
  booked?: { id: string; passes: number }[];
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** What is still to do on a day: the state of each step and the issues, read from the draft. */
export function dayChecks(draft: DayDraft, input: DayCheckInput): { steps: DayStep[]; issues: DayIssue[] } {
  const steps: DayStep[] = [];
  const issues: DayIssue[] = [];
  const rows = draft.blocks.flatMap((b) => b.rows.map((r) => ({ r, blockId: b.id })));

  if (input.isMain) {
    const inDay = (e: ExpectedPlacement) => !!e.blockId && rows.some((x) => x.blockId === e.blockId && x.r.orderId === e.orderId);
    const placeable = input.placements.filter((e) => e.blockId);
    const placed = placeable.filter(inDay).length;
    const ran = rows.some((x) => x.r.orderId);
    const total = placeable.length;
    steps.push({
      step: 'programs',
      label: FILL_STEP_LABEL.programs,
      tone: !total ? 'none' : placed === total ? 'done' : placed ? 'partial' : 'todo',
      text: !total ? 'No confirmed programme plans air on this day' : placed === total ? (total === 1 ? 'Placed' : `All ${total} placed`) : placed ? `${placed} of ${total} placed` : `${n(total, 'airing')} to place`,
      ran,
      why: total || ran ? null : 'Nothing to place',
    });
    if (total > placed) issues.push({ key: 'programs-missing', text: `${n(total - placed, 'airing')} of confirmed plans ${total - placed === 1 ? 'is' : 'are'} not in the day`, tone: 'amber', step: 'programs' });
    const noBlock = input.placements.length - total;
    if (noBlock) issues.push({ key: 'programs-no-block', text: `${n(noBlock, 'airing')} ${noBlock === 1 ? 'names a block' : 'name blocks'} this day does not have`, tone: 'red', step: null });
    const stale = rows.filter((x) => x.r.orderId && !input.placements.some((e) => e.orderId === x.r.orderId && e.blockId === x.blockId)).length;
    if (stale) issues.push({ key: 'programs-stale', text: `${n(stale, 'row')} ${stale === 1 ? 'comes' : 'come'} from plans that no longer place ${stale === 1 ? 'it' : 'them'} there`, tone: 'amber', step: 'programs' });

    if (input.hasAds) {
      const breaks = rows.filter((x) => x.r.kind === 'linked-break');
      const ranB = rows.some((x) => x.r.relatedEventId);
      if (!input.adsBreaks) {
        steps.push({ step: 'breaks', label: FILL_STEP_LABEL.breaks, tone: 'none', text: 'The ads playlist has no day here yet', ran: ranB, why: 'Create the week of the ads playlist first' });
      } else if (!breaks.length) {
        steps.push({ step: 'breaks', label: FILL_STEP_LABEL.breaks, tone: 'none', text: 'No linked breaks in this day', ran: ranB, why: 'No linked breaks in this day' });
      } else {
        const byType = new Map(input.adsBreaks.map((a) => [a.blockTypeId, a]));
        let match = 0;
        let differ = 0;
        let missing = 0;
        for (const x of breaks) {
          const src = x.r.breakTypeId ? byType.get(x.r.breakTypeId) : undefined;
          if (!src) {
            missing++;
            continue;
          }
          const spots = rows.filter((y) => y.r.relatedEventId === x.r.id).map((y) => y.r);
          if (breakMatches(spots, src)) match++;
          else differ++;
        }
        const linked = match + differ;
        const spots = input.adsBreaks.reduce((k, a) => k + a.spots.length, 0);
        steps.push({
          step: 'breaks',
          label: FILL_STEP_LABEL.breaks,
          tone: !spots && !ranB ? 'none' : !differ ? 'done' : match && ranB ? 'partial' : 'todo',
          text: !spots && !ranB ? 'No spots in the ads playlist yet' : !differ ? (linked === 1 ? 'The linked break matches the ads playlist' : `All ${linked} linked breaks match the ads playlist`) : ranB ? `${differ} of ${n(linked, 'break')} differ from the ads playlist` : `${n(differ, 'break')} to fill`,
          ran: ranB,
          why: null,
        });
        if (differ) issues.push({ key: 'breaks-differ', text: `${n(differ, 'linked break')} ${differ === 1 ? 'differs' : 'differ'} from the ads playlist`, tone: 'amber', step: 'breaks' });
        if (missing) issues.push({ key: 'breaks-missing', text: `${n(missing, 'linked break')} ${missing === 1 ? 'has' : 'have'} no break in the ads playlist`, tone: 'red', step: null });
      }
    }
  }

  if (!input.isMain && input.booked) {
    const passes = new Map(input.booked.map((b) => [b.id, b.passes]));
    const inDay = new Map<string, number>();
    for (const x of rows) if (x.r.airingItemId) inDay.set(x.r.airingItemId, (inDay.get(x.r.airingItemId) ?? 0) + 1);
    const total = input.booked.reduce((k, b) => k + b.passes, 0);
    const placed = input.booked.reduce((k, b) => k + Math.min(b.passes, inDay.get(b.id) ?? 0), 0);
    const ranC = rows.some((x) => x.r.airingItemId);
    steps.push({
      step: 'commercials',
      label: FILL_STEP_LABEL.commercials,
      tone: !total ? 'none' : placed === total ? 'done' : placed ? 'partial' : 'todo',
      text: !total ? 'No confirmed campaigns book this day' : placed === total ? (total === 1 ? 'Placed' : `All ${total} placed`) : placed ? `${placed} of ${n(total, 'spot')} placed` : `${n(total, 'spot')} to place`,
      ran: ranC,
      why: total || ranC ? null : 'Nothing to place',
    });
    if (total > placed) issues.push({ key: 'commercials-missing', text: `${n(total - placed, 'booked spot')} ${total - placed === 1 ? 'is' : 'are'} not in the ads playlist`, tone: 'amber', step: 'commercials' });
    // a row of a booked spot that is gone, or one pass too many
    let stale = rows.filter((x) => x.r.orderId && !x.r.airingItemId).length;
    for (const [id, k] of inDay) stale += Math.max(0, k - (passes.get(id) ?? 0));
    if (stale) issues.push({ key: 'commercials-stale', text: `${n(stale, 'spot')} in the ads playlist ${stale === 1 ? 'is' : 'are'} no longer booked`, tone: 'amber', step: 'commercials' });
  }

  const ranR = rows.some((x) => x.r.rotationListId);
  if (!input.fillBlocks.length) {
    steps.push({ step: 'rotation', label: FILL_STEP_LABEL.rotation, tone: 'none', text: 'No block fills its gaps from a rotation list', ran: ranR, why: ranR ? null : 'No block fills its gaps' });
  } else {
    const short = input.fillBlocks.filter((b) => b.gapFrames >= input.second).length;
    steps.push({
      step: 'rotation',
      label: FILL_STEP_LABEL.rotation,
      tone: !short ? (ranR ? 'done' : 'none') : ranR ? 'partial' : 'todo',
      text: !short ? 'No gaps left to fill' : ranR ? `${n(short, 'block')} still ${short === 1 ? 'has a gap' : 'have gaps'}` : `${n(short, 'block')} ${short === 1 ? 'has a gap' : 'have gaps'}`,
      ran: ranR,
      why: null,
    });
    if (short) issues.push({ key: 'rotation-gaps', text: `${n(short, 'block')} ${short === 1 ? 'has a gap' : 'have gaps'} to fill`, tone: 'amber', step: 'rotation' });
  }
  if (input.notReady) issues.push({ key: 'media', text: `${n(input.notReady, 'row')}: media not ready`, tone: 'amber', step: null });
  return { steps, issues };
}
