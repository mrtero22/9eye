// The tools of Ads (decision 0025, group 6.4): clients (list, create, change, delete), deals (create,
// change, delete) and campaigns (create one per channel, change name, dates and ads, delete). Booking
// spots and confirming a campaign were there before (writes.ts, changes.ts). Each previews first,
// applies at the version it showed, and undo_change puts it back (undoAds) while nobody changed it since.

import { z } from 'zod';
import type { AuditEvent } from '@prisma/client';
import { demand } from '../access';
import { db, fromIsoDate } from '../db';
import { HttpError } from '../errors';
import {
  CLIENT_TYPES, commercialOrderName, createClient, createContract, createContractOrders, deleteClient, deleteCommercialOrder, deleteContract, getContract, listClients,
  listContracts, updateClient, updateContract, type ClientDto, type ClientInput, type ContractDto, type ContractInput,
} from '../services/commercials';
import { getCommercialOrder, saveCommercialOrder, type CommercialOrderDto } from '../services/commercialOrders';
import { mainTemplateFor } from '../services/orders';
import type { Principal } from './auth';
import { APPLY, STATUS, UNDO_HINT, capped, findChannel, isUuid, isoDate, plural, quote, range, type DefineTool, type ToolResult } from './common';
import { mediaItems } from './plans';

const apply = z.boolean().default(false).describe(APPLY);
const version = z.number().int().optional().describe('With apply: the version the preview showed.');
const clientArg = z.string().trim().min(1).max(500).describe('The client: its id or name (list_clients shows them).');
const dealArg = z.string().trim().min(1).max(300).describe('The deal: its id or name (list_deals shows them).');
const campaignArg = z.string().trim().min(1).max(300).describe('The campaign: its id or name (get_deal lists them).');
const adArg = z.string().trim().min(1).max(300).describe('An ad of the campaign: "V2" (as get_campaign shows it), its id, code or title.');
const mediaArg = z.string().trim().min(1).max(300).describe('An ad in Media by id or code, or a title by id or name (all its items). search_media finds them.');
const channelsArg = z.array(z.string().min(1).max(200)).min(1).max(50).describe('Channels by name, code or id.');
const pv = (applying: boolean, what = 'nothing is saved') => (applying ? '' : ` — preview, ${what}`);

function checkVersion(applying: boolean, asked: number | undefined, now: number, what: string) {
  if (!applying) return;
  if (asked === undefined) throw new HttpError(400, 'Apply needs the version the preview showed.');
  if (asked !== now) throw new HttpError(409, `The ${what} changed since the preview (version ${asked}, now ${now}): preview it again.`);
}

const words = (v: unknown) => (v === null || v === undefined || v === '' ? 'none' : typeof v === 'string' ? quote(v) : String(v));

/** One line per field that changes ("- name: "A" → "B""), and the new values. */
function diff<T extends object>(was: T, next: T, labels: [keyof T, string][]): string[] {
  return labels.filter(([k]) => JSON.stringify(was[k]) !== JSON.stringify(next[k])).map(([k, label]) => `- ${label}: ${words(was[k])} → ${words(next[k])}`);
}

// ---------------------------------------------------------------- lookups

/** By id, exact name, else the one whose name has the words. */
function pick<T extends { id: string; name: string }>(rows: T[], ref: string, what: string, hint: string): T {
  const r = ref.trim();
  const k = r.toLowerCase();
  const exact = rows.filter((x) => x.id === r || x.name.toLowerCase() === k);
  const hit = exact.length ? exact : rows.filter((x) => x.name.toLowerCase().includes(k));
  if (hit.length === 1) return hit[0];
  if (hit.length > 1) throw new HttpError(400, `"${r}" fits ${hit.length} ${what}s: ${hit.slice(0, 10).map((x) => `${quote(x.name)} (id ${x.id})`).join(', ')}. Name one by its id.`);
  throw new HttpError(404, `No ${what} ${quote(r)}. ${hint}`);
}

const clientRef = async (ref: string) => pick(await listClients(), ref, 'client', 'list_clients shows the clients.');
const dealRef = async (ref: string) => getContract(pick(await listContracts(), ref, 'deal', 'list_deals finds deals by name or client.').id);

/** A campaign by id or name (a part of the name when only one fits), with the role checked on its channel. */
export async function campaignRef(p: Principal, ref: string, need: 'view' | 'edit'): Promise<CommercialOrderDto> {
  const r = ref.trim();
  let id = r;
  if (!isUuid(r)) {
    const rows = await db.order.findMany({ where: { deletedAt: null, mode: 'commercials' }, select: { id: true, name: true } });
    id = pick(rows, r, 'campaign', 'get_deal lists the campaigns of a deal.').id;
  }
  const o = await getCommercialOrder(id);
  demand(p.access, 'orders', need, o.channel.id);
  return o;
}

