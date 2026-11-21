// Weekdays and the channel's week. Weekday numbers: 0 = Sunday … 6 = Saturday.
// Every channel has its own first weekday (Aurora Media alone uses Saturday, Friday and Sunday).

import { frameRate, partsToFrames } from './timecode';

export interface WeekdayName {
  long: string;
  short: string;
  mini: string;
}

export const WEEKDAYS: WeekdayName[] = [
  { long: 'Sunday', short: 'Sun', mini: 'Su' },
  { long: 'Monday', short: 'Mon', mini: 'Mo' },
  { long: 'Tuesday', short: 'Tue', mini: 'Tu' },
  { long: 'Wednesday', short: 'Wed', mini: 'We' },
  { long: 'Thursday', short: 'Thu', mini: 'Th' },
  { long: 'Friday', short: 'Fri', mini: 'Fr' },
  { long: 'Saturday', short: 'Sat', mini: 'Sa' },
];

/** The 7 weekday numbers in the channel's order, starting with its first weekday. */
export function weekOrder(weekStart: number): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

export function lastWeekday(weekStart: number): number {
  return (weekStart + 6) % 7;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Weekday of a calendar date "YYYY-MM-DD" (time zone free). */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First day of the channel's week that contains the date. */
export function weekStartOn(isoDate: string, weekStart: number): string {
  const back = (weekdayOf(isoDate) - weekStart + 7) % 7;
  return addDays(isoDate, -back);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "23 Mar 2024" */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * The channel's current broadcast day (date picker rule 3): the wall-clock date in the channel's time
 * zone (no zone: the server's own clock, Aurora Media's literal wall-clock time), one day earlier before the
 * channel's day start.
 */
export function broadcastToday(nowMs: number, channel: { dayStartFrames: number; frameRate: string; timeZone: string | null }): string {
  let y: number, mo: number, d: number, h: number, mi: number, s: number;
  if (channel.timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: channel.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(nowMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    [y, mo, d, h, mi, s] = [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')];
  } else {
    const t = new Date(nowMs);
    [y, mo, d, h, mi, s] = [t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds()];
  }
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const r = frameRate(channel.frameRate);
  return partsToFrames({ h, m: mi, s, f: 0 }, r) < channel.dayStartFrames ? addDays(date, -1) : date;
}
