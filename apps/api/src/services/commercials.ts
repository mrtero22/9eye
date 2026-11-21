// Commercials, part A (design/orders-page.md): clients
// (advertisers / agencies), their contracts (one campaign: channels, dates, currency) and the
// contract's commercial orders, one per channel, made on the channel's main template.

import { uuidv7 } from '@9eye/core';
import type { Prisma } from '@prisma/client';
import { db, fromIsoDate, toIsoDate } from '../db';
import { HttpError, notFound } from '../errors';
import { mainTemplateFor } from './orders';

export const CLIENT_TYPES = ['advertiser', 'agency', 'both'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];
const ORDER_COLORS = ['#0284c7', '#4f46e5', '#e11d48', '#d97706', '#059669', '#9333ea', '#0d9488', '#db2777', '#7c3aed', '#64748b'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const refuse = (status: number, problems: { code: string; message: string }[]): never => {
  throw new HttpError(status, problems.length === 1 ? problems[0].message : 'Some fields are not valid.', problems);
};

// ---------------------------------------------------------------- clients

export interface ClientInput {
  name: string;
  type: ClientType;
  country: string;
  address: string;
  billingAddress: string;
  web: string;
  email: string;
  phone: string;
  fax: string;
  vatNumber: string;
  notes: string;
  toleranceSeconds: number | null;
}
export interface ClientDto extends ClientInput {
  id: string;
  contracts: number;
  version: number;
}

export async function listClients(): Promise<ClientDto[]> {
  const rows = await db.client.findMany({
    where: { deletedAt: null },
    include: { _count: { select: { contracts: { where: { deletedAt: null } } } } },
    orderBy: { name: 'asc' },
  });
  return rows.map((c) => ({
    id: c.id, name: c.name, type: c.type as ClientType, country: c.country, address: c.address, billingAddress: c.billingAddress, web: c.web, email: c.email,
    phone: c.phone, fax: c.fax, vatNumber: c.vatNumber, notes: c.notes, toleranceSeconds: c.toleranceSeconds, contracts: c._count.contracts, version: c.version,
  }));
}

function cleanClient(input: ClientInput): ClientInput {
  const t = (s: string) => s.trim();
  const c = {
    ...input, name: t(input.name), country: t(input.country), address: input.address.trim(), billingAddress: input.billingAddress.trim(), web: t(input.web),
    email: t(input.email), phone: t(input.phone), fax: t(input.fax), vatNumber: t(input.vatNumber), notes: input.notes.trim(),
  };
  if (!c.name) refuse(422, [{ code: 'name', message: 'A client needs a name.' }]);
  if (c.email && !/^[^@\s]+@[^@\s]+$/.test(c.email)) refuse(422, [{ code: 'email', message: 'The e-mail address is not valid.' }]);
  return c;
}

async function nameTaken(model: 'client' | 'contract', name: string, except?: string) {
  const where = { deletedAt: null, name: { equals: name, mode: 'insensitive' as const }, ...(except ? { id: { not: except } } : {}) };
  return model === 'client' ? (await db.client.count({ where })) > 0 : (await db.contract.count({ where })) > 0;
}

export async function createClient(input: ClientInput): Promise<{ id: string }> {
  const c = cleanClient(input);
  if (await nameTaken('client', c.name)) refuse(422, [{ code: 'name', message: `There is a client called ${c.name} already.` }]);
  const id = uuidv7();
  await db.client.create({ data: { id, ...c } as Prisma.ClientUncheckedCreateInput });
  return { id };
}

export async function updateClient(id: string, input: ClientInput & { version: number }) {
  const { version, ...rest } = input;
  const c = cleanClient(rest);
  if (await nameTaken('client', c.name, id)) refuse(422, [{ code: 'name', message: `There is a client called ${c.name} already.` }]);
  const r = await db.client.updateMany({ where: { id, deletedAt: null, version }, data: { ...c, version: { increment: 1 } } });
  if (r.count !== 1) {
    if (!(await db.client.findFirst({ where: { id, deletedAt: null } }))) throw notFound('Client');
    throw new HttpError(409, 'Someone else changed this client since you opened it. Reload to see their changes.');
  }
}

export async function deleteClient(id: string) {
  const c = await db.client.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { contracts: { where: { deletedAt: null } } } } } });
  if (!c) throw notFound('Client');
  if (c._count.contracts) refuse(409, [{ code: 'in-use', message: `${c.name} has ${c._count.contracts === 1 ? 'a deal' : `${c._count.contracts} deals`}. Delete them first.` }]);
  await db.client.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ---------------------------------------------------------------- contracts

export interface ContractInput {
  clientId: string;
  name: string;
  startDate: string;
  endDate: string;
  currency: string;
  totalAgreed: number;
  notes: string;
  channelIds: string[];
}
export interface ContractListDto {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  startDate: string;
  endDate: string;
  currency: string;
  channelIds: string[];
  orders: number;
  spotsBooked: number;
}
export interface ContractOrderDto {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  startDate: string;
  endDate: string;
  status: string;
  spots: number;
  spotsBooked: number;
}
export interface ContractDto extends ContractListDto {
  totalAgreed: number;
  notes: string;
  version: number;
  ordersList: ContractOrderDto[];
}

