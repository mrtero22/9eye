// One commercial order (design/orders-page.md §3, part B): its spots and their booked places. A booked
// spot is an airing item of the order — the airing names the main-template block on a broadcast
// day (one per block and day), the item names the spot, the ad break (an
// ads-playlist block type linked in that block), its break position and passes. Each day shows its
// own blocks and breaks, from the order's main template and the channel's ads template.

import { addDays, uuidv7, weekdayOf } from '@9eye/core';
import type { Prisma } from '@prisma/client';
import { db, fromIsoDate, toIsoDate, type Tx, currentTenantId } from '../db';
import { companyEvent } from '../events';
import { HttpError, notFound } from '../errors';
import { channelDto, type ChannelDto } from './dto';

const refuse = (status: number, problems: { code: string; message: string }[]): never => {
  throw new HttpError(status, problems.length === 1 ? problems[0].message : `${problems.length} things stop this.`, problems);
};
const CHANGED = 'Someone else changed this campaign since you opened it. Reload to see their changes, then make yours again.';

// ---------------------------------------------------------------- reading

export interface CommercialOrderDto {
  id: string;
  name: string;
  status: 'confirmed' | 'draft';
  startDate: string;
  endDate: string;
  color: string;
  version: number;
  contract: { id: string; name: string; clientName: string; startDate: string; endDate: string };
  channel: ChannelDto;
  template: { id: string; name: string };
  /** The spots it may book, in order (V1, V2, …). */
  items: { id: string; productionId: string; title: string; code: string; lengthFrames: number | null; booked: number }[];
  booked: number;
  /** Every ad break of the template's days, in time order, with the weekdays that have it (0 = Sunday). */
  breaks: { breakTypeId: string; name: string; startFrames: number; weekdays: boolean[] }[];
}

async function loadOrder(id: string) {
  const o = await db.order.findFirst({
    where: { id, deletedAt: null, mode: 'commercials' },
    include: {
      contract: { include: { client: true } },
      channels: { include: { channel: { include: { playlists: true } }, template: true } },
      items: { orderBy: { position: 'asc' }, include: { production: true } },
    },
  });
  if (!o || !o.contract || !o.channels[0]) throw notFound('Campaign');
  return o;
}

/** The main template's blocks per weekday with their linked breaks, and the ads templates. */
async function structure(templateId: string, channelId: string) {
  const blocks = await db.templateBlock.findMany({
    where: { templateId },
    include: { blockType: { select: { name: true, color: true } }, breaks: { orderBy: { position: 'asc' }, include: { breakType: { select: { id: true, name: true, lengthFrames: true } } } } },
    orderBy: { startFrames: 'asc' },
  });
  const ads = await db.template.findMany({
    where: { deletedAt: null, playlist: { channelId, kind: 'ads' } },
    include: { blocks: { select: { weekday: true, blockTypeId: true, startFrames: true, lengthFrames: true } } },
    orderBy: { validFrom: 'desc' },
  });
  /** Where a break of an ads template sits on a weekday: start and length (frames from the day start). */
  const adsOn = (date: string) => {
    const d = fromIsoDate(date);
    const t = ads.find((x) => x.validFrom <= d && d <= x.validTo) ?? ads[0];
    const wd = weekdayOf(date);
    return new Map((t?.blocks ?? []).filter((b) => b.weekday === wd).map((b) => [b.blockTypeId, { startFrames: b.startFrames, lengthFrames: b.lengthFrames }]));
  };
  return { blocks, adsOn };
}

