// Templates (data model §5): read with everything the Templates page needs, create, clone, save
// (whole template, all-or-nothing, optimistic version check), delete.

import {
  TEMPLATE_NAME_MAX,
  checkDates,
  uuidv7,
  validateTemplate,
  type AdsBlock,
  type BlockDraft,
  type BlockTypeInfo,
  type TemplateDraft,
} from '@9eye/core';
import type { Prisma, Template } from '@prisma/client';
import { db, fromIsoDate, toIsoDate, type Tx } from '../db';
import { HttpError, notFound } from '../errors';
import { channelDto, templateSummaryDto, type ChannelDto, type TemplateSummaryDto } from './dto';

const playlistWithChannel = { playlist: { include: { channel: { include: { playlists: true } } } } } as const;

async function loadTemplate(id: string) {
  const t = await db.template.findFirst({ where: { id, deletedAt: null }, include: playlistWithChannel });
  if (!t) throw notFound('Layout');
  return t;
}

export async function listTemplates(channelId: string): Promise<TemplateSummaryDto[]> {
  const channel = await db.channel.findFirst({ where: { id: channelId, deletedAt: null } });
  if (!channel) throw notFound('Channel');
  const rows = await db.template.findMany({
    where: { deletedAt: null, playlist: { channelId } },
    include: { playlist: true },
    orderBy: [{ validFrom: 'desc' }, { name: 'asc' }],
  });
  return rows.map(templateSummaryDto);
}

