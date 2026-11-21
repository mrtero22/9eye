// Everything the Templates page derives from the loaded data: the channel's time, the block types,
// the ads days behind linked breaks, labels.

import {
  WEEKDAYS,
  clockFrames,
  formatClockShort,
  formatLength,
  formatTc,
  frameRate,
  framesPerDay,
  framesPerHour,
  offsetFromClock,
  parseTc,
  weekOrder,
  type AdsBlock,
  type AdsDays,
  type BlockDraft,
  type FrameRate,
  type RuleContext,
  type TemplateDraft,
  typeInDates,
} from '@9eye/core';
import type { BlockGroup, BlockType, Channel, PlaylistKind, TemplateFull } from '@/lib/types';

export interface PageCtx {
  channel: Channel;
  rate: FrameRate;
  fph: number;
  dayFrames: number;
  kind: PlaylistKind;
  hasAds: boolean;
  /** Main template of a channel with an ads playlist. */
  allowsBreaks: boolean;
  types: Map<string, BlockType>;
  groups: Map<string, BlockGroup>;
  adsDays: AdsDays;
  rule: RuleContext;
  order: number[];
}

const NO_ADS: AdsDays = [[], [], [], [], [], [], []];

export function buildCtx(full: TemplateFull, types: BlockType[], groups: BlockGroup[]): PageCtx {
  const rate = frameRate(full.channel.frameRate);
  const typeMap = new Map(types.map((t) => [t.id, t]));
  const hasAds = !!full.channel.adsPlaylistId;
  const allowsBreaks = full.template.kind === 'main' && hasAds;
  return {
    channel: full.channel,
    rate,
    fph: framesPerHour(rate),
    dayFrames: framesPerDay(rate),
    kind: full.template.kind,
    hasAds,
    allowsBreaks,
    types: typeMap,
    groups: new Map(groups.map((g) => [g.id, g])),
    adsDays: full.ads?.days ?? NO_ADS,
    rule: {
      channel: { frameRate: full.channel.frameRate, dayStartFrames: full.channel.dayStartFrames, weekStart: full.channel.weekStart },
      blockTypes: typeMap,
      allowsBreaks,
    },
    order: weekOrder(full.channel.weekStart),
  };
}

export function toDraft(full: TemplateFull): TemplateDraft {
  const { name, validFrom, validTo, activeWeekdays } = full.template;
  return { name, validFrom, validTo, activeWeekdays, blocks: full.blocks };
}

/** "06:00" (with seconds / frames only when needed) */
export const clock = (ctx: PageCtx, offset: number) => formatClockShort(offset, ctx.channel.dayStartFrames, ctx.rate);
/** "06:00–06:30" */
export const range = (ctx: PageCtx, b: Pick<BlockDraft, 'startFrames' | 'lengthFrames'>) => `${clock(ctx, b.startFrames)}–${clock(ctx, b.startFrames + b.lengthFrames)}`;
/** Full timecode of a time of day: "06:00:00:00" / "06:00:00;00" */
export const clockTc = (ctx: PageCtx, offset: number) => formatTc(clockFrames(offset, ctx.channel.dayStartFrames, ctx.rate), ctx.rate);
export const lengthTc = (ctx: PageCtx, frames: number) => formatTc(frames, ctx.rate);
export const lengthWords = (ctx: PageCtx, frames: number) => formatLength(frames, ctx.rate);

export function parseClock(ctx: PageCtx, text: string): number | null {
  const f = parseTc(text, ctx.rate, { maxHours: 23 });
  return f === null ? null : offsetFromClock(f, ctx.channel.dayStartFrames, ctx.rate);
}

export function parseLength(ctx: PageCtx, text: string): number | null {
  const f = parseTc(text, ctx.rate, { maxHours: 24 });
  return f === null || f <= 0 ? null : f;
}

export const dayName = (d: number) => WEEKDAYS[d].long;

export const typeName = (ctx: PageCtx, id: string) => ctx.types.get(id)?.name ?? 'Unknown block type';
export const typeColor = (ctx: PageCtx, id: string) => ctx.types.get(id)?.color ?? null;
export function groupOf(ctx: PageCtx, typeId: string): BlockGroup | undefined {
  const t = ctx.types.get(typeId);
  return t ? ctx.groups.get(t.groupId) : undefined;
}
export const groupColor = (ctx: PageCtx, g: BlockGroup, fallback: string | null) => g.color ?? fallback;