export async function getCommercialOrder(id: string): Promise<CommercialOrderDto> {
  const o = await loadOrder(id);
  const oc = o.channels[0];
  const { blocks, adsOn } = await structure(oc.templateId, oc.channelId);
  const counts = await db.airingItem.groupBy({ by: ['orderItemId'], where: { airing: { orderId: id } }, _count: { _all: true } });
  const bookedOf = new Map(counts.map((c) => [c.orderItemId, c._count._all]));
  // the union of breaks: start from the ads template on the order's first day (any weekday that has it)
  const start = toIsoDate(o.startDate);
  const union = new Map<string, { breakTypeId: string; name: string; startFrames: number; weekdays: boolean[] }>();
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const wd = weekdayOf(date);
    const ads = adsOn(date);
    for (const b of blocks.filter((x) => x.weekday === wd)) {
      for (const lb of b.breaks) {
        const u = union.get(lb.breakTypeId) ?? { breakTypeId: lb.breakTypeId, name: lb.breakType.name, startFrames: ads.get(lb.breakTypeId)?.startFrames ?? b.startFrames, weekdays: Array(7).fill(false) };
        u.weekdays[wd] = true;
        union.set(lb.breakTypeId, u);
      }
    }
  }
  return {
    id: o.id, name: o.name, status: o.status as 'confirmed' | 'draft', startDate: start, endDate: toIsoDate(o.endDate), color: o.color, version: o.version,
    contract: { id: o.contract!.id, name: o.contract!.name, clientName: o.contract!.client.name, startDate: toIsoDate(o.contract!.startDate), endDate: toIsoDate(o.contract!.endDate) },
    channel: channelDto(oc.channel),
    template: { id: oc.template.id, name: oc.template.name },
    items: o.items.map((it) => ({ id: it.id, productionId: it.productionId, title: it.production.title, code: it.production.code, lengthFrames: it.lengthFrames, booked: bookedOf.get(it.id) ?? 0 })),
    booked: counts.reduce((n, c) => n + c._count._all, 0),
    breaks: [...union.values()].sort((a, b) => a.startFrames - b.startFrames || a.name.localeCompare(b.name)),
  };
}

export interface BookingDto {
  date: string;
  /** The main-template block (its block type) the break belongs to. */
  blockTypeId: string;
  breakTypeId: string;
  orderItemId: string;
  positionId: string | null;
  passes: number;
}
export interface WeekDto {
  from: string;
  to: string;
  days: {
    date: string;
    inOrder: boolean;
    boxes: {
      blockTypeId: string;
      name: string;
      color: string;
      startFrames: number;
      lengthFrames: number;
      breaks: { breakTypeId: string; name: string; startFrames: number; lengthFrames: number; othersFrames: number }[];
    }[];
  }[];
  bookings: BookingDto[];
}

/** Seven days from `from`: each day's blocks and breaks, this order's bookings, how full each break is with other orders. */
export async function commercialWeek(id: string, from: string): Promise<WeekDto> {
  const o = await loadOrder(id);
  const oc = o.channels[0];
  const to = addDays(from, 6);
  const { blocks, adsOn } = await structure(oc.templateId, oc.channelId);
  const mine = await db.airing.findMany({ where: { orderId: id, date: { gte: fromIsoDate(from), lte: fromIsoDate(to) } }, include: { items: { orderBy: { position: 'asc' } } } });
  const others = await db.airingItem.findMany({
    where: { breakTypeId: { not: null }, airing: { channelId: oc.channelId, date: { gte: fromIsoDate(from), lte: fromIsoDate(to) }, orderId: { not: id }, order: { deletedAt: null, mode: 'commercials' } } },
    select: { breakTypeId: true, passes: true, airing: { select: { date: true } }, orderItem: { select: { lengthFrames: true } } },
  });
  const sold = new Map<string, number>();
  for (const x of others) {
    const k = `${toIsoDate(x.airing.date)}|${x.breakTypeId}`;
    sold.set(k, (sold.get(k) ?? 0) + (x.orderItem.lengthFrames ?? 0) * x.passes);
  }
  const startD = toIsoDate(o.startDate);
  const endD = toIsoDate(o.endDate);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    const wd = weekdayOf(date);
    const ads = adsOn(date);
    return {
      date,
      inOrder: date >= startD && date <= endD,
      boxes: blocks
        .filter((b) => b.weekday === wd)
        .map((b) => ({
          blockTypeId: b.blockTypeId, name: b.blockType.name, color: b.blockType.color, startFrames: b.startFrames, lengthFrames: b.lengthFrames,
          breaks: b.breaks
            .map((lb) => {
              const at = ads.get(lb.breakTypeId);
              return { breakTypeId: lb.breakTypeId, name: lb.breakType.name, startFrames: at?.startFrames ?? b.startFrames, lengthFrames: at?.lengthFrames ?? lb.breakType.lengthFrames, othersFrames: sold.get(`${date}|${lb.breakTypeId}`) ?? 0 };
            })
            .sort((a, c) => a.startFrames - c.startFrames),
        })),
    };
  });
  const bookings = mine.flatMap((a) =>
    a.items.filter((it) => it.breakTypeId).map((it) => ({ date: toIsoDate(a.date), blockTypeId: a.blockTypeId, breakTypeId: it.breakTypeId!, orderItemId: it.orderItemId, positionId: it.positionId, passes: it.passes })),
  );
  return { from, to, days, bookings };
}

