// Channel settings (Admin → Channels): name, code, time, playlists, defaults, exports, checks.
// Saved all-or-nothing: a change that does not fit the channel's templates is refused with the list
// of what is in the way (frame rate and day start locked while used; first weekday only when every
// template fits the new week; ads playlist off only when nothing uses it).

import {
  AGE_LOGO_POSITIONS,
  EPG_TYPES,
  EXPORTERS,
  FRAME_RATES,
  WEEKDAYS,
  checkDates,
  formatDate,
  formatTc,
  framesPerDay,
  lastWeekday,
  uuidv7,
  weekdayOf,
  type FrameRateCode,
} from '@9eye/core';
import type { Prisma } from '@prisma/client';
import { db, toIsoDate } from '../db';
import { HttpError, notFound } from '../errors';
import { channelDto, templateSummaryDto } from './dto';

export interface ChannelSettings {
  version: number;
  name: string;
  code: string;
  frameRate: string;
  dayStartFrames: number;
  weekStart: number;
  timeZone: string | null;
  dateLocale: string;
  hasAds: boolean;
  ageLogoPosition?: string | null;
  defaultBreakListId?: string | null;
  shortestBreakFrames?: number;
  defaultExport?: string | null;
  allowedExports?: string[];
  epgTypes?: string[];
  bxfTimesUtc?: boolean;
  reconcileTolerance?: number;
}

type Problem = { code: string; message: string; templateId?: string };

const withCounts = { playlists: { include: { _count: { select: { templates: { where: { deletedAt: null } } } } } } } as const;

export async function getChannel(id: string) {
  const c = await db.channel.findFirst({ where: { id, deletedAt: null }, include: withCounts });
  if (!c) throw notFound('Channel');
  return channelDto(c);
}

/** What uses the channel: its templates and block types (the "Used by" and "What can change" of the page). */
export async function channelUsage(id: string) {
  const c = await db.channel.findFirst({ where: { id, deletedAt: null }, include: { playlists: true } });
  if (!c) throw notFound('Channel');
  const templates = await db.template.findMany({
    where: { deletedAt: null, playlist: { channelId: id } },
    include: { playlist: true },
    orderBy: [{ validFrom: 'asc' }, { name: 'asc' }],
  });
  const ads = c.playlists.find((p) => p.kind === 'ads');
  const [blockTypeCount, adsBlockTypeCount, withBreaks] = await Promise.all([
    db.blockType.count({ where: { deletedAt: null, playlist: { channelId: id } } }),
    ads ? db.blockType.count({ where: { deletedAt: null, playlistId: ads.id } }) : Promise.resolve(0),
    db.template.findMany({ where: { deletedAt: null, playlist: { channelId: id, kind: 'main' }, blocks: { some: { breaks: { some: {} } } } }, select: { id: true } }),
  ]);
  return {
    templates: templates.map(templateSummaryDto),
    blockTypeCount,
    adsBlockTypeCount,
    mainTemplatesWithBreaks: withBreaks.map((t) => t.id),
  };
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz.includes('/') || tz === 'UTC';
  } catch {
    return false;
  }
}

export function isLocale(tag: string): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length === 1;
  } catch {
    return false;
  }
}

const short = (iso: string) => WEEKDAYS[weekdayOf(iso)].short;
const exporterCodes = new Set(EXPORTERS.map((e) => e.code));
const epgCodes = new Set(EPG_TYPES.map((e) => e.code));

