// Break positions (spec commercials §7): where in an ad break a booked spot goes — 1 = first. The
// company's list is edited and saved as a whole (order, the one default, colour, price modifier, the
// content types that may take each position; none = any), all-or-nothing.

import { uuidv7 } from '@9eye/core';
import type { Prisma } from '@prisma/client';
import { db } from '../db';
import { HttpError } from '../errors';

export interface BreakPositionDto {
  id: string;
  name: string;
  /** 1 = first in the break. */
  order: number;
  isDefault: boolean;
  color: string | null;
  /** Percent on the spot's price (−100 … 10 000). */
  priceModifier: number;
  contentTypeIds: string[];
  version: number;
}

/** A row of the list as the page saves it, in order: `id` null = new. */
export interface BreakPositionInput {
  id: string | null;
  version: number | null;
  name: string;
  isDefault: boolean;
  color: string | null;
  priceModifier: number;
  contentTypeIds: string[];
}

type Row = {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  color: string | null;
  priceModifier: { toNumber(): number } | number;
  contentTypeIds: string[];
  version: number;
};

const dto = (r: Row): BreakPositionDto => ({
  id: r.id,
  name: r.name,
  order: r.sortOrder,
  isDefault: r.isDefault,
  color: r.color,
  priceModifier: typeof r.priceModifier === 'number' ? r.priceModifier : r.priceModifier.toNumber(),
  contentTypeIds: r.contentTypeIds,
  version: r.version,
});

export async function listBreakPositions(): Promise<BreakPositionDto[]> {
  const rows = await db.breakPosition.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return rows.map(dto);
}

const CHANGED = 'Someone else changed the break positions since you opened them. Reload to see their changes, then make yours again.';

/** Saves the whole list: rows in their new order, plus the ids removed from it. */
export async function saveBreakPositions(input: { rows: BreakPositionInput[]; deletedIds: string[] }): Promise<BreakPositionDto[]> {
  const rows = input.rows.map((r) => ({ ...r, name: r.name.trim(), priceModifier: Math.round(r.priceModifier * 100) / 100, contentTypeIds: [...new Set(r.contentTypeIds)] }));

  const problems: { code: string; message: string }[] = [];
  rows.forEach((r, i) => {
    if (!r.name) problems.push({ code: 'name', message: `Position ${i + 1} has no name.` });
  });
  if (rows.filter((r) => r.isDefault).length > 1) problems.push({ code: 'default', message: 'Only one position can be the default.' });
  const ids = rows.map((r) => r.id).filter((x): x is string => !!x);
  if (new Set(ids).size !== ids.length || ids.some((x) => input.deletedIds.includes(x))) problems.push({ code: 'input', message: 'A position is in the list twice.' });
  if (rows.some((r) => (r.id === null) !== (r.version === null))) problems.push({ code: 'input', message: 'A saved position needs its version, a new one none.' });
  const typeIds = [...new Set(rows.flatMap((r) => r.contentTypeIds))];
  if (typeIds.length) {
    const found = await db.contentType.count({ where: { id: { in: typeIds }, deletedAt: null } });
    if (found !== typeIds.length) problems.push({ code: 'content-type', message: 'Some categories do not exist any more. Reload and choose again.' });
  }
  if (problems.length) throw new HttpError(422, problems.length === 1 ? problems[0].message : 'Some positions are not valid.', problems);

  await db.$transaction(async (tx) => {
    const current = await tx.breakPosition.findMany();
    const byId = new Map(current.map((c) => [c.id, c]));
    // Every saved position must be either kept (same version) or removed; a position someone else
    // added or changed meanwhile stops the save.
    for (const c of current) {
      const kept = rows.find((r) => r.id === c.id);
      if (kept ? kept.version !== c.version : !input.deletedIds.includes(c.id)) throw new HttpError(409, CHANGED);
    }
    if (ids.some((x) => !byId.has(x))) throw new HttpError(409, CHANGED);

    const gone = input.deletedIds.filter((x) => byId.has(x));
    if (gone.length) {
      // a position that booked spots use stays
      const used = await tx.airingItem.groupBy({ by: ['positionId'], where: { positionId: { in: gone } }, _count: { _all: true } });
      if (used.length) {
        throw new HttpError(
          422,
          used.map((u) => `${byId.get(u.positionId!)!.name} is used by ${u._count._all} booked ${u._count._all === 1 ? 'spot' : 'spots'}.`).join(' ') + ' Move those spots to another position first.',
        );
      }
      await tx.breakPosition.deleteMany({ where: { id: { in: gone } } });
    }
    for (const [i, r] of rows.entries()) {
      const data = { name: r.name, sortOrder: i + 1, isDefault: r.isDefault, color: r.color, priceModifier: r.priceModifier, contentTypeIds: r.contentTypeIds };
      if (!r.id) {
        // tenant_id is added by the tenant guard (db.ts)
        await tx.breakPosition.create({ data: { id: uuidv7(), ...data } as Prisma.BreakPositionUncheckedCreateInput });
        continue;
      }
      const c = byId.get(r.id)!;
      const same =
        c.name === data.name &&
        c.sortOrder === data.sortOrder &&
        c.isDefault === data.isDefault &&
        c.color === data.color &&
        c.priceModifier.toNumber() === data.priceModifier &&
        JSON.stringify(c.contentTypeIds) === JSON.stringify(data.contentTypeIds);
      if (!same) await tx.breakPosition.update({ where: { id: r.id }, data: { ...data, version: { increment: 1 } } });
    }
  });
  return listBreakPositions();
}
