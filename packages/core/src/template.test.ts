import { describe, expect, it } from 'vitest';
import { FRAME_RATES, minutesToFrames } from './timecode';
import {
  applyPlan,
  breaksAtPositions,
  copyDay,
  daySignature,
  moveBreak,
  ordinal,
  planApply,
  positionsOf,
  updateBlock,
  addBlock,
  snapStart,
  validateTemplate,
  type AdsDays,
  type BlockDraft,
  type BlockTypeInfo,
  type RuleContext,
  type TemplateDraft,
} from './index';

const R = FRAME_RATES['25'];
const min = (m: number) => minutesToFrames(m, R);
const ALL = [true, true, true, true, true, true, true];

function type(id: string, groupId: string, lengthMin: number, validWeekdays = ALL): BlockTypeInfo {
  return { id, name: id, groupId, color: '#888888', lengthFrames: min(lengthMin), validWeekdays, validFrom: '2024-01-06', validTo: '2099-12-25', playlistId: 'p' };
}

const types = new Map<string, BlockTypeInfo>(
  [
    type('run1', 'run', 60),
    type('run2', 'run', 60),
    type('rep1', 'repeat', 60),
    type('half', 'half', 30),
    type('friOnly', 'run', 60, [false, false, false, false, false, true, false]),
  ].map((t) => [t.id, t]),
);

const ctx: RuleContext = { channel: { frameRate: '25', dayStartFrames: min(360), weekStart: 6 }, blockTypes: types, allowsBreaks: true };

function block(id: string, weekday: number, typeId: string, startMin: number, lengthMin = 60, breaks: string[] = []): BlockDraft {
  return { id, weekday, blockTypeId: typeId, startFrames: min(startMin), lengthFrames: min(lengthMin), fillGaps: true, opensWithBreak: true, note: '', rotationListId: null, limitsPerContentType: [], breaks };
}

function draft(blocks: BlockDraft[]): TemplateDraft {
  // 2024-03-23 is a Saturday, 2099-05-29 a Friday (Aurora Media's week starts on Saturday).
  return { name: 'Main', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL.slice(), blocks };
}

// A sample ads day: per hour Billboard 1 :00, Billboard 2 :05, Ad Pod :10, Billboard 5 :30, Billboard 6 :35, Ad Pod :40 (start = running place in the ads playlist).
function adsDay(hours: number[]): { blockTypeId: string; startFrames: number; lengthFrames: number }[] {
  return hours.flatMap((h) =>
    [
      ['Billboard 1', 0, 5],
      ['Billboard 2', 5, 5],
      ['AB30', 10, 18],
      ['Billboard 5', 30, 5],
      ['Billboard 6', 35, 5],
      ['AB53', 40, 18],
    ].map(([n, off, len]) => ({ blockTypeId: `${n}@${h}`, startFrames: min(h * 60 + (off as number)), lengthFrames: min(len as number) })),
  );
}
const hours = Array.from({ length: 24 }, (_, i) => i);
const ADS: AdsDays = [0, 1, 2, 3, 4, 5, 6].map(() => adsDay(hours));

