// The open day while it is being changed: the saved version, the working draft and its history.
// Every change goes through here, so Undo / Redo and "Unsaved changes" cover all of them.

import { uuidv7, type DayDraft, type DraftRow } from '@9eye/core';
import type { DayEvent } from './model';

/** A row of the draft: what is stored plus what the table shows of it. */
export type Row = DayEvent;
export type Draft = DayDraft<Row>;

export interface DayEditor {
  dayId: string | null;
  version: number;
  base: Draft | null;
  present: Draft | null;
  past: Draft[];
  future: Draft[];
}

export type DayEditorAction =
  | { type: 'load'; dayId: string; version: number; draft: Draft }
  | { type: 'change'; draft: Draft }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'discard' };

const HISTORY = 200;

export const emptyDayEditor: DayEditor = { dayId: null, version: 0, base: null, present: null, past: [], future: [] };

export function dayEditorReducer(s: DayEditor, a: DayEditorAction): DayEditor {
  switch (a.type) {
    case 'load':
      return { dayId: a.dayId, version: a.version, base: a.draft, present: a.draft, past: [], future: [] };
    case 'change':
      if (!s.present || a.draft === s.present) return s;
      return { ...s, present: a.draft, past: [...s.past, s.present].slice(-HISTORY), future: [] };
    case 'undo': {
      if (!s.past.length || !s.present) return s;
      const prev = s.past[s.past.length - 1];
      return { ...s, present: prev, past: s.past.slice(0, -1), future: [s.present, ...s.future] };
    }
    case 'redo': {
      if (!s.future.length || !s.present) return s;
      const [next, ...rest] = s.future;
      return { ...s, present: next, past: [...s.past, s.present], future: rest };
    }
    case 'discard':
      return { ...s, present: s.base, past: [], future: [] };
  }
}

/** What is saved of a row. */
export function stored(r: Row): DraftRow {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    lengthFrames: r.lengthFrames,
    productionId: r.productionId,
    segmentId: r.segmentId,
    tcInFrames: r.tcInFrames,
    tcOutFrames: r.tcOutFrames,
    fixed: r.fixed,
    hold: r.hold,
    autoAdjust: r.autoAdjust,
    note: r.note,
    breakTypeId: r.breakTypeId,
    relatedEventId: r.relatedEventId,
    orderId: r.orderId,
    rotationListId: r.rotationListId,
    airingItemId: r.airingItemId,
  };
}

export const payload = (d: Draft) => d.blocks.map((b) => ({ id: b.id, rows: b.rows.map(stored) }));

export function isDayDirty(s: DayEditor): boolean {
  if (s.present === s.base || !s.present || !s.base) return false;
  return JSON.stringify(payload(s.present)) !== JSON.stringify(payload(s.base));
}

/** A new row for the draft, with a fresh id. */
export function makeRow(over: Partial<Row> & { kind: string; title: string }): Row {
  return {
    id: uuidv7(),
    sequence: 0,
    startFrames: 0,
    lengthFrames: 0,
    tcInFrames: 0,
    tcOutFrames: 0,
    color: null,
    contentType: null,
    episode: null,
    breakName: null,
    inBreak: false,
    media: null,
    note: '',
    fixed: false,
    hold: false,
    autoAdjust: false,
    productionId: null,
    segmentId: null,
    breakTypeId: null,
    relatedEventId: null,
    orderId: null,
    rotationListId: null,
    airingItemId: null,
    ...over,
  };
}

/** A copy of rows for pasting: fresh ids, links between a break and its spots kept; a copy is placed by hand (no order, rotation list or booked spot). */
export function copyRows(rows: Row[]): Row[] {
  const ids = new Map(rows.map((r) => [r.id, uuidv7()]));
  return rows.map((r) => ({ ...r, id: ids.get(r.id)!, relatedEventId: r.relatedEventId ? (ids.get(r.relatedEventId) ?? null) : null, orderId: null, rotationListId: null, airingItemId: null }));
}
