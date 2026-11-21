// Calendar-day logic of the shared date picker (docs/design/date-picker.md). Values are plain
// "YYYY-MM-DD" strings; every calculation runs on UTC midnights, so no browser or channel time zone
// ever moves a day (decision 0004).

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ms = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const parts = (s: string) => s.split('-').map(Number) as [number, number, number];
export const plusDays = (s: string, n: number) => iso(ms(s) + n * DAY);
export const weekdayIndex = (s: string) => new Date(ms(s)).getUTCDay();
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Number of days from a to b, both counted. */
export const dayCount = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY) + 1;

/** A valid date or null. */
export function makeDate(y: number, m: number, d: number): string | null {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** "17 Oct 2026", or "Sat 17 Oct 2026" with the weekday. Month as a word, never a number (rule 4). */
export function dayText(s: string, withWeekday = false): string {
  const [y, m, d] = parts(s);
  return `${withWeekday ? `${WEEKDAYS_SHORT[weekdayIndex(s)]} ` : ''}${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Saturday 17 October 2026" (screen readers, summaries). */
export function dayTextLong(s: string): string {
  const [y, m, d] = parts(s);
  return `${WEEKDAYS_LONG[weekdayIndex(s)]} ${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** "17 – 23 Oct 2026", "28 Sep – 4 Oct 2026", "28 Dec 2026 – 3 Jan 2027". */
export function spanText(a: string, b: string): string {
  const [ya, ma, da] = parts(a);
  const [yb, mb, db] = parts(b);
  if (ya !== yb) return `${dayText(a)} – ${dayText(b)}`;
  if (ma !== mb) return `${da} ${MONTHS[ma - 1]} – ${db} ${MONTHS[mb - 1]} ${yb}`;
  return `${da} – ${db} ${MONTHS[mb - 1]} ${yb}`;
}

/** First and last day of the channel week that holds the day. */
export function channelWeek(s: string, weekStart: number): [string, string] {
  const a = plusDays(s, -((weekdayIndex(s) - weekStart + 7) % 7));
  return [a, plusDays(a, 6)];
}

/** Same day n months later (clamped to the month's last day). */
export function plusMonths(s: string, n: number): string {
  const [y, m, d] = parts(s);
  const t = y * 12 + m - 1 + n;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  return makeDate(ny, nm, Math.min(d, daysInMonth(ny, nm)))!;
}

/** The 42 days (6 rows of the channel week) shown for the month of `view`. */
export function monthDays(view: string, weekStart: number): string[] {
  const first = `${view.slice(0, 7)}-01`;
  const start = plusDays(first, -((weekdayIndex(first) - weekStart + 7) % 7));
  return Array.from({ length: 42 }, (_, i) => plusDays(start, i));
}

const monthIndex = (w: string) => MONTHS_LONG.findIndex((x) => w.length >= 3 && x.toLowerCase().startsWith(w)) + 1;

/**
 * What the user typed → a day. Accepts "17 Oct 2026", "Sat 17 Oct", "Oct 17", "17/10/2026",
 * "17.10.26", "2026-10-17", "today", "tomorrow", "yesterday", "+7", "-2w". Numbers are read day
 * first; a missing year is the year of today.
 */
export function parseDay(text: string, today: string): { value: string } | { error: string } {
  const raw = (text || '').trim();
  const s = raw.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return { error: 'Type a date, e.g. 17 Oct 2026' };
  const year = parts(today)[0];
  if (s === 'today') return { value: today };
  if (s === 'tomorrow') return { value: plusDays(today, 1) };
  if (s === 'yesterday') return { value: plusDays(today, -1) };
  let m = /^([+-])\s*(\d{1,3})\s*(d|w)?$/.exec(s);
  if (m) return { value: plusDays(today, Number(m[2]) * (m[3] === 'w' ? 7 : 1) * (m[1] === '-' ? -1 : 1)) };
  const noSuchDay = (d: number, mi: number, y: number | null) => ({ error: `There is no ${d} ${MONTHS_LONG[mi - 1]}${y ? ` ${y}` : ''}.` });
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const v = makeDate(+m[1], +m[2], +m[3]);
    if (v) return { value: v };
    return +m[2] >= 1 && +m[2] <= 12 ? noSuchDay(+m[3], +m[2], +m[1]) : { error: `There is no month ${m[2]}.` };
  }
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year;
    const v = makeDate(y, +m[2], +m[1]);
    if (v) return { value: v };
    return +m[2] >= 1 && +m[2] <= 12 ? noSuchDay(+m[1], +m[2], y) : { error: `There is no month ${m[2]}. Numbers are read day first: 17/10/2026.` };
  }
  const s2 = s.replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s+/, '');
  let d = 0;
  let mi = 0;
  let y = year;
  let hasYear = false;
  m = /^(\d{1,2})\s*([a-z]{3,})\.?(?:\s+(\d{4}))?$/.exec(s2);
  if (m) {
    d = +m[1];
    mi = monthIndex(m[2]);
    if (m[3]) {
      y = +m[3];
      hasYear = true;
    }
  } else {
    m = /^([a-z]{3,})\.?\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(s2);
    if (m) {
      d = +m[2];
      mi = monthIndex(m[1]);
      if (m[3]) {
        y = +m[3];
        hasYear = true;
      }
    }
  }
  if (m && mi) {
    const v = makeDate(y, mi, d);
    return v ? { value: v } : noSuchDay(d, mi, hasYear ? y : null);
  }
  return { error: `Can't read "${raw}". Try 17 Oct 2026, 17/10/2026, today or +7.` };
}

/** The reason shown when a day is outside min / max and the page gave none. */
export function limitMessage(min?: string, max?: string): string {
  if (min && max) return `Pick a day from ${dayText(min)} to ${dayText(max)}.`;
  if (min) return `Pick ${dayText(min)} or later.`;
  if (max) return `Pick ${dayText(max)} or earlier.`;
  return '';
}

/** Channel weeks touched by a range (for the summary line). */
export function weekCount(a: string, b: string, weekStart: number): number {
  return Math.round((ms(channelWeek(b, weekStart)[0]) - ms(channelWeek(a, weekStart)[0])) / (7 * DAY)) + 1;
}

/** "23 Sep 2026 → 22 Nov 2026" */
export const formatDateRange = (a: string, b: string) => `${dayText(a)} → ${dayText(b)}`;
