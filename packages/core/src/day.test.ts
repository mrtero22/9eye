import { describe, expect, it } from 'vitest';
import { FRAME_RATES, formatTc, minutesToFrames } from './timecode';
import { dayEnd, layoutDay, publishRefusal, takesTime, type DayBlockInput } from './index';

const R = FRAME_RATES['25'];
const min = (m: number) => minutesToFrames(m, R);
const sec = (s: number) => s * 25;

const ev = (id: string, sequence: number, kind: string, lengthFrames = 0, relatedEventId: string | null = null) => ({ id, sequence, kind, lengthFrames, relatedEventId });

/** 06:00 half-hour block that runs short, 06:30 block that runs over; breaks filled from the ads playlist. */
const blocks: DayBlockInput[] = [
  {
    id: 'b2',
    startFrames: min(30),
    lengthFrames: min(30),
    events: [ev('p2', 0, 'program', min(29)), ev('lb2', 1, 'linked-break'), ev('s3', 2, 'commercial', min(3), 'lb2'), ev('g2', 3, 'gap-compensator')],
  },
  {
    id: 'b1',
    startFrames: 0,
    lengthFrames: min(30),
    events: [
      ev('g1', 5, 'gap-compensator'),
      ev('lb1', 0, 'linked-break'),
      ev('p1', 1, 'program', min(28)),
      ev('lbx', 2, 'linked-break'),
      ev('s1', 3, 'ident', sec(6), 'lbx'),
      ev('s2', 4, 'commercial', sec(24), 'lbx'),
    ],
  },
];

describe('the times of a day', () => {
  const day = layoutDay(blocks);

  it('puts blocks in planned plan and rows in sequence, back to back through the day', () => {
    expect(day.blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
    const [b1, b2] = day.blocks;
    expect(b1.events.map((e) => [e.id, e.startFrames])).toEqual([
      ['lb1', 0],
      ['p1', 0],
      ['lbx', min(28)],
      ['s1', min(28)],
      ['s2', min(28) + sec(6)],
      ['g1', min(28) + sec(30)],
    ]);
    // the next block starts where the first really ended, not at its planned 06:30
    expect(b2.realStartFrames).toBe(min(28) + sec(30));
    expect(b2.events[0].startFrames).toBe(min(28) + sec(30));
    expect(b2.plannedStartFrames).toBe(min(30));
  });

  it('measures each block against its plan: a gap is negative, over is positive', () => {
    const [b1, b2] = day.blocks;
    expect(b1.realLengthFrames).toBe(min(28) + sec(30));
    expect(b1.gapFrames).toBe(-(min(1) + sec(30)));
    expect(b2.realLengthFrames).toBe(min(32));
    expect(b2.gapFrames).toBe(min(2));
    expect(day.totalFrames).toBe(min(60) + sec(30));
  });

  it('shows a linked break with the total of its spots and gives it no time of its own', () => {
    const rows = Object.fromEntries(day.blocks.flatMap((b) => b.events).map((e) => [e.id, e.shownFrames]));
    expect(rows.lb1).toBe(0);
    expect(rows.lbx).toBe(sec(30));
    expect(rows.lb2).toBe(min(3));
    expect(rows.s2).toBe(sec(24));
    expect(takesTime('linked-break')).toBe(false);
    expect(takesTime('note')).toBe(false);
    expect(takesTime('gap-compensator')).toBe(true);
  });

  it('a new day has every block empty: all gap, nothing played', () => {
    const fresh = layoutDay([{ id: 'b', startFrames: 0, lengthFrames: min(60), events: [ev('lb', 0, 'linked-break'), ev('g', 1, 'gap-compensator')] }]);
    expect(fresh.totalFrames).toBe(0);
    expect(fresh.blocks[0].gapFrames).toBe(-min(60));
    expect(fresh.blocks[0].events.map((e) => e.startFrames)).toEqual([0, 0]);
  });
});

describe('the end of a day', () => {
  const start = min(6 * 60);

  it('says when the last row ends and how far the day runs past 24 hours', () => {
    const short = dayEnd(min(17 * 60), start, R);
    expect(formatTc(short.endClockFrames, R)).toBe('23:00:00:00');
    expect(short).toMatchObject({ nextDay: false, pastDayFrames: 0 });
    const full = dayEnd(min(24 * 60), start, R);
    expect(formatTc(full.endClockFrames, R)).toBe('06:00:00:00');
    expect(full).toMatchObject({ nextDay: true, pastDayFrames: 0 });
    const long = dayEnd(min(25 * 60 + 14) + sec(7), start, R);
    expect(formatTc(long.endClockFrames, R)).toBe('07:14:07:00');
    expect(long.nextDay).toBe(true);
    expect(formatTc(long.pastDayFrames, R)).toBe('01:14:07:00');
  });
});

describe('publishing', () => {
  it('is refused twice, and never on a reconciled day', () => {
    expect(publishRefusal({ published: false, reconciled: false }, true)).toBeNull();
    expect(publishRefusal({ published: true, reconciled: false }, false)).toBeNull();
    expect(publishRefusal({ published: true, reconciled: false }, true)).toMatch(/already approved/);
    expect(publishRefusal({ published: false, reconciled: false }, false)).toMatch(/not approved/);
    expect(publishRefusal({ published: true, reconciled: true }, false)).toMatch(/reconciled/);
  });
});