/** An ad of the campaign: "V2", its id, its Media item's id, code or title. */
function adOf(o: CommercialOrderDto, ref: string): CommercialOrderDto['items'][number] {
  const r = ref.trim();
  const k = r.toLowerCase();
  const v = /^v(\d{1,4})$/i.exec(r);
  if (v) {
    const x = o.items[Number(v[1]) - 1];
    if (!x) throw new HttpError(404, `The campaign has ${plural(o.items.length, 'ad')}: there is no ${r.toUpperCase()}.`);
    return x;
  }
  const hit = o.items.filter((x) => x.id === r || x.productionId === r || x.code.toLowerCase() === k || x.title.toLowerCase() === k);
  if (hit.length === 1) return hit[0];
  if (hit.length > 1) throw new HttpError(400, `"${r}" fits ${hit.length} ads of the campaign: name it as "V2".`);
  throw new HttpError(404, `No ad ${quote(r)} in the campaign: get_campaign lists its ads.`);
}

async function channelIdsOf(p: Principal, refs: string[]) {
  const out: { id: string; name: string }[] = [];
  for (const r of refs) {
    const c = await findChannel(p, r);
    if (!out.some((x) => x.id === c.id)) out.push({ id: c.id, name: c.name });
  }
  return out;
}

const channelNames = async (ids: string[]) => {
  const rows = await db.channel.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return ids.map((id) => rows.find((r) => r.id === id)?.name ?? 'a channel');
};

// ---------------------------------------------------------------- clients

const CLIENT_LABELS: [keyof ClientInput, string][] = [
  ['name', 'name'], ['type', 'type'], ['country', 'country'], ['address', 'address'], ['billingAddress', 'billing address'], ['web', 'web'], ['email', 'e-mail'],
  ['phone', 'phone'], ['fax', 'fax'], ['vatNumber', 'VAT number'], ['notes', 'notes'], ['toleranceSeconds', 'tolerance (seconds)'],
];
const clientInput = (c: ClientDto): ClientInput => ({
  name: c.name, type: c.type, country: c.country, address: c.address, billingAddress: c.billingAddress, web: c.web, email: c.email, phone: c.phone, fax: c.fax,
  vatNumber: c.vatNumber, notes: c.notes, toleranceSeconds: c.toleranceSeconds,
});
const clientFields = {
  type: z.enum(CLIENT_TYPES).optional().describe('advertiser, agency, or both.'),
  country: z.string().max(100).optional(),
  address: z.string().max(1000).optional(),
  billing_address: z.string().max(1000).optional(),
  web: z.string().max(300).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(100).optional(),
  fax: z.string().max(100).optional(),
  vat_number: z.string().max(100).optional(),
  notes: z.string().max(4000).optional(),
  tolerance_seconds: z.number().int().min(0).max(3600).nullable().optional().describe('How many seconds a spot may run over or under.'),
};
type ClientArgs = { [K in keyof typeof clientFields]?: z.infer<(typeof clientFields)[K]> } & { name?: string };
const withArgs = (c: ClientInput, a: ClientArgs): ClientInput => ({
  name: a.name ?? c.name, type: a.type ?? c.type, country: a.country ?? c.country, address: a.address ?? c.address, billingAddress: a.billing_address ?? c.billingAddress,
  web: a.web ?? c.web, email: a.email ?? c.email, phone: a.phone ?? c.phone, fax: a.fax ?? c.fax, vatNumber: a.vat_number ?? c.vatNumber, notes: a.notes ?? c.notes,
  toleranceSeconds: a.tolerance_seconds === undefined ? c.toleranceSeconds : a.tolerance_seconds,
});
const clientLine = (c: ClientDto) =>
  [
    `- ${quote(c.name)}`, c.type, c.country || null, c.email ? `e-mail ${c.email}` : null, c.phone ? `phone ${c.phone}` : null, c.web || null, c.vatNumber ? `VAT ${c.vatNumber}` : null,
    c.toleranceSeconds !== null ? `tolerance ${c.toleranceSeconds} s` : null, plural(c.contracts, 'deal'), `version ${c.version}`, `id ${c.id}`,
  ].filter(Boolean).join(' · ');

// ---------------------------------------------------------------- deals

