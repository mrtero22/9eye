// Orders of the Scheduling page (data model §7): the list of a channel with what each order does this
// week and its first issue, one order with everything its page needs, a channel's week of airings,
// and the writes — create, save (whole order, all-or-nothing, version), duplicate, split, move
// airings, delete.

import {
  ORDER_MODES,
  PROGRAMME_MODES,
  WEEKDAYS,
  addDays,
  dayLabel,
  duplicateOrder,
  formatClockShort,
  frameRate,
  framesPerDay,
  splitOrder,
  uuidv7,
  validateOrder,
  weekStartOn,
  weekdayOf,
  type AiringDraft,
  type OrderDraft,
  type OrderMode,
  type OrderRuleContext,
  type OrderStatus,
  type TemplateDay,
  type TimeWindows,
} from '@9eye/core';
import { Prisma } from '@prisma/client';
import { currentTenantId, db, fromIsoDate, toIsoDate, type Tx } from '../db';
import { HttpError, notFound } from '../errors';
import { channelDto, type ChannelDto } from './dto';

// ---------------------------------------------------------------- shapes sent to the browser

export interface CompactTemplate {
  id: string;
  name: string;
  validFrom: string;
  validTo: string;
  blocks: { weekday: number; blockTypeId: string; startFrames: number; lengthFrames: number; breakCount: number }[];
  blockTypes: Record<string, { name: string; color: string }>;
}

export interface OrderIssue {
  short: string;
  text: string;
  fix: { label: string; action: 'new-order' | 'confirm' | 'end-on' | 'change-end' | 'show-items' | 'open-week'; date?: string } | null;
}

export interface OrderSummaryDto {
  id: string;
  name: string;
  mode: OrderMode;
  status: OrderStatus;
  startDate: string;
  endDate: string;
  color: string;
  itemCount: number;
  /** Series: items with a first airing before this week / with any first airing. */
  aired: number;
  placed: number;
  /** This week: first airings (date, clock time, episode), repeats, and the passes of each block. */
  week: { firsts: { date: string; clock: string; chapter: number | null }[]; repeats: number; passes: { date: string; passes: number }[]; blocksPerDay: number };
  lastAiring: string | null;
  issue: OrderIssue | null;
}

export interface OrderListDto {
  channel: ChannelDto;
  weekFrom: string;
  orders: OrderSummaryDto[];
}

export interface OrderItemDto {
  id: string;
  position: number;
  productionId: string;
  title: string;
  chapter: number | null;
  code: string;
  contentId: string;
  contentTitle: string;
  contentTypeId: string;
  lengthFrames: number | null;
  catalogLengthFrames: number | null;
  mediaStatus: string | null;
}

export interface OrderFullDto {
  order: {
    id: string;
    name: string;
    mode: OrderMode;
    status: OrderStatus;
    startDate: string;
    endDate: string;
    color: string;
    firstItemId: string | null;
    reuseInLoop: boolean;
    maxAirings: number | null;
    totalAirings: number | null;
    timeWindows: TimeWindows;
    version: number;
    updatedAt: string;
  };
  channels: { channel: ChannelDto; template: CompactTemplate }[];
  items: OrderItemDto[];
  airings: AiringDraft[];
  issue: OrderIssue | null;
}

export interface WeekAiringDto {
  id: string;
  orderId: string;
  orderName: string;
  orderColor: string;
  mode: OrderMode;
  status: OrderStatus;
  date: string;
  blockTypeId: string;
  kind: 'first' | 'repeat';
  passes: number;
  /** First airing: its items' titles; repeat: its first airing's. */
  titles: string[];
  chapters: (number | null)[];
  /** Repeat: the day of its first airing. */
  firstDate: string | null;
  blockColor: string | null;
}

// ---------------------------------------------------------------- templates

const isoOrNull = (d: Date | null) => (d ? toIsoDate(d) : null);

async function compactTemplate(templateId: string): Promise<CompactTemplate> {
  const t = await db.template.findFirst({
    where: { id: templateId },
    include: { blocks: { include: { _count: { select: { breaks: true } } }, orderBy: [{ weekday: 'asc' }, { startFrames: 'asc' }] } },
  });
  if (!t) throw notFound('Layout');
  const typeIds = [...new Set(t.blocks.map((b) => b.blockTypeId))];
  const types = await db.blockType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true, color: true } });
  return {
    id: t.id,
    name: t.name,
    validFrom: toIsoDate(t.validFrom),
    validTo: toIsoDate(t.validTo),
    blocks: t.blocks.map((b) => ({ weekday: b.weekday, blockTypeId: b.blockTypeId, startFrames: b.startFrames, lengthFrames: b.lengthFrames, breakCount: b._count.breaks })),
    blockTypes: Object.fromEntries(types.map((x) => [x.id, { name: x.name, color: x.color }])),
  };
}

/** The channel's main template for a day: the one whose dates hold it, else the latest that overlaps the range. */
export async function mainTemplateFor(channelId: string, from: string, to = from) {
  const ts = await db.template.findMany({ where: { deletedAt: null, playlist: { channelId, kind: 'main' } }, orderBy: { validFrom: 'desc' } });
  const f = fromIsoDate(from);
  const t = fromIsoDate(to);
  return ts.find((x) => x.validFrom <= f && f <= x.validTo) ?? ts.find((x) => x.validFrom <= t && x.validTo >= f) ?? null;
}

