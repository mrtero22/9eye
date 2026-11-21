// Shapes of the Weeks API (apps/api/src/services/weeks.ts) and small helpers of the Playlist page.

import type { AdsBreak, DayState, ExpectedPlacement, FillReport, PlaylistKindName } from '@9eye/core';

export interface WeekDay {
  /** null = the weekday is not active in this week: it has no day playlist. */
  id: string | null;
  date: string;
  weekday: number;
  state: DayState | 'not-active';
  blocks: number;
}

export interface Week {
  id: string;
  kind: PlaylistKindName;
  playlistId: string;
  channelId: string;
  name: string;
  number: number;
  firstDate: string;
  lastDate: string;
  templateId: string;
  templateName: string;
  activeWeekdays: boolean[];
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  days: WeekDay[];
}

export interface WeekRunBody {
  kinds: PlaylistKindName[];
  fromWeek: string;
  toWeek: string;
  templates?: { main?: string | null; ads?: string | null };
  activeWeekdays?: boolean[] | null;
}

// ---------------------------------------------------------------- one day (apps/api/src/services/days.ts)

export interface DayEvent {
  id: string;
  sequence: number;
  kind: string;
  title: string;
  /** Offset from the broadcast-day start. */
  startFrames: number;
  lengthFrames: number;
  tcInFrames: number;
  tcOutFrames: number;
  color: string | null;
  contentType: string | null;
  episode: number | null;
  breakName: string | null;
  inBreak: boolean;
  media: 'ready' | 'not-ready' | null;
  note: string;
  fixed: boolean;
  hold: boolean;
  autoAdjust: boolean;
  productionId: string | null;
  segmentId: string | null;
  breakTypeId: string | null;
  relatedEventId: string | null;
  orderId: string | null;
  rotationListId: string | null;
  /** Ads playlist: the booked spot this row airs. */
  airingItemId: string | null;
}

/** A booked spot of a confirmed commercial order airing on the day (ads playlist). */
export interface BookedSpotRef {
  id: string;
  passes: number;
  orderId: string;
  orderName: string;
  productionId: string;
  title: string;
  breakName: string;
  positionName: string;
}

/** A catalog item as a playlist row (POST /days/catalog-rows). */
export interface CatalogRow {
  productionId: string;
  title: string;
  kind: string;
  lengthFrames: number | null;
  media: 'ready' | 'not-ready' | null;
  contentType: string;
  color: string | null;
  episode: number | null;
}

export interface DayBlock {
  id: string;
  blockTypeId: string;
  name: string;
  color: string;
  plannedStartFrames: number;
  plannedLengthFrames: number;
  realStartFrames: number;
  realLengthFrames: number;
  gapFrames: number;
  note: string;
  /** Its free time is filled from a rotation list. */
  fillGaps: boolean;
  opensWithBreak: boolean;
  rotationListId: string | null;
  rotationListName: string | null;
  events: DayEvent[];
}

/** What the steps of a day read (GET day): the airings it should play and the ads playlist's breaks. */
export interface DayChecks {
  placements: ExpectedPlacement[];
  /** null = the ads playlist has no day here. */
  adsBreaks: AdsBreak[] | null;
  defaultListId: string | null;
  /** Ads playlist: the day's booked spots (null on main). */
  booked: BookedSpotRef[] | null;
}

/** POST /days/:id/run: the draft with what a step placed, and what it says about it. */
export interface RunResult {
  blocks: { id: string; events: DayEvent[] }[];
  report: FillReport;
}

export interface RotationListRef {
  id: string;
  name: string;
  items: number;
}

export interface Day {
  channel: import('@/lib/types').Channel;
  kind: PlaylistKindName;
  date: string;
  weekFirstDate: string;
  week: { id: string; name: string; number: number; templateName: string } | null;
  missing: 'no-week' | 'not-active' | null;
  day: { id: string; state: DayState; version: number; totalFrames: number; notReady: number; blocks: DayBlock[]; checks: DayChecks } | null;
  marks: { date: string; state: DayState }[];
}

/** A day's playout file, as the API makes it. */
export interface DayExport {
  fileName: string;
  content: string;
  items: number;
  /** Titles of rows without a playout file. */
  noFile: string[];
  /** The day is not published yet. */
  draft: boolean;
}

export const KIND_LABEL: Record<string, string> = {
  program: 'Program',
  commercial: 'Ad',
  promo: 'Trailer',
  filler: 'Filler',
  ident: 'Ident',
  jingle: 'Sting',
  note: 'Note',
  'linked-break': 'Linked break',
  'gap-compensator': 'Gap holder',
};

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const STATE_LABEL: Record<WeekDay['state'], string> = { draft: 'Draft', published: 'Approved', reconciled: 'Reconciled', 'not-active': 'Not active' };

/** "1 week" / "3 weeks" */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