/**
 * Booked spots per order (airing items of its airings). One query bound only by the order ids:
 * a company's orders can have far more airings than Postgres takes as bind variables (32 767).
 */
async function bookedPerOrder(orderIds: string[]): Promise<Map<string, number>> {
  if (!orderIds.length) return new Map();
  const airings = await db.airing.findMany({ where: { orderId: { in: orderIds } }, select: { orderId: true, _count: { select: { items: true } } } });
  const out = new Map<string, number>();
  for (const a of airings) if (a._count.items) out.set(a.orderId, (out.get(a.orderId) ?? 0) + a._count.items);
  return out;
}

export async function listContracts(): Promise<ContractListDto[]> {
  const rows = await db.contract.findMany({
    where: { deletedAt: null },
    include: { client: true, channels: true, orders: { where: { deletedAt: null }, select: { id: true } } },
    orderBy: [{ startDate: 'desc' }, { name: 'asc' }],
  });
  const booked = await bookedPerOrder(rows.flatMap((c) => c.orders.map((o) => o.id)));
  return rows.map((c) => ({
    id: c.id, name: c.name, clientId: c.clientId, clientName: c.client.name, startDate: toIsoDate(c.startDate), endDate: toIsoDate(c.endDate), currency: c.currency,
    channelIds: c.channels.map((x) => x.channelId), orders: c.orders.length, spotsBooked: c.orders.reduce((n, o) => n + (booked.get(o.id) ?? 0), 0),
  }));
}

export async function getContract(id: string): Promise<ContractDto> {
  const c = await db.contract.findFirst({
    where: { id, deletedAt: null },
    include: {
      client: true,
      channels: true,
      orders: { where: { deletedAt: null }, include: { channels: { include: { channel: true } }, _count: { select: { items: true } } }, orderBy: { name: 'asc' } },
    },
  });
  if (!c) throw notFound('Deal');
  const booked = await bookedPerOrder(c.orders.map((o) => o.id));
  const ordersList = c.orders.map((o) => {
    const ch = o.channels[0]?.channel;
    return {
      id: o.id, name: o.name, channelId: ch?.id ?? '', channelName: ch?.name ?? '', startDate: toIsoDate(o.startDate), endDate: toIsoDate(o.endDate), status: o.status,
      spots: o._count.items, spotsBooked: booked.get(o.id) ?? 0,
    };
  });
  return {
    id: c.id, name: c.name, clientId: c.clientId, clientName: c.client.name, startDate: toIsoDate(c.startDate), endDate: toIsoDate(c.endDate), currency: c.currency,
    channelIds: c.channels.map((x) => x.channelId), orders: ordersList.length, spotsBooked: ordersList.reduce((n, o) => n + o.spotsBooked, 0),
    totalAgreed: c.totalAgreed.toNumber(), notes: c.notes, version: c.version, ordersList,
  };
}

async function checkContract(input: ContractInput, id?: string) {
  const problems: { code: string; message: string }[] = [];
  const name = input.name.trim();
  if (!name) problems.push({ code: 'name', message: 'A deal needs a name.' });
  if (input.endDate < input.startDate) problems.push({ code: 'dates', message: 'The deal ends before it starts.' });
  if (!(await db.client.findFirst({ where: { id: input.clientId, deletedAt: null } }))) problems.push({ code: 'client', message: 'Choose a client of this company.' });
  const channelIds = [...new Set(input.channelIds)];
  if (!channelIds.length) problems.push({ code: 'channels', message: 'Choose at least one channel.' });
  else if ((await db.channel.count({ where: { id: { in: channelIds }, deletedAt: null } })) !== channelIds.length) problems.push({ code: 'channels', message: 'Some channels do not belong to this company.' });
  if (!/^[A-Z]{3}$/.test(input.currency)) problems.push({ code: 'currency', message: 'Use a three-letter currency code, such as USD.' });
  if (name && (await nameTaken('contract', name, id))) problems.push({ code: 'name', message: `There is a deal called ${name} already.` });
  if (problems.length) refuse(422, problems);
  return { name, channelIds };
}

export async function createContract(input: ContractInput): Promise<{ id: string }> {
  const { name, channelIds } = await checkContract(input);
  const id = uuidv7();
  await db.contract.create({
    data: {
      id, clientId: input.clientId, name, startDate: fromIsoDate(input.startDate), endDate: fromIsoDate(input.endDate), currency: input.currency,
      totalAgreed: input.totalAgreed, notes: input.notes.trim(), channels: { create: channelIds.map((channelId) => ({ channelId })) },
    } as Prisma.ContractUncheckedCreateInput,
  });
  return { id };
}

