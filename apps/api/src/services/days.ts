// One day playlist (data model §6): read a day with every block and row at the time it really
// starts, save its rows whole (changed by hand in the browser), publish and unpublish it, and fill it
// from what exists (part 3): program placements of confirmed orders, the ads playlist's spots under
// their linked breaks, rotation lists in the free time of a block. The rules are in @9eye/core.

import {
  CONTENT_KINDS,
  PROGRAMME_MODES,
  addDays,
  airingProductions,
  dayState,
  fillBreaks,
  fillCommercials,
  fillRotation,
  frameRate,
  isIsoDate,
  layoutDay,
  placePrograms,
  publishRefusal,
  uuidv7,
  validateDay,
  weekNumber,
  weekStartOn,
  type AdsBreak,
  type BookedSpot,
  type DayDraft,
  type DayState,
  type DraftRow,
  type ExpectedPlacement,
  type FillMode,
  type FillProduction,
  type FillReport,
  type FillSegment,
  type FillStep,
  type OrderMode,
  type PlaylistKindName,
  type RotationList,
  type RotationProduction,
  type WindowRange,
} from '@9eye/core';
import { Prisma } from '@prisma/client';
import { db, fromIsoDate, toIsoDate } from '../db';
import { HttpError, notFound } from '../errors';
import { channelDto, type ChannelDto } from './dto';

export interface DayEventDto {
  id: string;
  sequence: number;
  kind: string;
  /** A linked-break row: the break's name. A gap compensator: empty. */
  title: string;
  /** Offset from the broadcast-day start. */
  startFrames: number;
  /** A linked-break row: the total of its spots. */
  lengthFrames: number;
  tcInFrames: number;
  tcOutFrames: number;
  /** A data colour: the break's (linked-break rows) or the content type's. */
  color: string | null;
  contentType: string | null;
  episode: number | null;
  /** The break this row belongs to: its own (linked-break row) or the one it was copied in under. */
  breakName: string | null;
  /** A spot under a linked break. */
  inBreak: boolean;
  /** null = the row has no media (notes, breaks) or its state is unknown. */
  media: 'ready' | 'not-ready' | null;
  note: string;
  fixed: boolean;
  hold: boolean;
  autoAdjust: boolean;
  productionId: string | null;
  segmentId: string | null;
  breakTypeId: string | null;
  /** A spot: the linked-break row it sits under. */
  relatedEventId: string | null;
  orderId: string | null;
  rotationListId: string | null;
  /** Ads playlist: the booked spot this row airs. */
  airingItemId: string | null;
}

export interface DayBlockDto {
  id: string;
  blockTypeId: string;
  name: string;
  color: string;
  plannedStartFrames: number;
  plannedLengthFrames: number;
  realStartFrames: number;
  realLengthFrames: number;
  /** Real − planned: negative = gap, positive = over. */
  gapFrames: number;
  note: string;
  /** Its free time is filled from a rotation list (the template block's setting). */
  fillGaps: boolean;
  opensWithBreak: boolean;
  rotationListId: string | null;
  rotationListName: string | null;
  events: DayEventDto[];
}

/** What the steps of a day read: the airings it should play and the ads playlist's breaks. */
export interface DayChecksDto {
  placements: ExpectedPlacement[];
  /** null = the ads playlist has no day here (or the channel has no ads playlist). */
  adsBreaks: AdsBreak[] | null;
  /** The channel's default rotation list (named in its settings), when it exists. */
  defaultListId: string | null;
  /** Ads playlist: the booked spots of the day's confirmed commercial orders (null on main). */
  booked: { id: string; passes: number; orderId: string; orderName: string; productionId: string; title: string; breakName: string; positionName: string }[] | null;
}

export interface DayDto {
  channel: ChannelDto;
  kind: PlaylistKindName;
  date: string;
  /** First day of the channel week the date is in. */
  weekFirstDate: string;
  week: { id: string; name: string; number: number; templateName: string } | null;
  /** Why there is no day playlist: the week was not created, or this weekday is off in it. */
  missing: 'no-week' | 'not-active' | null;
  day: {
    id: string;
    state: DayState;
    version: number;
    totalFrames: number;
    /** Rows whose media is not ready. */
    notReady: number;
    blocks: DayBlockDto[];
    checks: DayChecksDto;
  } | null;
  /** State of the days around the date (the date picker's marks). */
  marks: { date: string; state: DayState }[];
}

const MARK_DAYS = 45;
const FAMILY_KIND: Record<string, string> = { program: 'program', advert: 'commercial', filling: 'filler' };
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

type StoredRow = DraftRow & { sequence?: number };
interface RowsBlock {
  id: string;
  startFrames: number;
  lengthFrames: number;
  rows: StoredRow[];
}