// ---------------------------------------------------------------- writing

type Struct = Awaited<ReturnType<typeof structure>>;
/** Does the main template give this day this block with this break linked in it? */
const fits = (s: Struct, b: { date: string; blockTypeId: string; breakTypeId: string }) =>
  s.blocks.some((x) => x.weekday === weekdayOf(b.date) && x.blockTypeId === b.blockTypeId && x.breaks.some((lb) => lb.breakTypeId === b.breakTypeId));

async function writeBookings(tx: Tx, orderId: string, channelId: string, s: Struct, list: BookingDto[]) {
  // one airing per block and day; its items in break time order
  const groups = new Map<string, BookingDto[]>();
  for (const b of list) groups.set(`${b.date}|${b.blockTypeId}`, [...(groups.get(`${b.date}|${b.blockTypeId}`) ?? []), b]);
  const existing = await tx.airing.findMany({ where: { orderId, date: { in: [...new Set(list.map((b) => fromIsoDate(b.date)))] } }, include: { _count: { select: { items: true } } } });
  for (const [key, items] of groups) {
    const [date, blockTypeId] = key.split('|');
    const ads = s.adsOn(date);
    items.sort((a, b) => (ads.get(a.breakTypeId)?.startFrames ?? 0) - (ads.get(b.breakTypeId)?.startFrames ?? 0));
    let airing = existing.find((a) => toIsoDate(a.date) === date && a.blockTypeId === blockTypeId);
    let next = airing?._count.items ?? 0;
    if (!airing) {
      const created = await tx.airing.create({ data: { id: uuidv7(), orderId, channelId, date: fromIsoDate(date), blockTypeId, passes: 1 } as Prisma.AiringUncheckedCreateInput });
      airing = { ...created, _count: { items: 0 } };
      next = 0;
    }
    await tx.airingItem.createMany({
      data: items.map((b) => ({ id: uuidv7(), airingId: airing!.id, position: next++, orderItemId: b.orderItemId, passes: b.passes, breakTypeId: b.breakTypeId, positionId: b.positionId })),
    });
  }
}

async function bumpVersion(tx: Tx, id: string, version: number) {
  const r = await tx.order.updateMany({ where: { id, version }, data: { version: { increment: 1 } } });
  if (r.count !== 1) throw new HttpError(409, CHANGED);
  return version + 1;
}

