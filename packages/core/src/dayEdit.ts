// Changing a day playlist by hand (data model §6): the working copy of a day's rows and what may be
// done to it. The same rules run in the browser (every change) and in the API (on save).

import { EVENT_KINDS, type DayBlockInput } from './day';

/** What is stored of a row. Rows of the browser's draft carry more (what the table shows). */
export interface DraftRow {
  id: string;
  kind: string;
  title: string;
  /** A linked-break row is always 0: it shows the total of its spots. */
  lengthFrames: number;
  productionId: string | null;
  segmentId: string | null;
  tcInFrames: number;
  tcOutFrames: number;
  fixed: boolean;
  hold: boolean;
  autoAdjust: boolean;
  note: string;
  /** Linked-break rows: the block type of the ads block that fills it. */
  breakTypeId: string | null;
  /** A spot: the linked-break row it sits under. */
  relatedEventId: string | null;
  orderId: string | null;
  /** A row a rotation list put in (the list's own no-repeat rule reads it). */
  rotationListId: string | null;
  /** Ads playlist: the booked spot of a commercial order this row airs (one row per pass). */
  airingItemId: string | null;
}

export interface DraftBlock<R extends DraftRow = DraftRow> {
  id: string;
  rows: R[];
}

export interface DayDraft<R extends DraftRow = DraftRow> {
  blocks: DraftBlock<R>[];
}

export const NOTE_MAX = 200;
export const CONTENT_KINDS = ['program', 'commercial', 'promo', 'filler', 'ident', 'jingle'] as const;
const isContent = (kind: string) => (CONTENT_KINDS as readonly string[]).includes(kind);

/** Where new rows go: right after a row, or at the end of a block (before its gap compensator). */
export interface InsertAt {
  blockId: string;
  /** After this row; null = at the end of the block. */
  afterId: string | null;
  /** At the very start of the block (a row dropped above its first row); `afterId` is then null. */
  first?: boolean;
}

export function findRow<R extends DraftRow>(draft: DayDraft<R>, id: string): { block: DraftBlock<R>; row: R; index: number } | null {
  for (const block of draft.blocks) {
    const index = block.rows.findIndex((r) => r.id === id);
    if (index >= 0) return { block, row: block.rows[index], index };
  }
  return null;
}

/** The linked break a row belongs to: itself when it is one, else the one it sits under. */
export function breakOf<R extends DraftRow>(draft: DayDraft<R>, id: string | null): R | null {
  const hit = id ? findRow(draft, id) : null;
  if (!hit) return null;
  if (hit.row.kind === 'linked-break') return hit.row;
  return hit.row.relatedEventId ? (hit.block.rows.find((r) => r.id === hit.row.relatedEventId) ?? null) : null;
}

/**
 * Puts a block's rows in a state that can be saved: the gap compensator last; a spot stays linked
 * only while it sits in the unbroken run of spots right under its linked break.
 */
function tidyBlock<R extends DraftRow>(block: DraftBlock<R>): DraftBlock<R> {
  const gaps = block.rows.filter((r) => r.kind === 'gap-compensator');
  const rest = block.rows.filter((r) => r.kind !== 'gap-compensator');
  let current: string | null = null;
  const rows = [...rest, ...gaps].map((r) => {
    if (r.kind === 'linked-break') {
      current = r.id;
      return r.lengthFrames === 0 && r.relatedEventId === null ? r : { ...r, lengthFrames: 0, relatedEventId: null };
    }
    if (r.relatedEventId && r.relatedEventId === current) return r;
    current = null;
    return r.relatedEventId ? { ...r, relatedEventId: null } : r;
  });
  const same = rows.length === block.rows.length && rows.every((r, i) => r === block.rows[i]);
  return same ? block : { ...block, rows };
}

export function tidyDay<R extends DraftRow>(draft: DayDraft<R>): DayDraft<R> {
  const blocks = draft.blocks.map(tidyBlock);
  return blocks.every((b, i) => b === draft.blocks[i]) ? draft : { blocks };
}

/**
 * Inserts rows after a row (or at the end of a block). `link`: under the linked break of that
 * place, when it is one or sits under one. Without the link they go after the break's last spot,
 * so the spots stay together.
 */
