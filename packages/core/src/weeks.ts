// Weeks: dated copies of a template, one per channel playlist and week (data model §6).
// The same rules run in the browser (the Create weeks dialog) and in the API (on create / delete).

import type { AdsDays, BlockDraft } from './template';
import { WEEKDAYS, addDays, formatDate, isIsoDate, weekdayOf } from './week';

export const WEEK_NAME_MAX = 50;
/** Longest run of weeks one "Create weeks" makes. */
export const WEEK_RUN_MAX = 53;

export type PlaylistKindName = 'main' | 'ads';

/** ISO 8601 week number of a calendar date. */
export function isoWeekNumber(isoDate: string): number {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of that ISO week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** A week's number: the ISO week number of its first day (whatever weekday the channel's week starts on). */
export function weekNumber(firstDate: string): number {
  return isoWeekNumber(firstDate);
}

export function weekLastDate(firstDate: string): string {
  return addDays(firstDate, 6);
}

/** "Week 46 2026 AURORA M" / "… Ads"; the short name is cut so the whole name fits. */
export function defaultWeekName(firstDate: string, shortName: string, kind: PlaylistKindName): string {
  const head = `Week ${weekNumber(firstDate)} ${firstDate.slice(0, 4)} `;
  const tail = kind === 'main' ? ' M' : ' Ads';
  const room = WEEK_NAME_MAX - head.length - tail.length;
  return `${head}${shortName.trim().slice(0, room).trim()}${tail}`;
}

/** First days of every week from one week start to another (both included). */
export function weekStarts(fromWeek: string, toWeek: string): string[] {
  const out: string[] = [];
  for (let d = fromWeek; d <= toWeek; d = addDays(d, 7)) out.push(d);
  return out;
}

/** The channel's weeks of a month: a week belongs to the month its first day is in. `month` is 1–12. */
export function weekStartsOfMonth(year: number, month: number, weekStart: number): string[] {
  const mm = String(month).padStart(2, '0');
  const first = `${year}-${mm}-01`;
  let d = addDays(first, (weekStart - weekdayOf(first) + 7) % 7);
  const out: string[] = [];
  while (d.slice(0, 7) === `${year}-${mm}`) {
    out.push(d);
    d = addDays(d, 7);
  }
  return out;
}

export interface WeekTemplateInfo {
  id: string;
  name: string;
  validFrom: string;
  validTo: string;
  /** Index = weekday (0 = Sunday). */
  activeWeekdays: boolean[];
}

/** Templates whose dates hold the whole week. */
export function templatesForWeek<T extends Pick<WeekTemplateInfo, 'validFrom' | 'validTo'>>(templates: T[], firstDate: string): T[] {
  const last = weekLastDate(firstDate);
  return templates.filter((t) => t.validFrom <= firstDate && last <= t.validTo);
}

export interface WeekRunPlaylist {
  kind: PlaylistKindName;
  playlistId: string;
  templates: WeekTemplateInfo[];
  /** The template the person picked; needed only when several fit a week. */
  templateId?: string | null;
  /** First days of the weeks this playlist already has. */
  existing: string[];
}

export interface WeekRunInput {
  weekStart: number;
  /** The channel's current broadcast day. */
  today: string;
  fromWeek: string;
  toWeek: string;
  /** Goes into the default names (the channel's name until channels have a short name). */
  shortName: string;
  /** null = each template's own active days. */
  activeWeekdays?: boolean[] | null;
  playlists: WeekRunPlaylist[];
}

export interface PlannedWeek {
  kind: PlaylistKindName;
  playlistId: string;
  firstDate: string;
  lastDate: string;
  number: number;
  name: string;
  templateId: string;
  templateName: string;
  activeWeekdays: boolean[];
}

export type WeekProblemCode = 'dates' | 'too-many' | 'no-playlist' | 'active-days' | 'exists' | 'no-template' | 'pick-template';

export interface WeekProblem {
  code: WeekProblemCode;
  message: string;
  kind?: PlaylistKindName;
  firstDate?: string;
}

export type WeekWarningCode = 'past' | 'unmatched-breaks';

export interface WeekWarning {
  code: WeekWarningCode;
  message: string;
  kind?: PlaylistKindName;
  firstDate?: string;
}

