// The free timecode calculator (/tools/timecode-calculator), on the product's own frame-accurate time
// (@9eye/core). Pure functions, used twice: at build time for the first values on the page, then in
// the browser, where timecode-tool.ts runs them as the visitor types.
import { FRAME_RATES, formatTc, framesToParts, parseTc, type FrameRate } from '@9eye/core';

export interface Rate {
  id: string;
  rate: FrameRate;
  /** Real frames per second (30000/1001 for 29.97). */
  exact: number;
}

// The product's frame rates, plus the non-drop count of 29.97 and 59.94 and 60 fps, which visitors
// also need. The timecode functions read only `nominal` and `dropFrame` from a rate.
export const RATES: Rate[] = [
  { id: '23.976', rate: FRAME_RATES['23.976'], exact: 24000 / 1001 },
  { id: '24', rate: FRAME_RATES['24'], exact: 24 },
  { id: '25', rate: FRAME_RATES['25'], exact: 25 },
  { id: '29.97df', rate: FRAME_RATES['29.97df'], exact: 30000 / 1001 },
  { id: '29.97ndf', rate: { ...FRAME_RATES['29.97df'], label: '29.97 fps non-drop', dropFrame: false }, exact: 30000 / 1001 },
  { id: '30', rate: FRAME_RATES['30'], exact: 30 },
  { id: '50', rate: FRAME_RATES['50'], exact: 50 },
  { id: '59.94df', rate: FRAME_RATES['59.94df'], exact: 60000 / 1001 },
  { id: '59.94ndf', rate: { ...FRAME_RATES['59.94df'], label: '59.94 fps non-drop', dropFrame: false }, exact: 60000 / 1001 },
  { id: '60', rate: { ...FRAME_RATES['30'], label: '60 fps', nominal: 60 }, exact: 60 },
];

export function rateById(id: string): Rate {
  return RATES.find((r) => r.id === id) ?? RATES[3];
}

export type Read = { frames: number; note: string } | { error: string };

/**
 * Typed timecode → frames. HH:MM, HH:MM:SS or HH:MM:SS:FF (";" or "." before the frames too).
 * A drop-frame label that does not exist moves to the next one, with a note saying so.
 */
export function readTimecode(text: string, r: Rate): Read {
  const frames = parseTc(text, r.rate, { maxHours: 999 });
  if (frames === null) return { error: `Not a timecode at ${r.rate.label}. Type HH:MM:SS:FF, with frames 00 to ${r.rate.nominal - 1}.` };
  const [h, m, s = 0, f = 0] = text.trim().split(/[:;.]/).map(Number);
  const label = framesToParts(frames, r.rate);
  const moved = label.h !== h || label.m !== m || label.s !== s || label.f !== f;
  return { frames, note: moved ? `${formatTc(frames, r.rate)} — drop-frame timecode skips the label you typed, so it moves to the next one.` : '' };
}

/** Typed frame count → frames. */
export function readFrames(text: string): Read {
  const t = text.trim().replace(/[\s,]/g, '');
  if (!/^\d{1,10}$/.test(t)) return { error: 'Type a whole number of frames.' };
  return { frames: Number(t), note: '' };
}

/** Real time of a frame count: "HH:MM:SS.mmm". */
export function realTime(frames: number, r: Rate): string {
  const ms = Math.round((Math.abs(frames) * 1000) / r.exact);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const s = Math.floor(ms / 1000);
  return `${frames < 0 ? '-' : ''}${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}.${pad(ms % 1000, 3)}`;
}

/** The same real time counted in another frame rate, rounded to the nearest frame. */
export function changeRate(frames: number, from: Rate, to: Rate): { frames: number; exact: number } {
  const exact = (frames / from.exact) * to.exact;
  return { frames: Math.round(exact), exact };
}

export const tc = (frames: number, r: Rate) => formatTc(frames, r.rate);
export const count = (frames: number) => frames.toLocaleString('en-US');