/** Rows as the table shows them: start times, a break's filled length, colours, media state. */
async function describe(blocks: RowsBlock[]) {
  const rows = blocks.flatMap((b) => b.rows);
  const productionIds = [...new Set(rows.flatMap((r) => (r.productionId ? [r.productionId] : [])))];
  const breakTypeIds = [...new Set(rows.flatMap((r) => (r.kind === 'linked-break' && r.breakTypeId ? [r.breakTypeId] : [])))];
  const [productions, breakTypes] = await Promise.all([
    productionIds.length
      ? db.production.findMany({ where: { id: { in: productionIds } }, select: { id: true, chapter: true, mediaStatus: true, content: { select: { contentType: { select: { name: true, color: true } } } } } })
      : [],
    breakTypeIds.length ? db.blockType.findMany({ where: { id: { in: breakTypeIds } }, select: { id: true, name: true, color: true } }) : [],
  ]);
  const prod = new Map(productions.map((p) => [p.id, p]));
  const types = new Map(breakTypes.map((t) => [t.id, t]));
  const layout = layoutDay(blocks.map((b) => ({ id: b.id, startFrames: b.startFrames, lengthFrames: b.lengthFrames, events: b.rows.map((r, sequence) => ({ ...r, sequence })) })));
  const breakName = (r: DraftRow) => (r.breakTypeId ? (types.get(r.breakTypeId)?.name ?? null) : null) ?? (r.title || null);
  const breakNames = new Map(rows.filter((r) => r.kind === 'linked-break').map((r) => [r.id, breakName(r)] as const));
  let notReady = 0;
  const events = new Map(
    layout.blocks.map((lb) => [
      lb.id,
      lb.events.map((e): DayEventDto => {
        const isBreak = e.kind === 'linked-break';
        const p = e.productionId ? prod.get(e.productionId) : undefined;
        const media = p?.mediaStatus === 'ready' ? 'ready' : p?.mediaStatus === 'not-ready' ? 'not-ready' : null;
        if (media === 'not-ready') notReady++;
        const under = e.relatedEventId ? (breakNames.get(e.relatedEventId) ?? null) : null;
        const type = e.breakTypeId ? types.get(e.breakTypeId) : undefined;
        return {
          id: e.id,
          sequence: e.sequence,
          kind: e.kind,
          title: isBreak ? (breakName(e) ?? '') : e.title,
          startFrames: e.startFrames,
          lengthFrames: e.shownFrames,
          tcInFrames: e.tcInFrames,
          tcOutFrames: e.tcOutFrames,
          color: isBreak ? (type?.color ?? null) : (p?.content.contentType.color ?? null),
          contentType: p?.content.contentType.name ?? null,
          episode: p?.chapter ?? null,
          breakName: isBreak ? (type?.name ?? null) : under,
          inBreak: !isBreak && !!under,
          media,
          note: e.note,
          fixed: e.fixed,
          hold: e.hold,
          autoAdjust: e.autoAdjust,
          productionId: e.productionId,
          segmentId: e.segmentId,
          breakTypeId: e.breakTypeId,
          relatedEventId: e.relatedEventId,
          orderId: e.orderId,
          rotationListId: e.rotationListId,
          airingItemId: e.airingItemId,
        };
      }),
    ]),
  );
  return { layout, events, notReady };
}

const dbRow = (e: Prisma.PlaylistEventGetPayload<object>): StoredRow => ({
  id: e.id,
  sequence: e.sequence,
  kind: e.kind,
  title: e.title,
  lengthFrames: e.lengthFrames,
  productionId: e.productionId,
  segmentId: e.segmentId,
  tcInFrames: e.tcInFrames,
  tcOutFrames: e.tcOutFrames,
  fixed: e.fixed,
  hold: e.hold,
  autoAdjust: e.autoAdjust,
  note: e.note,
  breakTypeId: e.breakTypeId,
  relatedEventId: e.relatedEventId,
  orderId: e.orderId,
  rotationListId: e.rotationListId,
  airingItemId: e.airingItemId,
});

const DAY_INCLUDE = {
  playlist: { include: { channel: { include: { playlists: true } } } },
  blocks: { orderBy: { startFrames: 'asc' }, include: { blockType: { select: { name: true, color: true } }, events: { orderBy: { sequence: 'asc' } } } },
} satisfies Prisma.DayPlaylistInclude;
type DayRow = Prisma.DayPlaylistGetPayload<{ include: typeof DAY_INCLUDE }>;

// ---------------------------------------------------------------- what a day is filled from

/** The booked spots of the day's confirmed commercial orders on a channel (what its ads playlist airs). */
async function bookedSpotsOf(channelId: string, date: string) {
  return db.airingItem.findMany({
    where: { breakTypeId: { not: null }, airing: { channelId, date: fromIsoDate(date), order: { deletedAt: null, mode: 'commercials', status: 'confirmed' } } },
    include: {
      airing: { select: { order: { select: { id: true, name: true } } } },
      breakType: { select: { name: true } },
      breakPosition: { select: { name: true, sortOrder: true } },
      orderItem: { select: { productionId: true, production: { select: { title: true } } } },
    },
    orderBy: [{ airing: { blockTypeId: 'asc' } }, { position: 'asc' }],
  });
}

