import { describe, expect, it } from 'vitest';
import { dayChecks, fillCommercials, fitsPosition, type AdsDayBlock, type BookedSpot, type DayDraft, type DraftRow } from './index';

const sec = (s: number) => s * 25;
const row = (id: string, over: Partial<DraftRow> = {}): DraftRow => ({
  id, kind: 'commercial', title: id, lengthFrames: sec(15), productionId: null, segmentId: null, tcInFrames: 0, tcOutFrames: 0, fixed: false, hold: false, autoAdjust: false,
  note: '', breakTypeId: null, relatedEventId: null, orderId: null, rotationListId: null, airingItemId: null, ...over,
});
let next = 0;
const newId = () => `n${++next}`;
/** No shuffling: spots, blocks and gaps are tried in their own order. */
const ctx = { orderOfSpot: new Map<string, number>(), defaultOrder: 5, random: () => 0.999999 };
const spot = (id: string, production: string, breakTypeId: string, seconds: number, positionOrder = 5, passes = 1): BookedSpot => ({
  id, orderId: 'o1', orderName: 'AURORA SD - NOVAMART', breakTypeId, breakName: breakTypeId === 'ab' ? 'Ad Pod 13:30' : breakTypeId === 'sp' ? 'Billboard 1 13:00' : 'Billboard 9 13:50',
  production: { id: production, title: `Spot ${production}`, kind: 'commercial', segments: seconds ? [{ id: null, tcInFrames: 0, tcOutFrames: sec(seconds), lengthFrames: sec(seconds) }] : [] },
  positionOrder, positionName: positionOrder === 4 ? 'Ad Top' : 'Ad', passes,
});
const blocks: AdsDayBlock[] = [
  { id: 'AB', name: 'Ad Pod 13:30', blockTypeId: 'ab', lengthFrames: sec(60) },
  { id: 'SP', name: 'Billboard 1 13:00', blockTypeId: 'sp', lengthFrames: sec(30) },
];
const empty = (): DayDraft => ({ blocks: [{ id: 'AB', rows: [] }, { id: 'SP', rows: [] }] });
const titles = (d: DayDraft, i: number) => d.blocks[i].rows.map((r) => `${r.productionId}:${r.airingItemId}`);

describe('import commercials (automatic placement of booked spots)', () => {
  it('keeps break-position order, room in the break, and never the same spot twice in a row', () => {
    const spots = [spot('s1', 'p1', 'ab', 20, 5, 2), spot('s2', 'p2', 'ab', 15, 4), spot('s3', 'p3', 'sp', 20), spot('s4', 'p4', 'sp', 20), spot('s5', 'p5', 'zz', 20), spot('s6', 'p6', 'ab', 0)];
    const { draft, report } = fillCommercials(empty(), blocks, spots, ctx, 'missing', newId);
    // Commercial Top (4) before Commercial (5); the second pass of p1 would touch the first
    expect(titles(draft, 0)).toEqual(['p2:s2', 'p1:s1']);
    expect(titles(draft, 1)).toEqual(['p3:s3']);
    expect(draft.blocks[0].rows[1]).toMatchObject({ orderId: 'o1', airingItemId: 's1', lengthFrames: sec(20) });
    // the report reads like the day: break time, then break position, then title
    expect(report.placed.map((l) => [l.title, l.block, l.detail])).toEqual([
      ['Spot p2', 'Ad Pod 13:30', 'AURORA SD - NOVAMART · Ad Top'],
      ['Spot p1', 'Ad Pod 13:30', 'AURORA SD - NOVAMART · Ad'],
      ['Spot p3', 'Billboard 1 13:00', 'AURORA SD - NOVAMART · Ad'],
    ]);
    expect(report.notPlaced.map((l) => [l.title, l.detail])).toEqual([
      ['Spot p1', 'It would air right after itself. 1 of 2 plays placed. AURORA SD - NOVAMART.'],
      ['Spot p6', 'It has no length in the catalog. AURORA SD - NOVAMART.'],
      ['Spot p4', 'The break has no room left for it. AURORA SD - NOVAMART.'],
      ['Spot p5', 'The ads playlist has no such break on this day. AURORA SD - NOVAMART.'],
    ]);
  });

  it('places every play when other spots can sit between them', () => {
    const spots = [spot('s1', 'p1', 'ab', 10, 5, 2), spot('s2', 'p2', 'ab', 10, 5)];
    const { draft, report } = fillCommercials(empty(), blocks, spots, ctx, 'missing', newId);
    expect(titles(draft, 0)).toEqual(['p1:s1', 'p2:s2', 'p1:s1']);
    expect(report.notPlaced).toEqual([]);
    expect(report.placed[0].detail).toBe('AURORA SD - NOVAMART · Ad · 2 plays');
  });

  it('only what is missing keeps what is there; all again takes the plan rows out first', () => {
    const draft: DayDraft = { blocks: [{ id: 'AB', rows: [row('x', { productionId: 'p2', orderId: 'o1', airingItemId: 's2' }), row('h', { productionId: 'h1' })] }, { id: 'SP', rows: [] }] };
    const spots = [spot('s2', 'p2', 'ab', 15, 4)];
    const missing = fillCommercials(draft, blocks, spots, ctx, 'missing', newId);
    expect(missing.report).toMatchObject({ kept: 1, removed: 0, placed: [], notPlaced: [] });
    const all = fillCommercials(draft, blocks, spots, ctx, 'all', newId);
    expect(all.report).toMatchObject({ kept: 0, removed: 1 });
    // the hand-placed row has the default position (5): Commercial Top goes before it
    expect(titles(all.draft, 0)).toEqual(['p2:s2', 'h1:null']);
  });

  it('a position fits between the plans around it', () => {
    expect(fitsPosition([], 0, 3)).toBe(true);
    expect(fitsPosition([4, 5], 0, 4)).toBe(true);
    expect(fitsPosition([4, 5], 0, 5)).toBe(false);
    expect(fitsPosition([4, 6], 1, 5)).toBe(true);
    expect(fitsPosition([4, 6], 2, 5)).toBe(false);
    expect(fitsPosition([4, 6], 2, 8)).toBe(true);
  });
});

describe('the ads playlist’s step and issues', () => {
  it('counts booked plays in the day and rows no longer booked', () => {
    const draft: DayDraft = { blocks: [{ id: 'AB', rows: [row('a', { airingItemId: 's1', orderId: 'o1' }), row('b', { orderId: 'o1' })] }] };
    const { steps, issues } = dayChecks(draft, { isMain: false, hasAds: false, placements: [], adsBreaks: null, fillBlocks: [], second: 25, notReady: 0, booked: [{ id: 's1', passes: 2 }, { id: 's2', passes: 1 }] });
    expect(steps.find((s) => s.step === 'commercials')).toMatchObject({ tone: 'partial', text: '1 of 3 spots placed', ran: true });
    expect(issues.map((i) => [i.key, i.text])).toEqual([
      ['commercials-missing', '2 booked spots are not in the ads playlist'],
      ['commercials-stale', '1 spot in the ads playlist is no longer booked'],
    ]);
  });
});
