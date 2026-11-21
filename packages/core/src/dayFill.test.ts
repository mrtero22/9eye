import { describe, expect, it } from 'vitest';
import {
  FRAME_RATES,
  airingProductions,
  dayChecks,
  fillBreaks,
  fillRotation,
  inTimeWindows,
  placePrograms,
  splitTargets,
  type AdsBreak,
  type DayDraft,
  type DraftRow,
  type ExpectedPlacement,
  type FillProduction,
  type RotationBlock,
  type RotationList,
  type RotationProduction,
} from './index';

const R = FRAME_RATES['25'];
const sec = (s: number) => s * 25;
const min = (m: number) => m * 60 * 25;

const row = (id: string, kind: string, over: Partial<DraftRow> = {}): DraftRow => ({
  id, kind, title: id, lengthFrames: kind === 'linked-break' || kind === 'note' || kind === 'gap-compensator' ? 0 : 100,
  productionId: null, segmentId: null, tcInFrames: 0, tcOutFrames: 0, fixed: false, hold: false, autoAdjust: false, note: '',
  breakTypeId: kind === 'linked-break' ? `type-${id}` : null, relatedEventId: null, orderId: null, rotationListId: null, airingItemId: null, ...over,
});
const brk = (id: string) => row(id, 'linked-break');
const gc = (id: string) => row(id, 'gap-compensator');
let next = 0;
const newId = () => `n${++next}`;
const kinds = (d: DayDraft, block = 0) => d.blocks[block].rows.map((r) => (r.kind === 'program' ? `${r.productionId}:${r.segmentId}` : r.id));

const prod = (id: string, segs: number, segMin = 10, kind = 'program'): FillProduction => ({
  id, title: `Title ${id}`, kind,
  segments: Array.from({ length: segs }, (_, i) => ({ id: `${id}s${i + 1}`, tcInFrames: min(segMin * i), tcOutFrames: min(segMin * (i + 1)), lengthFrames: min(segMin) })),
});
const expected = (orderId: string, blockId: string | null, productionIds: string[], more: Partial<ExpectedPlacement> = {}): ExpectedPlacement => ({
  airingId: `a-${orderId}-${blockId}`, orderId, orderName: `Plan ${orderId}`, blockId, blockName: blockId ?? 'Late Block', repeat: false, productionIds, titles: productionIds.map((p) => `Title ${p}`), ...more,
});

describe('splitting a programme across its breaks', () => {
  it('puts part i right before the i-th break of the run, the rest at the end', () => {
    const rows = [brk('B1'), brk('B2'), brk('B3'), brk('B4'), gc('g')];
    expect(splitTargets(rows, false, 4)).toEqual(['B1', 'B2', 'B3', 'B4']);
    expect(splitTargets(rows, false, 6)).toEqual(['B1', 'B2', 'B3', 'B4', null, null]);
    expect(splitTargets(rows, false, 2)).toEqual(['B1', 'B2']);
  });

  it('skips a block’s opening break and the break right after a programme', () => {
    expect(splitTargets([brk('B0'), brk('B1'), brk('B2'), gc('g')], true, 2)).toEqual(['B1', 'B2']);
    const second = [row('p1', 'program'), brk('B1'), row('p2', 'program'), brk('B4'), brk('B5'), brk('B6'), gc('g')];
    expect(splitTargets(second, false, 3)).toEqual(['B5', 'B6', null]);
  });

  it('goes before the next programme when the slot runs out, and to the end in a block without breaks', () => {
    // B1 B2 then a programme: slot [B1, B2, P]
    expect(splitTargets([brk('B1'), brk('B2'), row('P', 'program'), gc('g')], false, 4)).toEqual(['B1', 'B2', 'P', 'P']);
    expect(splitTargets([gc('g')], false, 3)).toEqual([null, null, null]);
  });

  it('prefers an exact fit, then the smallest bigger slot, then the biggest smaller one', () => {
    // slots: [B1 B2 B3 P] (4) and [B5 B6 LAST] (3)
    const rows = [brk('B1'), brk('B2'), brk('B3'), row('P', 'program'), brk('B4'), brk('B5'), brk('B6'), gc('g')];
    // B4 follows the programme: not a split point
    expect(splitTargets(rows, false, 3)).toEqual(['B5', 'B6', null]);
    expect(splitTargets(rows, false, 4)).toEqual(['B1', 'B2', 'B3', 'P']);
    expect(splitTargets(rows, false, 2)).toEqual(['B5', 'B6']);
    expect(splitTargets(rows, false, 6)).toEqual(['B1', 'B2', 'B3', 'P', 'P', 'P']);
  });
});

