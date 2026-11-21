// Frame-accurate time (decision 0004): every duration and offset is an integer number of frames.
// Timecodes are only a way of showing and typing frames, in the channel's frame rate.

export type FrameRateCode = '23.976' | '24' | '25' | '29.97df' | '30' | '50' | '59.94df';

export interface FrameRate {
  code: FrameRateCode;
  /** Shown in the UI, e.g. "29.97 fps drop-frame". */
  label: string;
  /** Frames counted per timecode second (30 for 29.97). */
  nominal: number;
  /** Drop-frame timecode: frame numbers 0..n are skipped every minute except every tenth. */
  dropFrame: boolean;
}

export const FRAME_RATES: Record<FrameRateCode, FrameRate> = {
  '23.976': { code: '23.976', label: '23.976 fps', nominal: 24, dropFrame: false },
  '24': { code: '24', label: '24 fps', nominal: 24, dropFrame: false },
  '25': { code: '25', label: '25 fps', nominal: 25, dropFrame: false },
  '29.97df': { code: '29.97df', label: '29.97 fps drop-frame', nominal: 30, dropFrame: true },
  '30': { code: '30', label: '30 fps', nominal: 30, dropFrame: false },
  '50': { code: '50', label: '50 fps', nominal: 50, dropFrame: false },
  '59.94df': { code: '59.94df', label: '59.94 fps drop-frame', nominal: 60, dropFrame: true },
};

export const FRAME_RATE_CODES = Object.keys(FRAME_RATES) as FrameRateCode[];

export function frameRate(code: string): FrameRate {
  const r = FRAME_RATES[code as FrameRateCode];
  if (!r) throw new Error(`Unknown frame rate ${code}`);
  return r;
}

/** Frame numbers dropped per minute in drop-frame timecode (2 at 29.97, 4 at 59.94). */
function dropPerMinute(r: FrameRate): number {
  return r.dropFrame ? Math.round(r.nominal / 15) : 0;
}

export function framesPerHour(r: FrameRate): number {
  return r.nominal * 3600 - dropPerMinute(r) * 54;
}

export function framesPerMinuteNominal(r: FrameRate): number {
  return r.nominal * 60;
}

/** One broadcast day of 24 hours. */
export function framesPerDay(r: FrameRate): number {
  return framesPerHour(r) * 24;
}

export interface TcParts {
  h: number;
  m: number;
  s: number;
  f: number;
}

/** Timecode label → frame count. Hours may exceed 23 (durations). */
export function partsToFrames({ h, m, s, f }: TcParts, r: FrameRate): number {
  const total = (h * 3600 + m * 60 + s) * r.nominal + f;
  if (!r.dropFrame) return total;
  const minutes = h * 60 + m;
  return total - dropPerMinute(r) * (minutes - Math.floor(minutes / 10));
}

