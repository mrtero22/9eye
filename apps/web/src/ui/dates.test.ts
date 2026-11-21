import { describe, expect, it } from 'vitest';
import { channelWeek, dayText, monthDays, parseDay, plusMonths, spanText, weekCount } from './dates';

const TODAY = '2026-10-17'; // a Saturday

describe('typing a date', () => {
  const ok = (t: string) => {
    const r = parseDay(t, TODAY);
    return 'value' in r ? r.value : r.error;
  };
  it('reads the accepted forms, day first, with the year of today when missing', () => {
    expect(ok('17 Oct 2026')).toBe('2026-10-17');
    expect(ok('Sat 17 Oct')).toBe('2026-10-17');
    expect(ok('Oct 17')).toBe('2026-10-17');
    expect(ok('17/10/2026')).toBe('2026-10-17');
    expect(ok('17.10.26')).toBe('2026-10-17');
    expect(ok('2026-10-17')).toBe('2026-10-17');
    expect(ok('3/4')).toBe('2026-04-03');
    expect(ok('today')).toBe('2026-10-17');
    expect(ok('tomorrow')).toBe('2026-10-18');
    expect(ok('yesterday')).toBe('2026-10-16');
    expect(ok('+7')).toBe('2026-10-24');
    expect(ok('-2w')).toBe('2026-10-03');
    expect(ok('1 january 2027')).toBe('2027-01-01');
  });
  it('says what is wrong', () => {
    expect(ok('31 Sep 2026')).toBe('There is no 31 September 2026.');
    expect(ok('31/9')).toBe('There is no 31 September 2026.');
    expect(ok('10/17/2026')).toMatch(/There is no month 17\. Numbers are read day first/);
    expect(ok('soon')).toMatch(/Can't read "soon"/);
    expect(ok('')).toMatch(/Type a date/);
  });
});

describe('calendar days', () => {
  it('formats with the month as a word', () => {
    expect(dayText('2026-10-17', true)).toBe('Sat 17 Oct 2026');
    expect(spanText('2026-10-17', '2026-10-23')).toBe('17 – 23 Oct 2026');
    expect(spanText('2026-09-26', '2026-10-02')).toBe('26 Sep – 2 Oct 2026');
    expect(spanText('2026-12-26', '2027-01-01')).toBe('26 Dec 2026 – 1 Jan 2027');
  });
  it('follows the channel week', () => {
    expect(channelWeek('2026-10-22', 6)).toEqual(['2026-10-17', '2026-10-23']); // Saturday weeks (AURORA)
    expect(channelWeek('2026-10-22', 1)).toEqual(['2026-10-19', '2026-10-25']); // Monday weeks (scenario B)
    expect(monthDays('2026-10-01', 6)[0]).toBe('2026-09-26');
    expect(monthDays('2026-10-01', 4)[0]).toBe('2026-10-01');
    expect(weekCount('2026-09-23', '2026-11-22', 6)).toBe(10);
  });
  it('moves by months without leaving the month', () => {
    expect(plusMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(plusMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});