describe('import program placements', () => {
  const day = (): DayDraft => ({
    blocks: [
      { id: 'b1', rows: [brk('Billboard 1'), brk('AB'), gc('g1')] },
      { id: 'b2', rows: [gc('g2')] },
    ],
  });
  const blocks = [{ id: 'b1', name: 'Run Block 1', opensWithBreak: false }, { id: 'b2', name: 'Run Block 2', opensWithBreak: false }];
  const productions = new Map([['ep1', prod('ep1', 3)], ['ep2', prod('ep2', 1)], ['empty', prod('empty', 0)]]);

  it('splits each item across the breaks of its block, marked with the plan', () => {
    const r = placePrograms(day(), blocks, [expected('o1', 'b1', ['ep1']), expected('o2', 'b2', ['ep2'], { repeat: true })], productions, 'missing', newId);
    expect(kinds(r.draft, 0)).toEqual(['ep1:ep1s1', 'Billboard 1', 'ep1:ep1s2', 'AB', 'ep1:ep1s3', 'g1']);
    expect(kinds(r.draft, 1)).toEqual(['ep2:ep2s1', 'g2']);
    const first = r.draft.blocks[0].rows[0];
    expect(first).toMatchObject({ kind: 'program', title: 'Title ep1', orderId: 'o1', tcInFrames: 0, tcOutFrames: min(10), lengthFrames: min(10) });
    expect(r.report.placed).toEqual([
      { title: 'Title ep1', block: 'Run Block 1', detail: 'Plan o1 · 3 parts', frames: min(30) },
      { title: 'Title ep2', block: 'Run Block 2', detail: 'Plan o2 · 1 part · repeat', frames: min(10) },
    ]);
  });

  it('says why something is not placed', () => {
    const r = placePrograms(day(), blocks, [expected('o1', null, ['ep1']), expected('o2', 'b1', ['empty', 'gone'])], productions, 'missing', newId);
    expect(r.report.placed).toEqual([]);
    expect(r.report.notPlaced.map((l) => [l.title, l.detail])).toEqual([
      ['Title ep1', 'This day has no block “Late Block”: the week was made from another layout.'],
      ['Title empty', 'It has no length in the catalog.'],
      ['Title gone', 'Its catalog item does not exist any more.'],
    ]);
  });

  it('only what is missing keeps a plan already in its block; all again replaces it', () => {
    const once = placePrograms(day(), blocks, [expected('o1', 'b1', ['ep1'])], productions, 'missing', newId).draft;
    const again = placePrograms(once, blocks, [expected('o1', 'b1', ['ep1']), expected('o2', 'b2', ['ep2'])], productions, 'missing', newId);
    expect(again.report).toMatchObject({ kept: 1, removed: 0 });
    expect(again.report.placed.map((l) => l.title)).toEqual(['Title ep2']);
    const all = placePrograms(again.draft, blocks, [expected('o1', 'b1', ['ep1'])], productions, 'all', newId);
    expect(all.report).toMatchObject({ kept: 0, removed: 4 });
    expect(kinds(all.draft, 0)).toEqual(['ep1:ep1s1', 'Billboard 1', 'ep1:ep1s2', 'AB', 'ep1:ep1s3', 'g1']);
    expect(kinds(all.draft, 1)).toEqual(['g2']);
  });

  it('expands an airing: a series once, programmes by plays, a repeat its one item', () => {
    expect(airingProductions('series', { passes: 2, productionIds: ['a', 'b'] }, null)).toEqual(['a', 'b']);
    expect(airingProductions('programmes', { passes: 2, productionIds: ['a'] }, null)).toEqual(['a', 'a']);
    expect(airingProductions('programmes', { passes: 0, productionIds: ['a'] }, null)).toEqual(['a']);
    expect(airingProductions('series', { passes: 0, productionIds: [] }, { productionIds: ['a', 'b'], repeatIndex: 1 })).toEqual(['b']);
  });
});

