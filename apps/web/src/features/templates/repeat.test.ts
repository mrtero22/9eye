import { describe, expect, it } from 'vitest';
import { FRAME_RATES, minutesToFrames, type BlockDraft, type TemplateDraft } from '@9eye/core';
import type { BlockGroup, BlockType, TemplateFull } from '@/lib/types';
import { buildCtx } from './model';
import { planRepeat, type RepeatInput } from './repeat';

const R = FRAME_RATES['25'];
const min = (m: number) => minutesToFrames(m, R);
const ALL = [true, true, true, true, true, true, true];
const SAT = 6;

function type(id: string, name: string, minutes: number): BlockType {
  return {
    id, name, groupId: 'g', color: '#4a90e2', textColor: '#ffffff', lengthFrames: min(minutes), validWeekdays: ALL, validFrom: '2026-01-01', validTo: '2099-12-31',
    playlistId: 'ads', fillGaps: false, opensWithBreak: false, note: '', kind: 'ads', channelId: 'c', channelName: 'DRAMA', usedCount: 0,
  };
}
const types = [
  ...[1, 2, 3, 4, 5, 6].map((n) => type(`sp${n}`, `sp ${n}`, 5)),
  type('ab1', 'drama addbox 1', 18),
  type('ab2', 'drama addbox 2', 18),
];
const groups: BlockGroup[] = [{ id: 'g', name: 'drama sp', color: null }];

const full = {
  template: { id: 't', name: 'ADS', kind: 'ads', playlistId: 'ads', channelId: 'c', validFrom: '2026-10-17', validTo: '2027-10-15', activeWeekdays: ALL, version: 1, updatedAt: '' },
  channel: { id: 'c', name: 'DRAMA', code: 'D', frameRate: '25', dayStartFrames: min(8 * 60), weekStart: SAT, mainPlaylistId: 'main', adsPlaylistId: 'ads' },
  blocks: [],
  ads: null,
  main: null,
} as unknown as TemplateFull;
const ctx = buildCtx(full, types, groups);

const b = (weekday: number, typeId: string, startMin: number, lengthMin: number): BlockDraft => ({
  id: `${typeId}@${weekday}@${startMin}`, weekday, blockTypeId: typeId, startFrames: min(startMin), lengthFrames: min(lengthMin),
  fillGaps: false, opensWithBreak: false, note: '', rotationListId: null, limitsPerContentType: [], breaks: [],
});
// Saturday 08:00–09:00, as built by hand: sp 1, sp 2, addbox 1, sp 3, sp 4, addbox 2
const hour = [b(SAT, 'sp1', 0, 5), b(SAT, 'sp2', 5, 5), b(SAT, 'ab1', 10, 18), b(SAT, 'sp3', 30, 5), b(SAT, 'sp4', 35, 5), b(SAT, 'ab2', 40, 18)];
const draft = (blocks: BlockDraft[] = hour): TemplateDraft => ({ name: 'ADS', validFrom: '2026-10-17', validTo: '2027-10-15', activeWeekdays: ALL, blocks });
const onlySat = [false, false, false, false, false, false, true];
const input = (patch: Partial<RepeatInput> = {}): RepeatInput => ({ weekday: SAT, from: 0, to: min(60), every: min(60), until: 0, days: onlySat, naming: 'number', ...patch });
const nameOf = (p: ReturnType<typeof planRepeat>, id: string) => types.find((t) => t.id === id)?.name ?? p.newTypes.find((n) => n.tempId === id)?.name;

describe('repeat a time range', () => {
  it('fills the day with the next numbers of each series, using the unused ones first', () => {
    const p = planRepeat(ctx, draft(), input());
    expect(p.problems).toEqual([]);
    expect(p.copies).toBe(23);
    expect(p.reused.map((t) => t.name)).toEqual(['sp 5', 'sp 6']);
    expect(p.newTypes).toHaveLength(90 + 46);
    expect(p.newTypes.at(-1)!.name).toBe('drama addbox 48');
    expect(p.blocks).toHaveLength(23 * 6);
    const nine = p.blocks.filter((x) => x.startFrames >= min(60) && x.startFrames < min(120)).map((x) => [x.startFrames / min(1), nameOf(p, x.blockTypeId)]);
    expect(nine).toEqual([[60, 'sp 5'], [65, 'sp 6'], [70, 'drama addbox 3'], [90, 'sp 7'], [95, 'sp 8'], [100, 'drama addbox 4']]);
    const last = p.blocks.at(-1)!;
    expect([last.startFrames / min(1), nameOf(p, last.blockTypeId)]).toEqual([23 * 60 + 40, 'drama addbox 48']);
  });

  it('can name the copies with their time, and puts the whole pattern on other days', () => {
    const p = planRepeat(ctx, draft(), input({ naming: 'time', days: ALL }));
    expect(p.problems).toEqual([]);
    expect(p.newTypes.slice(0, 3).map((n) => n.name)).toEqual(['sp 1 09:00', 'sp 2 09:05', 'drama addbox 1 09:10']);
    expect(p.blocks).toHaveLength(23 * 6 + 6 * 24 * 6);
    expect(p.blocks.some((x) => x.weekday === 0 && x.blockTypeId === 'sp1' && x.startFrames === 0)).toBe(true);
  });

  it('skips what is already there on other days', () => {
    const sunday = hour.map((x) => ({ ...x, id: `${x.id}-sun`, weekday: 0 }));
    const p = planRepeat(ctx, draft([...hour, ...sunday]), input({ days: [true, false, false, false, false, false, true] }));
    expect(p.problems).toEqual([]);
    expect(p.skipped).toBe(6);
  });

  it('refuses everything when a copy does not fit', () => {
    const blocked = planRepeat(ctx, draft([...hour, b(0, 'sp6', 120, 5)]), input({ days: [true, false, false, false, false, false, true] }));
    expect(blocked.problems.length).toBeGreaterThan(0);
    expect(blocked.problems.join(' ')).toMatch(/overlaps|already used/);
    expect(planRepeat(ctx, draft(), input({ to: min(20) })).problems[0]).toMatch(/drama addbox 1 at 08:10 runs past the end of the range/);
    expect(planRepeat(ctx, draft(), input({ every: min(30) })).problems[0]).toMatch(/at least as long as the range/);
    expect(planRepeat(ctx, draft(), input({ until: min(60) })).problems[0]).toMatch(/no room for a copy/);
  });
});