/** The ads-template block a linked break means on that weekday. */
export function adsBlockFor(ctx: PageCtx, weekday: number, typeId: string): AdsBlock | undefined {
  return ctx.adsDays[weekday]?.find((a) => a.blockTypeId === typeId);
}

/** Start of the clock hour that contains an offset, as an offset. */
export function hourFloor(ctx: PageCtx, offset: number): number {
  const c = clockFrames(offset, ctx.channel.dayStartFrames, ctx.rate);
  const floored = c - (c % ctx.fph);
  const off = offsetFromClock(floored, ctx.channel.dayStartFrames, ctx.rate);
  return off > offset ? off - ctx.dayFrames : off;
}

/** "Saturday", "Sat–Wed", "Sat, Mon" for a set of weekdays in the channel's week order. */
export function dayRun(ctx: PageCtx, days: number[]): string {
  const idx = days.map((d) => ctx.order.indexOf(d)).sort((a, b) => a - b);
  if (idx.length === 1) return WEEKDAYS[ctx.order[idx[0]]].short;
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (contiguous) return `${WEEKDAYS[ctx.order[idx[0]]].short}–${WEEKDAYS[ctx.order[idx[idx.length - 1]]].short}`;
  return idx.map((i) => WEEKDAYS[ctx.order[i]].short).join(', ');
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function usage(validFrom: string, validTo: string): { label: string; tone: 'green' | 'neutral' } {
  const t = todayIso();
  if (t < validFrom) return { label: 'Upcoming', tone: 'neutral' };
  if (t > validTo) return { label: 'Ended', tone: 'neutral' };
  return { label: 'In use', tone: 'green' };
}

/** What is being dragged onto the week grid: an existing block, or a block type from the library. */
export type DragSource =
  | { kind: 'move'; blockId: string; grab: number }
  /** `breaks`: positions of a break list to apply (Add block panel), null for none. */
  | { kind: 'new'; typeId: string; breaks?: number[] | null };

/** A block type armed for placing by clicking on the grid, with the break list to apply (Add block). */
export interface Placing {
  typeId: string;
  breaks: number[] | null;
}

const NUMBERED = /^(.*?)\s*(\d+)$/;

/**
 * The numbered series a block type belongs to ("1H RUN 1", "1H RUN 2", …): same group, same kind,
 * same name before the number. A type without a number is a series of one.
 */
export function seriesOf(ctx: PageCtx, t: BlockType): { base: string; types: BlockType[] } {
  const m = NUMBERED.exec(t.name);
  if (!m) return { base: t.name, types: [t] };
  const types = [...ctx.types.values()]
    .filter((x) => x.groupId === t.groupId && x.kind === t.kind && NUMBERED.exec(x.name)?.[1] === m[1])
    .sort((a, b) => Number(NUMBERED.exec(a.name)![2]) - Number(NUMBERED.exec(b.name)![2]));
  return { base: m[1], types };
}

/** The type a click places on a weekday: the armed one, or the next of its series not used that day yet. */
export function nextOfSeries(ctx: PageCtx, draft: TemplateDraft, t: BlockType, weekday: number): BlockType | null {
  const { types } = seriesOf(ctx, t);
  const used = new Set(draft.blocks.filter((b) => b.weekday === weekday).map((b) => b.blockTypeId));
  const i = Math.max(0, types.findIndex((x) => x.id === t.id));
  const ordered = [...types.slice(i), ...types.slice(0, i)];
  return ordered.find((x) => !used.has(x.id) && x.validWeekdays[weekday] && typeInDates(x, draft.validFrom, draft.validTo)) ?? null;
}

/** "1H RUN (1–6)" or the type's own name. */
export function seriesLabel(ctx: PageCtx, t: BlockType): string {
  const { base, types } = seriesOf(ctx, t);
  if (types.length < 2) return t.name;
  const nums = types.map((x) => NUMBERED.exec(x.name)![2]);
  return `${base} (${nums[0]}–${nums[nums.length - 1]})`;
}