describe('import break events', () => {
  const spot = (title: string, kind = 'commercial', lengthFrames = sec(30)) => ({ kind, title, lengthFrames, productionId: `p-${title}`, segmentId: null, tcInFrames: 0, tcOutFrames: lengthFrames });
  const ads: AdsBreak[] = [
    { blockTypeId: 'type-Billboard 1', name: 'Billboard 1 06:00', spots: [spot('Spot A'), spot('Spot B')] },
    { blockTypeId: 'type-AB', name: 'Ad Pod 06:30', spots: [spot('Trailer C', 'promo', sec(20))] },
  ];
  const day = (): DayDraft => ({ blocks: [{ id: 'b1', rows: [row('p1', 'program'), brk('Billboard 1'), brk('AB'), brk('XX'), gc('g1')] }] });
  const blocks = [{ id: 'b1', name: 'Run Block 1' }];
  const names = new Map([['type-XX', 'Sponsor 9']]);

  it('copies each break’s spots in under its linked break, linked', () => {
    const r = fillBreaks(day(), blocks, ads, names, 'missing', newId);
    const rows = r.draft.blocks[0].rows;
    expect(rows.map((x) => x.title)).toEqual(['p1', 'Billboard 1', 'Spot A', 'Spot B', 'AB', 'Trailer C', 'XX', 'g1']);
    expect(rows.filter((x) => x.relatedEventId).map((x) => [x.title, x.relatedEventId, x.kind])).toEqual([['Spot A', 'Billboard 1', 'commercial'], ['Spot B', 'Billboard 1', 'commercial'], ['Trailer C', 'AB', 'promo']]);
    expect(r.report.placed).toEqual([
      { title: 'Billboard 1 06:00', block: 'Run Block 1', detail: '2 spots', frames: sec(60) },
      { title: 'Ad Pod 06:30', block: 'Run Block 1', detail: '1 spot', frames: sec(20) },
    ]);
    expect(r.report.notPlaced).toEqual([{ title: 'Sponsor 9', block: 'Run Block 1', detail: 'The ads playlist has no such break on this day.', frames: null }]);
  });

  it('keeps filled breaks (only what is missing) or fills them again (all again)', () => {
    const once = fillBreaks(day(), blocks, ads, names, 'missing', newId).draft;
    const changed: AdsBreak[] = [{ ...ads[0], spots: [spot('Spot Z')] }, ads[1]];
    expect(fillBreaks(once, blocks, changed, names, 'missing', newId).report).toMatchObject({ kept: 2, removed: 0, placed: [] });
    const all = fillBreaks(once, blocks, changed, names, 'all', newId);
    expect(all.report).toMatchObject({ kept: 0, removed: 3 });
    expect(all.draft.blocks[0].rows.map((x) => x.title)).toEqual(['p1', 'Billboard 1', 'Spot Z', 'AB', 'Trailer C', 'XX', 'g1']);
  });

  it('says so when the ads playlist has no day yet', () => {
    const r = fillBreaks(day(), blocks, null, names, 'missing', newId);
    expect(r.report.notes).toEqual(['The ads playlist has no day here yet: create its week first.']);
    expect(r.draft).toEqual(day());
  });
});

