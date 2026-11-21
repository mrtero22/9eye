// The Playout XML playlist file (checked item by item against a full day's file of a playout that
// reads this format): the day's main playlist as one <ITEM> per playable row, back
// to back from the playlist start — no start times, no blocks, no linked-break or gap rows.

import { formatTc, type FrameRate } from './timecode';

/** One playable row of the day, as Playout XML needs it. */
export interface PlayoutXmlItem {
  /** The playout file path (Aurora Media keeps it in the production's Additional data). */
  file: string;
  /** The row's title; a trailing " - 0" is left out. */
  title: string;
  /** "#rrggbb" (the content type's colour), written as "$rrggbb"; null = none. */
  color: string | null;
  /** Segment TC in and out, in frames. */
  inFrames: number;
  outFrames: number;
  /** The production's notes, as they are. */
  category: string;
  /** The production's STAR field (the advertiser). */
  star: string;
}

/** Row kinds that never reach the playout file. */
export const PLAYOUT_XML_LEFT_OUT = new Set(['linked-break', 'gap-compensator', 'note']);

/** Real frames per second: 29.97 drop-frame counts 30 a second but runs at 30000/1001. */
const realFps = (rate: FrameRate) => (rate.code.includes('.') ? (rate.nominal * 1000) / 1001 : rate.nominal);

/** Seconds as Playout XML writes them: at most 2 decimals, no trailing zeros ("7", "24.8", "1693.72"). */
export function playoutXmlSeconds(frames: number, rate: FrameRate): string {
  const hundredths = Math.round((frames * 100) / realFps(rate));
  const sign = hundredths < 0 ? '-' : '';
  const a = Math.abs(hundredths);
  const frac = String(a % 100).padStart(2, '0').replace(/0+$/, '');
  return `${sign}${Math.floor(a / 100)}${frac ? `.${frac}` : ''}`;
}

/** "Ident_AURORA - 0" → "Ident_AURORA": only a trailing " - 0" goes. */
export const playoutXmlTitle = (title: string) => title.replace(/ - 0$/, '');

/** "#9B9B9B" → "$9b9b9b". */
export const playoutXmlColor = (color: string | null) => (color && /^#[0-9a-f]{6}$/i.test(color) ? `$${color.slice(1).toLowerCase()}` : '');

/** An attribute value: the five XML characters escaped; a line break stays as it is (as the format's files have it). */
const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The root's name: "<prefix>_YYYY_MM_DD.xml - <playlist start with frames>", e.g.
 * "aurora_media_2026_10_15.xml - 06:00:00:00". The prefix is the company's (Aurora Media: "aurora_media").
 */
export function playoutXmlRootName(prefix: string, isoDate: string, dayStartFrames: number, rate: FrameRate): string {
  return `${prefix}_${isoDate.replace(/-/g, '_')}.xml - ${formatTc(dayStartFrames, rate)}`;
}

/** A company's prefix from its short name: "aurora-media" → "aurora_media". */
export const playoutXmlPrefix = (slug: string) => slug.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Item ids: a running number per file, starting from a number of the broadcast day (days since
 * 1 Jan 2020 × 10 000 + 1), so two days never share an id and exporting a day again gives the same
 * ids. Files written by other systems show a running number too; where its start comes from is
 * not known.
 */
export function playoutXmlFirstItemId(isoDate: string): number {
  const days = Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse('2020-01-01T00:00:00Z')) / 86_400_000);
  return days * 10_000 + 1;
}

/** The whole file: UTF-8, LF line ends, two-space indent, one self-closing <ITEM> per row. */
export function playoutXmlFile(p: { rootId: string; name: string; firstItemId: number; items: PlayoutXmlItem[]; rate: FrameRate }): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', `<PBPlaylist   id="${attr(p.rootId)}" name="${attr(p.name)}">`];
  p.items.forEach((it, i) => {
    const length = it.outFrames - it.inFrames;
    lines.push(
      `  <ITEM type="video_clip" file="${attr(it.file)}" id="${p.firstItemId + i}" inp="${playoutXmlSeconds(it.inFrames, p.rate)}" outp="${playoutXmlSeconds(it.outFrames, p.rate)}" duration="${playoutXmlSeconds(length, p.rate)}" title="${attr(playoutXmlTitle(it.title))}" color="${playoutXmlColor(it.color)}" category="${attr(it.category)}" star="${attr(it.star)}" notes="" />`,
    );
  });
  lines.push('</PBPlaylist>', '');
  return lines.join('\n');
}
