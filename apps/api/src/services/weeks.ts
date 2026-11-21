// Weeks (data model §6): the dated copies of a template. List a range, check and create a run
// (all-or-nothing, main before ads), read one, rename, delete (refused while in use).

import {
  STRUCTURAL_EVENT_KINDS,
  WEEKDAYS,
  addDays,
  broadcastToday,
  buildWeekDays,
  checkWeekName,
  dayState,
  formatClockShort,
  frameRate,
  isIsoDate,
  planWeekRun,
  templatesForWeek,
  unmatchedBreaks,
  uuidv7,
  weekDeleteBlockers,
  weekLastDate,
  weekNumber,
  weekdayOf,
  type AdsDays,
  type DayState,
  type PlannedWeek,
  type PlaylistKindName,
  type WeekBlockSource,
  type WeekProblem,
  type WeekRunPlan,
  type WeekRunPlaylist,
  type WeekTemplateInfo,
} from '@9eye/core';
import { Prisma, type Template } from '@prisma/client';
import { db, fromIsoDate, toIsoDate, type Tx, currentTenantId } from '../db';
import { companyEvent } from '../events';
import { HttpError, notFound } from '../errors';
import { channelDto, type ChannelDto } from './dto';

export interface WeekDayDto {
  /** null = the weekday is not active in this week: it has no day playlist. */
  id: string | null;
  date: string;
  weekday: number;
  state: DayState | 'not-active';
  blocks: number;
}

export interface WeekDto {
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
  days: WeekDayDto[];
}

const weekInclude = {
  playlist: true,
  template: { select: { name: true } },
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
  days: { include: { _count: { select: { blocks: true } } }, orderBy: { date: 'asc' } },
} satisfies Prisma.WeekInclude;

type WeekRow = Prisma.WeekGetPayload<{ include: typeof weekInclude }>;

function weekDto(w: WeekRow): WeekDto {
  const firstDate = toIsoDate(w.firstDate);
  return {
    id: w.id,
    kind: w.playlist.kind as PlaylistKindName,
    playlistId: w.playlistId,
    channelId: w.playlist.channelId,
    name: w.name,
    number: weekNumber(firstDate),
    firstDate,
    lastDate: weekLastDate(firstDate),
    templateId: w.templateId,
    templateName: w.template.name,
    activeWeekdays: w.activeWeekdays,
    version: w.version,
    createdAt: w.createdAt.toISOString(),
    createdBy: w.createdBy?.name ?? null,
    updatedAt: w.updatedAt.toISOString(),
    updatedBy: w.updatedBy?.name ?? null,
    days: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(firstDate, i);
      const d = w.days.find((x) => toIsoDate(x.date) === date);
      return d
        ? { id: d.id, date, weekday: weekdayOf(date), state: dayState(d), blocks: d._count.blocks }
        : { id: null, date, weekday: weekdayOf(date), state: 'not-active' as const, blocks: 0 };
    }),
  };
}

async function loadChannel(channelId: string) {
  const channel = await db.channel.findFirst({ where: { id: channelId, deletedAt: null }, include: { playlists: true } });
  if (!channel) throw notFound('Channel');
  return channel;
}

/** The weeks of one playlist of a channel whose first day lies between two dates (both included). */
export async function listWeeks(channelId: string, kind: PlaylistKindName, from: string, to: string): Promise<WeekDto[]> {
  const channel = await loadChannel(channelId);
  if (!isIsoDate(from) || !isIsoDate(to)) throw new HttpError(400, 'Both dates are required (YYYY-MM-DD).');
  const playlist = channel.playlists.find((p) => p.kind === kind);
  if (!playlist) return [];
  const rows = await db.week.findMany({
    where: { playlistId: playlist.id, firstDate: { gte: fromIsoDate(from), lte: fromIsoDate(to) } },
    include: weekInclude,
    orderBy: { firstDate: 'asc' },
  });
  return rows.map(weekDto);
}

export interface WeekRunBody {
  kinds: PlaylistKindName[];
  fromWeek: string;
  toWeek: string;
  /** Needed only where several templates fit a week. */
  templates?: { main?: string | null; ads?: string | null };
  /** null / absent = each template's own active days. */
  activeWeekdays?: boolean[] | null;
}

