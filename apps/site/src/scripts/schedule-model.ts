// The sample day and week of the free TV schedule template (/tools/tv-schedule-template), counted the way
// the template's formulas count: whole frames, non-drop timecode, items in the clock hour where they
// start. The page shows these results; they match what Excel shows when the file opens. No imports,
// so Node can run it directly in checks.

export interface Item { type: string; title: string; episode?: string; houseId?: string; duration: string; frames?: number; planned?: string }
export interface Sample {
  channel: string;
  date: string;
  dayStart: string;
  fps: number;
  adLimitMinutes: number;
  types: string[];
  items: Item[];
  week: { days: string[]; weekday: [number, string][]; weekend: [number, string][] };
}
export interface PlaylistRow { n: number; start: string; planned: string; offBy: string; late: boolean; item: Item; duration: string }

export const seconds = (t: string) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
const two = (n: number) => String(n).padStart(2, '0');

/** Frames as HH:MM:SS:FF (non-drop). */
export function tc(frames: number, fps: number): string {
  return `${two(Math.floor(frames / (fps * 3600)))}:${two(Math.floor(frames / (fps * 60)) % 60)}:${two(Math.floor(frames / fps) % 60)}:${two(frames % fps)}`;
}

/** Seconds as H:MM:SS, the way the template shows durations. */
export function hms(total: number): string {
  const s = Math.round(total);
  return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

export function playlist(s: Sample) {
  const day0 = seconds(s.dayStart) * s.fps;
  const full = 86400 * s.fps;
  const perHour = new Map<number, Map<string, number>>();
  let at = 0;
  const rows: PlaylistRow[] = s.items.map((item, i) => {
    const d = seconds(item.duration) * s.fps + (item.frames ?? 0);
    const tod = (day0 + at) % full;
    let offBy = '';
    if (item.planned) {
      const o = ((((tod - seconds(item.planned) * s.fps) % full) + full + full / 2) % full) - full / 2;
      offBy = o === 0 ? 'On time' : `${o > 0 ? 'Late' : 'Early'} ${tc(Math.abs(o), s.fps)}`;
    }
    const hour = Math.floor(tod / (s.fps * 3600));
    const kinds = perHour.get(hour) ?? new Map<string, number>();
    kinds.set(item.type, (kinds.get(item.type) ?? 0) + d);
    perHour.set(hour, kinds);
    at += d;
    return { n: i + 1, start: tc(tod, s.fps), planned: item.planned ?? '', offBy, late: offBy !== '' && offBy !== 'On time', item, duration: tc(d, s.fps) };
  });
  const over = at > full;
  const hours = [...perHour.keys()].map((hour) => {
    const k = perHour.get(hour)!;
    const sec = (type?: string) => (type ? (k.get(type) ?? 0) : [...k.values()].reduce((a, b) => a + b, 0)) / s.fps;
    const above = Math.round(sec('Commercial')) - s.adLimitMinutes * 60;
    return {
      hour: `${two(hour)}:00 – ${two((hour + 1) % 24)}:00`,
      commercial: hms(sec('Commercial')),
      promo: hms(sec('Promo')),
      sponsorship: hms(sec('Sponsorship')),
      programme: hms(sec('Programme')),
      all: hms(sec()),
      status: above > 0 ? `Over by ${Math.floor(above / 60)} min ${two(above % 60)} s` : 'OK',
    };
  });
  return {
    rows,
    hours,
    scheduled: tc(at, s.fps),
    leftLabel: over ? 'Over by' : at === full ? 'Day is full' : 'Left to fill',
    left: tc(Math.abs(full - at), s.fps),
    ends: tc((day0 + at) % full, s.fps),
  };
}

export const GENRES = ['News', 'Kids', 'Series', 'Movie', 'Sport', 'Music', 'Magazine'];

/** The week grid between two slot times (HH:MM), with each run of the same title merged into one cell per day. */
export function weekGrid(s: Sample, from: string, to: string) {
  const day0 = seconds(s.dayStart);
  const a = seconds(`${from}:00`);
  const first = Math.round((((a - day0) % 86400) + 86400) % 86400 / 1800);
  const count = Math.round((((seconds(`${to}:00`) - a) % 86400) + 86400) % 86400 / 1800);
  const days = s.week.days.map((name) => {
    const pattern = ['Sat', 'Sun'].includes(name) ? s.week.weekend : s.week.weekday;
    const slots = pattern.flatMap(([n, title]) => Array<string>(n).fill(title)).slice(first, first + count);
    const cells: { row: number; span: number; title: string; genre: string }[] = [];
    slots.forEach((title, i) => {
      const last = cells[cells.length - 1];
      if (last && last.title === title) last.span++;
      else cells.push({ row: i, span: 1, title, genre: GENRES.find((g) => title.startsWith(g))?.toLowerCase() ?? '' });
    });
    return { name, cells };
  });
  const times = Array.from({ length: count }, (_, i) => {
    const t = (day0 + (first + i) * 1800) % 86400;
    return `${two(Math.floor(t / 3600))}:${two((t / 60) % 60)}`;
  });
  return { days, times };
}