export async function updateContract(id: string, input: ContractInput & { version: number }) {
  const cur = await db.contract.findFirst({ where: { id, deletedAt: null }, include: { orders: { where: { deletedAt: null }, include: { channels: { include: { channel: true } } } } } });
  if (!cur) throw notFound('Deal');
  const { name, channelIds } = await checkContract(input, id);
  // a channel that an order of the contract uses cannot leave it (refused with the list)
  const used = cur.orders.flatMap((o) => o.channels.filter((c) => !channelIds.includes(c.channelId)).map((c) => ({ order: o.name, channel: c.channel.name })));
  if (used.length) refuse(409, used.map((u) => ({ code: 'channel-in-use', message: `${u.channel} is used by the campaign ${u.order}.` })));
  await db.$transaction(async (tx) => {
    const r = await tx.contract.updateMany({
      where: { id, version: input.version },
      data: { clientId: input.clientId, name, startDate: fromIsoDate(input.startDate), endDate: fromIsoDate(input.endDate), currency: input.currency, totalAgreed: input.totalAgreed, notes: input.notes.trim(), version: { increment: 1 } },
    });
    if (r.count !== 1) throw new HttpError(409, 'Someone else changed this deal since you opened it. Reload to see their changes.');
    await tx.contractChannel.deleteMany({ where: { contractId: id, channelId: { notIn: channelIds } } });
    await tx.contractChannel.createMany({ data: channelIds.map((channelId) => ({ contractId: id, channelId })), skipDuplicates: true });
  });
}

export async function deleteContract(id: string) {
  const c = await db.contract.findFirst({ where: { id, deletedAt: null }, include: { orders: { where: { deletedAt: null }, select: { id: true } } } });
  if (!c) throw notFound('Deal');
  if (c.orders.length) refuse(409, [{ code: 'in-use', message: `${c.name} has ${c.orders.length === 1 ? 'a campaign' : `${c.orders.length} campaigns`}. Delete them first.` }]);
  await db.contract.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ---------------------------------------------------------------- the contract's orders

/** "AURORA SD - NOVAMART - START 23 OCT 2026", as Aurora Media names them. */
export function commercialOrderName(channel: string, contract: string, start: string) {
  const [y, m, d] = start.split('-');
  return `${channel} - ${contract} - START ${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * One commercial order per channel, on the channel's main template, from `startDate` to the
 * contract's end. A channel not yet in the contract is added to it. All-or-nothing.
 */
export async function createContractOrders(contractId: string, input: { channelIds: string[]; startDate: string }): Promise<{ ids: string[] }> {
  const c = await db.contract.findFirst({ where: { id: contractId, deletedAt: null }, include: { channels: true } });
  if (!c) throw notFound('Deal');
  const start = input.startDate;
  const end = toIsoDate(c.endDate);
  const problems: { code: string; message: string }[] = [];
  if (start < toIsoDate(c.startDate) || start > end) problems.push({ code: 'start', message: 'The campaign must start within the deal’s dates.' });
  const channelIds = [...new Set(input.channelIds)];
  if (!channelIds.length) problems.push({ code: 'channels', message: 'Choose at least one channel.' });
  const channels = await db.channel.findMany({ where: { id: { in: channelIds }, deletedAt: null } });
  if (channels.length !== channelIds.length) problems.push({ code: 'channels', message: 'Some channels do not belong to this company.' });
  const plans: { channelId: string; name: string; templateId: string }[] = [];
  for (const ch of channels) {
    const tpl = await mainTemplateFor(ch.id, start, end);
    if (!tpl) problems.push({ code: 'template', message: `${ch.name} has no main layout between ${start} and ${end}.` });
    else plans.push({ channelId: ch.id, name: commercialOrderName(ch.name, c.name, start), templateId: tpl.id });
  }
  if (problems.length) refuse(422, problems);
  const count = await db.order.count();
  const ids: string[] = [];
  await db.$transaction(async (tx) => {
    const inContract = new Set(c.channels.map((x) => x.channelId));
    const added = channelIds.filter((x) => !inContract.has(x));
    if (added.length) await tx.contractChannel.createMany({ data: added.map((channelId) => ({ contractId, channelId })) });
    for (const [i, p] of plans.entries()) {
      const id = uuidv7();
      ids.push(id);
      await tx.order.create({
        data: {
          id, name: p.name, mode: 'commercials', contractId, status: 'draft', startDate: fromIsoDate(start), endDate: c.endDate,
          color: ORDER_COLORS[(count + i) % ORDER_COLORS.length], channels: { create: [{ id: uuidv7(), channelId: p.channelId, templateId: p.templateId, position: 0 }] },
        } as Prisma.OrderUncheckedCreateInput,
      });
    }
  });
  return { ids };
}

/** Removes a commercial order that has no booked spots yet. */
export async function deleteCommercialOrder(id: string) {
  const o = await db.order.findFirst({ where: { id, deletedAt: null, mode: 'commercials' } });
  if (!o) throw notFound('Campaign');
  const booked = (await bookedPerOrder([id])).get(id) ?? 0;
  if (booked) refuse(409, [{ code: 'in-use', message: `${o.name} has ${booked} booked spots. Remove them first.` }]);
  await db.order.update({ where: { id }, data: { deletedAt: new Date() } });
}