/** Replaces the order's bookings between `from` and `to` (one week of the board) with `bookings`. */
export async function saveCommercialWeek(id: string, input: { version: number; from: string; to: string; bookings: BookingDto[] }): Promise<{ version: number }> {
  const o = await loadOrder(id);
  const oc = o.channels[0];
  const s = await structure(oc.templateId, oc.channelId);
  const startD = toIsoDate(o.startDate);
  const endD = toIsoDate(o.endDate);
  const problems: { code: string; message: string }[] = [];
  if (input.to < input.from || addDays(input.from, 62) < input.to) problems.push({ code: 'range', message: 'Save one week at a time.' });
  const itemIds = new Set(o.items.map((i) => i.id));
  const positionIds = [...new Set(input.bookings.map((b) => b.positionId).filter((x): x is string => !!x))];
  if (positionIds.length && (await db.breakPosition.count({ where: { id: { in: positionIds } } })) !== positionIds.length) problems.push({ code: 'position', message: 'A break position does not exist any more.' });
  const before = await commercialWeek(id, input.from);
  const known = new Set(before.bookings.map((b) => `${b.date}|${b.blockTypeId}|${b.breakTypeId}`));
  for (const b of input.bookings) {
    if (b.date < input.from || b.date > input.to) problems.push({ code: 'range', message: `A spot on ${b.date} is outside the week being saved.` });
    else if (b.date < startD || b.date > endD) problems.push({ code: 'dates', message: `The campaign runs from ${startD} to ${endD}; ${b.date} is outside it.` });
    if (!itemIds.has(b.orderItemId)) problems.push({ code: 'item', message: 'A booked spot is not one of the campaign’s spots.' });
    // a break the template no longer has keeps what was booked there, but takes nothing new
    if (!known.has(`${b.date}|${b.blockTypeId}|${b.breakTypeId}`) && !fits(s, b)) problems.push({ code: 'break', message: `${b.date} has no such break in that block.` });
  }
  if (problems.length) refuse(422, [...new Map(problems.map((p) => [p.message, p])).values()]);
  let version = input.version;
  await db.$transaction(async (tx) => {
    version = await bumpVersion(tx, id, input.version);
    // A booked spot that stays keeps its id: the ads playlist rows that air it point at it.
    const range = { orderId: id, date: { gte: fromIsoDate(input.from), lte: fromIsoDate(input.to) } };
    const old = await tx.airingItem.findMany({ where: { airing: range }, include: { airing: { select: { date: true, blockTypeId: true } } } });
    const unused = new Map(old.map((o) => [o.id, o]));
    const fresh: BookingDto[] = [];
    for (const b of input.bookings) {
      const same = [...unused.values()].find((o) => toIsoDate(o.airing.date) === b.date && o.airing.blockTypeId === b.blockTypeId && o.breakTypeId === b.breakTypeId && o.orderItemId === b.orderItemId);
      if (!same) {
        fresh.push(b);
        continue;
      }
      unused.delete(same.id);
      if (same.positionId !== b.positionId || same.passes !== b.passes) await tx.airingItem.update({ where: { id: same.id }, data: { positionId: b.positionId, passes: b.passes } });
    }
    if (unused.size) await tx.airingItem.deleteMany({ where: { id: { in: [...unused.keys()] } } });
    await tx.airing.deleteMany({ where: { ...range, items: { none: {} } } });
    await writeBookings(tx, id, oc.channelId, s, fresh);
  });
  return { version };
}

export interface BookInput {
  version: number;
  from: string;
  to: string;
  breakTypeIds: string[];
  /** Index 0 = Sunday. */
  weekdays: boolean[];
  itemIds: string[];
  spread: 'rotate' | 'same';
  positionId: string | null;
  passes: number;
  apply: boolean;
  /** Only the Nth break of each block (1 = the first), day by day from the layout; among the chosen breaks. */
  nthInBlock?: number | null;
}
export interface BookResult {
  added: number;
  addedFrames: number;
  kept: number;
  /** Breaks a chosen weekday does not have: weekday (0 = Sunday) → break type ids. */
  skipped: { weekday: number; breakTypeIds: string[] }[];
  /** With nthInBlock: blocks on the chosen days that have no Nth break. */
  noNth: number;
  version: number;
}

/**
 * Book spots over a date range: every chosen break on every chosen day that has it; a break this
 * order has booked already keeps its spot. Spots rotate over the day's new breaks in time order,
 * starting again each day (Aurora Media's rule), or the first spot goes everywhere. `apply` false = count only.
 */