describe('import rotation lists (fill gaps)', () => {
  const ctx = { date: '2030-06-01', channelId: 'ch', dayStartFrames: min(360), rate: R, random: () => 0.99 };
  const item = (position: number, productionId: string, seconds: number, insertedAt: string | null = null) => ({
    position, productionId, insertedAt, segments: [{ id: `${productionId}-s`, tcInFrames: 0, tcOutFrames: sec(seconds), lengthFrames: sec(seconds) }],
  });
  const list = (over: Partial<RotationList> = {}): RotationList => ({
    id: 'L', name: 'Fillers', lastItemPosition: null, insertionDaysInterval: 0, allowSameDayRepeat: false, randomInsert: false, applyChannelRestrictions: false,
    items: [item(1, 'f1', 120), item(2, 'f2', 60), item(3, 'f3', 30), item(4, 'f4', 10)], ...over,
  });
  const p = (id: string, over: Partial<RotationProduction> = {}): RotationProduction => ({ id, title: id.toUpperCase(), kind: 'filler', starts: null, expires: null, channelIds: [], windows: { allowed: [], rejected: [] }, ...over });
  const productions = (over: Record<string, Partial<RotationProduction>> = {}) => new Map(['f1', 'f2', 'f3', 'f4'].map((id) => [id, p(id, over[id])]));
  /** b1: 5 minutes planned, a 2-minute programme in it. b2: 3 minutes, empty. */
  const day = (): DayDraft => ({ blocks: [{ id: 'b1', rows: [row('p1', 'program', { lengthFrames: min(2) }), gc('g1')] }, { id: 'b2', rows: [gc('g2')] }] });
  const blocks = (listId: string | null = 'L'): RotationBlock[] => [
    { id: 'b1', name: 'Block 1', listId, plannedStartFrames: 0, plannedLengthFrames: min(5) },
    { id: 'b2', name: 'Block 2', listId, plannedStartFrames: min(5), plannedLengthFrames: min(3) },
  ];
  const titles = (d: DayDraft, b = 0) => d.blocks[b].rows.map((r) => r.title);

  it('walks the list from where it left off and takes what fits; an item goes in once a day', () => {
    const r = fillRotation(day(), blocks(), new Map([['L', list({ lastItemPosition: 1 })]]), productions(), ctx, 'missing', newId);
    // block 1 has 3:00 free: f2 (1:00), f3 (0:30), f4 (0:10) from position 2 on, then f1 (2:00) does not fit
    expect(titles(r.draft, 0)).toEqual(['p1', 'F2', 'F3', 'F4', 'g1']);
    // block 2 has 3:00: f1 is the only one left
    expect(titles(r.draft, 1)).toEqual(['F1', 'g2']);
    expect(r.draft.blocks[1].rows[0]).toMatchObject({ kind: 'filler', rotationListId: 'L', productionId: 'f1', segmentId: 'f1-s', lengthFrames: sec(120) });
    expect(r.report.placed).toEqual([
      { title: 'Fillers', block: 'Block 1', detail: '3 items', frames: sec(100) },
      { title: 'Fillers', block: 'Block 2', detail: '1 item', frames: sec(120) },
    ]);
    expect(r.lastItems).toEqual([{ listId: 'L', position: 1 }]);
  });

  it('may repeat items on the same day when the list allows it, and loops while something fits', () => {
    const r = fillRotation(day(), blocks().slice(0, 1), new Map([['L', list({ allowSameDayRepeat: true, items: [item(1, 'f3', 30), item(2, 'f2', 60)] })]]), productions(), ctx, 'missing', newId);
    expect(titles(r.draft, 0)).toEqual(['p1', 'F3', 'F2', 'F3', 'F2', 'g1']);
  });

  it('counts a block in whole seconds and leaves a block alone when less than a second is free', () => {
    const almost: DayDraft = { blocks: [{ id: 'b1', rows: [row('p1', 'program', { lengthFrames: min(5) - 10 }), gc('g1')] }] };
    // planned 5:00 + 20 frames: 20 frames do not count, the free time is 10 frames
    const r = fillRotation(almost, [{ ...blocks()[0], plannedLengthFrames: min(5) + 20 }], new Map([['L', list()]]), productions(), ctx, 'missing', newId);
    expect(r.report.placed).toEqual([]);
    expect(r.report.notPlaced).toEqual([]);
  });

  it('applies the gates: used in this day, days since last use, dates, channels', () => {
    const lists = new Map([['L', list({ insertionDaysInterval: 3, applyChannelRestrictions: true, items: [item(1, 'f1', 120, '2030-05-30'), item(2, 'f2', 60, '2030-05-27'), item(3, 'f3', 30), item(4, 'f4', 10)] })]]);
    const prods = productions({ f3: { expires: '2030-06-01' }, f4: { channelIds: ['other'] } });
    const inDay: DayDraft = { blocks: [{ id: 'b1', rows: [row('x', 'filler', { productionId: 'f2', rotationListId: 'L', lengthFrames: 0 }), gc('g1')] }, { id: 'b2', rows: [gc('g2')] }] };
    const r = fillRotation(inDay, blocks(), lists, prods, ctx, 'missing', newId);
    // f1 used 2 days ago (interval 3), f2 already in the day, f3 expires today, f4 not for this channel
    expect(r.report.placed).toEqual([]);
    expect(r.report.notPlaced.map((l) => l.block)).toEqual(['Block 1', 'Block 2']);
    // without the interval and a day later, f1 and f2 may go in again (f2 is still in the day)
    const r2 = fillRotation(inDay, blocks(), new Map([['L', { ...lists.get('L')!, insertionDaysInterval: 0 }]]), prods, ctx, 'missing', newId);
    expect(titles(r2.draft, 0)).toEqual(['x', 'F1', 'g1']);
  });

  it('starts / expires: an item airs from its first day and before its last', () => {
    const r = fillRotation(day(), blocks().slice(0, 1), new Map([['L', list()]]), productions({ f1: { starts: '2030-06-02' }, f2: { starts: '2030-06-01' }, f3: { expires: '2030-06-02' } }), ctx, 'missing', newId);
    expect(titles(r.draft, 0)).toEqual(['p1', 'F2', 'F3', 'F4', 'g1']);
  });

  it('time windows: rejected ones keep an item out, allowed ones let it in only there', () => {
    // block 1 starts 06:00 on Saturday (6)
    const block = blocks()[0];
    const at = (weekday: number, h: number, hours = 1) => ({ weekday, startFrames: min(h * 60), lengthFrames: min(hours * 60) });
    expect(inTimeWindows({ allowed: [], rejected: [at(6, 5, 2)] }, block, ctx)).toBe(false);
    expect(inTimeWindows({ allowed: [], rejected: [at(0, 5, 2)] }, block, ctx)).toBe(true);
    expect(inTimeWindows({ allowed: [at(6, 6)], rejected: [] }, block, ctx)).toBe(true);
    expect(inTimeWindows({ allowed: [at(6, 20)], rejected: [] }, block, ctx)).toBe(false);
    // a block after midnight falls on the next weekday (Sunday 01:00)
    expect(inTimeWindows({ allowed: [at(0, 1)], rejected: [] }, { plannedStartFrames: min(19 * 60), plannedLengthFrames: min(60) }, ctx)).toBe(true);
  });

  it('says why a block was not filled, and all again takes the list’s rows out first', () => {
    const r = fillRotation(day(), blocks(null), new Map(), productions(), ctx, 'missing', newId);
    expect(r.report.notPlaced.map((l) => l.detail)).toEqual(['No rotation list is set for this block.', 'No rotation list is set for this block.']);
    const once = fillRotation(day(), blocks(), new Map([['L', list()]]), productions(), ctx, 'missing', newId).draft;
    const all = fillRotation(once, blocks(), new Map([['L', list()]]), productions(), ctx, 'all', newId);
    expect(all.report.removed).toBe(4);
    expect(titles(all.draft, 0)).toEqual(titles(once, 0));
  });

  it('shuffles a list that inserts at random', () => {
    const r = fillRotation(day(), blocks().slice(0, 1), new Map([['L', list({ randomInsert: true })]]), productions(), { ...ctx, random: () => 0 }, 'missing', newId);
    expect(r.report.placed[0].detail).toBe('3 items');
  });
});