const DEAL_LABELS: [keyof ContractInput, string][] = [
  ['clientId', 'client'], ['name', 'name'], ['startDate', 'first day'], ['endDate', 'last day'], ['currency', 'currency'], ['totalAgreed', 'deal value'], ['notes', 'notes'], ['channelIds', 'channels'],
];
const dealInput = (d: ContractDto): ContractInput => ({
  clientId: d.clientId, name: d.name, startDate: d.startDate, endDate: d.endDate, currency: d.currency, totalAgreed: d.totalAgreed, notes: d.notes, channelIds: d.channelIds,
});
async function dealWords(d: ContractInput): Promise<ContractInput> {
  const clients = await listClients();
  return { ...d, clientId: clients.find((c) => c.id === d.clientId)?.name ?? d.clientId, channelIds: await channelNames(d.channelIds) };
}

// ---------------------------------------------------------------- read

export function registerAdsRead(tool: DefineTool, p: Principal) {
  tool(
    'list_clients',
    'List clients',
    'The ad clients (advertisers and agencies): type, country, contacts, VAT number, tolerance, how many deals, version and id.',
    z.object({ query: z.string().max(200).optional().describe('Only clients whose name has these words.') }),
    async ({ query }) => {
      demand(p.access, 'orders', 'view');
      const low = query?.trim().toLowerCase();
      const rows = (await listClients()).filter((c) => !low || c.name.toLowerCase().includes(low));
      return [`Clients (${rows.length}):`, ...(rows.length ? capped(rows.map(clientLine), 'narrow it with query') : ['- none'])].join('\n');
    },
  );
}

// ---------------------------------------------------------------- writes

