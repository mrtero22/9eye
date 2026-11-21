// The tools of Ads (decision 0025, group 6.4; src/mcp/ads.ts): list_clients; create, change and delete
// a client and a deal; create_campaigns, edit_campaign, delete_campaign — preview, apply at the
// version, and undo_change; and the Drafts preset, which no longer makes or deletes in Ads.

import { uuidv7 } from '@9eye/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { preset } from '../src/aiPolicy';
import { platformDb } from '../src/db';
import type { Principal } from '../src/mcp/auth';
import { invokeTool, toolDefs } from '../src/mcp/tools';
import { fillMainTemplate, makeCatalog, makeCompany, makeEmptyChannel, resetDb, type Fixture } from './fixtures';

let a: Fixture;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  await fillMainTemplate(a);
  await makeCatalog(a);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

async function principal(): Promise<Principal> {
  const tenant = await platformDb.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
  return { user: { id: null, name: 'Tester' }, tenant, tokenId: null, via: 'agent', access: { all: true, grants: new Set(), channelIds: null }, canWrite: true };
}
async function call(name: string, args: Record<string, unknown>) {
  const p = await principal();
  const def = toolDefs(p).find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return invokeTool(p, def, def.input.parse(args));
}
/** Applies what the preview showed (its applyWith). */
async function applied(name: string, args: Record<string, unknown>) {
  const preview = await call(name, args);
  expect(preview.isError, preview.text).toBe(false);
  expect(preview.applyWith, preview.text).toBeTruthy();
  const done = await call(name, { ...args, ...preview.applyWith });
  expect(done.isError, done.text).toBe(false);
  return { preview, done };
}
const changeOf = (text: string) => /Change id ([0-9a-f-]{36})/.exec(text)?.[1] ?? '';
const undo = async (text: string) => {
  const r = await call('undo_change', { change: changeOf(text) });
  expect(r.isError, r.text).toBe(false);
  return r;
};

const clients = () => platformDb.client.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, orderBy: { name: 'asc' } });
const client = async (name: string) => (await clients()).find((c) => c.name === name)!;
const deals = () => platformDb.contract.findMany({ where: { tenantId: a.tenantId, deletedAt: null } });
const campaigns = () => platformDb.order.findMany({ where: { tenantId: a.tenantId, mode: 'commercials', deletedAt: null } });
const campaign = async (name: string) => (await campaigns()).find((o) => o.name === name)!;
const adsOf = async (name: string) =>
  (await platformDb.orderItem.findMany({ where: { orderId: (await campaign(name)).id }, include: { production: true }, orderBy: { position: 'asc' } })).map((i) => i.production.title);

const DEAL = { client: 'Novamart', name: 'NOVAMART JUNE', from: '2030-06-01', to: '2030-06-30', currency: 'eur', value: 12000, channels: ['AURORA'] };
const CAMPAIGN = 'AURORA TV - NOVAMART JUNE - START 08 JUN 2030';

