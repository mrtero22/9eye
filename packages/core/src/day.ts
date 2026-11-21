// One day playlist: blocks and their rows, with the times the rows really get (data model §6).
// Start times run back to back through the whole day; a block's planned start never resets them.

import { clockFrames, framesPerDay, type FrameRate } from './timecode';

/** What a row of a block is. The first six are content kinds with their own colour on every screen. */
export const EVENT_KINDS = ['program', 'commercial', 'promo', 'filler', 'ident', 'jingle', 'note', 'linked-break', 'gap-compensator'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Rows that take no time of their own: a note, and a linked break (its spots carry the time). */
export function takesTime(kind: string): boolean {
  return kind !== 'linked-break' && kind !== 'note';
}

export interface DayEventInput {
  id: string;
  sequence: number;
  kind: string;
  lengthFrames: number;
  /** A break event (spot) points at the linked-break row it was copied in under. */
  relatedEventId?: string | null;
}

export interface DayBlockInput<E extends DayEventInput = DayEventInput> {
  id: string;
  /** Planned start, as an offset from the broadcast-day start. */
  startFrames: number;
  /** Planned length. */
  lengthFrames: number;
  events: E[];
}

export type LaidEvent<E extends DayEventInput = DayEventInput> = E & {
  /** Offset from the broadcast-day start at which the row begins. */
  startFrames: number;
  /** A linked-break row: the total of the spots linked to it. Every other row: its own length. */
  shownFrames: number;
};

export interface LaidBlock<E extends DayEventInput = DayEventInput> {
  id: string;
  plannedStartFrames: number;
  plannedLengthFrames: number;
  /** Where the block really begins: the end of everything before it. */
  realStartFrames: number;
  realLengthFrames: number;
  /** Real length − planned length: negative = a gap, positive = it runs over. */
  gapFrames: number;
  events: LaidEvent<E>[];
}

export interface DayLayout<E extends DayEventInput = DayEventInput> {
  blocks: LaidBlock<E>[];
  /** Everything the day plays, end to end. */
  totalFrames: number;
}

/** Blocks in planned order, rows in sequence, every row at the time it really starts. */
export function layoutDay<E extends DayEventInput>(blocks: DayBlockInput<E>[]): DayLayout<E> {
  let t = 0;
  const filled = new Map<string, number>();
  for (const b of blocks) {
    for (const e of b.events) {
      if (e.relatedEventId && takesTime(e.kind)) filled.set(e.relatedEventId, (filled.get(e.relatedEventId) ?? 0) + e.lengthFrames);
    }
  }
  const out = [...blocks]
    .sort((a, b) => a.startFrames - b.startFrames)
    .map((b): LaidBlock<E> => {
      const realStartFrames = t;
      const events = [...b.events]
        .sort((x, y) => x.sequence - y.sequence)
        .map((e): LaidEvent<E> => {
          const row = { ...e, startFrames: t, shownFrames: e.kind === 'linked-break' ? (filled.get(e.id) ?? 0) : e.lengthFrames };
          if (takesTime(e.kind)) t += e.lengthFrames;
          return row;
        });
      const realLengthFrames = t - realStartFrames;
      return { id: b.id, plannedStartFrames: b.startFrames, plannedLengthFrames: b.lengthFrames, realStartFrames, realLengthFrames, gapFrames: realLengthFrames - b.lengthFrames, events };
    });
  return { blocks: out, totalFrames: t };
}

export interface DayEnd {
  /** Time of day at which the last row ends. */
  endClockFrames: number;
  /** The day ends on the next calendar day (it passes midnight). */
  nextDay: boolean;
  /** How far the day runs past 24 hours; 0 when it does not. */
  pastDayFrames: number;
}

export function dayEnd(totalFrames: number, dayStartFrames: number, r: FrameRate): DayEnd {
  const day = framesPerDay(r);
  return {
    endClockFrames: clockFrames(totalFrames, dayStartFrames, r),
    nextDay: dayStartFrames + totalFrames >= day,
    pastDayFrames: Math.max(0, totalFrames - day),
  };
}

/** Why a day cannot be published / unpublished, or null when it can. */
export function publishRefusal(day: { published: boolean; reconciled: boolean }, publish: boolean): string | null {
  if (day.reconciled) return 'This day is reconciled: it cannot be changed.';
  if (publish && day.published) return 'This day is already approved.';
  if (!publish && !day.published) return 'This day is not approved.';
  return null;
}