async function templateDays(templateId: string): Promise<TemplateDay[]> {
  const blocks = await db.template.findFirst({ where: { id: templateId }, select: { blocks: { select: { weekday: true, blockTypeId: true, startFrames: true, lengthFrames: true } } } });
  const days: TemplateDay[] = Array.from({ length: 7 }, () => new Map());
  for (const b of blocks?.blocks ?? []) days[b.weekday].set(b.blockTypeId, { startFrames: b.startFrames, lengthFrames: b.lengthFrames });
  return days;
}

// ---------------------------------------------------------------- reading orders

const orderInclude = {
  channels: { orderBy: { position: 'asc' as const } },
  items: { orderBy: { position: 'asc' as const }, include: { production: { include: { content: true } } } },
} as const;

async function loadOrder(id: string) {
  const o = await db.order.findFirst({ where: { id, deletedAt: null }, include: orderInclude });
  if (!o) throw notFound('Plan');
  return o;
}

async function loadAirings(orderId: string): Promise<AiringDraft[]> {
  const rows = await db.airing.findMany({ where: { orderId }, include: { items: { orderBy: { position: 'asc' } } }, orderBy: [{ date: 'asc' }] });
  return rows.map((a) => ({
    id: a.id,
    channelId: a.channelId,
    date: toIsoDate(a.date),
    blockTypeId: a.blockTypeId,
    passes: a.passes,
    repeatOfId: a.repeatOfId,
    repeatIndex: a.repeatIndex,
    blockColor: a.blockColor,
    items: a.items.map((x) => ({ itemId: x.orderItemId, passes: x.passes, jingle: x.jingle === 'pre' || x.jingle === 'post' ? x.jingle : null })),
  }));
}

async function loadChannel(channelId: string) {
  const c = await db.channel.findFirst({ where: { id: channelId, deletedAt: null }, include: { playlists: true } });
  if (!c) throw notFound('Channel');
  return c;
}

export async function getOrderFull(id: string): Promise<OrderFullDto> {
  const o = await loadOrder(id);
  const channels = [];
  for (const oc of o.channels) {
    channels.push({ channel: channelDto(await loadChannel(oc.channelId)), template: await compactTemplate(oc.templateId) });
  }
  const airings = await loadAirings(o.id);
  const own = channels[0]?.channel;
  const issue = own ? (await issuesFor(own, [o.id])).get(o.id) ?? null : null;
  return {
    order: {
      id: o.id, name: o.name, mode: o.mode as OrderMode, status: o.status as OrderStatus, startDate: toIsoDate(o.startDate), endDate: toIsoDate(o.endDate),
      color: o.color, firstItemId: o.firstItemId, reuseInLoop: o.reuseInLoop, maxAirings: o.maxAirings, totalAirings: o.totalAirings,
      timeWindows: o.timeWindows as unknown as TimeWindows, version: o.version, updatedAt: o.updatedAt.toISOString(),
    },
    channels,
    items: o.items.map((i) => ({
      id: i.id, position: i.position, productionId: i.productionId, title: i.production.title, chapter: i.production.chapter, code: i.production.code,
      contentId: i.production.contentId, contentTitle: i.production.content.title, contentTypeId: i.production.content.contentTypeId,
      lengthFrames: i.lengthFrames, catalogLengthFrames: i.production.lengthFrames, mediaStatus: i.production.mediaStatus,
    })),
    airings,
    issue,
  };
}

interface StatRow {
  order_id: string;
  last_airing: Date | null;
  last_first: Date | null;
}