/** Frame count → timecode label (non-negative counts). */
export function framesToParts(frames: number, r: FrameRate): TcParts {
  let n = Math.max(0, Math.trunc(frames));
  if (r.dropFrame) {
    const drop = dropPerMinute(r);
    const perMinute = r.nominal * 60 - drop;
    const perTen = r.nominal * 600 - drop * 9;
    const d = Math.floor(n / perTen);
    const m = n % perTen;
    n += m > drop ? drop * 9 * d + drop * Math.floor((m - drop) / perMinute) : drop * 9 * d;
  }
  const f = n % r.nominal;
  const totalSeconds = Math.floor(n / r.nominal);
  return { h: Math.floor(totalSeconds / 3600), m: Math.floor(totalSeconds / 60) % 60, s: totalSeconds % 60, f };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "HH:MM:SS:FF", or "HH:MM:SS;FF" for drop-frame. */
export function formatTc(frames: number, r: FrameRate): string {
  const sign = frames < 0 ? '-' : '';
  const p = framesToParts(Math.abs(frames), r);
  return `${sign}${pad(p.h)}:${pad(p.m)}:${pad(p.s)}${r.dropFrame ? ';' : ':'}${pad(p.f)}`;
}

/** Short form for grids and lists: "HH:MM", adding seconds and frames only when they are not zero. */
export function formatTcShort(frames: number, r: FrameRate): string {
  const p = framesToParts(frames, r);
  // The first label of a drop-frame minute (e.g. 18:12:00;02) is the start of that minute: "18:12".
  if (r.dropFrame && p.s === 0 && p.m % 10 !== 0 && p.f === dropPerMinute(r)) p.f = 0;
  let out = `${pad(p.h)}:${pad(p.m)}`;
  if (p.s || p.f) out += `:${pad(p.s)}`;
  if (p.f) out += `${r.dropFrame ? ';' : ':'}${pad(p.f)}`;
  return out;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Time of day of an offset inside the broadcast day (wraps after midnight). */
export function clockFrames(offsetFrames: number, dayStartFrames: number, r: FrameRate): number {
  return mod(dayStartFrames + offsetFrames, framesPerDay(r));
}

/** Time of day → offset from the broadcast-day start. */
export function offsetFromClock(clock: number, dayStartFrames: number, r: FrameRate): number {
  return mod(clock - dayStartFrames, framesPerDay(r));
}

export function formatClock(offsetFrames: number, dayStartFrames: number, r: FrameRate): string {
  return formatTc(clockFrames(offsetFrames, dayStartFrames, r), r);
}

export function formatClockShort(offsetFrames: number, dayStartFrames: number, r: FrameRate): string {
  return formatTcShort(clockFrames(offsetFrames, dayStartFrames, r), r);
}

/**
 * Typed timecode → frames. Accepts "HH:MM", "HH:MM:SS" and "HH:MM:SS:FF" (also ";" or "." before
 * the frames). Returns null when it is not a valid timecode of this frame rate. A drop-frame label
 * that does not exist (e.g. 00:01:00;00) moves to the next one that does.
 */
export function parseTc(text: string, r: FrameRate, opts: { maxHours?: number } = {}): number | null {
  const t = text.trim();
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2})(?:[:;.](\d{2}))?)?$/.exec(t);
  if (!m) return null;
  const parts = { h: Number(m[1]), m: Number(m[2]), s: Number(m[3] ?? 0), f: Number(m[4] ?? 0) };
  if (parts.m > 59 || parts.s > 59 || parts.f >= r.nominal) return null;
  if (opts.maxHours !== undefined && parts.h > opts.maxHours) return null;
  if (r.dropFrame && parts.s === 0 && parts.m % 10 !== 0 && parts.f < dropPerMinute(r)) {
    parts.f = dropPerMinute(r);
  }
  return partsToFrames(parts, r);
}

/**
 * Whole minutes → frames, as the timecode label "HH:MM:00" (for building data). In drop-frame the
 * label of a minute that is not a tenth starts at frame 2 (or 4), so 00:02:00;02.
 */
export function minutesToFrames(minutes: number, r: FrameRate): number {
  const m = minutes % 60;
  const f = r.dropFrame && m % 10 !== 0 ? dropPerMinute(r) : 0;
  return partsToFrames({ h: Math.floor(minutes / 60), m, s: 0, f }, r);
}

/**
 * Plain-language length: "30 min", "1 h", "1 h 30 min", "5 min 20 s". Drop-frame lengths are real
 * time rounded to the second (a drop-frame label count is not a duration).
 */
export function formatLength(frames: number, r: FrameRate): string {
  let h: number, m: number, s: number, f = 0;
  if (r.dropFrame) {
    const total = Math.round((frames * 1001) / (r.nominal * 1000));
    h = Math.floor(total / 3600);
    m = Math.floor(total / 60) % 60;
    s = total % 60;
  } else {
    ({ h, m, s, f } = framesToParts(frames, r));
  }
  const bits: string[] = [];
  if (h) bits.push(`${h} h`);
  if (m) bits.push(`${m} min`);
  if (s) bits.push(`${s} s`);
  if (f) bits.push(`${f} fr`);
  return bits.length ? bits.join(' ') : '0 min';
}