export async function bookSpots(id: string, input: BookInput): Promise<BookResult> {
  const o = await loadOrder(id);
  const oc = o.channels[0];
  const s = await structure(oc.templateId, oc.channelId);
  const from = input.from < toIsoDate(o.startDate) ? toIsoDate(o.startDate) : input.from;
  const to = input.to > toIsoDate(o.endDate) ? toIsoDate(o.endDate) : input.to;
  const items = input.itemIds.map((x) => o.items.find((i) => i.id === x)).filter((x): x is (typeof o.items)[number] => !!x);
  const problems: { code: string; message: string }[] = [];
  if (!items.length) problems.push({ code: 'items', message: 'Choose at least one spot of the campaign.' });
  if (!input.breakTypeIds.length) problems.push({ code: 'breaks', message: 'Choose at least one break.' });
  if (to < from) problems.push({ code: 'dates', message: 'The dates are outside the campaign.' });
  if (addDays(from, 400) < to) problems.push({ code: 'dates', message: 'Book at most 400 days at once.' });
  if (input.positionId && !(await db.breakPosition.findFirst({ where: { id: input.positionId } }))) problems.push({ code: 'position', message: 'The break position does not exist any more.' });
  if (problems.length) refuse(422, problems);
  const chosen = new Set(input.breakTypeIds);
  const have = await db.airingItem.findMany({
    where: { breakTypeId: { in: [...chosen] }, airing: { orderId: id, date: { gte: fromIsoDate(from), lte: fromIsoDate(to) } } },
    select: { breakTypeId: true, airing: { select: { date: true } } },
  });
  const booked = new Set(have.map((h) => `${toIsoDate(h.airing.date)}|${h.breakTypeId}`));
  const add: BookingDto[] = [];
  let kept = 0;
  let addedFrames = 0;
  const skipped = new Map<number, Set<string>>();
  const nth = input.nthInBlock ?? null;
  let noNth = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const wd = weekdayOf(date);
    if (!input.weekdays[wd]) continue;
    const ads = s.adsOn(date);
    const today = s.blocks.filter((b) => b.weekday === wd);
    // every chosen break of the day's blocks, or only each block's Nth (its linked breaks in their order)
    const linked = nth
      ? today.flatMap((b) => {
          const lb = b.breaks[nth - 1];
          if (!lb) noNth++;
          return lb && chosen.has(lb.breakTypeId) ? [{ b, lb }] : [];
        })
      : today.flatMap((b) => b.breaks.filter((lb) => chosen.has(lb.breakTypeId)).map((lb) => ({ b, lb })));
    const breaks = linked.map(({ b, lb }) => ({ blockTypeId: b.blockTypeId, breakTypeId: lb.breakTypeId, at: ads.get(lb.breakTypeId)?.startFrames ?? b.startFrames })).sort((a, b) => a.at - b.at);
    const present = new Set(today.flatMap((b) => b.breaks.map((lb) => lb.breakTypeId)));
    if (!nth) for (const x of chosen) if (!present.has(x)) skipped.set(wd, (skipped.get(wd) ?? new Set()).add(x));
    let k = 0;
    for (const b of breaks) {
      if (booked.has(`${date}|${b.breakTypeId}`)) {
        kept++;
        continue;
      }
      const item = input.spread === 'same' ? items[0] : items[k++ % items.length];
      addedFrames += (item.lengthFrames ?? 0) * input.passes;
      add.push({ date, blockTypeId: b.blockTypeId, breakTypeId: b.breakTypeId, orderItemId: item.id, positionId: input.positionId, passes: input.passes });
    }
  }
  let version = input.version;
  if (input.apply && add.length) {
    await db.$transaction(
      async (tx) => {
        version = await bumpVersion(tx, id, input.version);
        await writeBookings(tx, id, oc.channelId, s, add);
      },
      { timeout: 60_000 },
    );
  }
  return { added: add.length, addedFrames, kept, skipped: [...skipped].map(([weekday, ids]) => ({ weekday, breakTypeIds: [...ids] })), noNth, version };
}