const templateInfo = (t: Template): WeekTemplateInfo => ({
  id: t.id,
  name: t.name,
  validFrom: toIsoDate(t.validFrom),
  validTo: toIsoDate(t.validTo),
  activeWeekdays: t.activeWeekdays,
});

async function templateBlocks(templateId: string): Promise<WeekBlockSource[]> {
  const rows = await db.templateBlock.findMany({
    where: { templateId },
    include: { breaks: { orderBy: { position: 'asc' } } },
    orderBy: [{ weekday: 'asc' }, { startFrames: 'asc' }],
  });
  return rows.map((b) => ({
    weekday: b.weekday,
    blockTypeId: b.blockTypeId,
    startFrames: b.startFrames,
    lengthFrames: b.lengthFrames,
    fillGaps: b.fillGaps,
    opensWithBreak: b.opensWithBreak,
    note: b.note,
    rotationListId: b.rotationListId,
    limitsPerContentType: (b.limitsPerContentType as unknown[]) ?? [],
    breaks: b.breaks.map((k) => k.breakTypeId),
  }));
}

function adsDaysOf(blocks: WeekBlockSource[]): AdsDays {
  const days: AdsDays = [[], [], [], [], [], [], []];
  for (const b of blocks) days[b.weekday].push({ blockTypeId: b.blockTypeId, startFrames: b.startFrames, lengthFrames: b.lengthFrames });
  return days;
}

interface RunContext {
  plan: WeekRunPlan;
  /** Template blocks of every template the plan uses. */
  blocks: Map<string, WeekBlockSource[]>;
}

async function planRun(channelId: string, body: WeekRunBody): Promise<RunContext> {
  const channel = await loadChannel(channelId);
  const kinds = [...new Set(body.kinds)];
  const datesOk = isIsoDate(body.fromWeek) && isIsoDate(body.toWeek);
  const range = datesOk ? { gte: fromIsoDate(body.fromWeek), lte: fromIsoDate(body.toWeek) } : null;
  const blocks = new Map<string, WeekBlockSource[]>();
  const blocksOf = async (templateId: string) => {
    if (!blocks.has(templateId)) blocks.set(templateId, await templateBlocks(templateId));
    return blocks.get(templateId)!;
  };

  const playlists: WeekRunPlaylist[] = [];
  const missing: WeekProblem[] = [];
  for (const kind of kinds) {
    const p = channel.playlists.find((x) => x.kind === kind);
    if (!p) {
      missing.push({ code: 'no-playlist', message: `This channel has no ${kind} playlist.`, kind });
      continue;
    }
    const templates = await db.template.findMany({ where: { playlistId: p.id, deletedAt: null }, orderBy: [{ validFrom: 'asc' }, { name: 'asc' }] });
    const existing = range ? await db.week.findMany({ where: { playlistId: p.id, firstDate: range }, select: { firstDate: true } }) : [];
    playlists.push({
      kind,
      playlistId: p.id,
      templates: templates.map(templateInfo),
      templateId: body.templates?.[kind] ?? null,
      existing: existing.map((w) => toIsoDate(w.firstDate)),
    });
  }
  if (missing.length) return { plan: { weeks: [], problems: missing, warnings: [] }, blocks };

  const plan = planWeekRun({
    weekStart: channel.weekStart,
    today: broadcastToday(Date.now(), channel),
    fromWeek: body.fromWeek,
    toWeek: body.toWeek,
    shortName: channel.name,
    activeWeekdays: body.activeWeekdays ?? null,
    playlists,
  });
  if (plan.problems.length) return { plan, blocks };

  // Linked breaks that will find no ads block: a warning, never a refusal (the ads template may change later).
  const adsPlaylist = channel.playlists.find((p) => p.kind === 'ads');
  const mainWeeks = plan.weeks.filter((w) => w.kind === 'main');
  if (adsPlaylist && mainWeeks.length && range) {
    const adsTemplates = (await db.template.findMany({ where: { playlistId: adsPlaylist.id, deletedAt: null } })).map(templateInfo);
    const adsWeeks = await db.week.findMany({ where: { playlistId: adsPlaylist.id, firstDate: range }, select: { firstDate: true, templateId: true } });
    const rate = frameRate(channel.frameRate);
    for (const w of mainWeeks) {
      const fitting = templatesForWeek(adsTemplates, w.firstDate);
      const adsTemplateId =
        plan.weeks.find((x) => x.kind === 'ads' && x.firstDate === w.firstDate)?.templateId ??
        adsWeeks.find((x) => toIsoDate(x.firstDate) === w.firstDate)?.templateId ??
        (fitting.length === 1 ? fitting[0].id : null);
      if (!adsTemplateId) continue;
      const lost = unmatchedBreaks(await blocksOf(w.templateId), adsDaysOf(await blocksOf(adsTemplateId)), w.activeWeekdays);
      if (!lost.length) continue;
      const at = `${WEEKDAYS[lost[0].weekday].long} ${formatClockShort(lost[0].startFrames, channel.dayStartFrames, rate)}`;
      plan.warnings.push({
        code: 'unmatched-breaks',
        kind: 'main',
        firstDate: w.firstDate,
        message: `Week ${w.number}: ${lost.length} linked ${lost.length === 1 ? 'break has' : 'breaks have'} no block in the ads layout (first: the block at ${at}). The week is still created.`,
      });
    }
  }
  for (const w of plan.weeks) await blocksOf(w.templateId);
  return { plan, blocks };
}

