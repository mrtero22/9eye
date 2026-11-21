import { describe, expect, it } from 'vitest';
import { broadcastToday } from './week';
import {
  FRAME_RATES,
  clockFrames,
  formatClockShort,
  formatLength,
  formatTc,
  formatTcShort,
  framesPerDay,
  framesPerHour,
  framesToParts,
  minutesToFrames,
  offsetFromClock,
  parseTc,
  partsToFrames,
} from './timecode';

const R25 = FRAME_RATES['25'];
const DF = FRAME_RATES['29.97df'];
const DF60 = FRAME_RATES['59.94df'];

describe('frame counts', () => {
  it('knows the length of an hour and a day', () => {
    expect(framesPerHour(R25)).toBe(90000);
    expect(framesPerDay(R25)).toBe(2160000);
    expect(framesPerHour(DF)).toBe(107892);
    expect(framesPerDay(DF)).toBe(2589408);
    expect(framesPerHour(DF60)).toBe(215784);
  });
});

describe('drop-frame timecode', () => {
  it('skips frames 0 and 1 every minute except every tenth', () => {
    expect(formatTc(1799, DF)).toBe('00:00:59;29');
    expect(formatTc(1800, DF)).toBe('00:01:00;02');
    expect(formatTc(17982, DF)).toBe('00:10:00;00');
    expect(formatTc(17983, DF)).toBe('00:10:00;01');
    expect(formatTc(19782, DF)).toBe('00:11:00;02');
    expect(formatTc(107892, DF)).toBe('01:00:00;00');
  });

  it('round-trips every frame of the first eleven minutes', () => {
    for (let n = 0; n < 20000; n++) expect(partsToFrames(framesToParts(n, DF), DF)).toBe(n);
  });

  it('moves a label that does not exist to the next one', () => {
    expect(parseTc('00:01:00;00', DF)).toBe(1800);
    expect(parseTc('00:10:00;00', DF)).toBe(17982);
  });

  it('round-trips 59.94', () => {
    for (let n = 0; n < 40000; n += 7) expect(partsToFrames(framesToParts(n, DF60), DF60)).toBe(n);
  });
});

describe('non-drop timecode', () => {
  it('formats and parses at 25 fps', () => {
    expect(formatTc(90000 * 6 + 25 * 30 + 12, R25)).toBe('06:00:30:12');
    expect(parseTc('06:00:30:12', R25)).toBe(90000 * 6 + 25 * 30 + 12);
    expect(parseTc('06:30', R25)).toBe(90000 * 6.5);
    expect(parseTc('06:00:00.24', R25)).toBe(540024);
    expect(parseTc('06:00:00:25', R25)).toBeNull();
    expect(parseTc('6:61', R25)).toBeNull();
    expect(parseTc('abc', R25)).toBeNull();
  });
});

describe('time of day', () => {
  it('wraps after midnight from the broadcast-day start', () => {
    const start = parseTc('06:00', R25)!;
    expect(formatClockShort(0, start, R25)).toBe('06:00');
    expect(formatClockShort(minutesToFrames(19 * 60, R25), start, R25)).toBe('01:00');
    expect(offsetFromClock(parseTc('05:00', R25)!, start, R25)).toBe(minutesToFrames(23 * 60, R25));
    expect(clockFrames(framesPerDay(R25), start, R25)).toBe(start);
  });

  it('shows seconds and frames only when needed', () => {
    expect(formatTcShort(parseTc('06:10', R25)!, R25)).toBe('06:10');
    expect(formatTcShort(parseTc('06:10:05', R25)!, R25)).toBe('06:10:05');
    expect(formatTcShort(parseTc('06:10:05;10', DF)!, DF)).toBe('06:10:05;10');
  });

  it('describes lengths in words', () => {
    expect(formatLength(minutesToFrames(30, R25), R25)).toBe('30 min');
    expect(formatLength(minutesToFrames(90, R25), R25)).toBe('1 h 30 min');
    expect(formatLength(minutesToFrames(60, DF), DF)).toBe('1 h');
    expect(formatLength(minutesToFrames(2, DF), DF)).toBe('2 min');
    expect(formatLength(minutesToFrames(30, DF), DF)).toBe('30 min');
  });

  it('builds drop-frame minutes as existing labels and shows them as whole minutes', () => {
    expect(formatTc(minutesToFrames(2, DF), DF)).toBe('00:02:00;02');
    expect(formatTc(minutesToFrames(30, DF), DF)).toBe('00:30:00;00');
    expect(formatTcShort(minutesToFrames(18 * 60 + 12, DF), DF)).toBe('18:12');
    expect(formatTcShort(parseTc('18:12:00;03', DF)!, DF)).toBe('18:12:00;03');
  });
});

describe('broadcast today', () => {
  const ch = (dayStart: string, timeZone: string | null, rate = '25') => ({ dayStartFrames: partsToFrames({ h: Number(dayStart.slice(0, 2)), m: Number(dayStart.slice(3)), s: 0, f: 0 }, FRAME_RATES[rate as '25']), frameRate: rate, timeZone });
  it('is yesterday before the day start, in the channel time zone', () => {
    // 2026-10-18 07:30 UTC = 09:30 in Brussels (summer time), 02:30 in Chicago
    const now = Date.UTC(2026, 9, 18, 7, 30);
    expect(broadcastToday(now, ch('06:00', 'Europe/Brussels'))).toBe('2026-10-18');
    expect(broadcastToday(now, ch('10:00', 'Europe/Brussels'))).toBe('2026-10-17');
    expect(broadcastToday(now, ch('06:00', 'America/Chicago', '29.97df'))).toBe('2026-10-17');
  });
});
