// Linked-break lists: each channel's own lists of break positions (decision 0016).

import { uuidv7 } from '@9eye/core';
import type { Prisma } from '@prisma/client';
import { db } from '../db';
import { HttpError, notFound } from '../errors';

export interface BreakListDto {
  id: string;
  channelId: string;
  name: string;
  positions: number[];
}

const dto = (l: { id: string; channelId: string; name: string; positions: number[] }): BreakListDto => ({
  id: l.id,
  channelId: l.channelId,
  name: l.name,
  positions: l.positions,
});

async function channelWithAds(channelId: string) {
  const c = await db.channel.findFirst({ where: { id: channelId, deletedAt: null }, include: { playlists: true } });
  if (!c) throw notFound('Channel');
  if (!c.playlists.some((p) => p.kind === 'ads')) {
    throw new HttpError(409, `${c.name} has no ads playlist, so its blocks have no linked breaks.`);
  }
  return c;
}

function checkPositions(positions: number[]) {
  if (new Set(positions).size !== positions.length) throw new HttpError(422, 'A position can be in a list only once.');
}

export async function listBreakLists(channelId: string) {
  const c = await db.channel.findFirst({ where: { id: channelId, deletedAt: null } });
  if (!c) throw notFound('Channel');
  const rows = await db.breakList.findMany({ where: { channelId }, orderBy: { name: 'asc' } });
  return rows.map(dto);
}

export async function createBreakList(channelId: string, input: { name: string; positions: number[] }) {
  await channelWithAds(channelId);
  checkPositions(input.positions);
  const name = input.name.trim();
  if (!name) throw new HttpError(422, 'A name is required.');
  const row = await db.breakList.create({ data: { id: uuidv7(), channelId, name, positions: input.positions } as Prisma.BreakListUncheckedCreateInput });
  return dto(row);
}

export async function updateBreakList(id: string, input: { name?: string; positions?: number[] }) {
  const cur = await db.breakList.findFirst({ where: { id } });
  if (!cur) throw notFound('Break list');
  if (input.positions) checkPositions(input.positions);
  if (input.name !== undefined && !input.name.trim()) throw new HttpError(422, 'A name is required.');
  const row = await db.breakList.update({ where: { id }, data: { name: input.name?.trim(), positions: input.positions } });
  return dto(row);
}

export async function deleteBreakList(id: string) {
  const cur = await db.breakList.findFirst({ where: { id } });
  if (!cur) throw notFound('Break list');
  await db.breakList.delete({ where: { id } });
}
