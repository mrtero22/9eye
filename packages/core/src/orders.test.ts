import { describe, expect, it } from 'vitest';
import { FRAME_RATES, framesPerDay, minutesToFrames } from './timecode';
import { addDays } from './week';
import {
  airingCount,
  autoPlace,
  copyWeek,
  firstCompleteWeek,
  nextItemFor,
  replaceItems,
  rotate,
  shiftAirings,
  splitOrder,
  validateOrder,
  type AiringDraft,
  type OrderDraft,
  type OrderRuleContext,
  type TemplateDay,
} from './orders';

const R = FRAME_RATES['25'];
const h = (hours: number) => minutesToFrames(hours * 60, R);
// A Lumen-Plus-like channel: day from 09:00, week from Saturday, one-hour blocks named by their clock time.
const BLOCKS: Record<string, number> = { D11: h(2), R15: h(6), R19: h(10), R23: h(14), N03: h(18), N07: h(22) };
const day = (): TemplateDay => new Map(Object.entries(BLOCKS).map(([k, start]) => [k, { startFrames: start, lengthFrames: h(1) }]));
const CH = 'ch-1';
const ctx: OrderRuleContext = { templates: new Map([[CH, [day(), day(), day(), day(), day(), day(), day()]]]), dayFrames: framesPerDay(R) };

let n = 0;
const id = (p: string) => `${p}-${++n}`;
const first = (date: string, bt: string, itemId: string): AiringDraft => ({ id: id('a'), channelId: CH, date, blockTypeId: bt, passes: 1, repeatOfId: null, repeatIndex: 0, blockColor: null, items: [{ itemId, passes: 0, jingle: null }] });
const repeat = (date: string, bt: string, of: AiringDraft): AiringDraft => ({ id: id('r'), channelId: CH, date, blockTypeId: bt, passes: 0, repeatOfId: of.id, repeatIndex: 0, blockColor: null, items: [] });

function order(items: number, airings: AiringDraft[] = [], extra: Partial<OrderDraft> = {}): OrderDraft {
  return {
    name: 'Harbor - Lumen Plus', mode: 'series', status: 'draft', startDate: '2026-10-17', endDate: '2026-11-06', color: '#0284c7',
    firstItemId: null, reuseInLoop: false, maxAirings: null, totalAirings: null, timeWindows: { allowed: [], rejected: [] },
    channels: [{ channelId: CH, templateId: 'tpl' }],
    items: Array.from({ length: items }, (_, i) => ({ id: `e${i + 1}`, productionId: `p${i + 1}`, lengthFrames: null })),
    airings, ...extra,
  };
}

/** One episode Sat / Mon / Wed at 15:00 with repeats 19:00, 23:00, 03:00 (same broadcast day) and 11:00 the next day. */
function week(start: string, eps: string[]): AiringDraft[] {
  const out: AiringDraft[] = [];
  [0, 2, 4].forEach((off, i) => {
    const f = first(addDays(start, off), 'R15', eps[i]);
    out.push(f, repeat(f.date, 'R19', f), repeat(f.date, 'R23', f), repeat(f.date, 'N03', f), repeat(addDays(f.date, 1), 'D11', f));
  });
  return out;
}