export async function listOrders(channelId: string): Promise<OrderListDto> {
  const c = await loadChannel(channelId);
  const channel = channelDto(c);
  const tenantId = currentTenantId();
  const ws = weekStartOn(channel.today, channel.weekStart);
  const we = addDays(ws, 6);
  const orders = await db.order.findMany({
    // commercial orders live on the Orders page, not in Scheduling
    where: { deletedAt: null, mode: { not: 'commercials' }, channels: { some: { channelId } } },
    include: { channels: true, _count: { select: { items: true } } },
    orderBy: { name: 'asc' },
  });
  const ids = orders.map((o) => o.id);
  if (!ids.length) return { channel, weekFrom: ws, orders: [] };
  const stats = await db.$queryRaw<StatRow[]>`
    SELECT order_id, max(date) AS last_airing, max(date) FILTER (WHERE repeat_of_id IS NULL) AS last_first
    FROM airing WHERE tenant_id = ${tenantId}::uuid AND channel_id = ${channelId}::uuid GROUP BY order_id`;
  const placedRows = await db.$queryRaw<{ order_id: string; placed: bigint; aired: bigint }[]>`
    SELECT a.order_id, count(DISTINCT ai.order_item_id) AS placed,
           count(DISTINCT ai.order_item_id) FILTER (WHERE a.date < ${fromIsoDate(ws)}) AS aired
    FROM airing a JOIN airing_item ai ON ai.airing_id = a.id
    WHERE a.tenant_id = ${tenantId}::uuid AND a.channel_id = ${channelId}::uuid AND a.repeat_of_id IS NULL GROUP BY a.order_id`;
  const weekRows = await db.$queryRaw<{ order_id: string; date: Date; block_type_id: string; passes: number; first: boolean; chapter: number | null }[]>`
    SELECT a.order_id, a.date, a.block_type_id, a.passes, a.repeat_of_id IS NULL AS first,
           (SELECT p.chapter FROM airing_item ai JOIN order_item oi ON oi.id = ai.order_item_id JOIN production p ON p.id = oi.production_id
            WHERE ai.airing_id = a.id ORDER BY ai.position LIMIT 1) AS chapter
    FROM airing a WHERE a.tenant_id = ${tenantId}::uuid AND a.channel_id = ${channelId}::uuid
      AND a.date >= ${fromIsoDate(ws)} AND a.date <= ${fromIsoDate(we)}`;
  const statOf = new Map(stats.map((s) => [s.order_id, s]));
  const placedOf = new Map(placedRows.map((r) => [r.order_id, r]));
  const rate = frameRate(channel.frameRate);
  const templateIds = [...new Set(orders.flatMap((o) => o.channels.filter((x) => x.channelId === channelId).map((x) => x.templateId)))];
  const startOf = new Map<string, TemplateDay[]>();
  for (const t of templateIds) startOf.set(t, await templateDays(t));
  const issues = await issuesFor(channel, ids);
  return {
    channel,
    weekFrom: ws,
    orders: orders.map((o) => {
      const tpl = startOf.get(o.channels.find((x) => x.channelId === channelId)!.templateId)!;
      const mine = weekRows.filter((r) => r.order_id === o.id);
      const firsts = mine
        .filter((r) => r.first)
        .map((r) => {
          const date = toIsoDate(r.date);
          const start = tpl[weekdayOf(date)].get(r.block_type_id)?.startFrames ?? 0;
          return { date, start, clock: formatClockShort(start, channel.dayStartFrames, rate), chapter: r.chapter };
        })
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start))
        .map(({ date, clock, chapter }) => ({ date, clock, chapter }));
      const s = statOf.get(o.id);
      const p = placedOf.get(o.id);
      return {
        id: o.id, name: o.name, mode: o.mode as OrderMode, status: o.status as OrderStatus, startDate: toIsoDate(o.startDate), endDate: toIsoDate(o.endDate),
        color: o.color, itemCount: o._count.items, aired: Number(p?.aired ?? 0), placed: Number(p?.placed ?? 0),
        week: {
          firsts: o.mode === 'series' || o.mode === 'programmes' ? firsts : [],
          repeats: mine.filter((r) => !r.first).length,
          passes: mine.filter((r) => r.first).map((r) => ({ date: toIsoDate(r.date), passes: r.passes })),
          blocksPerDay: Math.max(0, ...tpl.map((d) => d.size)),
        },
        lastAiring: isoOrNull(s?.last_airing ?? null),
        issue: issues.get(o.id) ?? null,
      };
    }),
  };
}

// ---------------------------------------------------------------- issues (data model §7)

const HORIZON = 14;