export function registerAdsTools(tool: DefineTool, p: Principal) {
  tool(
    'create_client',
    'Create a client',
    `Create an ad client (an advertiser, an agency, or both). Preview first. ${UNDO_HINT} (undo deletes it while it has no deals)`,
    z.object({ name: z.string().trim().min(1).max(500), ...clientFields, apply }),
    async (a, { changeId }) => {
      demand(p.access, 'orders', 'edit');
      const next = withArgs({ name: '', type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null }, a);
      const taken = (await listClients()).find((c) => c.name.toLowerCase() === next.name.trim().toLowerCase());
      const out = [`New client ${quote(next.name)}${pv(a.apply, 'nothing is made')}`, ...CLIENT_LABELS.filter(([k]) => k !== 'name' && next[k] !== '' && next[k] !== null).map(([k, l]) => `- ${l}: ${words(next[k])}`)];
      if (taken) {
        out.push(`There is a client ${quote(taken.name)} already: pick another name.`);
        if (a.apply) throw new HttpError(409, out.join('\n'));
        return out.join('\n');
      }
      if (!a.apply) {
        out.push('To make it: create_client with the same arguments and apply: true. Then create_deal makes a deal with it.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const made = await createClient(next);
      out[0] = `Client ${quote(next.name)} made (id ${made.id}). Change id ${changeId} — undo_change deletes it while it has no deals.`;
      return { text: out.join('\n'), change: { targetId: made.id, channelIds: [], before: null, after: { clientId: made.id, version: 1 } } };
    },
    'write',
  );

  tool(
    'edit_client',
    'Change a client',
    `Change an ad client's name, type, country, addresses, contacts, VAT number, notes or tolerance. Only what is given changes. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({ client: clientArg, name: z.string().trim().min(1).max(500).optional(), ...clientFields, apply, version }),
    async (a, { changeId }) => {
      demand(p.access, 'orders', 'edit');
      const c = await clientRef(a.client);
      checkVersion(a.apply, a.version, c.version, 'client');
      const was = clientInput(c);
      const next = withArgs(was, a);
      const lines = diff(was, next, CLIENT_LABELS);
      const head = `Client ${quote(c.name)} · version ${c.version}${pv(a.apply)}`;
      if (!lines.length) return `${head}\nNothing to change: the client is like that already.`;
      if (!a.apply) return { text: [head, ...lines, `To save it: edit_client with the same arguments, apply: true and version ${c.version}.`].join('\n'), applyWith: { apply: true, version: c.version } };
      await updateClient(c.id, { ...next, version: c.version });
      return {
        text: [`Client ${quote(next.name)} saved as version ${c.version + 1}. Change id ${changeId} — ${UNDO_HINT}`, ...lines].join('\n'),
        change: { targetId: c.id, channelIds: [], before: { clientId: c.id, fields: was }, after: { clientId: c.id, version: c.version + 1 } },
      };
    },
    'write',
  );

  tool(
    'delete_client',
    'Delete a client',
    `Delete an ad client that has no deals. Preview first; apply needs the version the preview showed. ${UNDO_HINT} (undo brings it back)`,
    z.object({ client: clientArg, apply, version }),
    async (a, { changeId }) => {
      demand(p.access, 'orders', 'edit');
      const c = await clientRef(a.client);
      checkVersion(a.apply, a.version, c.version, 'client');
      const head = `Delete client ${quote(c.name)}${pv(a.apply, 'nothing is deleted')}`;
      if (c.contracts) {
        const text = `${head}\nCannot: it has ${plural(c.contracts, 'deal')}; delete them first. Nothing was changed.`;
        if (a.apply) throw new HttpError(409, text);
        return text;
      }
      if (!a.apply) return { text: `${head}\nTo delete it: delete_client with apply: true and version ${c.version}.`, applyWith: { apply: true, version: c.version } };
      await deleteClient(c.id);
      return { text: `Client ${quote(c.name)} is deleted. Change id ${changeId} — undo_change brings it back.`, change: { targetId: c.id, channelIds: [], before: { clientId: c.id }, after: { clientId: c.id, deleted: true } } };
    },
    'write',
  );

  tool(
    'create_deal',
    'Create a deal',
    `Create a deal with an ad client: its dates, currency, value, notes and channels. Its campaigns come next (create_campaigns). Preview first. ${UNDO_HINT} (undo deletes it while it has no campaigns)`,
    z.object({
      client: clientArg,
      name: z.string().trim().min(1).max(300),
      from: isoDate.describe('The first day, YYYY-MM-DD.'),
      to: isoDate.describe('The last day, YYYY-MM-DD.'),
      currency: z.string().regex(/^[A-Za-z]{3}$/, 'a three-letter currency code').describe('A three-letter currency code, such as USD or EUR.'),
      value: z.number().min(0).max(1e13).default(0).describe('The deal value agreed, in its currency.'),
      notes: z.string().max(4000).default(''),
      channels: channelsArg,
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'orders', 'edit');
      const client = await clientRef(a.client);
      const channels = await channelIdsOf(p, a.channels);
      for (const c of channels) demand(p.access, 'orders', 'edit', c.id);
      const input: ContractInput = { clientId: client.id, name: a.name, startDate: a.from, endDate: a.to, currency: a.currency.toUpperCase(), totalAgreed: a.value, notes: a.notes, channelIds: channels.map((c) => c.id) };
      const out = [
        `New deal ${quote(a.name)} · client ${quote(client.name)} · ${range(a.from, a.to)} · deal value ${a.value.toLocaleString('en-US')} ${input.currency} · channels ${channels.map((c) => c.name).join(', ')}${pv(a.apply, 'nothing is made')}`,
        ...(a.notes ? [`Notes: ${a.notes}`] : []),
      ];
      const problems = [
        a.to < a.from ? 'The deal ends before it starts.' : null,
        (await listContracts()).some((d) => d.name.toLowerCase() === a.name.trim().toLowerCase()) ? `There is a deal called ${a.name} already: pick another name.` : null,
      ].filter((x): x is string => !!x);
      if (problems.length) {
        out.push(...problems.map((x) => `Cannot: ${x}`));
        if (a.apply) throw new HttpError(422, out.join('\n'));
        return out.join('\n');
      }
      if (!a.apply) {
        out.push('To make it: create_deal with the same arguments and apply: true. Then create_campaigns makes its campaigns.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const made = await createContract(input);
      out[0] = `Deal ${quote(a.name)} made with ${quote(client.name)} (id ${made.id}). Change id ${changeId} — undo_change deletes it while it has no campaigns.`;
      return { text: out.join('\n'), change: { targetId: made.id, channelIds: input.channelIds, before: null, after: { dealId: made.id, version: 1 } } };
    },
    'write',
  );

  tool(
    'edit_deal',
    'Change a deal',
    `Change a deal's client, name, dates, currency, value, notes or channels (a channel a campaign of the deal uses stays). Only what is given changes. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      deal: dealArg,
      client: clientArg.optional(),
      name: z.string().trim().min(1).max(300).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      currency: z.string().regex(/^[A-Za-z]{3}$/, 'a three-letter currency code').optional(),
      value: z.number().min(0).max(1e13).optional(),
      notes: z.string().max(4000).optional(),
      channels: channelsArg.optional().describe('The whole list of channels (replaces it).'),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'orders', 'edit');
      const d = await dealRef(a.deal);
      checkVersion(a.apply, a.version, d.version, 'deal');
      const was = dealInput(d);
      const channels = a.channels ? await channelIdsOf(p, a.channels) : null;
      for (const c of channels ?? []) demand(p.access, 'orders', 'edit', c.id);
      const next: ContractInput = {
        clientId: a.client ? (await clientRef(a.client)).id : was.clientId, name: a.name ?? was.name, startDate: a.from ?? was.startDate, endDate: a.to ?? was.endDate,
        currency: a.currency?.toUpperCase() ?? was.currency, totalAgreed: a.value ?? was.totalAgreed, notes: a.notes ?? was.notes, channelIds: channels ? channels.map((c) => c.id) : was.channelIds,
      };
      const head = `Deal ${quote(d.name)} · client ${quote(d.clientName)} · version ${d.version}${pv(a.apply)}`;
      const lines = diff(await dealWords(was), await dealWords(next), DEAL_LABELS);
      if (!lines.length) return `${head}\nNothing to change: the deal is like that already.`;
      const used = d.ordersList.filter((o) => !next.channelIds.includes(o.channelId));
      if (used.length) {
        const text = [head, ...lines, `Cannot: ${used.map((o) => `${o.channelName} is used by the campaign ${quote(o.name)}`).join('; ')}. Nothing was changed.`].join('\n');
        if (a.apply) throw new HttpError(409, text);
        return text;
      }
      const outside = d.ordersList.filter((o) => o.startDate < next.startDate || o.endDate > next.endDate);
      const note = outside.length ? [`Note: ${plural(outside.length, 'campaign')} would run outside the new dates (${outside.map((o) => quote(o.name)).join(', ')}): change their dates with edit_campaign.`] : [];
      if (!a.apply) return { text: [head, ...lines, ...note, `To save it: edit_deal with the same arguments, apply: true and version ${d.version}.`].join('\n'), applyWith: { apply: true, version: d.version } };
      await updateContract(d.id, { ...next, version: d.version });
      return {
        text: [`Deal ${quote(next.name)} saved as version ${d.version + 1}. Change id ${changeId} — ${UNDO_HINT}`, ...lines, ...note].join('\n'),
        change: { targetId: d.id, channelIds: [...new Set([...was.channelIds, ...next.channelIds])], before: { dealId: d.id, fields: was }, after: { dealId: d.id, version: d.version + 1 } },
      };
    },
    'write',
  );

  tool(
    'delete_deal',
    'Delete a deal',
    `Delete a deal that has no campaigns. Preview first; apply needs the version the preview showed. ${UNDO_HINT} (undo brings it back)`,
    z.object({ deal: dealArg, apply, version }),
    async (a, { changeId }) => {
      demand(p.access, 'orders', 'edit');
      const d = await dealRef(a.deal);
      checkVersion(a.apply, a.version, d.version, 'deal');
      const head = `Delete deal ${quote(d.name)} · client ${quote(d.clientName)} · ${range(d.startDate, d.endDate)}${pv(a.apply, 'nothing is deleted')}`;
      if (d.orders) {
        const text = `${head}\nCannot: it has ${plural(d.orders, 'campaign')}; delete them first (delete_campaign). Nothing was changed.`;
        if (a.apply) throw new HttpError(409, text);
        return text;
      }
      if (!a.apply) return { text: `${head}\nTo delete it: delete_deal with apply: true and version ${d.version}.`, applyWith: { apply: true, version: d.version } };
      await deleteContract(d.id);
      return { text: `Deal ${quote(d.name)} is deleted. Change id ${changeId} — undo_change brings it back.`, change: { targetId: d.id, channelIds: d.channelIds, before: { dealId: d.id }, after: { dealId: d.id, deleted: true } } };
    },
    'write',
  );

  // ---------------------------------------------------------------- campaigns

  tool(
    'create_campaigns',
    'Create campaigns',
    `Create a deal's campaigns: one draft per channel, on the channel's main layout, from a day to the deal's last day, optionally with the ads they may book. Then book_campaign_spots books them. Preview first. ${UNDO_HINT} (undo deletes them while nothing is booked)`,
    z.object({
      deal: dealArg,
      channels: channelsArg.optional().describe("Default: the deal's channels. A channel not in the deal joins it."),
      from: isoDate.optional().describe("The first day. Default: the deal's first day."),
      ads: z.array(mediaArg).max(200).default([]).describe('The ads they may book (V1, V2, … in this order).'),
      apply,
    }),
    async (a, { changeId }) => {
      demand(p.access, 'orders', 'edit');
      const d = await dealRef(a.deal);
      const channels = a.channels ? await channelIdsOf(p, a.channels) : (await channelNames(d.channelIds)).map((name, i) => ({ id: d.channelIds[i], name }));
      for (const c of channels) demand(p.access, 'orders', 'edit', c.id);
      const from = a.from ?? d.startDate;
      if (a.ads.length) demand(p.access, 'catalog', 'view');
      const ads = a.ads.length ? await mediaItems(a.ads) : [];
      const seen = new Set<string>();
      const unique = ads.filter((x) => !seen.has(x.id) && seen.add(x.id));
      const out = [
        `Deal ${quote(d.name)} of ${quote(d.clientName)} · ${plural(channels.length, 'new campaign')}, draft, ${range(from, d.endDate)}${pv(a.apply, 'nothing is made')}`,
        ...channels.map((c) => `- ${quote(commercialOrderName(c.name, d.name, from))} · ${c.name}${d.channelIds.includes(c.id) ? '' : ' (joins the deal)'}`),
        `Ads: ${unique.length ? capped(unique.map((x, i) => `V${i + 1} ${quote(x.title)}`), 'and more', 20).join(', ') : 'none yet (edit_campaign adds them)'}`,
      ];
      const problems: string[] = [];
      if (from < d.startDate || from > d.endDate) problems.push(`A campaign starts within the deal (${range(d.startDate, d.endDate)}).`);
      for (const c of channels) if (!(await mainTemplateFor(c.id, from, d.endDate))) problems.push(`${c.name} has no main layout for ${range(from, d.endDate)}.`);
      if (problems.length) {
        out.push(...problems.map((x) => `Cannot: ${x}`));
        if (a.apply) throw new HttpError(422, out.join('\n'));
        return out.join('\n');
      }
      if (!a.apply) {
        out.push('To make them: create_campaigns with the same arguments and apply: true.');
        return { text: out.join('\n'), applyWith: { apply: true } };
      }
      const added = channels.filter((c) => !d.channelIds.includes(c.id)).map((c) => c.id);
      const made = await createContractOrders(d.id, { channelIds: channels.map((c) => c.id), startDate: from });
      const versions: Record<string, number> = {};
      for (const id of made.ids) {
        versions[id] = 1;
        if (!unique.length) continue;
        const o = await getCommercialOrder(id);
        versions[id] = (await saveCommercialOrder(id, { version: o.version, name: o.name, status: 'draft', startDate: o.startDate, endDate: o.endDate, items: unique.map((x) => ({ id: null, productionId: x.id })) })).version;
      }
      out[0] = `Deal ${quote(d.name)} · ${plural(made.ids.length, 'campaign')} made (draft; ids ${made.ids.join(', ')}). Change id ${changeId} — undo_change deletes them while nothing is booked.`;
      return { text: out.join('\n'), change: { targetId: d.id, channelIds: channels.map((c) => c.id), before: null, after: { dealId: d.id, versions, addedChannelIds: added } } };
    },
    'write',
  );

  tool(
    'edit_campaign',
    'Change a campaign',
    `Change a campaign's name or dates (within its deal, holding every booking), add ads it may book, or take out ads that are not booked. Only what is given changes. Preview first; apply saves at the version the preview showed. ${UNDO_HINT}`,
    z.object({
      campaign: campaignArg,
      name: z.string().trim().min(1).max(300).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      add_ads: z.array(mediaArg).max(200).optional().describe('Ads to add at the end of its list.'),
      remove_ads: z.array(adArg).max(200).optional().describe('Ads to take out (only ones not booked).'),
      apply,
      version,
    }),
    async (a, { changeId }) => {
      const o = await campaignRef(p, a.campaign, 'edit');
      checkVersion(a.apply, a.version, o.version, 'campaign');
      const head = [`Campaign ${quote(o.name)} · ${o.channel.name} · ${STATUS[o.status] ?? o.status} · version ${o.version}${pv(a.apply)}`];
      const lines: string[] = [];
      const problems: string[] = [];
      const name = a.name ?? o.name;
      const from = a.from ?? o.startDate;
      const to = a.to ?? o.endDate;
      if (name !== o.name) lines.push(`- name: ${quote(o.name)} → ${quote(name)}`);
      if (from !== o.startDate || to !== o.endDate) {
        lines.push(`- dates: ${range(o.startDate, o.endDate)} → ${range(from, to)}`);
        if (to < from) problems.push('The campaign ends before it starts.');
        if (from < o.contract.startDate || to > o.contract.endDate) problems.push(`A campaign stays within its deal (${range(o.contract.startDate, o.contract.endDate)}).`);
        const outside = await db.airing.count({ where: { orderId: o.id, OR: [{ date: { lt: fromIsoDate(from) } }, { date: { gt: fromIsoDate(to) } }] } });
        if (outside) problems.push(`${plural(outside, 'block')} with booked spots fall outside ${range(from, to)}: take those spots out first (remove_campaign_spots).`);
      }
      let items = o.items.map((x) => ({ id: x.id as string | null, productionId: x.productionId }));
      if (a.remove_ads?.length) {
        const gone = [...new Set(a.remove_ads.map((r) => adOf(o, r)))];
        for (const g of gone.filter((x) => x.booked)) problems.push(`${quote(g.title)} is booked ${plural(g.booked, 'time')}: take those spots out first (remove_campaign_spots).`);
        items = items.filter((x) => !gone.some((g) => g.id === x.id));
        lines.push(`- ads taken out: ${gone.map((g) => quote(g.title)).join(', ')}`);
      }
      if (a.add_ads?.length) {
        demand(p.access, 'catalog', 'view');
        const found = (await mediaItems(a.add_ads)).filter((m) => !items.some((x) => x.productionId === m.id));
        const seen = new Set<string>();
        const fresh = found.filter((m) => !seen.has(m.id) && seen.add(m.id));
        items = [...items, ...fresh.map((m) => ({ id: null, productionId: m.id }))];
        if (fresh.length) lines.push(`- ads added: ${fresh.map((m) => `V${items.findIndex((x) => x.productionId === m.id) + 1} ${quote(m.title)}`).join(', ')}`);
      }
      if (!lines.length) return [...head, 'Nothing to change: the campaign is like that already.'].join('\n');
      if (problems.length) {
        const text = [...head, ...lines, ...problems.map((x) => `Cannot: ${x}`), 'Nothing was changed.'].join('\n');
        if (a.apply) throw new HttpError(422, text);
        return text;
      }
      if (!a.apply) return { text: [...head, ...lines, `To save it: edit_campaign with the same arguments, apply: true and version ${o.version}.`].join('\n'), applyWith: { apply: true, version: o.version } };
      const r = await saveCommercialOrder(o.id, { version: o.version, name, status: o.status, startDate: from, endDate: to, items });
      return {
        text: [`Campaign ${quote(name)} saved as version ${r.version}. Change id ${changeId} — ${UNDO_HINT}`, ...lines].join('\n'),
        change: {
          targetId: o.id, channelIds: [o.channel.id],
          before: { campaignId: o.id, name: o.name, status: o.status, startDate: o.startDate, endDate: o.endDate, items: o.items.map((x) => ({ id: x.id, productionId: x.productionId })) },
          after: { campaignId: o.id, version: r.version },
        },
      };
    },
    'write',
  );

  tool(
    'delete_campaign',
    'Delete a campaign',
    `Delete a campaign that has no booked spots. Preview first; apply needs the version the preview showed. ${UNDO_HINT} (undo brings it back)`,
    z.object({ campaign: campaignArg, apply, version }),
    async (a, { changeId }) => {
      const o = await campaignRef(p, a.campaign, 'edit');
      checkVersion(a.apply, a.version, o.version, 'campaign');
      const head = `Delete campaign ${quote(o.name)} · ${o.channel.name} · ${STATUS[o.status] ?? o.status} · ${range(o.startDate, o.endDate)} · ${plural(o.items.length, 'ad')}${pv(a.apply, 'nothing is deleted')}`;
      if (o.booked) {
        const text = `${head}\nCannot: it has ${plural(o.booked, 'booked spot')}; take them out first (remove_campaign_spots). Nothing was changed.`;
        if (a.apply) throw new HttpError(409, text);
        return text;
      }
      if (!a.apply) return { text: `${head}\nTo delete it: delete_campaign with apply: true and version ${o.version}.`, applyWith: { apply: true, version: o.version } };
      await deleteCommercialOrder(o.id);
      return { text: `Campaign ${quote(o.name)} is deleted. Change id ${changeId} — undo_change brings it back.`, change: { targetId: o.id, channelIds: [o.channel.id], before: { campaignId: o.id }, after: { campaignId: o.id, deleted: true } } };
    },
    'write',
  );
}