/** The airings of confirmed programme orders on this channel and day, in block order. */
async function expectedPlacements(channelId: string, date: string, blocks: { id: string; blockTypeId: string; blockName: string }[]) {
  const items = { orderBy: { position: 'asc' }, select: { orderItem: { select: { productionId: true, production: { select: { title: true } } } } } } as const;
  const airings = await db.airing.findMany({
    // commercial orders book spots into ad breaks; they never place programmes
    where: { channelId, date: fromIsoDate(date), order: { deletedAt: null, mode: { not: 'commercials' } } },
    select: {
      id: true,
      passes: true,
      repeatIndex: true,
      blockTypeId: true,
      order: { select: { id: true, name: true, mode: true, status: true } },
      blockType: { select: { name: true } },
      items,
      repeatOf: { select: { items } },
    },
  });
  const order = new Map(blocks.map((b, i) => [b.blockTypeId, i]));
  const placements: ExpectedPlacement[] = [];
  let drafts = 0;
  let others = 0;
  for (const a of airings) {
    const programmes = PROGRAMME_MODES.includes(a.order.mode as OrderMode);
    if (a.order.status !== 'confirmed') {
      if (programmes) drafts++;
      continue;
    }
    if (!programmes) {
      others++;
      continue;
    }
    const own = a.items.map((i) => i.orderItem);
    const first = a.repeatOf?.items.map((i) => i.orderItem) ?? null;
    const list = first ?? own;
    const productionIds = airingProductions(a.order.mode, { passes: a.passes, productionIds: own.map((i) => i.productionId) }, first ? { productionIds: first.map((i) => i.productionId), repeatIndex: a.repeatIndex } : null);
    const title = new Map(list.map((i) => [i.productionId, i.production.title]));
    const block = blocks.find((b) => b.blockTypeId === a.blockTypeId);
    placements.push({
      airingId: a.id,
      orderId: a.order.id,
      orderName: a.order.name,
      blockId: block?.id ?? null,
      blockName: block?.blockName ?? a.blockType.name,
      repeat: !!first,
      productionIds,
      titles: productionIds.map((p) => title.get(p) ?? ''),
    });
  }
  const rank = (p: ExpectedPlacement) => (p.blockId ? (order.get(blocks.find((b) => b.id === p.blockId)!.blockTypeId) ?? 0) : blocks.length);
  placements.sort((x, y) => rank(x) - rank(y) || x.orderName.localeCompare(y.orderName) || x.airingId.localeCompare(y.airingId));
  const notes: string[] = [];
  if (drafts) notes.push(`${n(drafts, 'airing')} of draft plans ${drafts === 1 ? 'was' : 'were'} left out: only confirmed plans reach the playlist.`);
  if (others) notes.push(`${n(others, 'airing')} of trailer, sting or graphics plans ${others === 1 ? 'is' : 'are'} not placed by this step (not built yet).`);
  return { placements, notes };
}

/** The breaks of the channel's ads playlist on this day, with their spots; null = no ads day. */
async function adsBreaksOf(playlists: { id: string; kind: string }[], date: string): Promise<AdsBreak[] | null> {
  const ads = playlists.find((p) => p.kind === 'ads');
  if (!ads) return null;
  const day = await db.dayPlaylist.findFirst({
    where: { playlistId: ads.id, date: fromIsoDate(date) },
    select: { blocks: { orderBy: { startFrames: 'asc' }, select: { blockTypeId: true, blockType: { select: { name: true } }, events: { orderBy: { sequence: 'asc' } } } } },
  });
  if (!day) return null;
  return day.blocks.map((b) => ({
    blockTypeId: b.blockTypeId,
    name: b.blockType.name,
    spots: b.events
      .filter((e) => (CONTENT_KINDS as readonly string[]).includes(e.kind))
      .map((e) => ({ kind: e.kind, title: e.title, lengthFrames: e.lengthFrames, productionId: e.productionId, segmentId: e.segmentId, tcInFrames: e.tcInFrames, tcOutFrames: e.tcOutFrames })),
  }));
}

function segmentOf(s: { id: string; tcInFrames: number | null; tcOutFrames: number | null; lengthFrames: number | null }): FillSegment | null {
  const tcIn = s.tcInFrames ?? 0;
  const length = s.tcOutFrames !== null && s.tcOutFrames > tcIn ? s.tcOutFrames - tcIn : (s.lengthFrames ?? 0);
  return length > 0 ? { id: s.id, tcInFrames: tcIn, tcOutFrames: tcIn + length, lengthFrames: length } : null;
}

const SEGMENTATIONS = {
  where: { deletedAt: null },
  orderBy: { code: 'asc' },
  select: { id: true, segments: { where: { deletedAt: null }, orderBy: { code: 'asc' }, select: { id: true, tcInFrames: true, tcOutFrames: true, lengthFrames: true } } },
} as const;

/** The segments a production plays: those of one segmentation (its first by default), else the whole production. */
function segmentsOf(p: { lengthFrames: number | null; segmentations: { id: string; segments: Parameters<typeof segmentOf>[0][] }[] }, segmentationId: string | null = null): FillSegment[] {
  const segm = segmentationId ? p.segmentations.find((s) => s.id === segmentationId) : p.segmentations[0];
  if (segm?.segments.length) return segm.segments.flatMap((s) => segmentOf(s) ?? []);
  return p.lengthFrames && p.lengthFrames > 0 ? [{ id: null, tcInFrames: 0, tcOutFrames: p.lengthFrames, lengthFrames: p.lengthFrames }] : [];
}

async function fillProductions(ids: string[]): Promise<Map<string, FillProduction>> {
  if (!ids.length) return new Map();
  const rows = await db.production.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, title: true, lengthFrames: true, content: { select: { contentType: { select: { family: true } } } }, segmentations: SEGMENTATIONS },
  });
  return new Map(rows.map((p) => [p.id, { id: p.id, title: p.title, kind: FAMILY_KIND[p.content.contentType.family] ?? 'program', segments: segmentsOf(p) }]));
}