export interface WeekRunPlan {
  /** In the order they are created: week by week, main before ads. */
  weeks: PlannedWeek[];
  /** Any problem: nothing is created (all-or-nothing). */
  problems: WeekProblem[];
  /** Does not block. */
  warnings: WeekWarning[];
}

const KIND_LABEL: Record<PlaylistKindName, string> = { main: 'main playlist', ads: 'ads playlist' };
const KIND_ORDER: PlaylistKindName[] = ['main', 'ads'];

function weekLabel(firstDate: string): string {
  return `Week ${weekNumber(firstDate)} (${formatDate(firstDate)})`;
}

/** What "Create weeks" would make, and everything that stops it. */
export function planWeekRun(input: WeekRunInput): WeekRunPlan {
  const plan: WeekRunPlan = { weeks: [], problems: [], warnings: [] };
  const first = WEEKDAYS[input.weekStart]?.long ?? '?';
  if (!isIsoDate(input.fromWeek) || !isIsoDate(input.toWeek)) {
    plan.problems.push({ code: 'dates', message: 'Both weeks are required (YYYY-MM-DD).' });
    return plan;
  }
  if (weekdayOf(input.fromWeek) !== input.weekStart || weekdayOf(input.toWeek) !== input.weekStart) {
    plan.problems.push({ code: 'dates', message: `A week starts on a ${first}, the first day of the channel's week.` });
    return plan;
  }
  if (input.toWeek < input.fromWeek) {
    plan.problems.push({ code: 'dates', message: 'The last week is before the first week.' });
    return plan;
  }
  const starts = weekStarts(input.fromWeek, input.toWeek);
  if (starts.length > WEEK_RUN_MAX) {
    plan.problems.push({ code: 'too-many', message: `At most ${WEEK_RUN_MAX} weeks can be created at once.` });
    return plan;
  }
  if (!input.playlists.length) {
    plan.problems.push({ code: 'no-playlist', message: 'Pick at least one playlist.' });
    return plan;
  }
  if (input.activeWeekdays && (input.activeWeekdays.length !== 7 || !input.activeWeekdays.some(Boolean))) {
    plan.problems.push({ code: 'active-days', message: 'At least one day of the week must be active.' });
    return plan;
  }
  const playlists = [...input.playlists].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (const firstDate of starts) {
    for (const p of playlists) {
      const at = { kind: p.kind, firstDate };
      if (p.existing.includes(firstDate)) {
        plan.problems.push({ code: 'exists', message: `${weekLabel(firstDate)} already exists in the ${KIND_LABEL[p.kind]}.`, ...at });
        continue;
      }
      const fitting = templatesForWeek(p.templates, firstDate);
      if (!fitting.length) {
        plan.problems.push({ code: 'no-template', message: `${weekLabel(firstDate)} is outside the dates of every layout of the ${KIND_LABEL[p.kind]}.`, ...at });
        continue;
      }
      let template: WeekTemplateInfo | undefined;
      if (p.templateId) {
        template = fitting.find((t) => t.id === p.templateId);
        if (!template) {
          plan.problems.push({ code: 'no-template', message: `${weekLabel(firstDate)} is outside the dates of the picked layout of the ${KIND_LABEL[p.kind]}.`, ...at });
          continue;
        }
      } else if (fitting.length > 1) {
        plan.problems.push({ code: 'pick-template', message: `${fitting.length} layouts of the ${KIND_LABEL[p.kind]} fit ${weekLabel(firstDate)}: pick one.`, ...at });
        continue;
      } else {
        template = fitting[0];
      }
      plan.weeks.push({
        kind: p.kind,
        playlistId: p.playlistId,
        firstDate,
        lastDate: weekLastDate(firstDate),
        number: weekNumber(firstDate),
        name: defaultWeekName(firstDate, input.shortName, p.kind),
        templateId: template.id,
        templateName: template.name,
        activeWeekdays: input.activeWeekdays ?? template.activeWeekdays,
      });
    }
    if (weekLastDate(firstDate) < input.today) {
      plan.warnings.push({ code: 'past', message: `${weekLabel(firstDate)} is in the past.`, firstDate });
    }
  }
  return plan;
}

/** What a template block carries into a week. */
export type WeekBlockSource = Pick<
  BlockDraft,
  'weekday' | 'blockTypeId' | 'startFrames' | 'lengthFrames' | 'fillGaps' | 'opensWithBreak' | 'note' | 'rotationListId' | 'limitsPerContentType' | 'breaks'