/** What "Create weeks" would do: the weeks, every refusal and every warning. Writes nothing. */
export async function checkWeeks(channelId: string, body: WeekRunBody): Promise<WeekRunPlan> {
  return (await planRun(channelId, body)).plan;
}

async function writeWeek(tx: Tx, w: PlannedWeek, blocks: WeekBlockSource[], userId: string | null): Promise<string> {
  const weekId = uuidv7();
  await tx.week.create({
    data: {
      id: weekId,
      playlistId: w.playlistId,
      templateId: w.templateId,
      name: w.name,
      firstDate: fromIsoDate(w.firstDate),
      activeWeekdays: w.activeWeekdays,
      createdById: userId,
      updatedById: userId,
    } as Prisma.WeekUncheckedCreateInput,
  });
  const days = buildWeekDays(w.firstDate, w.activeWeekdays, blocks, w.kind).map((d) => ({ ...d, id: uuidv7() }));
  if (!days.length) return weekId;
  await tx.dayPlaylist.createMany({
    data: days.map((d) => ({ id: d.id, weekId, playlistId: w.playlistId, date: fromIsoDate(d.date) })) as unknown as Prisma.DayPlaylistCreateManyInput[],
  });
  const blockRows = days.flatMap((d) => d.blocks.map((b) => ({ ...b, id: uuidv7(), dayId: d.id })));
  if (blockRows.length) {
    await tx.playlistBlock.createMany({
      data: blockRows.map((b) => ({
        id: b.id,
        dayId: b.dayId,
        blockTypeId: b.blockTypeId,
        startFrames: b.startFrames,
        lengthFrames: b.lengthFrames,
        fillGaps: b.fillGaps,
        rotationListId: b.rotationListId,
        opensWithBreak: b.opensWithBreak,
        note: b.note,
        limitsPerContentType: b.limitsPerContentType as Prisma.InputJsonValue,
      })),
    });
  }
  const eventRows = blockRows.flatMap((b) => b.events.map((e) => ({ id: uuidv7(), blockId: b.id, sequence: e.sequence, kind: e.kind, lengthFrames: e.lengthFrames, breakTypeId: e.breakTypeId })));
  if (eventRows.length) await tx.playlistEvent.createMany({ data: eventRows });
  return weekId;
}

/** Creates every week of the run or none. Week by week, main before ads. */
export async function createWeeks(channelId: string, body: WeekRunBody, userId: string | null): Promise<{ weeks: WeekDto[]; warnings: WeekRunPlan['warnings'] }> {
  const { plan, blocks } = await planRun(channelId, body);
  if (plan.problems.length) {
    throw new HttpError(422, plan.problems.length === 1 ? plan.problems[0].message : `${plan.problems.length} problems: nothing was created.`, plan.problems);
  }
  const ids: string[] = [];
  try {
    await db.$transaction(
      async (tx) => {
        for (const w of plan.weeks) ids.push(await writeWeek(tx, w, blocks.get(w.templateId) ?? [], userId));
      },
      { timeout: 120_000 },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, 'One of these weeks was created by someone else meanwhile. Nothing was created; check again.');
    }
    throw err;
  }
  const rows = await db.week.findMany({ where: { id: { in: ids } }, include: weekInclude, orderBy: [{ firstDate: 'asc' }] });
  const order = new Map(ids.map((id, i) => [id, i]));
  const weeks = rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map(weekDto);
  if (weeks.length) {
    const ch = await db.channel.findFirst({ where: { id: channelId }, select: { name: true } });
    const from = weeks[0].firstDate;
    const text = `${ch?.name ?? 'A channel'}: ${weeks.length === 1 ? '1 week' : `${weeks.length} weeks`} created (${[...new Set(weeks.map((w) => w.kind))].join(' and ')} playlist), from ${from}.`;
    companyEvent(currentTenantId(), { kind: 'week_created', channelId, text });
  }
  return { weeks, warnings: plan.warnings };
}

