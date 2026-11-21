// Templates: the weekly pattern of blocks of one channel playlist (data model §5).
// The same rules run in the browser (instant feedback) and in the API (on save).

import { formatClockShort, frameRate, framesPerDay, type FrameRate } from './timecode';
import { WEEKDAYS, isIsoDate, lastWeekday, weekdayOf } from './week';

export interface ChannelTime {
  frameRate: string;
  dayStartFrames: number;
  /** First weekday of the channel's week, 0 = Sunday … 6 = Saturday. */
  weekStart: number;
}

export interface BlockTypeInfo {
  id: string;
  name: string;
  groupId: string;
  color: string;
  lengthFrames: number;
  /** Index = weekday (0 = Sunday). */
  validWeekdays: boolean[];
  validFrom: string;
  validTo: string;
  playlistId: string;
}

export interface BlockDraft {
  id: string;
  weekday: number;
  blockTypeId: string;
  startFrames: number;
  lengthFrames: number;
  fillGaps: boolean;
  opensWithBreak: boolean;
  note: string;
  rotationListId: string | null;
  limitsPerContentType: unknown[];
  /** Linked breaks in order: block type ids of ads-template blocks (main templates only). */
  breaks: string[];
}

export interface TemplateDraft {
  name: string;
  validFrom: string;
  validTo: string;
  /** Index = weekday (0 = Sunday). */
  activeWeekdays: boolean[];
  blocks: BlockDraft[];
}

/** A block of the ads template on one weekday — what a linked break points at. */
export interface AdsBlock {
  blockTypeId: string;
  startFrames: number;
  lengthFrames: number;
}

/** Index = weekday; each list sorted by start. */
export type AdsDays = AdsBlock[][];

export type ProblemCode =
  | 'name'
  | 'dates'
  | 'active-days'
  | 'unknown-block-type'
  | 'length'
  | 'outside-day'
  | 'weekday'
  | 'type-twice'
  | 'overlap'
  | 'break-twice'
  | 'no-breaks'
  | 'not-a-break'
  | 'weekday-number'
  | 'break-list';

export interface Problem {
  code: ProblemCode;
  message: string;
  blockId?: string;
  weekday?: number;
}

export type BlockTypeLookup = Map<string, BlockTypeInfo>;

export interface RuleContext {
  channel: ChannelTime;
  blockTypes: BlockTypeLookup;
  /** Main template of a channel that has an ads playlist: the only kind with linked breaks. */
  allowsBreaks: boolean;
  /** When given, every linked break must be one of these (block types of ads playlists). */
  breakTypeIds?: Set<string>;
}

export const TEMPLATE_NAME_MAX = 50;

export function rateOf(channel: ChannelTime): FrameRate {
  return frameRate(channel.frameRate);
}

export function endOf(b: Pick<BlockDraft, 'startFrames' | 'lengthFrames'>): number {
  return b.startFrames + b.lengthFrames;
}

/** "Saturday 07:00" */
export function blockLabel(b: Pick<BlockDraft, 'weekday' | 'startFrames'>, channel: ChannelTime): string {
  return `${WEEKDAYS[b.weekday]?.long ?? '?'} ${formatClockShort(b.startFrames, channel.dayStartFrames, rateOf(channel))}`;
}

export function blocksOfDay<T extends Pick<BlockDraft, 'weekday' | 'startFrames'>>(blocks: T[], weekday: number): T[] {
  return blocks.filter((b) => b.weekday === weekday).sort((a, b) => a.startFrames - b.startFrames);
}

export function overlaps(a: Pick<BlockDraft, 'startFrames' | 'lengthFrames'>, b: Pick<BlockDraft, 'startFrames' | 'lengthFrames'>): boolean {
  return a.startFrames < endOf(b) && b.startFrames < endOf(a);
}

/**
 * Problems of one block against the other blocks of the template (the block itself may be in the
 * list; it is skipped by id).
 */