export function insertRows<R extends DraftRow>(draft: DayDraft<R>, at: InsertAt, rows: R[], link: boolean): DayDraft<R> {
  if (!rows.length) return draft;
  const owner = at.afterId ? breakOf(draft, at.afterId) : null;
  // a break that comes in with its own spots (cut or copied together) keeps them
  const own = new Set(rows.filter((r) => r.kind === 'linked-break').map((r) => r.id));
  return tidyDay({
    blocks: draft.blocks.map((b) => {
      if (b.id !== at.blockId) return b;
      let index = at.first ? 0 : at.afterId ? b.rows.findIndex((r) => r.id === at.afterId) + 1 : b.rows.length;
      if (at.afterId && index === 0) index = b.rows.length;
      if (owner && !link) {
        // step over the rest of the break's spots
        while (index < b.rows.length && b.rows[index].relatedEventId === owner.id) index++;
      }
      const added = rows.map((r) => ({
        ...r,
        relatedEventId: r.relatedEventId && own.has(r.relatedEventId) ? r.relatedEventId : owner && link && r.kind !== 'linked-break' && r.kind !== 'note' ? owner.id : null,
      }));
      return { ...b, rows: [...b.rows.slice(0, index), ...added, ...b.rows.slice(index)] };
    }),
  });
}

/** The rows an action on these ids takes: a linked break brings its spots; a gap compensator never moves. */
export function rowsToTake<R extends DraftRow>(draft: DayDraft<R>, ids: string[]): R[] {
  const want = new Set(ids);
  const out: R[] = [];
  for (const b of draft.blocks) {
    const breaks = new Set(b.rows.filter((r) => r.kind === 'linked-break' && want.has(r.id)).map((r) => r.id));
    for (const r of b.rows) {
      if (r.kind === 'gap-compensator') continue;
      if (want.has(r.id) || (r.relatedEventId && breaks.has(r.relatedEventId))) out.push(r);
    }
  }
  return out;
}

/** Removes rows. A linked break that goes leaves its spots as plain rows. */
export function removeRows<R extends DraftRow>(draft: DayDraft<R>, ids: string[]): DayDraft<R> {
  const gone = new Set(ids);
  const blocks = draft.blocks.map((b) => {
    const rows = b.rows.filter((r) => r.kind === 'gap-compensator' || !gone.has(r.id));
    return rows.length === b.rows.length ? b : { ...b, rows };
  });
  return tidyDay(blocks.every((b, i) => b === draft.blocks[i]) ? draft : { blocks });
}

/** Moves rows (in day order; a linked break with its spots) to another place. */
export function moveRows<R extends DraftRow>(draft: DayDraft<R>, ids: string[], at: InsertAt, link: boolean): DayDraft<R> {
  const taken = rowsToTake(draft, ids);
  if (!taken.length || (at.afterId && taken.some((r) => r.id === at.afterId))) return draft;
  const without = removeRows(draft, taken.map((r) => r.id));
  const firstBreak = taken[0].kind === 'linked-break';
  // a break moves with its own spots: put the rows back in one piece and let them keep their links
  if (firstBreak && taken.every((r, i) => i === 0 || r.relatedEventId === taken[0].id)) {
    const placed = insertRows(without, at, [taken[0]], false);
    return tidyDay({
      blocks: placed.blocks.map((b) => {
        const i = b.rows.findIndex((r) => r.id === taken[0].id);
        return i < 0 ? b : { ...b, rows: [...b.rows.slice(0, i + 1), ...taken.slice(1), ...b.rows.slice(i + 1)] };
      }),
    });
  }
  return insertRows(without, at, taken, link);
}

/** One place up or down inside its block (never below the gap compensator). */
export function nudgeRow<R extends DraftRow>(draft: DayDraft<R>, id: string, dir: -1 | 1): DayDraft<R> {
  const hit = findRow(draft, id);
  if (!hit || hit.row.kind === 'gap-compensator') return draft;
  const to = hit.index + dir;
  const other = hit.block.rows[to];
  if (!other || other.kind === 'gap-compensator') return draft;
  const rows = [...hit.block.rows];
  rows[hit.index] = other;
  rows[to] = hit.row;
  return tidyDay({ blocks: draft.blocks.map((b) => (b.id === hit.block.id ? { ...b, rows } : b)) });
}

export function canNudge<R extends DraftRow>(draft: DayDraft<R>, id: string, dir: -1 | 1): boolean {
  return nudgeRow(draft, id, dir) !== draft;
}

export function updateRow<R extends DraftRow>(draft: DayDraft<R>, id: string, patch: Partial<R>): DayDraft<R> {
  const hit = findRow(draft, id);
  if (!hit) return draft;
  const next = { ...hit.row, ...patch };
  if ((Object.keys(patch) as (keyof R)[]).every((k) => hit.row[k] === next[k])) return draft;
  return { blocks: draft.blocks.map((b) => (b.id === hit.block.id ? { ...b, rows: b.rows.map((r) => (r.id === id ? next : r)) } : b)) };
}

/** The part of the media that plays: the row's length follows it. Null when the range is not valid. */
export function setTcRange<R extends DraftRow>(draft: DayDraft<R>, id: string, tcInFrames: number, tcOutFrames: number): DayDraft<R> | null {
  if (!Number.isInteger(tcInFrames) || !Number.isInteger(tcOutFrames) || tcInFrames < 0 || tcOutFrames <= tcInFrames) return null;
  return updateRow(draft, id, { tcInFrames, tcOutFrames, lengthFrames: tcOutFrames - tcInFrames } as Partial<R>);
}