export interface WeekEventDto {
  id: string;
  sequence: number;
  kind: string;
  lengthFrames: number;
  breakTypeId: string | null;
}

export interface WeekBlockDto {
  id: string;
  blockTypeId: string;
  startFrames: number;
  lengthFrames: number;
  fillGaps: boolean;
  opensWithBreak: boolean;
  note: string;
  rotationListId: string | null;
  limitsPerContentType: unknown[];
  events: WeekEventDto[];
}

export interface WeekFullDto {
  week: WeekDto;
  channel: ChannelDto;
  days: (WeekDayDto & { blockList: WeekBlockDto[] })[];
}

async function loadWeek(id: string) {
  const w = await db.week.findFirst({ where: { id }, include: weekInclude });
  if (!w) throw notFound('Week');
  return w;
}

export async function getWeek(id: string): Promise<WeekFullDto> {
  const w = await loadWeek(id);
  const channel = await loadChannel(w.playlist.channelId);
  const days = await db.dayPlaylist.findMany({
    where: { weekId: id },
    include: { blocks: { include: { events: { orderBy: { sequence: 'asc' } } }, orderBy: { startFrames: 'asc' } } },
  });
  const dto = weekDto(w);
  return {
    week: dto,
    channel: channelDto(channel),
    days: dto.days.map((d) => ({
      ...d,
      blockList: (days.find((x) => x.id === d.id)?.blocks ?? []).map((b) => ({
        id: b.id,
        blockTypeId: b.blockTypeId,
        startFrames: b.startFrames,
        lengthFrames: b.lengthFrames,
        fillGaps: b.fillGaps,
        opensWithBreak: b.opensWithBreak,
        note: b.note,
        rotationListId: b.rotationListId,
        limitsPerContentType: (b.limitsPerContentType as unknown[]) ?? [],
        events: b.events.map((e) => ({ id: e.id, sequence: e.sequence, kind: e.kind, lengthFrames: e.lengthFrames, breakTypeId: e.breakTypeId })),
      })),
    })),
  };
}

export async function renameWeek(id: string, input: { name: string; version: number }, userId: string | null): Promise<WeekDto> {
  const problem = checkWeekName(input.name);
  if (problem) throw new HttpError(422, problem, [{ code: 'name', message: problem }]);
  await loadWeek(id);
  const updated = await db.week.updateMany({
    where: { id, version: input.version },
    data: { name: input.name.trim(), version: { increment: 1 }, updatedById: userId },
  });
  if (updated.count !== 1) throw new HttpError(409, 'Someone else changed this week since you opened it. Reload it to see their changes.');
  return weekDto(await loadWeek(id));
}

/** Deletes the week with its day playlists; refused while a day is published, reconciled or holds placed events. */
export async function deleteWeek(id: string): Promise<void> {
  await loadWeek(id);
  const days = await db.dayPlaylist.findMany({
    where: { weekId: id },
    select: {
      date: true,
      published: true,
      reconciled: true,
      blocks: { select: { _count: { select: { events: { where: { kind: { notIn: [...STRUCTURAL_EVENT_KINDS] } } } } } } },
    },
  });
  const blockers = weekDeleteBlockers(
    days.map((d) => ({
      date: toIsoDate(d.date),
      published: d.published,
      reconciled: d.reconciled,
      placedEvents: d.blocks.reduce((n, b) => n + b._count.events, 0),
    })),
  );
  if (blockers.length) {
    throw new HttpError(409, 'This week is in use: nothing was deleted.', blockers.map((b) => ({ code: 'in-use', message: b.message })));
  }
  await db.week.delete({ where: { id } });
}
