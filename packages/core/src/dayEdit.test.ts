import { describe, expect, it } from 'vitest';
import {
  breakOf,
  canNudge,
  draftBlocks,
  insertRows,
  layoutDay,
  moveRows,
  nudgeRow,
  removeRows,
  rowsToTake,
  setTcRange,
  updateRow,
  validateDay,
  type DayDraft,
  type DraftRow,
} from './index';

const row = (id: string, kind: string, over: Partial<DraftRow> = {}): DraftRow => ({
  id, kind, title: id, lengthFrames: kind === 'linked-break' || kind === 'note' || kind === 'gap-compensator' ? 0 : 100,
  productionId: null, segmentId: null, tcInFrames: 0, tcOutFrames: 0, fixed: false, hold: false, autoAdjust: false, note: '',
  breakTypeId: kind === 'linked-break' ? `type-${id}` : null, relatedEventId: null, orderId: null, rotationListId: null, airingItemId: null, ...over,
});

/** b1: Billboard 1 (empty) · p1 · AB with spots s1 s2 · p2 · gap.  b2: gap. */
const day = (): DayDraft => ({
  blocks: [
    {
      id: 'b1',
      rows: [row('Billboard 1', 'linked-break'), row('p1', 'program'), row('AB', 'linked-break'), row('s1', 'ident', { relatedEventId: 'AB' }), row('s2', 'commercial', { relatedEventId: 'AB' }), row('p2', 'program'), row('g1', 'gap-compensator')],
    },
    { id: 'b2', rows: [row('g2', 'gap-compensator')] },
  ],
});
const ids = (d: DayDraft, block = 0) => d.blocks[block].rows.map((r) => r.id);
const links = (d: DayDraft, block = 0) => Object.fromEntries(d.blocks[block].rows.filter((r) => r.relatedEventId).map((r) => [r.id, r.relatedEventId]));
const ctx = { blockIds: ['b1', 'b2'], allowsBreaks: true };

describe('inserting rows', () => {
  it('puts them right after a row, or at the end of a block before its gap holder', () => {
    expect(ids(insertRows(day(), { blockId: 'b1', afterId: 'p1' }, [row('n', 'program')], false))).toEqual(['Billboard 1', 'p1', 'n', 'AB', 's1', 's2', 'p2', 'g1']);
    expect(ids(insertRows(day(), { blockId: 'b1', afterId: null }, [row('n', 'program')], false))).toEqual(['Billboard 1', 'p1', 'AB', 's1', 's2', 'p2', 'n', 'g1']);
    expect(ids(insertRows(day(), { blockId: 'b1', afterId: 'g1' }, [row('n', 'program')], false))).toEqual(['Billboard 1', 'p1', 'AB', 's1', 's2', 'p2', 'n', 'g1']);
    expect(ids(insertRows(day(), { blockId: 'b2', afterId: null }, [row('n', 'program'), row('m', 'filler')], false), 1)).toEqual(['n', 'm', 'g2']);
  });

  it('links them to the break of that place, or steps over its spots when they are not linked', () => {
    const linked = insertRows(day(), { blockId: 'b1', afterId: 's1' }, [row('n', 'commercial')], true);
    expect(ids(linked)).toEqual(['Billboard 1', 'p1', 'AB', 's1', 'n', 's2', 'p2', 'g1']);
    expect(links(linked)).toEqual({ s1: 'AB', n: 'AB', s2: 'AB' });
    const first = insertRows(day(), { blockId: 'b1', afterId: 'AB' }, [row('n', 'commercial')], true);
    expect(ids(first)).toEqual(['Billboard 1', 'p1', 'AB', 'n', 's1', 's2', 'p2', 'g1']);
    const plain = insertRows(day(), { blockId: 'b1', afterId: 's1' }, [row('n', 'program')], false);
    expect(ids(plain)).toEqual(['Billboard 1', 'p1', 'AB', 's1', 's2', 'n', 'p2', 'g1']);
    expect(links(plain)).toEqual({ s1: 'AB', s2: 'AB' });
    // an empty break takes its first spot
    expect(links(insertRows(day(), { blockId: 'b1', afterId: 'Billboard 1' }, [row('n', 'commercial')], true))).toMatchObject({ n: 'Billboard 1' });
    // a note or another break is never a spot
    expect(links(insertRows(day(), { blockId: 'b1', afterId: 'AB' }, [row('n', 'note')], true))).toEqual({});
    // a break pasted with its own spots keeps them
    const pasted = insertRows(day(), { blockId: 'b2', afterId: null }, [row('X', 'linked-break'), row('x1', 'commercial', { relatedEventId: 'X' })], false);
    expect(links(pasted, 1)).toEqual({ x1: 'X' });
    expect(breakOf(day(), 's2')?.id).toBe('AB');
    expect(breakOf(day(), 'AB')?.id).toBe('AB');
    expect(breakOf(day(), 'p1')).toBeNull();
  });
});