describe('validateTemplate', () => {
  it('accepts a valid layout', () => {
    expect(validateTemplate(draft([block('a', 6, 'run1', 0), block('b', 6, 'rep1', 60)]), ctx)).toEqual([]);
  });

  it('refuses overlap, a type used twice a day, a wrong weekday and running past the day', () => {
    const problems = validateTemplate(
      draft([
        block('a', 6, 'run1', 0),
        block('b', 6, 'rep1', 30),
        block('c', 6, 'run1', 120),
        block('d', 0, 'friOnly', 0),
        block('e', 0, 'half', 1430, 30),
      ]),
      ctx,
    );
    expect(problems.map((p) => p.code).sort()).toEqual(['outside-day', 'overlap', 'type-twice', 'weekday']);
    expect(problems.find((p) => p.code === 'overlap')!.message).toBe('Saturday 06:30 (rep1) overlaps run1 at Saturday 06:00.');
  });

  it('checks the layout dates against the channel week', () => {
    const d = draft([]);
    expect(validateTemplate({ ...d, validFrom: '2024-03-24' }, ctx).map((p) => p.message)).toEqual([
      "The layout must start on a Saturday, the first day of the channel's week.",
    ]);
    expect(validateTemplate({ ...d, validTo: '2024-03-15' }, ctx).map((p) => p.code)).toEqual(['dates']);
    expect(validateTemplate({ ...d, name: '' }, ctx).map((p) => p.code)).toEqual(['name']);
    expect(validateTemplate({ ...d, name: 'x'.repeat(51) }, ctx).map((p) => p.code)).toEqual(['name']);
  });

  it('allows breaks only where the channel has an ads playlist', () => {
    const d = draft([block('a', 6, 'run1', 0, 60, ['Billboard 1@0'])]);
    expect(validateTemplate(d, { ...ctx, allowsBreaks: false }).map((p) => p.code)).toEqual(['no-breaks']);
    expect(validateTemplate(d, { ...ctx, breakTypeIds: new Set(['x']) }).map((p) => p.code)).toEqual(['not-a-break']);
    expect(validateTemplate(draft([block('a', 6, 'run1', 0, 60, ['Billboard 1@0', 'Billboard 1@0'])]), ctx).map((p) => p.code)).toEqual(['break-twice']);
  });
});