describe('steps and issues of a day', () => {
  const ads: AdsBreak[] = [{ blockTypeId: 'type-Billboard 1', name: 'Billboard 1', spots: [{ kind: 'commercial', title: 'A', lengthFrames: 100, productionId: 'pa', segmentId: null, tcInFrames: 0, tcOutFrames: 100 }] }];
  const input = (over = {}) => ({ isMain: true, hasAds: true, placements: [expected('o1', 'b1', ['ep1']), expected('o2', null, ['ep2'])], adsBreaks: ads, fillBlocks: [{ id: 'b1', listId: 'L', gapFrames: min(3) }], second: 25, notReady: 1, ...over });
  const empty: DayDraft = { blocks: [{ id: 'b1', rows: [brk('Billboard 1'), gc('g1')] }] };

  it('says what is still to do', () => {
    const c = dayChecks(empty, input());
    expect(c.steps.map((s) => [s.label, s.tone, s.text, s.ran])).toEqual([
      ['Program placements', 'todo', '1 airing to place', false],
      ['Break events', 'todo', '1 break to fill', false],
      ['Rotation lists', 'todo', '1 block has a gap', false],
    ]);
    expect(c.issues.map((i) => [i.text, i.step])).toEqual([
      ['1 airing of confirmed plans is not in the day', 'programs'],
      ['1 airing names a block this day does not have', null],
      ['1 linked break differs from the ads playlist', 'breaks'],
      ['1 block has a gap to fill', 'rotation'],
      ['1 row: media not ready', null],
    ]);
  });

  it('and what is done', () => {
    const done: DayDraft = {
      blocks: [{ id: 'b1', rows: [row('p', 'program', { orderId: 'o1' }), brk('Billboard 1'), row('s', 'commercial', { title: 'A', productionId: 'pa', relatedEventId: 'Billboard 1' }), row('f', 'filler', { rotationListId: 'L' }), gc('g1')] }],
    };
    const c = dayChecks(done, input({ placements: [expected('o1', 'b1', ['ep1'])], fillBlocks: [{ id: 'b1', listId: 'L', gapFrames: 10 }], notReady: 0 }));
    expect(c.steps.map((s) => [s.tone, s.text, s.ran])).toEqual([
      ['done', 'Placed', true],
      ['done', 'The linked break matches the ads playlist', true],
      ['done', 'No gaps left to fill', true],
    ]);
    expect(c.issues).toEqual([]);
  });

  it('an ads playlist has only the rotation step; a main one without an ads day cannot import breaks', () => {
    expect(dayChecks(empty, input({ isMain: false })).steps.map((s) => s.step)).toEqual(['rotation']);
    const noAds = dayChecks(empty, input({ adsBreaks: null })).steps[1];
    expect(noAds).toMatchObject({ step: 'breaks', tone: 'none', why: 'Create the week of the ads playlist first' });
  });
});