/** Rotation lists with their items' segments, and what the five gates read of each production. */
async function rotationInputs(listIds: string[], channelId: string) {
  const rows = listIds.length ? await db.rotationList.findMany({ where: { id: { in: listIds }, deletedAt: null }, include: { items: { orderBy: { position: 'asc' } } } }) : [];
  const productionIds = [...new Set(rows.flatMap((l) => l.items.map((i) => i.productionId)))];
  const prods = productionIds.length
    ? await db.production.findMany({
        where: { id: { in: productionIds }, deletedAt: null },
        select: {
          id: true, title: true, lengthFrames: true, starts: true, expires: true, channelIds: true, contentId: true,
          content: { select: { contentTypeId: true, contentType: { select: { family: true } } } },
          segmentations: SEGMENTATIONS,
        },
      })
    : [];
  // time windows: the production's own relations and those it inherits from its content and content type
  const owners = [...new Set(prods.flatMap((p) => [p.id, p.contentId, p.content.contentTypeId]))];
  const rels = owners.length ? await db.catalogRelation.findMany({ where: { kind: 'time-window', itemId: { in: owners }, OR: [{ channelId: null }, { channelId }] } }) : [];
  const windowIds = [...new Set(rels.map((r) => (r.params as { timeWindowId?: string }).timeWindowId).filter((x): x is string => !!x))];
  const windows = windowIds.length ? await db.timeWindow.findMany({ where: { id: { in: windowIds } }, select: { id: true } }) : [];
  const ranges = windows.length ? await db.timeWindowRange.findMany({ where: { timeWindowId: { in: windows.map((w) => w.id) }, OR: [{ channelId: null }, { channelId }] } }) : [];
  const rangesOf = (id: string): WindowRange[] => ranges.filter((r) => r.timeWindowId === id).map((r) => ({ weekday: r.weekday, startFrames: r.startFrames, lengthFrames: r.lengthFrames }));

  const productions = new Map<string, RotationProduction>();
  const byId = new Map(prods.map((p) => [p.id, p]));
  for (const p of prods) {
    const own = rels.filter((r) => [p.id, p.contentId, p.content.contentTypeId].includes(r.itemId));
    const pick = (rule: string) => own.filter((r) => (r.params as { rule?: string }).rule === rule).flatMap((r) => rangesOf((r.params as { timeWindowId: string }).timeWindowId));
    productions.set(p.id, {
      id: p.id,
      title: p.title,
      kind: FAMILY_KIND[p.content.contentType.family] ?? 'filler',
      starts: p.starts ? toIsoDate(p.starts) : null,
      expires: p.expires ? toIsoDate(p.expires) : null,
      channelIds: p.channelIds,
      windows: { allowed: pick('allowed'), rejected: pick('rejected') },
    });
  }
  const lists = new Map<string, RotationList>(
    rows.map((l) => [
      l.id,
      {
        id: l.id,
        name: l.name,
        lastItemPosition: l.lastItemPosition,
        insertionDaysInterval: l.insertionDaysInterval,
        allowSameDayRepeat: l.allowSameDayRepeat,
        randomInsert: l.randomInsert,
        applyChannelRestrictions: l.applyChannelRestrictions,
        items: l.items.flatMap((i) => {
          const p = byId.get(i.productionId);
          return p ? [{ position: i.position, productionId: i.productionId, segments: segmentsOf(p, i.segmentationId), insertedAt: i.insertedAt ? toIsoDate(i.insertedAt) : null }] : [];
        }),
      },
    ]),
  );
  return { lists, productions };
}

// ---------------------------------------------------------------- read

export async function getDay(channelId: string, kind: PlaylistKindName, date: string): Promise<DayDto> {
  if (!isIsoDate(date)) throw new HttpError(400, 'The date is not valid (YYYY-MM-DD).');
  const channel = await db.channel.findFirst({ where: { id: channelId, deletedAt: null }, include: { playlists: true } });
  if (!channel) throw notFound('Channel');
  const playlist = channel.playlists.find((p) => p.kind === kind);
  if (!playlist) throw new HttpError(404, `This channel has no ${kind} playlist.`);
  const weekFirstDate = weekStartOn(date, channel.weekStart);

  const [row, week, around] = await Promise.all([
    db.dayPlaylist.findFirst({ where: { playlistId: playlist.id, date: fromIsoDate(date) }, include: DAY_INCLUDE }),
    db.week.findFirst({ where: { playlistId: playlist.id, firstDate: fromIsoDate(weekFirstDate) }, include: { template: { select: { name: true } } } }),
    db.dayPlaylist.findMany({
      where: { playlistId: playlist.id, date: { gte: fromIsoDate(addDays(date, -MARK_DAYS)), lte: fromIsoDate(addDays(date, MARK_DAYS)) } },
      select: { date: true, published: true, reconciled: true },
      orderBy: { date: 'asc' },
    }),
  ]);

  const out: DayDto = {
    channel: channelDto(channel),
    kind,
    date,
    weekFirstDate,
    week: week ? { id: week.id, name: week.name, number: weekNumber(weekFirstDate), templateName: week.template.name } : null,
    missing: row ? null : week ? 'not-active' : 'no-week',
    day: null,
    marks: around.map((d) => ({ date: toIsoDate(d.date), state: dayState(d) })),
  };
  if (!row) return out;
  out.day = await dayBody(row, date);
  return out;
}

