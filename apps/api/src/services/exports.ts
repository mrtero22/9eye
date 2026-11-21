// Playout exports of one broadcast day. Built: Playout XML (the file is written by @9eye/core). The file is made from the SAVED main
// playlist of the day: it already holds the ads (break events copied in from the ads playlist).

import { PLAYOUT_XML_LEFT_OUT, exportFileName, frameRate, playoutXmlFile, playoutXmlFirstItemId, playoutXmlPrefix, playoutXmlRootName, type PlayoutXmlItem } from '@9eye/core';
import { currentTenantId, db, fromIsoDate, platformDb } from '../db';
import { HttpError, notFound } from '../errors';

export interface DayExportDto {
  fileName: string;
  content: string;
  /** Items in the file. */
  items: number;
  /** Titles of rows without a playout file (written with an empty file path). */
  noFile: string[];
  /** The day is not published yet. */
  draft: boolean;
}

export async function exportDay(channelId: string, date: string, format: string): Promise<DayExportDto> {
  if (format !== 'playout-xml') throw new HttpError(400, 'Only the Playout XML export is built so far.');
  const channel = await db.channel.findFirst({ where: { id: channelId, deletedAt: null }, include: { playlists: true } });
  if (!channel) throw notFound('Channel');
  const main = channel.playlists.find((p) => p.kind === 'main');
  const day = main
    ? await db.dayPlaylist.findFirst({
        where: { playlistId: main.id, date: fromIsoDate(date) },
        include: { blocks: { orderBy: { startFrames: 'asc' }, include: { events: { orderBy: { sequence: 'asc' } } } } },
      })
    : null;
  if (!day) throw new HttpError(404, 'This day has no main playlist yet: create its week first.');

  const tenant = await platformDb.tenant.findUniqueOrThrow({ where: { id: currentTenantId() } });
  const rows = day.blocks.flatMap((b) => b.events).filter((e) => !PLAYOUT_XML_LEFT_OUT.has(e.kind));
  const ids = [...new Set(rows.flatMap((e) => (e.productionId ? [e.productionId] : [])))];
  const productions = ids.length
    ? await db.production.findMany({ where: { id: { in: ids } }, select: { id: true, additionalData: true, notes: true, customValues: true, content: { select: { contentType: { select: { color: true } } } } } })
    : [];
  const byId = new Map(productions.map((p) => [p.id, p]));

  // TC in / out are in the catalog's frame rate; a row's length in the channel's
  const media = frameRate(tenant.catalogFrameRate);
  const rate = frameRate(channel.frameRate);
  const toMedia = (frames: number) => Math.round((frames * media.nominal) / rate.nominal);
  const items: PlayoutXmlItem[] = rows.map((e) => {
    const p = e.productionId ? byId.get(e.productionId) : undefined;
    const star = p && typeof p.customValues === 'object' && p.customValues && !Array.isArray(p.customValues) ? (p.customValues as Record<string, unknown>).STAR : undefined;
    return {
      file: p?.additionalData.trim() ?? '',
      title: e.title,
      color: p?.content.contentType.color ?? null,
      inFrames: e.tcInFrames,
      outFrames: e.tcOutFrames > e.tcInFrames ? e.tcOutFrames : e.tcInFrames + toMedia(e.lengthFrames),
      category: p?.notes ?? '',
      star: typeof star === 'string' ? star : '',
    };
  });

  const content = playoutXmlFile({
    rootId: String(Date.now()),
    name: playoutXmlRootName(playoutXmlPrefix(tenant.slug), date, channel.dayStartFrames, rate),
    firstItemId: playoutXmlFirstItemId(date),
    items,
    rate: media,
  });
  return {
    fileName: exportFileName('playout-xml', date, channel.dayStartFrames, rate, channel.code),
    content,
    items: items.length,
    noFile: [...new Set(items.filter((i) => !i.file).map((i) => i.title))],
    draft: !day.published,
  };
}
