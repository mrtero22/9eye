// What the API sends to the browser. Field names are 9eye's own (decision 0015).

import type { BlockGroup, BlockType, Channel, ChannelPlaylist, Template } from '@prisma/client';
import { broadcastToday, type BlockDraft, type BlockTypeInfo } from '@9eye/core';
import { toIsoDate } from '../db';

export type PlaylistKind = 'main' | 'ads';

export interface ChannelDto {
  id: string;
  name: string;
  code: string;
  frameRate: string;
  dayStartFrames: number;
  weekStart: number;
  timeZone: string | null;
  dateLocale: string;
  ageLogoPosition: string | null;
  defaultBreakListId: string | null;
  shortestBreakFrames: number;
  defaultRotationListName: string | null;
  defaultExport: string | null;
  allowedExports: string[];
  epgTypes: string[];
  bxfTimesUtc: boolean;
  reconcileTolerance: number;
  version: number;
  mainPlaylistId: string | null;
  adsPlaylistId: string | null;
  templateCount: number;
  /** The channel's current broadcast day (date pickers' "today"). */
  today: string;
}

export function channelDto(c: Channel & { playlists: (ChannelPlaylist & { _count?: { templates: number } })[] }): ChannelDto {
  const main = c.playlists.find((p) => p.kind === 'main');
  const ads = c.playlists.find((p) => p.kind === 'ads');
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    frameRate: c.frameRate,
    dayStartFrames: c.dayStartFrames,
    weekStart: c.weekStart,
    timeZone: c.timeZone,
    dateLocale: c.dateLocale,
    ageLogoPosition: c.ageLogoPosition,
    defaultBreakListId: c.defaultBreakListId,
    shortestBreakFrames: c.shortestBreakFrames,
    defaultRotationListName: c.defaultRotationListName,
    defaultExport: c.defaultExport,
    allowedExports: c.allowedExports,
    epgTypes: c.epgTypes,
    bxfTimesUtc: c.bxfTimesUtc,
    reconcileTolerance: c.reconcileTolerance,
    version: c.version,
    mainPlaylistId: main?.id ?? null,
    adsPlaylistId: ads?.id ?? null,
    templateCount: c.playlists.reduce((n, p) => n + (p._count?.templates ?? 0), 0),
    today: broadcastToday(Date.now(), c),
  };
}

export interface TemplateSummaryDto {
  id: string;
  name: string;
  kind: PlaylistKind;
  playlistId: string;
  channelId: string;
  validFrom: string;
  validTo: string;
  activeWeekdays: boolean[];
  version: number;
  updatedAt: string;
}

export function templateSummaryDto(t: Template & { playlist: ChannelPlaylist }): TemplateSummaryDto {
  return {
    id: t.id,
    name: t.name,
    kind: t.playlist.kind as PlaylistKind,
    playlistId: t.playlistId,
    channelId: t.playlist.channelId,
    validFrom: toIsoDate(t.validFrom),
    validTo: toIsoDate(t.validTo),
    activeWeekdays: t.activeWeekdays,
    version: t.version,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export interface BlockTypeDto extends BlockTypeInfo {
  textColor: string;
  fillGaps: boolean;
  opensWithBreak: boolean;
  note: string;
  kind: PlaylistKind;
  channelId: string;
  channelName: string;
  usedCount: number;
}

export function blockTypeDto(
  t: BlockType & { playlist: ChannelPlaylist & { channel: Channel }; _count?: { blocks: number; linkedBreaks: number } },
): BlockTypeDto {
  return {
    id: t.id,
    name: t.name,
    groupId: t.groupId,
    color: t.color,
    textColor: t.textColor,
    lengthFrames: t.lengthFrames,
    validWeekdays: t.validWeekdays,
    validFrom: toIsoDate(t.validFrom),
    validTo: toIsoDate(t.validTo),
    playlistId: t.playlistId,
    fillGaps: t.fillGaps,
    opensWithBreak: t.opensWithBreak,
    note: t.note,
    kind: t.playlist.kind as PlaylistKind,
    channelId: t.playlist.channelId,
    channelName: t.playlist.channel.name,
    usedCount: (t._count?.blocks ?? 0) + (t._count?.linkedBreaks ?? 0),
  };
}

export interface BlockGroupDto {
  id: string;
  name: string;
  color: string | null;
}

export const blockGroupDto = (g: BlockGroup): BlockGroupDto => ({ id: g.id, name: g.name, color: g.color });

export type BlockDto = BlockDraft;