async function dayBody(row: DayRow, date: string): Promise<NonNullable<DayDto['day']>> {
  const channel = row.playlist.channel;
  const isMain = row.playlist.kind === 'main';
  const listIds = [...new Set(row.blocks.flatMap((b) => (b.rotationListId ? [b.rotationListId] : [])))];
  const blockNames = row.blocks.map((b) => ({ id: b.id, blockTypeId: b.blockTypeId, blockName: b.blockType.name }));
  const [described, lists, expected, adsBreaks, defaultList, booked] = await Promise.all([
    describe(row.blocks.map((b) => ({ id: b.id, startFrames: b.startFrames, lengthFrames: b.lengthFrames, rows: b.events.map(dbRow) }))),
    listIds.length ? db.rotationList.findMany({ where: { id: { in: listIds } }, select: { id: true, name: true } }) : [],
    isMain ? expectedPlacements(channel.id, date, blockNames) : { placements: [], notes: [] },
    isMain ? adsBreaksOf(channel.playlists, date) : null,
    channel.defaultRotationListName ? db.rotationList.findFirst({ where: { name: channel.defaultRotationListName, deletedAt: null }, select: { id: true } }) : null,
    isMain ? null : bookedSpotsOf(channel.id, date),
  ]);
  const listName = new Map(lists.map((l) => [l.id, l.name]));
  const blocks = described.layout.blocks.map((lb): DayBlockDto => {
    const b = row.blocks.find((x) => x.id === lb.id)!;
    return {
      id: b.id,
      blockTypeId: b.blockTypeId,
      name: b.blockType.name,
      color: b.blockType.color,
      plannedStartFrames: lb.plannedStartFrames,
      plannedLengthFrames: lb.plannedLengthFrames,
      realStartFrames: lb.realStartFrames,
      realLengthFrames: lb.realLengthFrames,
      gapFrames: lb.gapFrames,
      note: b.note,
      fillGaps: b.fillGaps,
      opensWithBreak: b.opensWithBreak,
      rotationListId: b.rotationListId,
      rotationListName: b.rotationListId ? (listName.get(b.rotationListId) ?? null) : null,
      events: described.events.get(b.id) ?? [],
    };
  });
  return {
    id: row.id,
    state: dayState(row),
    version: row.version,
    totalFrames: described.layout.totalFrames,
    notReady: described.notReady,
    blocks,
    checks: { placements: expected.placements, adsBreaks, defaultListId: defaultList?.id ?? null, booked: booked
        ? booked.map((b) => ({
            id: b.id, passes: b.passes, orderId: b.airing.order.id, orderName: b.airing.order.name, productionId: b.orderItem.productionId, title: b.orderItem.production.title,
            breakName: b.breakType?.name ?? '', positionName: b.breakPosition?.name ?? '',
          }))
        : null,
    },
  };
}

export interface CatalogRowDto {
  productionId: string;
  title: string;
  /** The row kind its content type's family gives: program, commercial or filler. */
  kind: string;
  lengthFrames: number | null;
  media: 'ready' | 'not-ready' | null;
  contentType: string;
  color: string | null;
  episode: number | null;
}

/** What a catalog item looks like as a playlist row (before it is saved in a day). */
export async function catalogRows(productionIds: string[]): Promise<CatalogRowDto[]> {
  const rows = await db.production.findMany({
    where: { id: { in: productionIds }, deletedAt: null },
    select: { id: true, title: true, chapter: true, lengthFrames: true, mediaStatus: true, content: { select: { contentType: { select: { name: true, family: true, color: true } } } } },
  });
  const byId = new Map(rows.map((p) => [p.id, p]));
  return productionIds.flatMap((id) => {
    const p = byId.get(id);
    if (!p) return [];
    const type = p.content.contentType;
    return [{
      productionId: p.id,
      title: p.title,
      kind: FAMILY_KIND[type.family] ?? 'program',
      lengthFrames: p.lengthFrames,
      media: p.mediaStatus === 'ready' ? ('ready' as const) : p.mediaStatus === 'not-ready' ? ('not-ready' as const) : null,
      contentType: type.name,
      color: type.color,
      episode: p.chapter,
    }];
  });
}

// ---------------------------------------------------------------- fill (run a step on the draft)

/** The rotation lists of the company, by name. */
export async function rotationLists(): Promise<{ id: string; name: string; items: number }[]> {
  const rows = await db.rotationList.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, _count: { select: { items: true } } } });
  return rows.map((l) => ({ id: l.id, name: l.name, items: l._count.items }));
}

export interface RunBody {
  step: FillStep;
  mode: FillMode;
  version: number;
  /** Rotation lists: one list for every block instead of each block's own. */
  listId?: string | null;
  /** Rotation lists: only these blocks (a gap row's "Fill gaps automatically"). */
  blockIds?: string[] | null;
  blocks: { id: string; rows: DraftRow[] }[];
}