describe('ads', () => {
  it('clients: create, list, change at the version, a taken name refused, delete — each undone', async () => {
    const made = await applied('create_client', { name: 'Novamart', type: 'agency', country: 'Iran', email: 'ads@novamart.example' });
    expect(made.preview.text).toContain('New client "Novamart" — preview, nothing is made');
    expect(made.preview.text).toContain('- type: "agency"');
    expect((await call('create_client', { name: 'novamart' })).text).toContain('There is a client "Novamart" already');
    expect((await call('list_clients', {})).text).toContain('- "Novamart" · agency · Iran · e-mail ads@novamart.example · 0 deals · version 1');

    const edit = await applied('edit_client', { client: 'novamart', phone: '+98 21 0000', tolerance_seconds: 5 });
    expect(edit.preview.text).toContain('- phone: none → "+98 21 0000"');
    expect(edit.preview.applyWith).toEqual({ apply: true, version: 1 });
    expect(await client('Novamart')).toMatchObject({ phone: '+98 21 0000', toleranceSeconds: 5, version: 2 });
    expect((await call('edit_client', { client: 'Novamart', phone: 'x', apply: true, version: 1 })).status).toBe(409);
    await undo(edit.done.text);
    expect(await client('Novamart')).toMatchObject({ phone: '', toleranceSeconds: null });

    const del = await applied('delete_client', { client: 'Novamart' });
    expect(await clients()).toHaveLength(0);
    await undo(del.done.text);
    expect((await clients()).map((c) => c.name)).toEqual(['Novamart']);
    // changed since it was made: undo of the make leaves it
    expect((await call('undo_change', { change: changeOf(made.done.text) })).text).toContain('The client changed after change');
  });

  it('deals and campaigns: create, change, delete; what has campaigns or booked spots stays', async () => {
    await applied('create_client', { name: 'Novamart' });
    const deal = await applied('create_deal', DEAL);
    expect(deal.preview.text).toContain('New deal "NOVAMART JUNE" · client "Novamart" · 2030-06-01 → 2030-06-30 · deal value 12,000 EUR · channels AURORA TV — preview');
    expect((await call('create_deal', DEAL)).text).toContain('There is a deal called NOVAMART JUNE already');
    const editDeal = await applied('edit_deal', { deal: 'NOVAMART JUNE', value: 15000, notes: 'Two spots a day' });
    expect(editDeal.preview.text).toContain('- deal value: 12000 → 15000');
    expect(editDeal.preview.text).toContain('- notes: none → "Two spots a day"');
    expect(Number((await deals())[0].totalAgreed)).toBe(15000);
    await undo(editDeal.done.text);
    expect(Number((await deals())[0].totalAgreed)).toBe(12000);

    const camp = await applied('create_campaigns', { deal: 'NOVAMART JUNE', from: '2030-06-08', ads: ['LumenPlus_Ident_1', 'LumenPlus_Ident_2'] });
    expect(camp.preview.text).toContain(`- "${CAMPAIGN}" · AURORA TV`);
    expect(camp.preview.text).toContain('Ads: V1 "LumenPlus_Ident_1", V2 "LumenPlus_Ident_2"');
    expect(await adsOf(CAMPAIGN)).toEqual(['LumenPlus_Ident_1', 'LumenPlus_Ident_2']);
    expect((await call('delete_deal', { deal: 'NOVAMART JUNE' })).text).toContain('Cannot: it has 1 campaign');

    const editC = await applied('edit_campaign', { campaign: CAMPAIGN, name: 'NOVAMART SPOTS', to: '2030-06-20', remove_ads: ['V1'], add_ads: ['LumenPlus_Ident_3'] });
    expect(editC.preview.text).toContain(`- name: "${CAMPAIGN}" → "NOVAMART SPOTS"`);
    expect(editC.preview.text).toContain('- ads added: V2 "LumenPlus_Ident_3"');
    expect(await adsOf('NOVAMART SPOTS')).toEqual(['LumenPlus_Ident_2', 'LumenPlus_Ident_3']);
    expect((await call('edit_campaign', { campaign: 'NOVAMART SPOTS', to: '2030-07-05' })).text).toContain('A campaign stays within its deal');
    await undo(editC.done.text);
    expect(await adsOf(CAMPAIGN)).toEqual(['LumenPlus_Ident_1', 'LumenPlus_Ident_2']);

    // a booked spot of V1 on 8 June
    const o = await campaign(CAMPAIGN);
    const v1 = await platformDb.orderItem.findFirstOrThrow({ where: { orderId: o.id }, orderBy: { position: 'asc' } });
    const airingId = uuidv7();
    await platformDb.airing.create({ data: { id: airingId, tenantId: a.tenantId, orderId: o.id, channelId: a.channelId, date: new Date('2030-06-08T00:00:00Z'), blockTypeId: a.types.run1, passes: 1 } });
    await platformDb.airingItem.create({ data: { id: uuidv7(), airingId, position: 0, orderItemId: v1.id, passes: 1 } });
    expect((await call('delete_campaign', { campaign: CAMPAIGN })).text).toContain('Cannot: it has 1 booked spot');
    expect((await call('edit_campaign', { campaign: CAMPAIGN, remove_ads: ['V1'] })).text).toContain('"LumenPlus_Ident_1" is booked 1 time');
    expect((await call('edit_campaign', { campaign: CAMPAIGN, from: '2030-06-10' })).text).toContain('1 block with booked spots fall outside 2030-06-10 → 2030-06-30');
    expect((await call('undo_change', { change: changeOf(camp.done.text) })).isError).toBe(true);
    await platformDb.airing.delete({ where: { id: airingId } });

    const delC = await applied('delete_campaign', { campaign: CAMPAIGN });
    expect(await campaigns()).toHaveLength(0);
    await undo(delC.done.text);
    expect(await campaigns()).toHaveLength(1);
  });

  it('create_campaigns: a channel without a main layout stops it; undo deletes fresh campaigns; a deal without campaigns is deleted and comes back', async () => {
    await applied('create_client', { name: 'Novamart' });
    await applied('create_deal', DEAL);
    await makeEmptyChannel(a, 'NO LAYOUT');
    expect((await call('create_campaigns', { deal: 'NOVAMART JUNE', channels: ['AURORA', 'NO LAYOUT'] })).text).toContain('Cannot: NO LAYOUT has no main layout for 2030-06-01 → 2030-06-30.');
    const made = await applied('create_campaigns', { deal: 'NOVAMART JUNE' });
    expect((await campaigns()).map((o) => o.name)).toEqual(['AURORA TV - NOVAMART JUNE - START 01 JUN 2030']);
    await undo(made.done.text);
    expect(await campaigns()).toHaveLength(0);

    const del = await applied('delete_deal', { deal: 'NOVAMART JUNE' });
    expect(await deals()).toHaveLength(0);
    await undo(del.done.text);
    expect(await deals()).toHaveLength(1);
  });

  it('book_campaign_spots: the 2nd break of each block, day by day, in a break position; campaigns by name', async () => {
    // every day: Run Block 1 has Billboard 1 06:00 then Ad Pod 06:30, Run Block 2 Billboard 1 07:00 then Ad Pod 07:30, Half Block only Billboard 1 08:00
    const blocks = await platformDb.templateBlock.findMany({ where: { templateId: a.mainTemplateId } });
    const links: Record<string, string[]> = { [a.types.run1]: ['Billboard 1 06', 'AB 06'], [a.types.run2]: ['Billboard 1 07', 'AB 07'], [a.types.half]: ['Billboard 1 08'] };
    await platformDb.linkedBreak.createMany({ data: blocks.flatMap((b) => (links[b.blockTypeId] ?? []).map((k, position) => ({ id: uuidv7(), blockId: b.id, position, breakTypeId: a.breaks[k] }))) });
    const bottom = await platformDb.breakPosition.create({ data: { id: uuidv7(), tenantId: a.tenantId, name: 'Commercial Bottom', sortOrder: 1 } });
    await applied('create_client', { name: 'Novamart' });
    await applied('create_deal', { ...DEAL, from: '2030-06-01', to: '2030-06-07' });
    await applied('create_campaigns', { deal: 'NOVAMART JUNE', ads: ['LumenPlus_Ident_1'] });
    const name = 'AURORA TV - NOVAMART JUNE - START 01 JUN 2030';
    expect((await call('get_campaign', { campaign: 'novamart june' })).text).toContain(`Campaign "${name}"`);

    const book = await applied('book_campaign_spots', { campaign: name, break_in_block: 2, position: 'commercial bottom' });
    expect(book.preview.text).toContain('Breaks: the 2nd break of each block, day by day from the layout');
    expect(book.preview.text).toContain('14 spots to book');
    expect(book.preview.text).toContain('- 7 blocks on these days have no 2nd break: nothing goes there.');
    expect(book.preview.text).toContain('position "commercial bottom"');
    const spots = await platformDb.airingItem.findMany({ where: { airing: { orderId: (await campaign(name)).id } } });
    expect(spots).toHaveLength(14);
    expect(new Set(spots.map((x) => x.breakTypeId))).toEqual(new Set([a.breaks['AB 06'], a.breaks['AB 07']]));
    expect(spots.every((x) => x.positionId === bottom.id)).toBe(true);
    await undo(book.done.text);
    expect(await platformDb.airingItem.count({ where: { airing: { orderId: (await campaign(name)).id } } })).toBe(0);
  });

  it('the AI table: Drafts changes bookings and campaigns but makes and deletes nothing in Ads', async () => {
    const p = await principal();
    const names = (policy: Principal['policy']) => new Set(toolDefs({ ...p, via: 'mcp', policy }).map((d) => d.name));
    const drafts = names(preset('drafts'));
    expect(['list_clients', 'edit_client', 'edit_deal', 'edit_campaign', 'book_campaign_spots'].every((n) => drafts.has(n))).toBe(true);
    expect(['create_client', 'delete_client', 'create_deal', 'delete_deal', 'create_campaigns', 'delete_campaign'].some((n) => drafts.has(n))).toBe(false);
    expect(preset('drafts').playlist).toMatchObject({ change: 'on', create: 'on' });
    expect(names(preset('full')).has('create_campaigns')).toBe(true);
  });
});