/** Checks that do not depend on the channel's data. */
function checkBasics(input: Pick<ChannelSettings, 'name' | 'code' | 'frameRate' | 'dayStartFrames' | 'weekStart'> & Partial<ChannelSettings>): Problem[] {
  const invalid: Problem[] = [];
  const name = input.name.trim();
  if (!name || name.length > 80) invalid.push({ code: 'name', message: 'The name is required and has at most 80 characters.' });
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(input.code.trim())) invalid.push({ code: 'code', message: 'The code is 1–20 letters, digits, "-" or "_" (it is used in export file names).' });
  const rate = FRAME_RATES[input.frameRate as FrameRateCode];
  if (!rate) invalid.push({ code: 'frame-rate', message: 'Pick a frame rate from the list.' });
  else {
    const day = framesPerDay(rate);
    if (!Number.isInteger(input.dayStartFrames) || input.dayStartFrames < 0 || input.dayStartFrames >= day) {
      invalid.push({ code: 'day-start', message: 'The day start must be a time of day.' });
    }
    if (input.shortestBreakFrames !== undefined && (!Number.isInteger(input.shortestBreakFrames) || input.shortestBreakFrames < 0 || input.shortestBreakFrames >= day)) {
      invalid.push({ code: 'shortest-break', message: 'The shortest break must be a length shorter than a day.' });
    }
  }
  if (!Number.isInteger(input.weekStart) || input.weekStart < 0 || input.weekStart > 6) invalid.push({ code: 'week-start', message: 'Pick the first weekday.' });
  const tz = input.timeZone?.trim();
  if (tz && !isTimeZone(tz)) invalid.push({ code: 'time-zone', message: `"${tz}" is not a time zone name (e.g. Europe/London), or leave it empty.` });
  if (input.dateLocale !== undefined && !isLocale(input.dateLocale.trim())) invalid.push({ code: 'date-locale', message: 'Pick a date locale from the list.' });
  if (input.ageLogoPosition && !AGE_LOGO_POSITIONS.some((p) => p.code === input.ageLogoPosition)) invalid.push({ code: 'age-logo', message: 'Pick an age logo position from the list.' });
  const allowed = input.allowedExports ?? [];
  if (allowed.some((e) => !exporterCodes.has(e)) || new Set(allowed).size !== allowed.length) invalid.push({ code: 'exports', message: 'Allowed exports must be known exports, each once.' });
  if (input.defaultExport && !allowed.includes(input.defaultExport)) invalid.push({ code: 'default-export', message: 'The default export must be one of the allowed exports.' });
  const epg = input.epgTypes ?? [];
  if (epg.some((e) => !epgCodes.has(e)) || new Set(epg).size !== epg.length) invalid.push({ code: 'epg', message: 'Pick EPG types from the list.' });
  if (input.reconcileTolerance !== undefined && (!Number.isInteger(input.reconcileTolerance) || input.reconcileTolerance < 0 || input.reconcileTolerance > 100000)) {
    invalid.push({ code: 'tolerance', message: 'The reconciliation timing margin is a whole number, 0 or more.' });
  }
  return invalid;
}

async function checkUnique(name: string, code: string, exceptId: string | null) {
  const others = await db.channel.findMany({ where: { deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}), OR: [{ name }, { code }] } });
  const taken: Problem[] = [];
  const byCode = others.find((o) => o.code === code);
  if (others.some((o) => o.name === name)) taken.push({ code: 'name', message: `Another channel is already called ${name}.` });
  if (byCode) taken.push({ code: 'code', message: `${byCode.name} already uses the code ${code}.` });
  if (taken.length) throw new HttpError(422, 'Nothing was saved. Names and codes are unique.', taken);
}

export async function createChannel(input: { name: string; code: string; frameRate: string; dayStartFrames: number; weekStart: number; hasAds: boolean }) {
  const invalid = checkBasics({ ...input, timeZone: null });
  if (invalid.length) throw new HttpError(422, 'Nothing was saved. Some settings are not valid.', invalid);
  const name = input.name.trim();
  const code = input.code.trim();
  await checkUnique(name, code, null);
  const id = uuidv7();
  await db.$transaction(async (tx) => {
    await tx.channel.create({
      data: { id, name, code, frameRate: input.frameRate, dayStartFrames: input.dayStartFrames, weekStart: input.weekStart } as Prisma.ChannelUncheckedCreateInput,
    });
    await tx.channelPlaylist.create({ data: { id: uuidv7(), channelId: id, kind: 'main' } as Prisma.ChannelPlaylistUncheckedCreateInput });
    if (input.hasAds) await tx.channelPlaylist.create({ data: { id: uuidv7(), channelId: id, kind: 'ads' } as Prisma.ChannelPlaylistUncheckedCreateInput });
  });
  return getChannel(id);
}