export type DayProblemCode = 'blocks' | 'row-twice' | 'kind' | 'length' | 'tc' | 'note' | 'gap-compensator' | 'link' | 'break' | 'break-twice';

export interface DayProblem {
  code: DayProblemCode;
  message: string;
  rowId?: string;
  blockId?: string;
}

export interface DayRuleContext {
  /** The day's blocks: a save never adds or drops one. */
  blockIds: string[];
  /** Only a main playlist of a channel with an ads playlist has linked breaks. */
  allowsBreaks: boolean;
}

/** Everything that must hold before a day is saved. Empty list = valid. */
export function validateDay(draft: DayDraft, ctx: DayRuleContext): DayProblem[] {
  const out: DayProblem[] = [];
  const ids = draft.blocks.map((b) => b.id);
  if (ids.length !== ctx.blockIds.length || new Set(ids).size !== ids.length || ids.some((id) => !ctx.blockIds.includes(id))) {
    return [{ code: 'blocks', message: 'The blocks of this day changed since you opened it. Reload it.' }];
  }
  const seen = new Set<string>();
  const tidy = tidyDay(draft);
  draft.blocks.forEach((b, bi) => {
    const breakTypes = new Set<string>();
    const gaps = b.rows.filter((r) => r.kind === 'gap-compensator');
    if (gaps.length > 1 || (gaps.length === 1 && b.rows[b.rows.length - 1].kind !== 'gap-compensator')) {
      out.push({ code: 'gap-compensator', message: 'A block has one gap holder at most, as its last row.', blockId: b.id });
    }
    b.rows.forEach((r, ri) => {
      const at = { rowId: r.id, blockId: b.id };
      const name = r.title || r.kind;
      if (seen.has(r.id)) out.push({ code: 'row-twice', message: `Row ${r.id} appears twice.`, ...at });
      seen.add(r.id);
      if (!(EVENT_KINDS as readonly string[]).includes(r.kind)) {
        out.push({ code: 'kind', message: `"${name}" is not a kind of row.`, ...at });
        return;
      }
      if (!Number.isInteger(r.lengthFrames) || r.lengthFrames < 0) out.push({ code: 'length', message: `"${name}" needs a length that is not negative.`, ...at });
      if (!Number.isInteger(r.tcInFrames) || !Number.isInteger(r.tcOutFrames) || r.tcInFrames < 0 || r.tcOutFrames < r.tcInFrames) {
        out.push({ code: 'tc', message: `"${name}": TC out must not be before TC in.`, ...at });
      } else if (isContent(r.kind) && r.tcOutFrames > r.tcInFrames && r.tcOutFrames - r.tcInFrames !== r.lengthFrames) {
        out.push({ code: 'tc', message: `"${name}": the length must be TC out minus TC in.`, ...at });
      }
      if (r.kind === 'note' && (!r.title.trim() || r.title.trim().length > NOTE_MAX)) {
        out.push({ code: 'note', message: `A note needs a text of at most ${NOTE_MAX} characters.`, ...at });
      }
      if (r.note.length > 4000) out.push({ code: 'note', message: `"${name}": the note is too long.`, ...at });
      if (r.kind === 'linked-break') {
        if (!ctx.allowsBreaks) out.push({ code: 'break', message: 'Only the main playlist of a channel with an ads playlist has linked breaks.', ...at });
        else if (!r.breakTypeId) out.push({ code: 'break', message: 'A linked break must name its break.', ...at });
        else if (breakTypes.has(r.breakTypeId)) out.push({ code: 'break-twice', message: `"${name}": the same break is linked twice in one block.`, ...at });
        if (r.breakTypeId) breakTypes.add(r.breakTypeId);
        if (r.lengthFrames !== 0) out.push({ code: 'length', message: 'A linked break has no length of its own.', ...at });
      }
      if (r.relatedEventId !== tidy.blocks[bi].rows[ri]?.relatedEventId) {
        out.push({ code: 'link', message: `"${name}" is linked to a break it does not sit under.`, ...at });
      }
    });
  });
  return out;
}

/** The draft as `layoutDay` reads it, with each block's planned start and length. */
export function draftBlocks<R extends DraftRow>(draft: DayDraft<R>, planned: { id: string; startFrames: number; lengthFrames: number }[]): DayBlockInput<R & { sequence: number }>[] {
  return draft.blocks.map((b) => {
    const p = planned.find((x) => x.id === b.id);
    return { id: b.id, startFrames: p?.startFrames ?? 0, lengthFrames: p?.lengthFrames ?? 0, events: b.rows.map((r, sequence) => ({ ...r, sequence })) };
  });
}