describe('removing and moving rows', () => {
  it('removes rows but never the gap holder; a break that goes leaves its spots as plain rows', () => {
    expect(ids(removeRows(day(), ['p1', 'g1', 's2']))).toEqual(['Billboard 1', 'AB', 's1', 'p2', 'g1']);
    const noBreak = removeRows(day(), ['AB']);
    expect(ids(noBreak)).toEqual(['Billboard 1', 'p1', 's1', 's2', 'p2', 'g1']);
    expect(links(noBreak)).toEqual({});
    const same = day();
    expect(removeRows(same, ['nothing'])).toBe(same);
  });

  it('takes a linked break with its spots', () => {
    expect(rowsToTake(day(), ['AB', 'g1']).map((r) => r.id)).toEqual(['AB', 's1', 's2']);
    expect(rowsToTake(day(), ['p2', 'p1']).map((r) => r.id)).toEqual(['p1', 'p2']);
  });

  it('moves rows to another place, in day order; a break keeps its spots', () => {
    const toB2 = moveRows(day(), ['p2', 'p1'], { blockId: 'b2', afterId: null }, false);
    expect(ids(toB2)).toEqual(['Billboard 1', 'AB', 's1', 's2', 'g1']);
    expect(ids(toB2, 1)).toEqual(['p1', 'p2', 'g2']);
    const breakMoved = moveRows(day(), ['AB'], { blockId: 'b2', afterId: null }, false);
    expect(ids(breakMoved)).toEqual(['Billboard 1', 'p1', 'p2', 'g1']);
    expect(ids(breakMoved, 1)).toEqual(['AB', 's1', 's2', 'g2']);
    expect(links(breakMoved, 1)).toEqual({ s1: 'AB', s2: 'AB' });
    // a spot moved out of its break is a plain row; moved under another break it can be linked
    expect(links(moveRows(day(), ['s2'], { blockId: 'b1', afterId: 'p1' }, false))).toEqual({ s1: 'AB' });
    expect(links(moveRows(day(), ['s2'], { blockId: 'b1', afterId: 'Billboard 1' }, true))).toEqual({ s2: 'Billboard 1', s1: 'AB' });
    // dropped above a block's first row (drag and drop)
    expect(ids(moveRows(day(), ['p2'], { blockId: 'b1', afterId: null, first: true }, false))).toEqual(['p2', 'Billboard 1', 'p1', 'AB', 's1', 's2', 'g1']);
    expect(ids(moveRows(day(), ['AB'], { blockId: 'b2', afterId: null, first: true }, false), 1)).toEqual(['AB', 's1', 's2', 'g2']);
    const d = day();
    expect(moveRows(d, ['p1'], { blockId: 'b1', afterId: 'p1' }, false)).toBe(d);
  });

  it('nudges a row one place inside its block; a spot that leaves its break is unlinked', () => {
    expect(ids(nudgeRow(day(), 'p1', -1))).toEqual(['p1', 'Billboard 1', 'AB', 's1', 's2', 'p2', 'g1']);
    const down = nudgeRow(day(), 's2', 1);
    expect(ids(down)).toEqual(['Billboard 1', 'p1', 'AB', 's1', 'p2', 's2', 'g1']);
    expect(links(down)).toEqual({ s1: 'AB' });
    // p1 moved under the break's first place is not a spot, and cuts the run: the spots after it are plain
    expect(links(nudgeRow(day(), 'p1', 1))).toEqual({});
    expect(canNudge(day(), 'p2', 1)).toBe(false); // the gap compensator stays last
    expect(canNudge(day(), 'Billboard 1', -1)).toBe(false);
    expect(canNudge(day(), 'g1', -1)).toBe(false);
    expect(canNudge(day(), 'p2', -1)).toBe(true);
  });
});