/** Name, state, dates and the spots it may book. A spot with booked places stays; dates must hold every booking. */
export async function saveCommercialOrder(
  id: string,
  input: { version: number; name: string; status: 'confirmed' | 'draft'; startDate: string; endDate: string; items: { id: string | null; productionId: string }[] },
): Promise<{ version: number }> {
  const o = await loadOrder(id);
  const problems: { code: string; message: string }[] = [];
  const name = input.name.trim();
  if (!name) problems.push({ code: 'name', message: 'The campaign needs a name.' });
  const c = o.contract!;
  if (input.endDate < input.startDate) problems.push({ code: 'dates', message: 'The campaign ends before it starts.' });
  if (input.startDate < toIsoDate(c.startDate) || input.endDate > toIsoDate(c.endDate)) problems.push({ code: 'dates', message: `The campaign must stay within the deal (${toIsoDate(c.startDate)} – ${toIsoDate(c.endDate)}).` });
  const outside = await db.airing.count({ where: { orderId: id, OR: [{ date: { lt: fromIsoDate(input.startDate) } }, { date: { gt: fromIsoDate(input.endDate) } }] } });
  if (outside) problems.push({ code: 'dates', message: `${outside} blocks with booked spots fall outside those dates. Remove those spots first.` });
  const keepIds = new Set(input.items.map((i) => i.id).filter((x): x is string => !!x));
  if ([...keepIds].some((x) => !o.items.some((i) => i.id === x))) problems.push({ code: 'items', message: 'A spot of the list is not one of the campaign’s.' });
  const gone = o.items.filter((i) => !keepIds.has(i.id));
  if (gone.length) {
    const used = await db.airingItem.groupBy({ by: ['orderItemId'], where: { orderItemId: { in: gone.map((g) => g.id) } }, _count: { _all: true } });
    for (const u of used) problems.push({ code: 'item-in-use', message: `${gone.find((g) => g.id === u.orderItemId)!.production.title} is booked ${u._count._all} times. Remove those bookings first.` });
  }
  const newIds = input.items.filter((i) => !i.id).map((i) => i.productionId);
  const prods = newIds.length ? await db.production.findMany({ where: { id: { in: newIds } }, select: { id: true, lengthFrames: true } }) : [];
  if (prods.length !== new Set(newIds).size) problems.push({ code: 'production', message: 'Some spots are not in the catalog.' });
  if (problems.length) refuse(422, problems);
  let version = input.version;
  await db.$transaction(async (tx) => {
    const r = await tx.order.updateMany({
      where: { id, version: input.version },
      data: { name, status: input.status, startDate: fromIsoDate(input.startDate), endDate: fromIsoDate(input.endDate), version: { increment: 1 } },
    });
    if (r.count !== 1) throw new HttpError(409, CHANGED);
    version = input.version + 1;
    if (gone.length) await tx.orderItem.deleteMany({ where: { id: { in: gone.map((g) => g.id) } } });
    for (const [i, it] of input.items.entries()) {
      if (it.id) await tx.orderItem.update({ where: { id: it.id }, data: { position: i } });
      else await tx.orderItem.create({ data: { id: uuidv7(), orderId: id, position: i, productionId: it.productionId, lengthFrames: prods.find((p) => p.id === it.productionId)?.lengthFrames ?? null } });
    }
  });
  if (o.status !== 'confirmed' && input.status === 'confirmed') {
    for (const oc of o.channels) {
      const text = `Campaign "${name}" of ${c.client.name} on ${oc.channel.name} is confirmed (${input.startDate} → ${input.endDate}).`;
      companyEvent(currentTenantId(), { kind: 'campaign_confirmed', channelId: oc.channel.id, text });
    }
  }
  return { version };
}