export interface RunDto {
  blocks: { id: string; events: DayEventDto[] }[];
  report: FillReport;
}

async function openDay(dayId: string) {
  const day = await db.dayPlaylist.findFirst({ where: { id: dayId }, include: DAY_INCLUDE });
  if (!day) throw notFound('Day');
  if (day.reconciled) throw new HttpError(409, 'This day is reconciled: it cannot be changed.');
  if (day.published) throw new HttpError(409, 'This day is approved: reopen it to change it.');
  return day;
}

function checkDraft(day: DayRow, draft: DayDraft) {
  const problems = validateDay(draft, {
    blockIds: day.blocks.map((b) => b.id),
    allowsBreaks: day.playlist.kind === 'main' && day.playlist.channel.playlists.some((p) => p.kind === 'ads'),
  });
  if (problems.length) throw new HttpError(422, problems.length === 1 ? problems[0].message : `${problems.length} problems in the day: fix them first.`, problems);
}

/**
 * Runs one step of filling a day on the draft the person is working on, and gives back the draft
 * with what it placed (nothing is saved: the person looks, then saves).
 */
export async function runStep(dayId: string, input: RunBody): Promise<RunDto> {
  const day = await openDay(dayId);
  if (input.version !== day.version) throw new HttpError(409, 'Someone else changed this day since you opened it. Reload it to see their changes.');
  const channel = day.playlist.channel;
  const isMain = day.playlist.kind === 'main';
  const date = toIsoDate(day.date);
  const draft: DayDraft = { blocks: input.blocks };
  checkDraft(day, draft);
  const info = day.blocks.map((b) => ({ id: b.id, name: b.blockType.name, opensWithBreak: b.opensWithBreak }));

  let result: { draft: DayDraft; report: FillReport };
  if (input.step === 'programs') {
    if (!isMain) throw new HttpError(400, 'Program placements go into the main playlist.');
    const { placements, notes } = await expectedPlacements(channel.id, date, day.blocks.map((b) => ({ id: b.id, blockTypeId: b.blockTypeId, blockName: b.blockType.name })));
    const productions = await fillProductions([...new Set(placements.flatMap((p) => p.productionIds))]);
    result = placePrograms(draft, info, placements, productions, input.mode, uuidv7);
    result.report.notes.push(...notes);
    if (!placements.length) result.report.notes.unshift('No confirmed programme plans air on this day.');
  } else if (input.step === 'commercials') {
    if (isMain) throw new HttpError(400, 'Ads go into the ads playlist.');
    const items = await bookedSpotsOf(channel.id, date);
    const productions = await fillProductions([...new Set(items.map((i) => i.orderItem.productionId))]);
    const positions = await db.breakPosition.findMany({ orderBy: { sortOrder: 'asc' } });
    const def = positions.find((x) => x.isDefault) ?? null;
    const spots: BookedSpot[] = items.map((i) => ({
      id: i.id,
      orderId: i.airing.order.id,
      orderName: i.airing.order.name,
      breakTypeId: i.breakTypeId!,
      breakName: i.breakType?.name ?? 'Its break',
      production: productions.get(i.orderItem.productionId) ?? { id: i.orderItem.productionId, title: 'A spot', kind: 'commercial', segments: [] },
      positionOrder: i.breakPosition?.sortOrder ?? def?.sortOrder ?? 0,
      positionName: i.breakPosition?.name ?? def?.name ?? 'No position',
      passes: i.passes,
    }));
    // booked spots already in the day that are not this day's any more keep their own position
    const others = [...new Set(draft.blocks.flatMap((b) => b.rows.flatMap((r) => (r.airingItemId && !spots.some((x) => x.id === r.airingItemId) ? [r.airingItemId] : []))))];
    const theirs = others.length ? await db.airingItem.findMany({ where: { id: { in: others } }, select: { id: true, breakPosition: { select: { sortOrder: true } } } }) : [];
    const orderOfSpot = new Map(theirs.map((x) => [x.id, x.breakPosition?.sortOrder ?? def?.sortOrder ?? 0]));
    const blocks = day.blocks.map((b) => ({ id: b.id, name: b.blockType.name, blockTypeId: b.blockTypeId, lengthFrames: b.lengthFrames }));
    result = fillCommercials(draft, blocks, spots, { orderOfSpot, defaultOrder: def?.sortOrder ?? 0 }, input.mode, uuidv7);
    if (!spots.length) result.report.notes.unshift('No confirmed campaigns book this day.');
    const drafts = await db.airingItem.count({ where: { breakTypeId: { not: null }, airing: { channelId: channel.id, date: day.date, order: { deletedAt: null, mode: 'commercials', status: { not: 'confirmed' } } } } });
    if (drafts) result.report.notes.push(`${n(drafts, 'booked spot')} of draft campaigns ${drafts === 1 ? 'was' : 'were'} left out.`);
  } else if (input.step === 'breaks') {
    if (!isMain || !channel.playlists.some((p) => p.kind === 'ads')) throw new HttpError(400, 'Break events go into the main playlist of a channel with an ads playlist.');
    const ads = await adsBreaksOf(channel.playlists, date);
    const typeIds = [...new Set(draft.blocks.flatMap((b) => b.rows.flatMap((r) => (r.kind === 'linked-break' && r.breakTypeId ? [r.breakTypeId] : []))))];
    const names = typeIds.length ? await db.blockType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true } }) : [];
    result = fillBreaks(draft, info, ads, new Map(names.map((t) => [t.id, t.name])), input.mode, uuidv7);
  } else {
    const wanted = input.blockIds?.length ? new Set(input.blockIds) : null;
    // the list asked for, else each block's own list, else the channel's default list
    const fallback = !input.listId && channel.defaultRotationListName ? await db.rotationList.findFirst({ where: { name: channel.defaultRotationListName, deletedAt: null }, select: { id: true } }) : null;
    const blocks = day.blocks
      .filter((b) => (wanted ? wanted.has(b.id) : b.fillGaps))
      .map((b) => ({ id: b.id, name: b.blockType.name, listId: input.listId ?? b.rotationListId ?? fallback?.id ?? null, plannedStartFrames: b.startFrames, plannedLengthFrames: b.lengthFrames }));
    const { lists, productions } = await rotationInputs([...new Set(blocks.flatMap((b) => (b.listId ? [b.listId] : [])))], channel.id);
    if (input.listId && !lists.has(input.listId)) throw notFound('Rotation list');
    const rate = frameRate(channel.frameRate);
    result = fillRotation(draft, blocks, lists, productions, { date, channelId: channel.id, dayStartFrames: channel.dayStartFrames, rate }, input.mode, uuidv7);
    if (!blocks.length) result.report.notes.push('No block of this day fills its gaps from a rotation list.');
  }

  const described = await describe(day.blocks.map((b) => ({ id: b.id, startFrames: b.startFrames, lengthFrames: b.lengthFrames, rows: result.draft.blocks.find((x) => x.id === b.id)?.rows ?? [] })));
  return { blocks: day.blocks.map((b) => ({ id: b.id, events: described.events.get(b.id) ?? [] })), report: result.report };
}