describe('changing a row', () => {
  it('sets fields, and the length follows the TC range', () => {
    const d = day();
    const held = updateRow(d, 'p1', { hold: true, note: 'check' });
    expect(held.blocks[0].rows[1]).toMatchObject({ hold: true, note: 'check' });
    expect(updateRow(d, 'p1', { hold: false })).toBe(d);
    const cut = setTcRange(d, 'p1', 250, 1000)!;
    expect(cut.blocks[0].rows[1]).toMatchObject({ tcInFrames: 250, tcOutFrames: 1000, lengthFrames: 750 });
    expect(setTcRange(d, 'p1', 1000, 1000)).toBeNull();
    expect(setTcRange(d, 'p1', -1, 10)).toBeNull();
  });

  it('lays the draft out: the block’s real length follows its rows', () => {
    const laid = layoutDay(draftBlocks(day(), [{ id: 'b1', startFrames: 0, lengthFrames: 500 }, { id: 'b2', startFrames: 500, lengthFrames: 500 }]));
    expect(laid.blocks[0].realLengthFrames).toBe(400);
    expect(laid.blocks[0].events.find((e) => e.id === 'AB')?.shownFrames).toBe(200);
    expect(laid.blocks[1].realStartFrames).toBe(400);
  });
});

describe('what may be saved', () => {
  it('accepts every result of the operations', () => {
    expect(validateDay(day(), ctx)).toEqual([]);
    expect(validateDay(moveRows(day(), ['AB', 'p1'], { blockId: 'b2', afterId: null }, false), ctx)).toEqual([]);
    expect(validateDay(insertRows(day(), { blockId: 'b1', afterId: 's1' }, [row('n', 'note', { title: 'Call the studio' })], true), ctx)).toEqual([]);
  });

  it('refuses rows that break a rule, each with its reason', () => {
    const codes = (d: DayDraft, c = ctx) => validateDay(d, c).map((p) => p.code);
    const d = day();
    expect(codes({ blocks: [d.blocks[0]] })).toEqual(['blocks']);
    expect(codes({ blocks: [{ ...d.blocks[0], rows: [...d.blocks[0].rows, row('p1', 'program')] }, d.blocks[1]] })).toEqual(['gap-compensator', 'row-twice']);
    expect(codes(updateRow(d, 'p1', { kind: 'cartoon' }))).toEqual(['kind']);
    expect(codes(updateRow(d, 'p1', { lengthFrames: -5 }))).toEqual(['length']);
    expect(codes(updateRow(d, 'p1', { tcInFrames: 10, tcOutFrames: 5 }))).toEqual(['tc']);
    expect(codes(updateRow(d, 'p1', { tcInFrames: 0, tcOutFrames: 50 }))).toEqual(['tc']); // length 100, range 50
    expect(codes(updateRow(d, 'p1', { kind: 'note', title: ' ', lengthFrames: 0 }))).toEqual(['note']);
    expect(codes(updateRow(d, 'p2', { relatedEventId: 'AB' }))).toEqual([]); // p2 sits right under the spots: a spot
    expect(codes(updateRow(d, 'p1', { relatedEventId: 'AB' }))).toEqual(['link']);
    expect(codes(updateRow(d, 'Billboard 1', { breakTypeId: null }))).toEqual(['break']);
    expect(codes(updateRow(d, 'Billboard 1', { breakTypeId: 'type-AB' }))).toEqual(['break-twice']);
    expect(codes(updateRow(d, 'Billboard 1', { lengthFrames: 30 }))).toEqual(['length']);
    expect(codes(removeRows(d, ['s1', 's2']), { ...ctx, allowsBreaks: false })).toEqual(['break', 'break']);
  });
});