async function blocksOf(templateId: string): Promise<BlockDraft[]> {
  const rows = await db.template.findFirst({
    where: { id: templateId },
    select: {
      blocks: {
        include: { breaks: { orderBy: { position: 'asc' } } },
        orderBy: [{ weekday: 'asc' }, { startFrames: 'asc' }],
      },
    },
  });
  return (rows?.blocks ?? []).map((b) => ({
    id: b.id,
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

const overlapsDates = (a: { validFrom: Date; validTo: Date }, b: { validFrom: Date; validTo: Date }) =>
  a.validFrom <= b.validTo && a.validTo >= b.validFrom;
const contains = (t: { validFrom: Date; validTo: Date }, d: Date) => t.validFrom <= d && d <= t.validTo;
const latest = <T extends { validFrom: Date }>(xs: T[]) => [...xs].sort((a, b) => +b.validFrom - +a.validFrom)[0];

/** The ads template whose blocks a main template's linked breaks mean (data model §5). */
async function adsTemplateFor(main: Template, adsPlaylistId: string): Promise<Template | null> {
  const ads = await db.template.findMany({ where: { playlistId: adsPlaylistId, deletedAt: null } });
  const overlapping = ads.filter((a) => overlapsDates(a, main));
  return overlapping.find((a) => contains(a, main.validFrom)) ?? latest(overlapping) ?? null;
}

async function adsDaysOf(templateId: string): Promise<AdsBlock[][]> {
  const days: AdsBlock[][] = [[], [], [], [], [], [], []];
  const rows = await db.template.findFirst({
    where: { id: templateId },
    select: { blocks: { select: { weekday: true, blockTypeId: true, startFrames: true, lengthFrames: true }, orderBy: { startFrames: 'asc' } } },
  });
  for (const b of rows?.blocks ?? []) days[b.weekday].push({ blockTypeId: b.blockTypeId, startFrames: b.startFrames, lengthFrames: b.lengthFrames });
  return days;
}

export interface TemplateFullDto {
  template: TemplateSummaryDto;
  channel: ChannelDto;
  blocks: BlockDraft[];
  /** Main template of a channel with an ads playlist: the ads template its breaks point into. */
  ads: { template: TemplateSummaryDto | null; days: AdsBlock[][] } | null;
  /** Ads template: the main template whose linked breaks point at its blocks. */
  main: { template: TemplateSummaryDto | null; blocks: Pick<BlockDraft, 'id' | 'weekday' | 'blockTypeId' | 'startFrames' | 'lengthFrames' | 'breaks'>[] } | null;
}

export async function getTemplateFull(id: string): Promise<TemplateFullDto> {
  const t = await loadTemplate(id);
  const channel = t.playlist.channel;
  const adsPlaylist = channel.playlists.find((p) => p.kind === 'ads');
  const mainPlaylist = channel.playlists.find((p) => p.kind === 'main');
  const out: TemplateFullDto = {
    template: templateSummaryDto(t),
    channel: channelDto(channel),
    blocks: await blocksOf(t.id),
    ads: null,
    main: null,
  };
  if (t.playlist.kind === 'main' && adsPlaylist) {
    const ads = await adsTemplateFor(t, adsPlaylist.id);
    out.ads = {
      template: ads ? templateSummaryDto({ ...ads, playlist: adsPlaylist }) : null,
      days: ads ? await adsDaysOf(ads.id) : [[], [], [], [], [], [], []],
    };
  }
  if (t.playlist.kind === 'ads' && mainPlaylist) {
    const mains = (await db.template.findMany({ where: { playlistId: mainPlaylist.id, deletedAt: null } })).filter((m) => overlapsDates(m, t));
    const linked: Template[] = [];
    for (const m of mains) if ((await adsTemplateFor(m, t.playlistId))?.id === t.id) linked.push(m);
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const main = linked.find((m) => contains(m, today)) ?? latest(linked) ?? null;
    out.main = {
      template: main ? templateSummaryDto({ ...main, playlist: mainPlaylist }) : null,
      blocks: main ? (await blocksOf(main.id)).map(({ id, weekday, blockTypeId, startFrames, lengthFrames, breaks }) => ({ id, weekday, blockTypeId, startFrames, lengthFrames, breaks })) : [],
    };
  }
  return out;
}

function checkNameAndDates(name: string, validFrom: string, validTo: string, weekStart: number) {
  const problems = checkDates(validFrom, validTo, weekStart);
  const n = name.trim();
  if (!n || n.length > TEMPLATE_NAME_MAX) {
    problems.unshift({ code: 'name', message: `The name is required and has at most ${TEMPLATE_NAME_MAX} characters.` });
  }
  if (problems.length) throw new HttpError(422, problems[0].message, problems);
}

export async function createTemplate(input: { playlistId: string; name: string; validFrom: string; validTo: string }) {
  const playlist = await db.channelPlaylist.findFirst({ where: { id: input.playlistId }, include: { channel: true } });
  if (!playlist || playlist.channel.deletedAt) throw notFound('Playlist');
  checkNameAndDates(input.name, input.validFrom, input.validTo, playlist.channel.weekStart);
  const t = await db.template.create({
    data: {
      id: uuidv7(),
      playlistId: playlist.id,
      name: input.name.trim(),
      validFrom: fromIsoDate(input.validFrom),
      validTo: fromIsoDate(input.validTo),
      activeWeekdays: [true, true, true, true, true, true, true],
    } as Prisma.TemplateUncheckedCreateInput,
  });
  return getTemplateFull(t.id);
}

async function writeBlocks(tx: Tx, templateId: string, blocks: BlockDraft[]) {
  await tx.templateBlock.deleteMany({ where: { templateId } });
  if (!blocks.length) return;
  await tx.templateBlock.createMany({
    data: blocks.map((b) => ({
      id: b.id,
      templateId,
      weekday: b.weekday,
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
  const breaks = blocks.flatMap((b) => b.breaks.map((breakTypeId, position) => ({ id: uuidv7(), blockId: b.id, position, breakTypeId })));
  if (breaks.length) await tx.linkedBreak.createMany({ data: breaks });
}

export async function cloneTemplate(id: string, input: { name: string; validFrom: string; validTo: string }) {
  const src = await loadTemplate(id);
  checkNameAndDates(input.name, input.validFrom, input.validTo, src.playlist.channel.weekStart);
  const blocks = (await blocksOf(src.id)).map((b) => ({ ...b, id: uuidv7() }));
  const newId = uuidv7();
  await db.$transaction(async (tx) => {
    await tx.template.create({
      data: {
        id: newId,
        playlistId: src.playlistId,
        name: input.name.trim(),
        validFrom: fromIsoDate(input.validFrom),
        validTo: fromIsoDate(input.validTo),
        activeWeekdays: src.activeWeekdays,
      } as Prisma.TemplateUncheckedCreateInput,
    });
    await writeBlocks(tx, newId, blocks);
  });
  return getTemplateFull(newId);
}

/** What stops a layout from being saved as `input` (nothing is written): the save's own checks. */
export async function templateProblems(id: string, input: TemplateDraft) {
  return checkTemplate(await loadTemplate(id), input);
}

async function checkTemplate(t: Awaited<ReturnType<typeof loadTemplate>>, input: TemplateDraft) {
  const channel = t.playlist.channel;
  const hasAds = channel.playlists.some((p) => p.kind === 'ads');
  const typeIds = [...new Set(input.blocks.flatMap((b) => [b.blockTypeId, ...b.breaks]))];
  const types = await db.blockType.findMany({ where: { id: { in: typeIds } }, include: { playlist: true } });
  const blockTypes = new Map<string, BlockTypeInfo>(
    types.map((x) => [
      x.id,
      {
        id: x.id,
        name: x.name,
        groupId: x.groupId,
        color: x.color,
        lengthFrames: x.lengthFrames,
        validWeekdays: x.validWeekdays,
        validFrom: toIsoDate(x.validFrom),
        validTo: toIsoDate(x.validTo),
        playlistId: x.playlistId,
      },
    ]),
  );
  const breakTypeIds = new Set(types.filter((x) => x.playlist.kind === 'ads').map((x) => x.id));
  return validateTemplate(input, {
    channel: { frameRate: channel.frameRate, dayStartFrames: channel.dayStartFrames, weekStart: channel.weekStart },
    blockTypes,
    allowsBreaks: t.playlist.kind === 'main' && hasAds,
    breakTypeIds,
  });
}

export async function saveTemplate(id: string, input: TemplateDraft & { version: number }) {
  const t = await loadTemplate(id);
  const problems = await checkTemplate(t, input);
  if (problems.length) {
    throw new HttpError(422, problems.length === 1 ? problems[0].message : `${problems.length} problems: nothing was saved.`, problems);
  }
  await db.$transaction(async (tx) => {
    const updated = await tx.template.updateMany({
      where: { id, version: input.version, deletedAt: null },
      data: {
        name: input.name.trim(),
        validFrom: fromIsoDate(input.validFrom),
        validTo: fromIsoDate(input.validTo),
        activeWeekdays: input.activeWeekdays,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new HttpError(409, 'Someone else saved this layout since you opened it. Reload it to see their changes.');
    }
    await writeBlocks(tx, id, input.blocks);
  });
  return getTemplateFull(id);
}

export async function deleteTemplate(id: string) {
  await loadTemplate(id);
  await db.template.update({ where: { id }, data: { deletedAt: new Date() } });
}