describe('copy week to the whole plan', () => {
  it('fills every week, gives each first airing the next episode and carries repeats of the week before', () => {
    const w1 = week('2026-10-17', ['e1', 'e2', 'e3']);
    const w2 = week('2026-10-24', ['e4', 'e5', 'e6']);
    const wedW1 = w1[10];
    const wedW2 = w2[10];
    // the reference week also replays last Wednesday on Saturday morning (+3) and this Wednesday on Friday (+2)
    const spill = repeat('2026-10-24', 'N07', wedW1);
    const friday = repeat('2026-10-30', 'R19', wedW2);
    const d = order(10, [...w1, ...w2, spill, friday]);
    const r = copyWeek(d, ctx, CH, '2026-10-24');
    expect(r.ok).toBe(true);
    expect(r.otherWeeks).toBe(2);
    expect(r.firsts).toBe(9);
    expect(r.spill).toBe(1);
    // 14 repeats a week; the first week's Saturday-morning replay has no Wednesday before the order starts
    expect(r.repeats).toBe(41);
    expect(r.withoutFirst).toBe(1);
    expect(r.lastFirstDate).toBe('2026-11-04');
    expect([r.firstItemId, r.lastItemId, r.notPlaced]).toEqual(['e1', 'e9', 1]);
    const at = (date: string, bt: string) => r.airings.find((a) => a.date === date && a.blockTypeId === bt)!;
    expect(at('2026-10-31', 'R15').items[0].itemId).toBe('e7');
    expect(at('2026-10-31', 'N07').repeatOfId).toBe(at('2026-10-28', 'R15').id);
    expect(at('2026-11-06', 'R19').repeatOfId).toBe(at('2026-11-04', 'R15').id);
    expect(validateOrder({ ...d, airings: r.airings }, ctx)).toEqual([]);
  });

  it('starts at the first episode to place and starts again when the list runs out, if asked', () => {
    const d = order(4, week('2026-10-24', ['e1', 'e2', 'e3']), { firstItemId: 'e2' });
    const r = copyWeek(d, ctx, CH, '2026-10-24');
    expect(r.ranOut).toBe(6);
    expect(r.firsts).toBe(3);
    const looping = copyWeek({ ...d, reuseInLoop: true }, ctx, CH, '2026-10-24');
    const items = looping.airings.filter((a) => !a.repeatOfId).sort((a, b) => (a.date < b.date ? -1 : 1)).map((a) => a.items[0].itemId);
    expect(items).toEqual(['e2', 'e3', 'e4', 'e1', 'e2', 'e3', 'e4', 'e1', 'e2']);
  });

  it('needs a complete channel week inside the plan, and keeps the airing limit', () => {
    const d = order(10, week('2026-10-31', ['e1', 'e2', 'e3']), { endDate: '2026-11-04' });
    expect(copyWeek(d, ctx, CH, '2026-10-31').reason).toMatch(/Not a complete week of the plan/);
    expect(firstCompleteWeek('2026-10-18', '2026-11-04', 6)).toBe('2026-10-24');
    const limited = copyWeek(order(10, week('2026-10-24', ['e1', 'e2', 'e3']), { maxAirings: 5 }), ctx, CH, '2026-10-24');
    expect(limited.ok).toBe(false);
    expect(limited.reason).toBe('Only 5 airings can be placed; copying gives 9.');
  });
});

describe('save rules', () => {
  it('lists every broken rule', () => {
    const f = first('2026-10-24', 'R15', 'e1');
    const d = order(2, [
      f,
      repeat('2026-10-23', 'R19', f),
      first('2026-11-07', 'R15', 'e2'),
      first('2026-10-24', 'XX', 'e2'),
      first('2026-10-24', 'R15', 'e2'),
      first('2026-10-25', 'R15', 'nope'),
    ]);
    const codes = validateOrder(d, ctx).map((p) => p.code);
    expect(codes).toEqual(['repeat', 'outside', 'block', 'twice', 'item']);
    expect(validateOrder(order(2, [f, first('2026-10-26', 'R15', 'e2')], { maxAirings: 1 }), ctx).map((p) => p.message)).toEqual(['Only 1 airings can be placed; this plan has 2.']);
  });
  it('counts airings: first airings for a series, plays otherwise', () => {
    const f = first('2026-10-24', 'R15', 'e1');
    expect(airingCount(order(1, [f, repeat('2026-10-24', 'R19', f)]))).toBe(1);
    expect(airingCount({ mode: 'promos', airings: [{ ...f, passes: 4 }, { ...f, passes: 2 }] })).toBe(6);
  });
});

describe('placing by hand', () => {
  it('a new first airing takes the episode after the one before it', () => {
    const d = order(3, [first('2026-10-24', 'R15', 'e1'), first('2026-10-26', 'R15', 'e2')]);
    expect(nextItemFor(d, ctx, CH, '2026-10-24', 'R19')).toBe('e2');
    expect(nextItemFor(d, ctx, CH, '2026-10-27', 'D11')).toBe('e3');
    expect(nextItemFor(d, ctx, CH, '2026-10-17', 'D11')).toBe('e1');
    expect(nextItemFor({ ...d, airings: [...d.airings, first('2026-10-27', 'R15', 'e3')] }, ctx, CH, '2026-10-28', 'R15')).toBe(null);
  });
});