describe('editing', () => {
  it('adds and updates blocks only when the rules hold (nothing changes otherwise)', () => {
    const d = draft([block('a', 6, 'run1', 0)]);
    const bad = addBlock(d, block('b', 6, 'rep1', 30), ctx);
    expect(bad.ok).toBe(false);
    const good = addBlock(d, block('b', 6, 'rep1', 60), ctx);
    expect(good.ok && good.draft.blocks.length).toBe(2);
    const moved = updateBlock(d, 'a', { startFrames: min(1410) }, ctx);
    expect(moved.ok).toBe(false);
  });

  it('reorders breaks', () => {
    const d = draft([block('a', 6, 'run1', 0, 60, ['x', 'y', 'z'])]);
    expect(moveBreak(d, 'a', 2, -1).blocks[0].breaks).toEqual(['x', 'z', 'y']);
    expect(moveBreak(d, 'a', 0, -1).blocks[0].breaks).toEqual(['x', 'y', 'z']);
  });

  it('copies a day to other days, replacing their blocks, or refuses everything', () => {
    let n = 0;
    const newId = () => `n${++n}`;
    const d = draft([block('a', 6, 'run1', 0, 60, ['Billboard 1@0']), block('b', 0, 'rep1', 300)]);
    const r = copyDay(d, 6, [0, 1], ctx, newId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(daySignature(r.draft.blocks, 0)).toBe(daySignature(r.draft.blocks, 6));
    expect(r.draft.blocks.filter((b) => b.weekday === 0).map((b) => b.blockTypeId)).toEqual(['run1']);
    const fri = copyDay(draft([block('a', 5, 'friOnly', 0)]), 5, [6], ctx, newId);
    expect(fri.ok).toBe(false);
  });
});

describe('linked breaks by position (0016)', () => {
  it('finds positions inside the block time and maps them to another block', () => {
    const src = block('a', 6, 'run1', 0, 60, ['Billboard 1@0', 'AB30@0', 'AB53@0']);
    expect(positionsOf(src, ADS)).toEqual([0, 2, 5]);
    expect(breaksAtPositions([0, 2, 5], block('t', 0, 'run1', 13 * 60), ADS)).toEqual(['Billboard 1@13', 'AB30@13', 'AB53@13']);
    expect(breaksAtPositions([0, 2, 5], block('t', 0, 'half', 13 * 60, 30), ADS)).toBeNull();
    expect(positionsOf({ ...src, breaks: ['Billboard 1@5'] }, ADS)).toEqual([-1]);
  });

  it('applies to the same block type, the group or the length, all-or-nothing', () => {
    const d = draft([
      block('a', 6, 'run1', 0, 60, ['Billboard 1@0', 'Billboard 2@0']),
      block('b', 0, 'run1', 120),
      block('c', 1, 'run2', 300),
      block('d', 2, 'half', 600, 30),
      block('e', 3, 'rep1', 0),
    ]);
    const byType = planApply(d, 'a', 'type', ALL, types, ADS);
    expect(byType.ok).toBe(true);
    expect(byType.targets.map((b) => b.id)).toEqual(['b']);
    expect(applyPlan(d, byType).blocks.find((b) => b.id === 'b')!.breaks).toEqual(['Billboard 1@2', 'Billboard 2@2']);

    const byGroup = planApply(d, 'a', 'group', ALL, types, ADS);
    expect(byGroup.targets.map((b) => b.id)).toEqual(['b', 'c']);

    const byLength = planApply(d, 'a', 'length', ALL, types, ADS);
    expect(byLength.targets.map((b) => b.id)).toEqual(['b', 'c', 'e']);

    const onlyMonday = planApply(d, 'a', 'group', [false, true, false, false, false, false, false], types, ADS);
    expect(onlyMonday.targets.map((b) => b.id)).toEqual(['c']);
  });

  it('refuses everything when one target has no break at a needed position', () => {
    const d = draft([
      block('a', 6, 'run1', 0, 60, ['Billboard 1@0', 'AB53@0']),
      block('b', 0, 'run1', 120),
      block('c', 1, 'run1', 300),
    ]);
    const ads = ADS.slice();
    ads[1] = adsDay(hours.filter((h) => h !== 5)); // Monday has no breaks in the 11:00 hour
    const plan = planApply(d, 'a', 'type', ALL, types, ads);
    expect(plan.ok).toBe(false);
    expect(plan.failures.map((b) => b.id)).toEqual(['c']);
    expect(applyPlan(d, plan)).toBe(d);
  });

  it('refuses when the source has a break outside its own time', () => {
    const d = draft([block('a', 6, 'run1', 0, 60, ['Billboard 1@3']), block('b', 0, 'run1', 120)]);
    const plan = planApply(d, 'a', 'type', ALL, types, ADS);
    expect(plan.ok).toBe(false);
    expect(plan.outside).toEqual(['Billboard 1@3']);
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});

describe('dragging a block (snapStart)', () => {
  const opts = { step: min(5), magnet: min(3), dayFrames: min(1440) };
  it('lands on 5-minute steps', () => {
    expect(snapStart([], 6, min(62), min(60), opts)).toBe(min(60));
    expect(snapStart([], 6, min(63), min(60), opts)).toBe(min(65));
  });
  it('sticks to the edge of a neighbour when close', () => {
    const blocks = [block('a', 6, 'run1', 0, 47)];
    expect(snapStart(blocks, 6, min(49), min(60), opts)).toBe(min(47));
    expect(snapStart(blocks, 6, min(56), min(60), opts)).toBe(min(55));
    // the end of the dragged block meets the start of the next one
    const next = [block('b', 6, 'run2', 120, 60)];
    expect(snapStart(next, 6, min(58), min(61), opts)).toBe(min(59));
    // another weekday or the dragged block itself does not count
    expect(snapStart(blocks, 0, min(49), min(60), opts)).toBe(min(50));
    expect(snapStart(blocks, 6, min(49), min(60), { ...opts, exceptId: 'a' })).toBe(min(50));
  });
  it('sticks to the start and the end of the day', () => {
    expect(snapStart([], 6, min(2), min(60), opts)).toBe(0);
    expect(snapStart([], 6, min(1378), min(60), opts)).toBe(min(1380));
  });
  it('stays inside the broadcast day', () => {
    expect(snapStart([], 6, -min(20), min(60), opts)).toBe(0);
    expect(snapStart([], 6, min(1430), min(60), opts)).toBe(min(1380));
  });
});