/** The first issue of each order (computed, not stored): stale, two programmes in a block, runs out soon, draft, never placed, ends with nothing after it. */
async function issuesFor(channel: ChannelDto, orderIds: string[]): Promise<Map<string, OrderIssue>> {
  const out = new Map<string, OrderIssue>();
  if (!orderIds.length) return out;
  const tenantId = currentTenantId();
  const T = channel.today;
  const H = addDays(T, HORIZON);
  const rate = frameRate(channel.frameRate);
  const all = await db.order.findMany({
    where: { deletedAt: null, channels: { some: { channelId: channel.id } } },
    include: { channels: true, items: { include: { production: { include: { content: { include: { contentType: true } } } } }, orderBy: { position: 'asc' } } },
  });
  const byId = new Map(all.map((o) => [o.id, o]));
  const stats = await db.$queryRaw<{ order_id: string; last_airing: Date | null; last_first: Date | null; next_airing: Date | null; placed: bigint }[]>`
    SELECT a.order_id, max(a.date) AS last_airing, max(a.date) FILTER (WHERE a.repeat_of_id IS NULL) AS last_first,
           min(a.date) FILTER (WHERE a.date >= ${fromIsoDate(T)}) AS next_airing,
           (SELECT count(DISTINCT ai.order_item_id) FROM airing b JOIN airing_item ai ON ai.airing_id = b.id
             WHERE b.order_id = a.order_id AND b.repeat_of_id IS NULL AND b.channel_id = ${channel.id}::uuid) AS placed
    FROM airing a WHERE a.tenant_id = ${tenantId}::uuid AND a.channel_id = ${channel.id}::uuid GROUP BY a.order_id`;
  const statOf = new Map(stats.map((s) => [s.order_id, s]));
  const programmeIds = all.filter((o) => PROGRAMME_MODES.includes(o.mode as OrderMode)).map((o) => o.id);
  // two programmes in one block, from today on
  const clashes = programmeIds.length
    ? await db.$queryRaw<{ order_id: string; other_id: string; date: Date; n: bigint }[]>`
        SELECT a.order_id, b.order_id AS other_id, min(a.date) AS date, count(*) AS n
        FROM airing a JOIN airing b ON b.channel_id = a.channel_id AND b.date = a.date AND b.block_type_id = a.block_type_id AND b.order_id <> a.order_id
        WHERE a.tenant_id = ${tenantId}::uuid AND a.channel_id = ${channel.id}::uuid AND a.date >= ${fromIsoDate(T)}
          AND a.order_id = ANY(${programmeIds}::uuid[]) AND b.order_id = ANY(${programmeIds}::uuid[])
        GROUP BY a.order_id, b.order_id`
    : [];
  const confirmedProgrammes = all.filter((o) => o.status === 'confirmed' && PROGRAMME_MODES.includes(o.mode as OrderMode)).map((o) => o.id);

  for (const id of orderIds) {
    const o = byId.get(id);
    if (!o) continue;
    const mode = o.mode as OrderMode;
    const s = statOf.get(id);
    const start = toIsoDate(o.startDate);
    const end = toIsoDate(o.endDate);
    const last = isoOrNull(s?.last_airing ?? null);
    const lastFirst = isoOrNull(s?.last_first ?? null);
    const placed = Number(s?.placed ?? 0);
    const items = o.items.length;
    const unit = mode === 'series' ? 'episode' : 'item';
    const set = (i: OrderIssue) => out.set(id, i);
    // 1 · nothing placed any more while the order still runs
    if (end >= T && start <= T && (!last || last < T)) {
      if (!last) set({ short: 'Nothing placed yet', text: `Nothing is placed yet; the plan runs ${dayLabel(start)} → ${dayLabel(end)}.`, fix: null });
      else if (mode === 'series' && items && placed >= items) {
        set({ short: `All ${unit}s aired by ${dayLabel(last).slice(0, -5)}; still runs to ${dayLabel(end).slice(0, -5)}`, text: `${o.status === 'draft' ? 'Draft: its' : 'Its'} ${items} ${unit}s all aired by ${dayLabel(last)}, but the plan still runs to ${dayLabel(end)}.`, fix: { label: `End the plan on ${dayLabel(last).slice(0, -5)}`, action: 'end-on', date: last } });
      } else set({ short: `Nothing placed since ${dayLabel(last).slice(4)}`, text: `${o.status === 'draft' ? 'Draft: nothing' : 'Nothing'} placed since ${dayLabel(last)}, but the plan runs to ${dayLabel(end)}.`, fix: { label: 'Change end date…', action: 'change-end' } });
      continue;
    }
    // 2 · two programmes in one block
    const clash = clashes.filter((c) => c.order_id === id);
    if (clash.length) {
      const n = clash.reduce((s, c) => s + Number(c.n), 0);
      const firstDate = clash.map((c) => toIsoDate(c.date)).sort()[0];
      const other = byId.get(clash[0].other_id)?.name ?? 'another plan';
      set({
        short: `Two programmes in ${n} block${n === 1 ? '' : 's'}`,
        text: `${n} block${n === 1 ? '' : 's'} from ${dayLabel(firstDate)} also hold${n === 1 ? 's' : ''} a programme of ${other}${clash.length > 1 ? ` and ${clash.length - 1} more plan${clash.length > 2 ? 's' : ''}` : ''}.`,
        fix: { label: `Show ${dayLabel(firstDate).slice(0, -5)}`, action: 'open-week', date: firstDate },
      });
      continue;
    }
    // 3 · a series runs out soon and nothing takes its blocks after it
    if (mode === 'series' && o.status === 'confirmed' && lastFirst && lastFirst >= T && lastFirst <= H && !o.reuseInLoop) {
      const oc = o.channels.find((x) => x.channelId === channel.id)!;
      const days = await templateDays(oc.templateId);
      const lastWeek = await db.airing.findMany({ where: { orderId: id, channelId: channel.id, repeatOfId: null, date: { gte: fromIsoDate(addDays(lastFirst, -6)), lte: fromIsoDate(lastFirst) } } });
      const slots = [...new Map(lastWeek.map((a) => [`${weekdayOf(toIsoDate(a.date))}|${a.blockTypeId}`, { wd: weekdayOf(toIsoDate(a.date)), bt: a.blockTypeId, date: toIsoDate(a.date) }])).values()];
      const free: typeof slots = [];
      for (const sl of slots) {
        const next = addDays(sl.date, 7);
        const others = confirmedProgrammes.filter((x) => x !== id);
        const n = others.length ? await db.airing.count({ where: { channelId: channel.id, blockTypeId: sl.bt, date: fromIsoDate(next), orderId: { in: others } } }) : 0;
        if (!n) free.push(sl);
      }
      if (free.length) {
        const lastAiring = lastWeek.find((a) => toIsoDate(a.date) === lastFirst);
        const clock = lastAiring ? formatClockShort(days[weekdayOf(lastFirst)].get(lastAiring.blockTypeId)?.startFrames ?? 0, channel.dayStartFrames, rate) : '';
        const lastItem = await db.airingItem.findFirst({ where: { airingId: lastAiring?.id ?? '' }, include: { orderItem: { include: { production: true } } }, orderBy: { position: 'desc' } });
        const n = lastItem?.orderItem.production.chapter;
        const freeDays = [...new Set(free.map((f) => WEEKDAYS[f.wd].short))];
        set({
          short: `Last ${unit} ${dayLabel(lastFirst).slice(0, -5)}${free.length === 1 ? `; nothing at ${clock} after it` : ''}`,
          text: `The last ${unit}${n !== undefined && n !== null ? ` (${n})` : ''} airs ${dayLabel(lastFirst).slice(0, -5)}. ${free.length === 1 ? `No plan places a programme in the ${clock} block after it.` : `The ${clock} block on ${freeDays.join(' / ')} is free after it.`}`,
          fix: { label: `New plan from ${dayLabel(addDays(lastFirst, 1)).slice(0, -5)}…`, action: 'new-order', date: addDays(lastFirst, 1) },
        });
        continue;
      }
    }
    // 4 · a draft with airings to come
    const next = isoOrNull(s?.next_airing ?? null);
    if (o.status === 'draft' && next) {
      const typical = mode === 'series' || mode === 'programmes' ? 0 : (await db.airing.findFirst({ where: { orderId: id, date: fromIsoDate(next) }, select: { passes: true } }))?.passes ?? 0;
      set({
        short: typical ? `Draft: ${typical} plays a block left out of the playlist` : 'Draft: left out of the playlist',
        text: typical ? `Draft: its ${typical} plays in every block are left out of the playlist.` : `Draft: its airings from ${dayLabel(next)} are left out of the playlist.`,
        fix: { label: 'Confirm plan', action: 'confirm' },
      });
      continue;
    }
    // 5 · items never placed
    if (mode === 'series' && !o.reuseInLoop && items && placed < items && end >= T) {
      const placedIds = new Set(
        (await db.airingItem.findMany({ where: { airing: { orderId: id, repeatOfId: null } }, select: { orderItemId: true }, distinct: ['orderItemId'] })).map((x) => x.orderItemId),
      );
      const missing = o.items.filter((i) => !placedIds.has(i.id));
      const first = missing[0]?.production;
      set({
        short: `${missing.length} of ${items} ${unit}s never placed`,
        text: `${items} ${unit}s in the list, ${placed} placed. ${first ? `${unit === 'episode' ? 'Episode' : 'Item'} ${first.chapter ?? first.title} has` : 'Some have'} no airing before the plan ends on ${dayLabel(end)}.`,
        fix: { label: first ? `Show ${unit} ${first.chapter ?? ''}`.trim() : 'Show all', action: 'show-items' },
      });
      continue;
    }
    // 6 · a promo order ends soon and no order of its kind follows it
    if (!PROGRAMME_MODES.includes(mode) && o.status === 'confirmed' && end >= T && end <= H) {
      const types = new Set(o.items.map((i) => i.production.content.contentTypeId));
      const after = addDays(end, 1);
      const follows = all.some(
        (x) => x.id !== id && x.mode === o.mode && x.status === 'confirmed' && toIsoDate(x.startDate) <= after && toIsoDate(x.endDate) >= after && x.items.some((i) => types.has(i.production.content.contentTypeId)),
      );
      if (!follows) {
        const typeNames = [...new Set(o.items.map((i) => i.production.content.contentType.name))].slice(0, 2).join(', ');
        set({
          short: `Ends ${dayLabel(end).slice(0, -5)}; nothing like it after it`,
          text: `Ends ${dayLabel(end).slice(0, -5)}. No other ${mode} plan places items of ${typeNames || 'its kind'} on this channel from ${dayLabel(after).slice(0, -5)}.`,
          fix: { label: 'Change end date…', action: 'change-end' },
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- a channel's week

export async function channelWeek(channelId: string, from: string): Promise<{ template: CompactTemplate | null; airings: WeekAiringDto[] }> {
  await loadChannel(channelId);
  const to = addDays(from, 6);
  const tpl = await mainTemplateFor(channelId, from, to);
  const rows = await db.airing.findMany({
    where: { channelId, date: { gte: fromIsoDate(from), lte: fromIsoDate(to) }, order: { deletedAt: null, mode: { not: 'commercials' } } },
    include: {
      order: true,
      items: { orderBy: { position: 'asc' }, include: { orderItem: { include: { production: true } } } },
      repeatOf: { include: { items: { orderBy: { position: 'asc' }, include: { orderItem: { include: { production: true } } } } } },
    },
  });
  return {
    template: tpl ? await compactTemplate(tpl.id) : null,
    airings: rows.map((a) => {
      const src = a.repeatOf ? a.repeatOf.items : a.items;
      return {
        id: a.id, orderId: a.orderId, orderName: a.order.name, orderColor: a.order.color, mode: a.order.mode as OrderMode, status: a.order.status as OrderStatus,
        date: toIsoDate(a.date), blockTypeId: a.blockTypeId, kind: a.repeatOfId ? 'repeat' : 'first', passes: a.passes,
        titles: src.map((x) => x.orderItem.production.title), chapters: src.map((x) => x.orderItem.production.chapter),
        firstDate: a.repeatOf ? toIsoDate(a.repeatOf.date) : null, blockColor: a.blockColor,
      };
    }),
  };
}

/** Blocks other programme orders hold on the order's channels inside its dates (Copy week names them). */
export async function occupiedCells(orderId: string): Promise<{ channelId: string; date: string; blockTypeId: string; orderName: string }[]> {
  const o = await loadOrder(orderId);
  if (!PROGRAMME_MODES.includes(o.mode as OrderMode)) return [];
  const rows = await db.airing.findMany({
    where: {
      channelId: { in: o.channels.map((c) => c.channelId) }, orderId: { not: o.id }, date: { gte: o.startDate, lte: o.endDate },
      order: { deletedAt: null, mode: { in: PROGRAMME_MODES } },
    },
    select: { channelId: true, date: true, blockTypeId: true, order: { select: { name: true } } },
  });
  return rows.map((r) => ({ channelId: r.channelId, date: toIsoDate(r.date), blockTypeId: r.blockTypeId, orderName: r.order.name }));
}

// ---------------------------------------------------------------- writes

export interface SaveInput extends OrderDraft {
  version: number;
}

export async function ruleContext(channels: { channelId: string; templateId: string }[]): Promise<OrderRuleContext> {
  const templates = new Map<string, TemplateDay[]>();
  let dayFrames = 0;
  for (const c of channels) {
    const t = await db.template.findFirst({ where: { id: c.templateId, deletedAt: null, playlist: { channelId: c.channelId, kind: 'main' } }, include: { playlist: { include: { channel: true } } } });
    if (!t) throw new HttpError(422, 'The channel has no such main layout.', [{ code: 'template', message: 'The channel has no such main layout.' }]);
    templates.set(c.channelId, await templateDays(t.id));
    dayFrames = Math.max(dayFrames, framesPerDay(frameRate(t.playlist.channel.frameRate)));
  }
  return { templates, dayFrames };
}

function refuse(problems: { code: string; message: string }[]): never {
  throw new HttpError(422, problems.length === 1 ? problems[0].message : `${problems.length} problems: nothing was saved.`, problems);
}

/** Productions must be the company's own. */
async function checkProductions(ids: string[]) {
  const unique = [...new Set(ids)];
  const n = await db.production.count({ where: { id: { in: unique }, deletedAt: null } });
  if (n !== unique.length) refuse([{ code: 'items', message: 'Some items are not in the catalog.' }]);
}

async function writeAirings(tx: Tx, tenantId: string, orderId: string, airings: AiringDraft[]) {
  const firsts = airings.filter((a) => !a.repeatOfId);
  const repeats = airings.filter((a) => a.repeatOfId);
  const row = (a: AiringDraft) => ({
    id: a.id, tenantId, orderId, channelId: a.channelId, date: fromIsoDate(a.date), blockTypeId: a.blockTypeId, passes: a.passes,
    repeatOfId: a.repeatOfId, repeatIndex: a.repeatIndex, blockColor: a.blockColor,
  });
  for (let i = 0; i < firsts.length; i += 2000) await tx.airing.createMany({ data: firsts.slice(i, i + 2000).map(row) });
  for (let i = 0; i < repeats.length; i += 2000) await tx.airing.createMany({ data: repeats.slice(i, i + 2000).map(row) });
  const items = airings.flatMap((a) => a.items.map((x, position) => ({ id: uuidv7(), airingId: a.id, position, orderItemId: x.itemId, passes: x.passes, jingle: x.jingle })));
  for (let i = 0; i < items.length; i += 5000) await tx.airingItem.createMany({ data: items.slice(i, i + 5000) });
}

async function writeOrder(tx: Tx, orderId: string, d: OrderDraft) {
  const tenantId = currentTenantId();
  await tx.airingItem.deleteMany({ where: { airing: { orderId } } });
  await tx.airing.updateMany({ where: { orderId }, data: { repeatOfId: null } });
  await tx.airing.deleteMany({ where: { orderId } });
  await tx.orderItem.deleteMany({ where: { orderId } });
  await tx.orderChannel.deleteMany({ where: { orderId } });
  await tx.orderChannel.createMany({ data: d.channels.map((c, position) => ({ id: uuidv7(), orderId, channelId: c.channelId, templateId: c.templateId, position })) });
  if (d.items.length) await tx.orderItem.createMany({ data: d.items.map((i, position) => ({ id: i.id, orderId, position, productionId: i.productionId, lengthFrames: i.lengthFrames })) });
  await writeAirings(tx, tenantId, orderId, d.airings);
}

const orderFields = (d: OrderDraft) => ({
  name: d.name.trim(), mode: d.mode, status: d.status, startDate: fromIsoDate(d.startDate), endDate: fromIsoDate(d.endDate), color: d.color.toLowerCase(),
  firstItemId: d.firstItemId, reuseInLoop: d.reuseInLoop, maxAirings: d.maxAirings, totalAirings: d.totalAirings,
  timeWindows: d.timeWindows as unknown as Prisma.InputJsonValue,
});

async function checkDraft(d: OrderDraft) {
  if (!ORDER_MODES.includes(d.mode)) refuse([{ code: 'mode', message: 'Unknown mode.' }]);
  for (const c of d.channels) await loadChannel(c.channelId);
  const ctx = await ruleContext(d.channels);
  await checkProductions(d.items.map((i) => i.productionId));
  const problems = validateOrder(d, ctx);
  if (problems.length) refuse(problems);
}

export async function saveOrder(id: string, input: SaveInput): Promise<OrderFullDto> {
  await loadOrder(id);
  const { version, ...d } = input;
  await checkDraft(d);
  await db.$transaction(
    async (tx) => {
      const updated = await tx.order.updateMany({ where: { id, version, deletedAt: null }, data: { ...orderFields(d), version: { increment: 1 } } });
      if (updated.count !== 1) throw new HttpError(409, 'Someone else saved this plan since you opened it. Reload it to see their changes.');
      await writeOrder(tx, id, d);
    },
    { timeout: 120_000 },
  );
  return getOrderFull(id);
}

const COLORS = ['#0284c7', '#4f46e5', '#e11d48', '#d97706', '#059669', '#9333ea', '#0d9488', '#db2777', '#7c3aed', '#64748b'];

export interface CreateInput {
  name: string;
  mode: OrderMode;
  channelIds: string[];
  startDate: string;
  endDate: string;
  productionIds: string[];
  firstProductionId: string | null;
  reuseInLoop: boolean;
  maxAirings: number | null;
  totalAirings: number | null;
  timeWindows: TimeWindows;
}

/** A new order is a draft, born empty (create and place are separate steps); its template comes from each channel. */
export async function createOrder(input: CreateInput): Promise<OrderFullDto> {
  if (!input.channelIds.length) refuse([{ code: 'channel', message: 'A plan needs a channel.' }]);
  const channels: { channelId: string; templateId: string }[] = [];
  for (const channelId of input.channelIds) {
    const ch = await loadChannel(channelId);
    if (!ch.playlists.some((p) => p.kind === 'main')) refuse([{ code: 'channel', message: `${ch.name} has no main playlist.` }]);
    const t = await mainTemplateFor(channelId, input.startDate, input.endDate);
    if (!t) refuse([{ code: 'template', message: `${ch.name} has no main layout for these dates.` }]);
    channels.push({ channelId, templateId: t.id });
  }
  const prods = await db.production.findMany({ where: { id: { in: input.productionIds }, deletedAt: null } });
  const lengthOf = new Map(prods.map((p) => [p.id, p.lengthFrames]));
  const items = input.productionIds.map((productionId) => ({ id: uuidv7(), productionId, lengthFrames: lengthOf.get(productionId) ?? null }));
  const count = await db.order.count({ where: { channels: { some: { channelId: input.channelIds[0] } } } });
  const d: OrderDraft = {
    name: input.name, mode: input.mode, status: 'draft', startDate: input.startDate, endDate: input.endDate, color: COLORS[count % COLORS.length],
    firstItemId: input.firstProductionId ? items.find((i) => i.productionId === input.firstProductionId)?.id ?? null : null,
    reuseInLoop: input.reuseInLoop, maxAirings: input.maxAirings, totalAirings: input.totalAirings, timeWindows: input.timeWindows,
    channels, items, airings: [],
  };
  await checkDraft(d);
  const id = uuidv7();
  await db.$transaction(async (tx) => {
    await tx.order.create({ data: { id, ...orderFields(d) } as Prisma.OrderUncheckedCreateInput });
    await writeOrder(tx, id, d);
  });
  return getOrderFull(id);
}

export async function draftOf(id: string): Promise<{ d: OrderDraft; version: number }> {
  const full = await getOrderFull(id);
  const o = full.order;
  return {
    version: o.version,
    d: {
      name: o.name, mode: o.mode, status: o.status, startDate: o.startDate, endDate: o.endDate, color: o.color, firstItemId: o.firstItemId,
      reuseInLoop: o.reuseInLoop, maxAirings: o.maxAirings, totalAirings: o.totalAirings, timeWindows: o.timeWindows,
      channels: full.channels.map((c) => ({ channelId: c.channel.id, templateId: c.template.id })),
      items: full.items.map((i) => ({ id: i.id, productionId: i.productionId, lengthFrames: i.lengthFrames })),
      airings: full.airings,
    },
  };
}

/** A new order with a new name, the same settings, items and airings. It is a draft until confirmed. */
export async function duplicate(id: string, name: string): Promise<{ id: string }> {
  const { d } = await draftOf(id);
  const copy = { ...duplicateOrder(d, name), status: 'draft' as const };
  await checkDraft(copy);
  const newId = uuidv7();
  await db.$transaction(
    async (tx) => {
      await tx.order.create({ data: { id: newId, ...orderFields(copy) } as Prisma.OrderUncheckedCreateInput });
      await writeOrder(tx, newId, copy);
    },
    { timeout: 120_000 },
  );
  return { id: newId };
}

/** Ends the order the day before `date`; the rest continues in a new order (all-or-nothing). */
export async function split(id: string, input: { version: number; date: string; name: string }): Promise<{ id: string; moved: number; droppedRepeats: number }> {
  const { d, version } = await draftOf(id);
  if (version !== input.version) throw new HttpError(409, 'Someone else saved this plan since you opened it. Reload it to see their changes.');
  const s = splitOrder(d, input.date, input.name);
  if (!s.ok) refuse([{ code: 'split', message: s.reason! }]);
  await checkDraft(s.keep);
  await checkDraft(s.rest);
  const newId = uuidv7();
  await db.$transaction(
    async (tx) => {
      const updated = await tx.order.updateMany({ where: { id, version, deletedAt: null }, data: { ...orderFields(s.keep), version: { increment: 1 } } });
      if (updated.count !== 1) throw new HttpError(409, 'Someone else saved this plan since you opened it. Reload it to see their changes.');
      await writeOrder(tx, id, s.keep);
      await tx.order.create({ data: { id: newId, ...orderFields(s.rest) } as Prisma.OrderUncheckedCreateInput });
      await writeOrder(tx, newId, s.rest);
    },
    { timeout: 120_000 },
  );
  return { id: newId, moved: s.moved, droppedRepeats: s.droppedRepeats };
}

/** Orders airings can move to: same dates, channels and mode. */
export async function moveTargets(id: string): Promise<{ id: string; name: string; status: OrderStatus }[]> {
  const o = await loadOrder(id);
  const chans = o.channels.map((c) => c.channelId).sort().join(',');
  const rows = await db.order.findMany({ where: { deletedAt: null, id: { not: id }, mode: o.mode, startDate: o.startDate, endDate: o.endDate }, include: { channels: true }, orderBy: { name: 'asc' } });
  return rows.filter((r) => r.channels.map((c) => c.channelId).sort().join(',') === chans).map((r) => ({ id: r.id, name: r.name, status: r.status as OrderStatus }));
}

/**
 * Moves the airings of chosen items (with their repeats) into another order: the items join its
 * list, a block it already holds on that day is refused. All-or-nothing.
 */
export async function moveAirings(id: string, input: { version: number; itemIds: string[]; targetId: string; targetVersion: number }): Promise<{ moved: number }> {
  const src = await draftOf(id);
  const dst = await draftOf(input.targetId);
  if (src.version !== input.version || dst.version !== input.targetVersion) throw new HttpError(409, 'One of the plans was saved by someone else meanwhile. Reload and try again.');
  if (!(await moveTargets(id)).some((t) => t.id === input.targetId)) refuse([{ code: 'target', message: 'Airings can only move to a plan with the same dates, channels and mode.' }]);
  const chosen = new Set(input.itemIds);
  const movedFirst = src.d.airings.filter((a) => !a.repeatOfId && a.items.length && a.items.every((x) => chosen.has(x.itemId)));
  const movedIds = new Set(movedFirst.map((a) => a.id));
  for (const a of src.d.airings) if (a.repeatOfId && movedIds.has(a.repeatOfId)) movedIds.add(a.id);
  const moving = src.d.airings.filter((a) => movedIds.has(a.id));
  if (!moving.length) refuse([{ code: 'none', message: 'The chosen items have no airings of their own to move.' }]);
  const taken = new Set(dst.d.airings.map((a) => `${a.channelId}|${a.date}|${a.blockTypeId}`));
  const clash = moving.filter((a) => taken.has(`${a.channelId}|${a.date}|${a.blockTypeId}`));
  if (clash.length) refuse([{ code: 'clash', message: `${clash.length} of these blocks already hold an airing of the other plan (first: ${dayLabel(clash[0].date)}). Nothing was moved.` }]);
  const itemMap = new Map<string, string>();
  const newItems = [...dst.d.items];
  for (const i of src.d.items.filter((x) => chosen.has(x.id))) {
    const existing = newItems.find((x) => x.productionId === i.productionId);
    if (existing) itemMap.set(i.id, existing.id);
    else {
      const nid = uuidv7();
      itemMap.set(i.id, nid);
      newItems.push({ ...i, id: nid });
    }
  }
  const target: OrderDraft = { ...dst.d, items: newItems, airings: [...dst.d.airings, ...moving.map((a) => ({ ...a, items: a.items.map((x) => ({ ...x, itemId: itemMap.get(x.itemId)! })) }))] };
  const source: OrderDraft = { ...src.d, airings: src.d.airings.filter((a) => !movedIds.has(a.id)) };
  await checkDraft(target);
  await checkDraft(source);
  await db.$transaction(
    async (tx) => {
      for (const [oid, d, v] of [[id, source, src.version], [input.targetId, target, dst.version]] as const) {
        const u = await tx.order.updateMany({ where: { id: oid, version: v, deletedAt: null }, data: { ...orderFields(d), version: { increment: 1 } } });
        if (u.count !== 1) throw new HttpError(409, 'One of the plans was saved by someone else meanwhile. Reload and try again.');
      }
      // the moved airings keep their ids: take them out of the source before the target writes them
      await writeOrder(tx, id, source);
      await writeOrder(tx, input.targetId, target);
    },
    { timeout: 120_000 },
  );
  return { moved: moving.length };
}

/**
 * Undo of an AI change (decision 0025): puts plans back as they were and takes away the plans it made,
 * all or nothing, each only at the version the change left it at (else 409: newer work stays).
 */
export async function restoreOrders(rows: { id: string; version: number; draft: OrderDraft }[], remove: { id: string; version: number }[] = []): Promise<void> {
  for (const r of rows) await checkDraft(r.draft);
  const stale = () => new HttpError(409, 'The plan was changed after that change, so undo would overwrite newer work: nothing was changed.');
  await db.$transaction(
    async (tx) => {
      for (const r of remove) {
        const u = await tx.order.updateMany({ where: { id: r.id, version: r.version, deletedAt: null }, data: { deletedAt: new Date() } });
        if (u.count !== 1) throw stale();
      }
      for (const r of rows) {
        const u = await tx.order.updateMany({ where: { id: r.id, version: r.version, deletedAt: null }, data: { ...orderFields(r.draft), version: { increment: 1 } } });
        if (u.count !== 1) throw stale();
        await writeOrder(tx, r.id, r.draft);
      }
    },
    { timeout: 120_000 },
  );
}

export async function deleteOrder(id: string) {
  await loadOrder(id);
  await db.order.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function mainTemplateDto(channelId: string, from: string, to: string): Promise<CompactTemplate | null> {
  await loadChannel(channelId);
  const t = await mainTemplateFor(channelId, from, to);
  return t ? compactTemplate(t.id) : null;
}
