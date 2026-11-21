// Block types and block groups (data model §5): the library of the Templates page.

import { frameRate, framesPerDay, isIsoDate, uuidv7 } from '@9eye/core';
import type { Prisma } from '@prisma/client';
import { db, fromIsoDate, type Tx } from '../db';
import { HttpError, notFound } from '../errors';
import { blockGroupDto, blockTypeDto } from './dto';

const include = {
  playlist: { include: { channel: true } },
  _count: { select: { blocks: { where: { template: { deletedAt: null } } }, linkedBreaks: { where: { block: { template: { deletedAt: null } } } } } },
} as const;

export async function listBlockTypes() {
  const rows = await db.blockType.findMany({ where: { deletedAt: null, playlist: { channel: { deletedAt: null } } }, include, orderBy: { name: 'asc' } });
  return rows.map(blockTypeDto);
}

export async function listBlockGroups() {
  const rows = await db.blockGroup.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  return rows.map(blockGroupDto);
}

export interface BlockTypeFields {
  color: string;
  textColor: string;
  lengthFrames: number;
  validFrom: string;
  validTo: string;
  validWeekdays: boolean[];
  fillGaps: boolean;
  opensWithBreak: boolean;
  note: string;
}

function checkFields(f: Partial<BlockTypeFields>, fps: string) {
  const problems: { code: string; message: string }[] = [];
  if (f.lengthFrames !== undefined && (f.lengthFrames <= 0 || f.lengthFrames > framesPerDay(frameRate(fps)))) {
    problems.push({ code: 'length', message: 'The length must be more than zero and at most one day.' });
  }
  if (f.validWeekdays && !f.validWeekdays.some(Boolean)) {
    problems.push({ code: 'weekdays', message: 'Pick at least one weekday.' });
  }
  if (f.validFrom !== undefined && f.validTo !== undefined) {
    if (!isIsoDate(f.validFrom) || !isIsoDate(f.validTo)) problems.push({ code: 'dates', message: 'Both dates are required.' });
    else if (f.validTo < f.validFrom) problems.push({ code: 'dates', message: 'The end date is before the start date.' });
  }
  if (problems.length) throw new HttpError(422, problems[0].message, problems);
}

async function resolveGroup(tx: Tx, groupId: string | undefined, newGroupName: string | undefined, color: string) {
  if (newGroupName) {
    return tx.blockGroup.create({ data: { id: uuidv7(), name: newGroupName.trim(), color } as Prisma.BlockGroupUncheckedCreateInput });
  }
  const g = groupId ? await tx.blockGroup.findFirst({ where: { id: groupId, deletedAt: null } }) : null;
  if (!g) throw new HttpError(422, 'Pick a block group.');
  return g;
}

/** One block type, or several numbered ones ("1H Series Run Block 1…6") — all or nothing. */
export async function createBlockTypes(input: BlockTypeFields & { playlistId: string; groupId?: string; newGroupName?: string; names: string[] }) {
  const playlist = await db.channelPlaylist.findFirst({ where: { id: input.playlistId }, include: { channel: true } });
  if (!playlist || playlist.channel.deletedAt) throw notFound('Playlist');
  checkFields(input, playlist.channel.frameRate);
  const names = input.names.map((n) => n.trim()).filter(Boolean);
  if (!names.length) throw new HttpError(422, 'A name is required.');
  const ids = await db.$transaction(async (tx) => {
    const group = await resolveGroup(tx, input.groupId, input.newGroupName, input.color);
    const out: string[] = [];
    for (const name of names) {
      const t = await tx.blockType.create({
        data: {
          id: uuidv7(),
          playlistId: playlist.id,
          groupId: group.id,
          name,
          color: input.color,
          textColor: input.textColor,
          lengthFrames: input.lengthFrames,
          validFrom: fromIsoDate(input.validFrom),
          validTo: fromIsoDate(input.validTo),
          validWeekdays: input.validWeekdays,
          fillGaps: input.fillGaps,
          opensWithBreak: input.opensWithBreak,
          note: input.note,
        } as Prisma.BlockTypeUncheckedCreateInput,
      });
      out.push(t.id);
    }
    return out;
  });
  const rows = await db.blockType.findMany({ where: { id: { in: ids } }, include, orderBy: { name: 'asc' } });
  return rows.map(blockTypeDto);
}