>;

export type StructuralEventKind = 'linked-break' | 'gap-compensator';
/** Rows a new week's blocks start with; every other kind of event is placed later. */
export const STRUCTURAL_EVENT_KINDS: StructuralEventKind[] = ['linked-break', 'gap-compensator'];

export interface PlannedEvent {
  sequence: number;
  kind: StructuralEventKind;
  /** Linked-break rows: the block type of the ads block that fills it. */
  breakTypeId: string | null;
  lengthFrames: number;
}

export interface PlannedBlock extends Omit<WeekBlockSource, 'weekday' | 'breaks'> {
  events: PlannedEvent[];
}

export interface PlannedDay {
  date: string;
  weekday: number;
  blocks: PlannedBlock[];
}

/**
 * The day playlists of a new week: one per active weekday, each with the template's blocks of that
 * weekday. A main-playlist block starts with its linked-break rows (length 0, in order) and one gap
 * compensator (length 0).
 */
export function buildWeekDays(firstDate: string, activeWeekdays: boolean[], blocks: WeekBlockSource[], kind: PlaylistKindName): PlannedDay[] {
  const days: PlannedDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(firstDate, i);
    const weekday = weekdayOf(date);
    if (!activeWeekdays[weekday]) continue;
    days.push({
      date,
      weekday,
      blocks: blocks
        .filter((b) => b.weekday === weekday)
        .sort((a, b) => a.startFrames - b.startFrames)
        .map(({ weekday: _weekday, breaks, ...rest }) => {
          const events: PlannedEvent[] = [];
          if (kind === 'main') {
            breaks.forEach((breakTypeId, sequence) => events.push({ sequence, kind: 'linked-break', breakTypeId, lengthFrames: 0 }));
            events.push({ sequence: events.length, kind: 'gap-compensator', breakTypeId: null, lengthFrames: 0 });
          }
          return { ...rest, events };
        }),
    });
  }
  return days;
}

export interface UnmatchedBreak {
  weekday: number;
  startFrames: number;
  breakTypeId: string;
}

/** Linked breaks with no block of that block type on the same weekday of the ads template. */
export function unmatchedBreaks(blocks: Pick<WeekBlockSource, 'weekday' | 'startFrames' | 'breaks'>[], adsDays: AdsDays, activeWeekdays: boolean[]): UnmatchedBreak[] {
  const out: UnmatchedBreak[] = [];
  for (const b of blocks) {
    if (!activeWeekdays[b.weekday]) continue;
    const day = adsDays[b.weekday] ?? [];
    for (const breakTypeId of b.breaks) {
      if (!day.some((a) => a.blockTypeId === breakTypeId)) out.push({ weekday: b.weekday, startFrames: b.startFrames, breakTypeId });
    }
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.startFrames - b.startFrames);
}

export type DayState = 'draft' | 'published' | 'reconciled';

export function dayState(day: { published: boolean; reconciled: boolean }): DayState {
  return day.reconciled ? 'reconciled' : day.published ? 'published' : 'draft';
}

export interface WeekDayUse {
  date: string;
  published: boolean;
  reconciled: boolean;
  /** Events that are not the rows a new week starts with (placed from orders, imported, added by hand). */
  placedEvents: number;
}

export interface WeekDeleteBlocker {
  date: string;
  message: string;
}

/** Days that keep a week from being deleted ("This week is in use"). Empty = it can go. */
export function weekDeleteBlockers(days: WeekDayUse[]): WeekDeleteBlocker[] {
  const out: WeekDeleteBlocker[] = [];
  for (const d of [...days].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const label = `${WEEKDAYS[weekdayOf(d.date)].short} ${formatDate(d.date)}`;
    if (d.reconciled) out.push({ date: d.date, message: `${label} is reconciled.` });
    else if (d.published) out.push({ date: d.date, message: `${label} is approved.` });
    else if (d.placedEvents > 0) out.push({ date: d.date, message: `${label} holds ${d.placedEvents} placed ${d.placedEvents === 1 ? 'event' : 'events'}.` });
  }
  return out;
}

export function checkWeekName(name: string): string | null {
  const n = name.trim();
  return !n || n.length > WEEK_NAME_MAX ? `The name is required and has at most ${WEEK_NAME_MAX} characters.` : null;
}