export function checkBlock(block: BlockDraft, blocks: BlockDraft[], ctx: RuleContext): Problem[] {
  const out: Problem[] = [];
  const label = blockLabel(block, ctx.channel);
  const at = { blockId: block.id, weekday: block.weekday };
  if (!Number.isInteger(block.weekday) || block.weekday < 0 || block.weekday > 6) {
    return [{ code: 'weekday-number', message: `Block ${block.id} has no valid weekday.`, ...at }];
  }
  const type = ctx.blockTypes.get(block.blockTypeId);
  if (!type) {
    out.push({ code: 'unknown-block-type', message: `${label}: the block type does not exist.`, ...at });
    return out;
  }
  const day = framesPerDay(rateOf(ctx.channel));
  if (!Number.isInteger(block.lengthFrames) || block.lengthFrames <= 0) {
    out.push({ code: 'length', message: `${label} (${type.name}) needs a length.`, ...at });
  }
  if (!Number.isInteger(block.startFrames) || block.startFrames < 0 || endOf(block) > day) {
    out.push({ code: 'outside-day', message: `${label} (${type.name}) runs past the end of the broadcast day.`, ...at });
  }
  if (!type.validWeekdays[block.weekday]) {
    out.push({ code: 'weekday', message: `${type.name} cannot be used on ${WEEKDAYS[block.weekday].long}.`, ...at });
  }
  for (const other of blocks) {
    if (other.id === block.id || other.weekday !== block.weekday) continue;
    if (other.blockTypeId === block.blockTypeId) {
      out.push({ code: 'type-twice', message: `${type.name} is already used on ${WEEKDAYS[block.weekday].long} (${blockLabel(other, ctx.channel)}).`, ...at });
    }
    if (overlaps(block, other)) {
      const otherName = ctx.blockTypes.get(other.blockTypeId)?.name ?? 'another block';
      out.push({ code: 'overlap', message: `${label} (${type.name}) overlaps ${otherName} at ${blockLabel(other, ctx.channel)}.`, ...at });
    }
  }
  if (block.breaks.length && !ctx.allowsBreaks) {
    out.push({ code: 'no-breaks', message: `${label}: only main layouts of a channel with an ads playlist have linked breaks.`, ...at });
  }
  if (new Set(block.breaks).size !== block.breaks.length) {
    out.push({ code: 'break-twice', message: `${label}: the same break is linked twice.`, ...at });
  }
  if (ctx.breakTypeIds) {
    for (const id of block.breaks) {
      if (!ctx.breakTypeIds.has(id)) {
        out.push({ code: 'not-a-break', message: `${label}: a linked break is not a block of an ads playlist.`, ...at });
        break;
      }
    }
  }
  return out;
}

/** Everything that must hold before a template is saved. Empty list = valid. */
export function validateTemplate(draft: TemplateDraft, ctx: RuleContext): Problem[] {
  const out: Problem[] = [];
  const name = draft.name.trim();
  if (!name || name.length > TEMPLATE_NAME_MAX) {
    out.push({ code: 'name', message: `The name is required and has at most ${TEMPLATE_NAME_MAX} characters.` });
  }
  out.push(...checkDates(draft.validFrom, draft.validTo, ctx.channel.weekStart));
  if (draft.activeWeekdays.length !== 7) {
    out.push({ code: 'active-days', message: 'Active days must list all seven weekdays.' });
  }
  // Report each overlapping or repeated pair once: check every block against the earlier ones.
  const seen: BlockDraft[] = [];
  const ids = new Set<string>();
  for (const b of [...draft.blocks].sort((x, y) => x.weekday - y.weekday || x.startFrames - y.startFrames)) {
    if (ids.has(b.id)) {
      out.push({ code: 'overlap', message: `Block ${b.id} appears twice.`, blockId: b.id });
      continue;
    }
    ids.add(b.id);
    out.push(...checkBlock(b, seen, ctx));
    seen.push(b);
  }
  return out;
}

export function checkDates(validFrom: string, validTo: string, weekStart: number): Problem[] {
  if (!isIsoDate(validFrom) || !isIsoDate(validTo)) {
    return [{ code: 'dates', message: 'Both dates are required (YYYY-MM-DD).' }];
  }
  const out: Problem[] = [];
  if (weekdayOf(validFrom) !== weekStart) {
    out.push({ code: 'dates', message: `The layout must start on a ${WEEKDAYS[weekStart].long}, the first day of the channel's week.` });
  }
  if (weekdayOf(validTo) !== lastWeekday(weekStart)) {
    out.push({ code: 'dates', message: `The layout must end on a ${WEEKDAYS[lastWeekday(weekStart)].long}, the last day of the channel's week.` });
  }
  if (validTo < validFrom) out.push({ code: 'dates', message: 'The end date is before the start date.' });
  return out;
}

/** Same blocks (type, start, length, breaks) on two weekdays — "Same as Saturday". */
export function daySignature(blocks: BlockDraft[], weekday: number): string {
  return blocksOfDay(blocks, weekday)
    .map((b) => `${b.blockTypeId}@${b.startFrames}+${b.lengthFrames}[${b.breaks.join(',')}]`)
    .join('|');
}

/** Is the block type usable within the template's dates? ("In date" in the Block types panel.) */
export function typeInDates(t: Pick<BlockTypeInfo, 'validFrom' | 'validTo'>, from: string, to: string): boolean {
  return t.validFrom <= to && t.validTo >= from;
}