export async function updateBlockType(id: string, input: Partial<BlockTypeFields> & { name?: string; groupId?: string; newGroupName?: string }) {
  const cur = await db.blockType.findFirst({ where: { id, deletedAt: null }, include: { playlist: { include: { channel: true } } } });
  if (!cur) throw notFound('Block type');
  checkFields({ ...input, validFrom: input.validFrom ?? cur.validFrom.toISOString().slice(0, 10), validTo: input.validTo ?? cur.validTo.toISOString().slice(0, 10) }, cur.playlist.channel.frameRate);
  if (input.name !== undefined && !input.name.trim()) throw new HttpError(422, 'A name is required.');
  await db.$transaction(async (tx) => {
    const groupId = input.newGroupName || input.groupId ? (await resolveGroup(tx, input.groupId, input.newGroupName, input.color ?? cur.color)).id : undefined;
    await tx.blockType.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        groupId,
        color: input.color,
        textColor: input.textColor,
        lengthFrames: input.lengthFrames,
        validFrom: input.validFrom ? fromIsoDate(input.validFrom) : undefined,
        validTo: input.validTo ? fromIsoDate(input.validTo) : undefined,
        validWeekdays: input.validWeekdays,
        fillGaps: input.fillGaps,
        opensWithBreak: input.opensWithBreak,
        note: input.note,
      },
    });
  });
  const row = await db.blockType.findFirst({ where: { id }, include });
  return blockTypeDto(row!);
}

export async function deleteBlockType(id: string) {
  const row = await db.blockType.findFirst({ where: { id, deletedAt: null }, include });
  if (!row) throw notFound('Block type');
  const used = row._count.blocks + row._count.linkedBreaks;
  if (used) {
    throw new HttpError(409, `${row.name} is used by ${used} ${used === 1 ? 'block' : 'blocks'} in layouts. Remove them first.`);
  }
  await db.blockType.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Several block types with their own names and settings, in one transaction (all or nothing).
 * Used by "Repeat a time range": each copy of an hour needs its own block types.
 */
export async function createBlockTypesBulk(input: { playlistId: string; items: (BlockTypeFields & { groupId: string; name: string })[] }) {
  const playlist = await db.channelPlaylist.findFirst({ where: { id: input.playlistId }, include: { channel: true } });
  if (!playlist || playlist.channel.deletedAt) throw notFound('Playlist');
  if (!input.items.length) return [];
  input.items.forEach((it) => checkFields(it, playlist.channel.frameRate));
  if (input.items.some((it) => !it.name.trim())) throw new HttpError(422, 'Every block type needs a name.');
  const groupIds = [...new Set(input.items.map((it) => it.groupId))];
  const groups = await db.blockGroup.count({ where: { id: { in: groupIds }, deletedAt: null } });
  if (groups !== groupIds.length) throw new HttpError(422, 'Some block groups do not exist.');
  const ids = input.items.map(() => uuidv7());
  await db.$transaction(async (tx) => {
    await tx.blockType.createMany({
      data: input.items.map((it, i) => ({
        id: ids[i],
        playlistId: playlist.id,
        groupId: it.groupId,
        name: it.name.trim(),
        color: it.color,
        textColor: it.textColor,
        lengthFrames: it.lengthFrames,
        validFrom: fromIsoDate(it.validFrom),
        validTo: fromIsoDate(it.validTo),
        validWeekdays: it.validWeekdays,
        fillGaps: it.fillGaps,
        opensWithBreak: it.opensWithBreak,
        note: it.note,
      })) as Prisma.BlockTypeCreateManyInput[],
    });
  });
  const rows = await db.blockType.findMany({ where: { id: { in: ids } }, include });
  const byId = new Map(rows.map((r) => [r.id, blockTypeDto(r)]));
  return ids.map((id) => byId.get(id)!);
}