export async function updateChannel(id: string, input: ChannelSettings) {
  const c = await db.channel.findFirst({ where: { id, deletedAt: null }, include: { playlists: true } });
  if (!c) throw notFound('Channel');
  const name = input.name.trim();
  const code = input.code.trim();
  const timeZone = input.timeZone?.trim() || null;
  const dateLocale = input.dateLocale.trim();
  const rate = FRAME_RATES[input.frameRate as FrameRateCode];

  // 1 · each setting on its own
  const invalid = checkBasics(input);
  if (input.hasAds && input.defaultBreakListId) {
    const list = await db.breakList.findFirst({ where: { id: input.defaultBreakListId, channelId: id } });
    if (!list) invalid.push({ code: 'break-list', message: 'The default break list must be one of this channel’s lists.' });
  }
  if (invalid.length) throw new HttpError(422, 'Nothing was saved. Some settings are not valid.', invalid);
  await checkUnique(name, code, id);

  // 2 · what the change means for the channel's templates and block types
  const templates = await db.template.findMany({
    where: { deletedAt: null, playlist: { channelId: id } },
    include: { playlist: true },
    orderBy: [{ validFrom: 'asc' }, { name: 'asc' }],
  });
  const label = (t: (typeof templates)[number]) => `${t.name} · ${t.playlist.kind === 'main' ? 'main' : 'ads'} playlist`;
  const reasons: string[] = [];
  const blocking: Problem[] = [];

  if (input.weekStart !== c.weekStart) {
    const misfits = templates.filter((t) => checkDates(toIsoDate(t.validFrom), toIsoDate(t.validTo), input.weekStart).length > 0);
    if (misfits.length) {
      reasons.push(
        `The first weekday can change only when every layout of ${c.name} starts on a ${WEEKDAYS[input.weekStart].long} and ends on a ${WEEKDAYS[lastWeekday(input.weekStart)].long}; ${misfits.length === 1 ? 'this one does' : `these ${misfits.length} do`} not.`,
      );
      for (const t of misfits) {
        const from = toIsoDate(t.validFrom);
        const to = toIsoDate(t.validTo);
        blocking.push({ code: 'week-start', templateId: t.id, message: `${label(t)} · ${formatDate(from)} (${short(from)}) → ${formatDate(to)} (${short(to)})` });
      }
    }
  }

  // The day start is a time of day: compare it as a timecode, so a new frame rate alone does not count as a new day start.
  const rateChanged = input.frameRate !== c.frameRate;
  const dayStartChanged = formatTc(input.dayStartFrames, rate) !== formatTc(c.dayStartFrames, FRAME_RATES[c.frameRate as FrameRateCode]);
  if (rateChanged || dayStartChanged) {
    const ownTypes = await db.blockType.count({ where: { deletedAt: null, playlist: { channelId: id } } });
    if (templates.length || ownTypes) {
      const what = [rateChanged && 'frame rate', dayStartChanged && 'day start'].filter(Boolean).join(' and ');
      reasons.push(`The ${what} can change only while ${c.name} has no layouts and no block types: their times are stored in frames, counted from the day start.`);
      for (const t of templates) blocking.push({ code: 'times-locked', templateId: t.id, message: label(t) });
      if (ownTypes) blocking.push({ code: 'times-locked', message: `${ownTypes} block ${ownTypes === 1 ? 'type belongs' : 'types belong'} to this channel` });
    }
  }

  const ads = c.playlists.find((p) => p.kind === 'ads');
  if (!input.hasAds && ads) {
    const adsTemplates = templates.filter((t) => t.playlistId === ads.id);
    const adsTypes = await db.blockType.count({ where: { deletedAt: null, playlistId: ads.id } });
    const mainWithBreaks = await db.template.findMany({
      where: { deletedAt: null, playlist: { channelId: id, kind: 'main' }, blocks: { some: { breaks: { some: {} } } } },
      include: { playlist: true },
    });
    if (adsTemplates.length || adsTypes || mainWithBreaks.length) {
      reasons.push('The ads playlist can be removed only when nothing uses it.');
      for (const t of adsTemplates) blocking.push({ code: 'ads-in-use', templateId: t.id, message: label(t) });
      if (adsTypes) blocking.push({ code: 'ads-in-use', message: `${adsTypes} block ${adsTypes === 1 ? 'type belongs' : 'types belong'} to the ads playlist` });
      for (const t of mainWithBreaks) blocking.push({ code: 'ads-in-use', templateId: t.id, message: `${label(t)} · has linked breaks` });
    }
  }

  if (blocking.length) throw new HttpError(422, `Nothing was saved. ${reasons.join(' ')}`, blocking);

  // 3 · write, all or nothing
  await db.$transaction(async (tx) => {
    const updated = await tx.channel.updateMany({
      where: { id, version: input.version, deletedAt: null },
      data: {
        name,
        code,
        frameRate: input.frameRate,
        dayStartFrames: input.dayStartFrames,
        weekStart: input.weekStart,
        timeZone,
        dateLocale,
        ageLogoPosition: input.ageLogoPosition === undefined ? undefined : input.ageLogoPosition || null,
        defaultBreakListId: input.hasAds ? (input.defaultBreakListId === undefined ? undefined : input.defaultBreakListId || null) : null,
        shortestBreakFrames: input.shortestBreakFrames,
        defaultExport: input.defaultExport === undefined ? undefined : input.defaultExport || null,
        allowedExports: input.allowedExports,
        epgTypes: input.epgTypes,
        bxfTimesUtc: input.bxfTimesUtc,
        reconcileTolerance: input.reconcileTolerance,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new HttpError(409, 'Someone else changed this channel since you opened it. Reload to see their settings.');
    if (input.hasAds && !ads) {
      await tx.channelPlaylist.create({ data: { id: uuidv7(), channelId: id, kind: 'ads' } as Prisma.ChannelPlaylistUncheckedCreateInput });
    }
    if (!input.hasAds && ads) await tx.channelPlaylist.delete({ where: { id: ads.id } });
  });
  return getChannel(id);
}