// ---------------------------------------------------------------- undo

const stale = (change: string, what: string) => new HttpError(409, `The ${what} changed after change ${change}, so undo would overwrite newer work: nothing was changed.`);

/** Puts back what a change of these tools made; null for a tool that is not one of them. */
export async function undoAds(e: AuditEvent, change: string): Promise<ToolResult | null> {
  const after = (e.after ?? {}) as Record<string, unknown>;
  const before = (e.before ?? {}) as Record<string, unknown>;
  const done = (text: string, b: object | null, a: object): ToolResult => ({ text, change: { targetId: change, channelIds: e.channelIds, before: b, after: a } });
  switch (e.action) {
    case 'tool create_client': {
      const c = (await listClients()).find((x) => x.id === after.clientId);
      if (c && after.version !== undefined && c.version !== after.version) throw stale(change, 'client');
      await deleteClient(after.clientId as string);
      return done(`The client made by change ${change} is deleted.`, { clientId: after.clientId }, { deleted: true });
    }
    case 'tool edit_client': {
      const id = after.clientId as string;
      const c = (await listClients()).find((x) => x.id === id);
      if (!c || c.version !== after.version) throw stale(change, 'client');
      await updateClient(id, { ...(before.fields as ClientInput), version: c.version });
      return done(`The client is back as it was before change ${change}.`, { clientId: id, version: c.version }, { clientId: id, version: c.version + 1 });
    }
    case 'tool delete_client': {
      const id = before.clientId as string;
      const row = await db.client.findFirst({ where: { id } });
      if (row && (await db.client.count({ where: { deletedAt: null, id: { not: id }, name: { equals: row.name, mode: 'insensitive' } } }))) {
        throw new HttpError(409, `A client called ${row.name} was made since change ${change}: nothing was changed.`);
      }
      await db.client.updateMany({ where: { id }, data: { deletedAt: null } });
      return done(`The client deleted by change ${change} is back.`, null, { clientId: id });
    }
    case 'tool create_deal': {
      const d = await getContract(after.dealId as string);
      if (after.version !== undefined && d.version !== after.version) throw stale(change, 'deal');
      await deleteContract(d.id);
      return done(`The deal made by change ${change} is deleted.`, { dealId: after.dealId }, { deleted: true });
    }
    case 'tool edit_deal': {
      const id = after.dealId as string;
      const d = await getContract(id);
      if (d.version !== after.version) throw stale(change, 'deal');
      await updateContract(id, { ...(before.fields as ContractInput), version: d.version });
      return done(`The deal is back as it was before change ${change}.`, { dealId: id, version: d.version }, { dealId: id, version: d.version + 1 });
    }
    case 'tool delete_deal': {
      const id = before.dealId as string;
      const row = await db.contract.findFirst({ where: { id } });
      if (row && (await db.contract.count({ where: { deletedAt: null, id: { not: id }, name: { equals: row.name, mode: 'insensitive' } } }))) {
        throw new HttpError(409, `A deal called ${row.name} was made since change ${change}: nothing was changed.`);
      }
      await db.contract.updateMany({ where: { id }, data: { deletedAt: null } });
      return done(`The deal deleted by change ${change} is back.`, null, { dealId: id });
    }
    case 'tool create_campaigns': {
      const versions = after.versions as Record<string, number>;
      const ids = Object.keys(versions);
      const rows = await db.order.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, version: true } });
      if (rows.length !== ids.length || rows.some((r) => r.version !== versions[r.id])) throw stale(change, 'campaigns');
      if (await db.airingItem.count({ where: { airing: { orderId: { in: ids } } } })) throw new HttpError(409, `Spots were booked in the campaigns of change ${change}: they stay. Nothing was changed.`);
      const added = (after.addedChannelIds as string[]) ?? [];
      const dealId = after.dealId as string;
      await db.$transaction(async (tx) => {
        await tx.order.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
        for (const channelId of added) {
          const other = await tx.order.count({ where: { contractId: dealId, deletedAt: null, channels: { some: { channelId } } } });
          if (!other) await tx.contractChannel.deleteMany({ where: { contractId: dealId, channelId } });
        }
      });
      return done(`The ${plural(ids.length, 'campaign')} made by change ${change} ${ids.length === 1 ? 'is' : 'are'} deleted.`, { campaignIds: ids }, { deleted: true });
    }
    case 'tool edit_campaign': {
      const id = after.campaignId as string;
      const o = await getCommercialOrder(id);
      if (o.version !== after.version) throw stale(change, 'campaign');
      const items = (before.items as { id: string; productionId: string }[]).map((x) => ({ id: o.items.some((y) => y.id === x.id) ? x.id : null, productionId: x.productionId }));
      const r = await saveCommercialOrder(id, {
        version: o.version, name: before.name as string, status: before.status as 'confirmed' | 'draft', startDate: before.startDate as string, endDate: before.endDate as string, items,
      });
      return done(`Campaign ${quote(before.name as string)} is back as it was before change ${change} (version ${r.version}).`, { campaignId: id, version: o.version }, { campaignId: id, version: r.version });
    }
    case 'tool delete_campaign': {
      const id = before.campaignId as string;
      await db.order.updateMany({ where: { id, mode: 'commercials' }, data: { deletedAt: null } });
      return done(`The campaign deleted by change ${change} is back.`, null, { campaignId: id });
    }
    default:
      return null;
  }
}