describe('trailer rotation', () => {
  it('spreads the plays of a day over its blocks, each item by its share', () => {
    const d = order(2, [], { mode: 'promos', startDate: '2026-10-24', endDate: '2026-10-25' });
    const r = rotate(d, ctx, CH, { passesPerDay: 12, shares: [{ itemId: 'e1', percent: 75 }, { itemId: 'e2', percent: 25 }] });
    expect(r.ok).toBe(true);
    expect([r.days, r.blocksPerDay, r.perItem.get('e1'), r.perItem.get('e2')]).toEqual([2, 6, 9, 3]);
    const sat = r.airings.filter((a) => a.date === '2026-10-24');
    expect(sat.map((a) => a.passes)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(sat.flatMap((a) => a.items).reduce((s, x) => s + (x.itemId === 'e2' ? x.passes : 0), 0)).toBe(3);
    expect(rotate(d, ctx, CH, { passesPerDay: 12, shares: [{ itemId: 'e1', percent: 70 }] }).reason).toBe('The shares add up to 70 %, not 100 %.');
  });
});

describe('auto-place', () => {
  it('series: the next item in every free block of the allowed windows', () => {
    const d = order(3, [], { startDate: '2026-10-24', endDate: '2026-10-30', timeWindows: { allowed: [{ weekdays: [true, true, true, true, true, true, true], fromFrames: h(6), toFrames: h(7) }], rejected: [] } });
    const r = autoPlace(d, ctx, CH, { passesPerBlock: 1, taken: new Set(['2026-10-25|R15']) });
    expect(r.airings.map((a) => [a.date, a.items[0].itemId])).toEqual([['2026-10-24', 'e1'], ['2026-10-26', 'e2'], ['2026-10-27', 'e3']]);
    expect(autoPlace({ ...d, timeWindows: { allowed: [], rejected: [] } }, ctx, CH, { passesPerBlock: 1 }).ok).toBe(false);
  });
});

describe('replace and split', () => {
  it('replaces items inside the dates only and says what it left', () => {
    const d = order(3, [first('2026-10-24', 'R15', 'e1'), first('2026-10-31', 'R15', 'e1'), first('2026-10-31', 'R19', 'e2')]);
    const r = replaceItems(d, { oldItemIds: ['e1'], newItemId: 'e3', from: '2026-10-25', to: '2026-11-06' });
    expect(r.found).toBe(1);
    expect(r.ignored).toEqual([{ reason: 'before the start date', count: 1 }]);
    expect(r.airings[1].items[0].itemId).toBe('e3');
  });
  it('ends the plan the day before and moves the rest with new ids; repeats of earlier airings go', () => {
    const f = first('2026-10-29', 'R15', 'e1');
    const d = order(2, [f, repeat('2026-10-30', 'D11', f), first('2026-10-31', 'R15', 'e2')]);
    const s = splitOrder(d, '2026-10-30', 'Harbor - part 2');
    expect(s.ok).toBe(true);
    expect([s.keep.endDate, s.keep.airings.length, s.rest.startDate, s.rest.airings.length, s.droppedRepeats]).toEqual(['2026-10-29', 1, '2026-10-30', 1, 1]);
    expect(s.rest.items[1].id).not.toBe('e2');
    expect(s.rest.airings[0].items[0].itemId).toBe(s.rest.items[1].id);
    expect(splitOrder(d, '2026-10-17', 'x').ok).toBe(false);
  });
});

describe('shift airings', () => {
  // Sat / Mon / Wed at 15:00, each with four repeats, over three weeks (e1 … e9); the order runs on to 20 Nov
  const three = () => [...week('2026-10-17', ['e1', 'e2', 'e3']), ...week('2026-10-24', ['e4', 'e5', 'e6']), ...week('2026-10-31', ['e7', 'e8', 'e9'])];
  const at = (airings: AiringDraft[], date: string, bt = 'R15') => airings.find((a) => a.date === date && a.blockTypeId === bt);

  it('later: the episodes move along the airing days, the first days empty and the weekly pattern goes on', () => {
    const w = three();
    const d = order(9, w, { endDate: '2026-11-20' });
    const r = shiftAirings(d, ctx, CH, w[20].id, 1); // from Mon 26 Oct (e5)
    expect(r.ok).toBe(true);
    expect([r.moved, r.emptied.length, r.emptied[0].repeats, r.added.length, r.added[0].repeats, r.outside]).toEqual([5, 1, 4, 1, 4, 0]);
    expect(at(r.airings, '2026-10-26')).toBeUndefined();
    expect(at(r.airings, '2026-10-26', 'R19')).toBeUndefined();
    expect(at(r.airings, '2026-10-27', 'D11')).toBeUndefined();
    // the days and their repeats stay; only the episode changes
    expect(at(r.airings, '2026-10-28')).toMatchObject({ id: w[25].id, items: [{ itemId: 'e5' }] });
    expect(at(r.airings, '2026-10-28', 'R19')!.repeatOfId).toBe(w[25].id);
    expect(at(r.airings, '2026-11-04')!.items[0].itemId).toBe('e8');
    // e9 continues the pattern: Saturday a week after the last Saturday, with its repeats
    const sat = at(r.airings, '2026-11-07')!;
    expect(sat.items[0].itemId).toBe('e9');
    expect(r.airings.filter((a) => a.repeatOfId === sat.id).map((a) => `${a.date} ${a.blockTypeId}`)).toEqual(['2026-11-07 R19', '2026-11-07 R23', '2026-11-07 N03', '2026-11-08 D11']);
    expect(r.airings).toHaveLength(d.airings.length);
    expect(validateOrder({ ...d, airings: r.airings }, ctx)).toEqual([]);
  });

  it('earlier, the mirror: the chosen episode and every one before it go back; its day empties and the pattern goes on before', () => {
    const w = three();
    const d = order(9, w, { startDate: '2026-10-10', endDate: '2026-11-20' });
    const r = shiftAirings(d, ctx, CH, w[20].id, -1); // from Mon 26 Oct (e5) back
    expect(r.ok).toBe(true);
    expect([r.moved, r.emptied.map((e) => e.airing.date), r.added.map((e) => e.airing.date), r.added[0].repeats]).toEqual([5, ['2026-10-26'], ['2026-10-14'], 4]);
    // e1 takes a new Wednesday a week before the first Wednesday, with its repeats
    const wed = at(r.airings, '2026-10-14')!;
    expect(wed.items[0].itemId).toBe('e1');
    expect(r.airings.filter((a) => a.repeatOfId === wed.id).map((a) => `${a.date} ${a.blockTypeId}`)).toEqual(['2026-10-14 R19', '2026-10-14 R23', '2026-10-14 N03', '2026-10-15 D11']);
    expect(at(r.airings, '2026-10-17')!.items[0].itemId).toBe('e2');
    expect(at(r.airings, '2026-10-24')).toMatchObject({ id: w[15].id, items: [{ itemId: 'e5' }] });
    expect(at(r.airings, '2026-10-26')).toBeUndefined();
    expect(at(r.airings, '2026-10-27', 'D11')).toBeUndefined();
    // the episodes after it stay
    expect(at(r.airings, '2026-10-28')).toBe(w[25]);
    expect(validateOrder({ ...d, airings: r.airings }, ctx)).toEqual([]);
  });

  it('is all-or-nothing: the plan ends or starts too soon, a new day on a block this plan uses', () => {
    const w = three();
    // the order ends Fri 6 Nov: e9 has no Saturday left
    expect(shiftAirings(order(9, w), ctx, CH, w[20].id, 1)).toMatchObject({ ok: false, airings: w, reason: '1 episode has no airing day before the plan ends (Fri 6 Nov 2026). Change the end date first.' });
    // the order starts Sat 17 Oct: e1 has no Wednesday before it
    expect(shiftAirings(order(9, w), ctx, CH, w[20].id, -1).reason).toBe('The plan starts on Sat 17 Oct 2026: 1 episode has no airing day left. Change the start date first.');
    // a repeat of Wednesday 4 Nov sits where next Saturday's 19:00 repeat goes
    const stray = repeat('2026-11-07', 'R19', w[40]);
    expect(shiftAirings(order(9, [...w, stray], { endDate: '2026-11-20' }), ctx, CH, w[20].id, 1).reason).toBe('Sat 7 Nov 2026: a new airing day of the pattern falls on a block this plan already uses.');
  });
});