// ---------------------------------------------------------------- save

export interface SaveDayBody {
  version: number;
  blocks: { id: string; rows: DraftRow[] }[];
}

/**
 * Saves a day's rows whole (all-or-nothing): the rules of `validateDay`, catalog items, segments,
 * orders, rotation lists and breaks that exist, and the version the person opened. A published or
 * reconciled day is not changed. Rows a rotation list put in move that list on (its last item and
 * the day its items were last used).
 */
export async function saveDay(dayId: string, input: SaveDayBody): Promise<DayDto> {
  const day = await openDay(dayId);
  const kind = day.playlist.kind as PlaylistKindName;
  const channel = day.playlist.channel;
  const date = toIsoDate(day.date);
  const draft: DayDraft = { blocks: input.blocks };
  const problems: { code: string; message: string; rowId?: string; blockId?: string }[] = validateDay(draft, {
    blockIds: day.blocks.map((b) => b.id),
    allowsBreaks: kind === 'main' && channel.playlists.some((p) => p.kind === 'ads'),
  });

  const rows = input.blocks.flatMap((b) => b.rows.map((r) => ({ ...r, blockId: b.id })));
  const before = new Map(day.blocks.flatMap((b) => b.events.map((e) => [e.id, e] as const)));
  const ids = <K extends 'productionId' | 'breakTypeId' | 'segmentId' | 'orderId' | 'rotationListId'>(k: K) => [...new Set(rows.flatMap((r) => (r[k] ? [r[k] as string] : [])))];
  const changed = (r: DraftRow, k: 'segmentId' | 'orderId') => r[k] && before.get(r.id)?.[k] !== r[k];
  const segmentIds = [...new Set(rows.filter((r) => changed(r, 'segmentId')).map((r) => r.segmentId!))];
  const orderIds = [...new Set(rows.filter((r) => changed(r, 'orderId')).map((r) => r.orderId!))];
  const listIds = ids('rotationListId');
  const spotIds = [...new Set(rows.flatMap((r) => (r.airingItemId ? [r.airingItemId] : [])))];
  const bookedHere = new Set(
    spotIds.length ? (await db.airingItem.findMany({ where: { id: { in: spotIds }, airing: { channelId: channel.id, date: day.date } }, select: { id: true } })).map((x) => x.id) : [],
  );
  const [productions, breakTypes, segments, airings, lists] = await Promise.all([
    ids('productionId').length ? db.production.findMany({ where: { id: { in: ids('productionId') }, deletedAt: null }, select: { id: true, title: true } }) : [],
    ids('breakTypeId').length ? db.blockType.findMany({ where: { id: { in: ids('breakTypeId') }, deletedAt: null, playlist: { kind: 'ads' } }, select: { id: true } }) : [],
    segmentIds.length ? db.segment.findMany({ where: { id: { in: segmentIds }, deletedAt: null }, select: { id: true, segmentation: { select: { productionId: true } } } }) : [],
    orderIds.length ? db.airing.findMany({ where: { orderId: { in: orderIds }, channelId: channel.id, date: day.date }, select: { orderId: true } }) : [],
    listIds.length ? db.rotationList.findMany({ where: { id: { in: listIds }, deletedAt: null }, include: { items: { orderBy: { position: 'asc' } } } }) : [],
  ]);
  const titles = new Map(productions.map((p) => [p.id, p.title]));
  const breaks = new Set(breakTypes.map((b) => b.id));
  const segmentOwner = new Map(segments.map((s) => [s.id, s.segmentation.productionId]));
  const orders = new Set(airings.map((a) => a.orderId));
  const listById = new Map(lists.map((l) => [l.id, l]));
  for (const r of rows) {
    const at = { rowId: r.id, blockId: r.blockId };
    const name = r.title || 'A row';
    if (r.productionId && !titles.has(r.productionId)) problems.push({ code: 'production', message: `"${name}": its catalog item does not exist.`, ...at });
    if (r.kind === 'linked-break' && r.breakTypeId && !breaks.has(r.breakTypeId)) problems.push({ code: 'break', message: 'A linked break names a break that is not a block of an ads playlist.', ...at });
    if (changed(r, 'segmentId') && (!r.productionId || segmentOwner.get(r.segmentId!) !== r.productionId)) problems.push({ code: 'segment', message: `"${name}": its part is not a part of its catalog item.`, ...at });
    if (changed(r, 'orderId') && !orders.has(r.orderId!)) problems.push({ code: 'order', message: `"${name}": its plan has no airing on this channel and day.`, ...at });
    if (r.rotationListId && !listById.has(r.rotationListId)) problems.push({ code: 'rotation', message: `"${name}": its rotation list does not exist.`, ...at });
    if (r.airingItemId && !bookedHere.has(r.airingItemId)) problems.push({ code: 'booked-spot', message: `"${name}": it is no longer booked on this channel and day. Run Campaigns again.`, ...at });
    if (before.has(r.id) && !day.blocks.some((b) => b.events.some((e) => e.id === r.id))) problems.push({ code: 'row-twice', message: 'A row belongs to another day.', ...at });
  }
  if (problems.length) {
    throw new HttpError(422, problems.length === 1 ? problems[0].message : `${problems.length} problems: nothing was saved.`, problems);
  }

  const data = input.blocks.flatMap((b) =>
    b.rows.map((r, sequence) => {
      const old = before.get(r.id);
      const title =
        r.kind === 'linked-break' || r.kind === 'gap-compensator'
          ? ''
          : r.productionId
            ? old && old.productionId === r.productionId
              ? old.title
              : (titles.get(r.productionId) ?? '')
            : r.title.trim().slice(0, 300);
      return {
        id: r.id,
        blockId: b.id,
        sequence,
        kind: r.kind,
        title,
        lengthFrames: r.lengthFrames,
        productionId: r.productionId,
        segmentId: r.segmentId,
        tcInFrames: r.tcInFrames,
        tcOutFrames: r.tcOutFrames,
        fixed: r.fixed,
        hold: r.hold,
        autoAdjust: r.autoAdjust,
        note: r.note,
        breakTypeId: r.kind === 'linked-break' ? r.breakTypeId : null,
        relatedEventId: r.relatedEventId,
        orderId: r.orderId,
        rotationListId: r.rotationListId,
        airingItemId: r.airingItemId,
      };
    }),
  );
  // a rotation list moves on with the rows it put in that are new in this save (in day order)
  const moved = new Map<string, { last: string; used: Set<string> }>();
  for (const r of rows) {
    if (!r.rotationListId || !r.productionId || before.has(r.id)) continue;
    const m = moved.get(r.rotationListId) ?? { last: r.productionId, used: new Set<string>() };
    m.last = r.productionId;
    m.used.add(r.productionId);
    moved.set(r.rotationListId, m);
  }
  try {
    await db.$transaction(async (tx) => {
      const updated = await tx.dayPlaylist.updateMany({ where: { id: dayId, version: input.version, published: false, reconciled: false }, data: { version: { increment: 1 } } });
      if (updated.count !== 1) throw new HttpError(409, 'Someone else changed this day since you opened it. Reload it to see their changes.');
      await tx.playlistEvent.deleteMany({ where: { blockId: { in: day.blocks.map((b) => b.id) } } });
      if (data.length) await tx.playlistEvent.createMany({ data });
      for (const [listId, m] of moved) {
        const item = listById.get(listId)!.items.find((i) => i.productionId === m.last);
        if (item) await tx.rotationList.update({ where: { id: listId }, data: { lastItemPosition: item.position } });
        await tx.rotationListItem.updateMany({ where: { listId, productionId: { in: [...m.used] } }, data: { insertedAt: fromIsoDate(date) } });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, 'A row of this day already exists elsewhere. Reload the day.');
    }
    throw err;
  }
  return getDay(channel.id, kind, date);
}

/** Publishes or unpublishes a day. A published day is read-only until it is unpublished. */
export async function setPublished(dayId: string, input: { publish: boolean; version: number }): Promise<{ id: string; state: DayState; version: number }> {
  const day = await db.dayPlaylist.findFirst({ where: { id: dayId } });
  if (!day) throw notFound('Day');
  const refusal = publishRefusal(day, input.publish);
  if (refusal) throw new HttpError(409, refusal);
  const updated = await db.dayPlaylist.updateMany({
    where: { id: dayId, version: input.version },
    data: { published: input.publish, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new HttpError(409, 'Someone else changed this day since you opened it. Reload it to see their changes.');
  return { id: dayId, state: input.publish ? 'published' : 'draft', version: input.version + 1 };
}
