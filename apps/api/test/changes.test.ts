// The change tools of decision 0024, phase C1 (src/mcp/changes.ts), called as an agent calls them
// (and an MCP client, which has no approve_day / reopen_day): edit_day, approve_day, reopen_day,
// get_layout, edit_layout, edit_media, add_to_rotation_list, confirm_campaign, remove_campaign_spots
// — preview, apply at the version, and undo_change.

import { uuidv7 } from '@9eye/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import type { Principal } from '../src/mcp/auth';
import { preset } from '../src/aiPolicy';
import { invokeTool, toolDefs } from '../src/mcp/tools';
import { ALL, auth, block, makeCatalog, makeCompany, resetDb, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
let a: Fixture;
let cat: CatalogFixture;
const SAT = '2030-06-01'; // the fixture channel's week starts on Saturday

const get = (u: string) => request(app).get(`/api${u}`).set(auth(a.slug));
const post = (u: string, body: object) => request(app).post(`/api${u}`).set(auth(a.slug)).send(body);
const put = (u: string, body: object) => request(app).put(`/api${u}`).set(auth(a.slug)).send(body);

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  cat = await makeCatalog(a);
  // Saturdays: Run Block 1 06:00 with its breaks, then Half Block 07:00
  const blocks = [block(6, a.types.run1, 0, 60, [a.breaks['Billboard 1 06'], a.breaks['AB 06']]), block(6, a.types.half, 60, 30)];
  await put(`/templates/${a.mainTemplateId}`, { version: 1, name: 'MAIN', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL, blocks }).expect(200);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

async function principal(via: 'agent' | 'mcp' = 'agent'): Promise<Principal> {
  const tenant = await platformDb.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
  return { user: { id: null, name: 'Tester' }, tenant, tokenId: null, via, access: { all: true, grants: new Set(), channelIds: null }, canWrite: true };
}

async function call(name: string, args: Record<string, unknown>, via: 'agent' | 'mcp' = 'agent') {
  const p = await principal(via);
  const def = toolDefs(p).find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return invokeTool(p, def, def.input.parse(args));
}

const changeOf = (text: string) => /Change id ([0-9a-f-]{36})/.exec(text)?.[1] ?? '';
const makeWeek = () => post(`/channels/${a.channelId}/weeks`, { kinds: ['main', 'ads'], fromWeek: SAT, toWeek: SAT }).expect(201);
const mainDay = () => platformDb.dayPlaylist.findFirstOrThrow({ where: { date: new Date(`${SAT}T00:00:00Z`), playlist: { kind: 'main' } }, include: { blocks: { include: { events: true } } } });
const titles = async () => (await mainDay()).blocks.flatMap((b) => b.events).filter((e) => e.productionId).map((e) => e.title).sort();
const refOf = (text: string, title: string) => new RegExp(`${title.replace(/[()]/g, '.')}[^\\n]*· row ([0-9a-f]{8})`).exec(text)?.[1] ?? '';

describe('a day by hand', () => {
  it('edit_day puts in, replaces, moves and takes out rows: preview, apply at the version, undo', async () => {
    await makeWeek();
    const add = await call('edit_day', { channel: 'AURORA', date: SAT, changes: [{ op: 'add', item: cat.harborEps[0], block: 'Run Block 1' }, { op: 'add', item: cat.identItems[0], block: '07:00' }] });
    expect(add.isError).toBe(false);
    expect(add.text).toContain('preview, nothing is saved');
    expect(add.text).toContain('- put in Harbor Nights - 1 (ep 1) · 00:45:00:00 at the end of 06:00:00:00 Run Block 1');
    expect(add.text).toMatch(/Run Block 1: 00:15:00:00 short \(was 01:00:00:00 short\)/);
    expect(add.applyWith).toMatchObject({ apply: true, version: 1, date: SAT });
    expect(await titles()).toEqual([]);

    const saved = await call('edit_day', { channel: 'AURORA', date: SAT, changes: [{ op: 'add', item: cat.harborEps[0], block: 'Run Block 1' }, { op: 'add', item: cat.identItems[0], block: '07:00' }], apply: true, version: 1 });
    expect(saved.text).toContain('saved as version 2');
    expect(await titles()).toEqual(['Harbor Nights - 1', 'LumenPlus_Ident_1']);

    // the rows have codes now: replace one, move the other, then take one out
    const day = (await call('get_day_playlist', { channel: 'AURORA', date: SAT })).text;
    const harbor = refOf(day, 'Harbor Nights - 1');
    const ident = refOf(day, 'LumenPlus_Ident_1');
    expect(harbor).toMatch(/^[0-9a-f]{8}$/);
    await call('edit_day', { channel: 'AURORA', date: SAT, changes: [{ op: 'replace', row: `row ${harbor}`, item: cat.brightEps[0] }, { op: 'move', row: ident, after: harbor }], apply: true, version: 2 });
    expect(await titles()).toEqual(['Bright Lanes - 1', 'LumenPlus_Ident_1']);
    const d = await mainDay();
    const block1 = d.blocks.find((b) => b.events.some((e) => e.title === 'Bright Lanes - 1'))!;
    expect(block1.events.filter((e) => e.productionId).sort((x, y) => x.sequence - y.sequence).map((e) => e.title)).toEqual(['Bright Lanes - 1', 'LumenPlus_Ident_1']);

    const removed = await call('edit_day', { channel: 'AURORA', date: SAT, changes: [{ op: 'remove', row: ident }], apply: true, version: 3 });
    expect(await titles()).toEqual(['Bright Lanes - 1']);
    // undo the last change: the ident is back
    expect((await call('undo_change', { change: changeOf(removed.text) })).text).toContain('is back as it was before change');
    expect(await titles()).toEqual(['Bright Lanes - 1', 'LumenPlus_Ident_1']);
  });

  it('edit_day refuses what it cannot do, and an approved day', async () => {
    await makeWeek();
    expect((await call('edit_day', { channel: 'AURORA', date: SAT, changes: [{ op: 'remove', row: 'deadbeef' }] })).text).toContain('No row "deadbeef"');
    // an item without a length cannot go in
    const noLength = await call('edit_day', { channel: 'AURORA', date: SAT, changes: [{ op: 'add', item: cat.harborEps[2], block: 'Run Block 1' }] });
    expect(noLength.text).toContain('has no length in the catalog');
    expect(noLength.applyWith).toBeNull();
    // a linked break stays as it is
    const day = (await call('get_day_playlist', { channel: 'AURORA', date: SAT })).text;
    const brk = /Break · Billboard 1 06:00[^\n]*· row ([0-9a-f]{8})/.exec(day)?.[1];
    expect(brk).toBeTruthy();
    expect((await call('edit_day', { channel: 'AURORA', date: SAT, changes: [{ op: 'remove', row: brk }] })).text).toContain('is a break: it stays as it is');
    // stale version
    const stale = await call('edit_day', { channel: 'AURORA', date: SAT, changes: [{ op: 'add', item: cat.brightEps[0], block: 'Run Block 1' }], apply: true, version: 7 });
    expect(stale).toMatchObject({ isError: true, status: 409 });
  });

  it('approve_day and reopen_day: under Playlist › Approve of the table, preview with the checks, undo', async () => {
    await makeWeek();
    expect(toolDefs({ ...(await principal('mcp')), policy: preset('drafts') }).map((d) => d.name)).not.toContain('approve_day');
    expect(toolDefs({ ...(await principal('mcp')), policy: preset('full') }).map((d) => d.name)).toContain('approve_day');
    const p = await call('approve_day', { channel: 'AURORA', date: SAT });
    expect(p.text).toContain('approving puts this day on air');
    expect(p.text).toContain('Steps that fill the day:');
    expect(p.applyWith).toMatchObject({ apply: true, version: 1 });
    const done = await call('approve_day', { channel: 'AURORA', date: SAT, apply: true, version: 1 });
    expect(done.text).toContain('is approved for air (version 2)');
    expect((await mainDay()).published).toBe(true);
    expect((await call('edit_day', { channel: 'AURORA', date: SAT, changes: [{ op: 'add', item: cat.brightEps[0], block: 'Run Block 1' }] })).text).toContain('a person must reopen it');
    await call('undo_change', { change: changeOf(done.text) });
    expect((await mainDay()).published).toBe(false);
    await call('approve_day', { channel: 'AURORA', date: SAT, apply: true, version: 3 });
    const reopened = await call('reopen_day', { channel: 'AURORA', date: SAT, apply: true, version: 4 });
    expect(reopened.text).toContain('reopened: a draft again');
    expect((await mainDay()).published).toBe(false);
  });
});

describe('layouts', () => {
  it('get_layout shows block codes; edit_layout adds, moves, resizes and takes out blocks, then undo', async () => {
    const shown = (await call('get_layout', { channel: 'AURORA' })).text;
    expect(shown).toContain('main layout "MAIN"');
    expect(shown).toContain('Saturday:');
    const half = /- 07:00:00:00 Half Block · 00:30:00:00[^\n]*· block ([0-9a-f]{8})/.exec(shown)?.[1];
    expect(half).toBeTruthy();
    expect(shown).toContain('Block types it can use:');

    const changes = [
      { op: 'add', block_type: 'Run Block 2', at: '10:00', weekdays: ['Mon', 'Tue'] },
      { op: 'move', block: half, at: '07:30' },
      { op: 'length', block: half, length: '00:20:00:00' },
    ];
    const preview = await call('edit_layout', { channel: 'AURORA', changes });
    expect(preview.text).toContain('- add Run Block 2 at 10:00:00:00 for 01:00:00:00 on Mon Tue');
    expect(preview.text).toContain('- move Sat 07:00:00:00 Half Block to 07:30:00:00');
    expect(preview.applyWith).toMatchObject({ apply: true, version: 2 });
    const saved = await call('edit_layout', { channel: 'AURORA', changes, apply: true, version: 2 });
    expect(saved.text).toContain('saved as version 3');
    const t = await get(`/templates/${a.mainTemplateId}`).expect(200);
    expect(t.body.blocks.filter((b: { weekday: number }) => b.weekday === 1 || b.weekday === 2)).toHaveLength(2);
    await call('undo_change', { change: changeOf(saved.text) });
    expect((await get(`/templates/${a.mainTemplateId}`).expect(200)).body.blocks).toHaveLength(2);

    // what stops it is in the preview
    const clash = await call('edit_layout', { channel: 'AURORA', changes: [{ op: 'add', block_type: 'Run Block 2', at: '06:30', weekdays: ['Sat'] }] });
    expect(clash.text).toContain('Problems — nothing can be saved');
    expect(clash.applyWith).toBeNull();
  });
});

describe('media', () => {
  it('edit_media changes an item, and undo puts it back', async () => {
    const preview = await call('edit_media', { item: cat.harborEps[2], length: '00:44:10:00', title: 'Harbor Nights - 3 (v2)', media: 'not-ready' });
    expect(preview.text).toContain('- length: — → 00:44:10:00');
    expect(preview.text).toContain('- title: "Harbor Nights - 3" → "Harbor Nights - 3 (v2)"');
    const v = (preview.applyWith as { version: number }).version;
    const saved = await call('edit_media', { item: cat.harborEps[2], length: '00:44:10:00', title: 'Harbor Nights - 3 (v2)', media: 'not-ready', apply: true, version: v });
    expect(saved.isError).toBe(false);
    let p = await platformDb.production.findUniqueOrThrow({ where: { id: cat.harborEps[2] } });
    expect(p).toMatchObject({ title: 'Harbor Nights - 3 (v2)', lengthFrames: 44 * 60 * 25 + 10 * 25, mediaStatus: 'not-ready' });
    await call('undo_change', { change: changeOf(saved.text) });
    p = await platformDb.production.findUniqueOrThrow({ where: { id: cat.harborEps[2] } });
    expect(p).toMatchObject({ title: 'Harbor Nights - 3', lengthFrames: null, mediaStatus: 'ready' });
    expect((await call('edit_media', { item: cat.harborEps[0], title: 'Harbor Nights - 1' })).text).toContain('Nothing would change.');
  });

  it('add_to_rotation_list adds at its end; what is in it already is refused; undo takes them out', async () => {
    const listId = uuidv7();
    await platformDb.rotationList.create({ data: { id: listId, tenantId: a.tenantId, name: 'Fillers' } });
    const preview = await call('add_to_rotation_list', { list: 'fillers', items: cat.identItems.slice(0, 2) });
    expect(preview.text).toContain('Rotation list "Fillers" · 0 items — preview');
    const saved = await call('add_to_rotation_list', { list: 'Fillers', items: cat.identItems.slice(0, 2), apply: true });
    expect(await platformDb.rotationListItem.count({ where: { listId } })).toBe(2);
    expect((await call('add_to_rotation_list', { list: 'Fillers', items: [cat.identItems[0]] })).text).toContain('In the list already');
    await call('undo_change', { change: changeOf(saved.text) });
    expect(await platformDb.rotationListItem.count({ where: { listId } })).toBe(0);
  });
});

describe('ads', () => {
  async function campaign(status: 'confirmed' | 'draft') {
    const empty = { type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null };
    const { id: clientId } = (await post('/commercials/clients', { name: 'Clearwater', ...empty }).expect(201)).body;
    const { id: dealId } = (await post('/commercials/contracts', { clientId, name: 'Clearwater', startDate: '2030-05-25', endDate: '2030-06-30', currency: 'USD', totalAgreed: 0, notes: '', channelIds: [a.channelId] }).expect(201)).body;
    const { ids } = (await post(`/commercials/contracts/${dealId}/orders`, { channelIds: [a.channelId], startDate: '2030-05-25' }).expect(201)).body;
    const o = (await get(`/commercials/orders/${ids[0]}`).expect(200)).body;
    await put(`/commercials/orders/${ids[0]}`, { version: o.version, name: o.name, status, startDate: o.startDate, endDate: o.endDate, items: [{ id: null, productionId: cat.identItems[0] }] }).expect(200);
    return ids[0] as string;
  }
  const order = (id: string) => get(`/commercials/orders/${id}`).expect(200).then((r) => r.body);
  const booked = (id: string) => platformDb.airingItem.count({ where: { airing: { orderId: id } } });

  it('confirm_campaign confirms a draft; undo makes it a draft again', async () => {
    const id = await campaign('draft');
    const o = await order(id);
    const preview = await call('confirm_campaign', { campaign: id });
    expect(preview.text).toContain('preview: confirming lets the ads playlists take');
    const done = await call('confirm_campaign', { campaign: id, apply: true, version: o.version });
    expect((await order(id)).status).toBe('confirmed');
    expect((await call('confirm_campaign', { campaign: id })).text).toContain('It is confirmed already.');
    await call('undo_change', { change: changeOf(done.text) });
    expect((await order(id)).status).toBe('draft');
  });

  it('remove_campaign_spots takes out the bookings of some breaks over a range; undo books them again', async () => {
    const id = await campaign('confirmed');
    let o = await order(id);
    // the layout has breaks on Saturdays only: Billboard 1 06:00 and Ad Pod 06:30, on 1 and 8 June
    await call('book_campaign_spots', { campaign: id, from: '2030-06-01', to: '2030-06-14', apply: true, version: o.version });
    const all = await booked(id);
    expect(all).toBe(4);
    o = await order(id);
    const preview = await call('remove_campaign_spots', { campaign: id, from: '2030-06-01', to: '2030-06-14', break_name_contains: 'Ad Pod', weekdays: ['Sat', 'Sun'] });
    expect(preview.text).toContain('2 spots to take out');
    expect(preview.text).toContain('- 2030-06-08 · Ad Pod 06:30 · V1');
    const done = await call('remove_campaign_spots', { campaign: id, from: '2030-06-01', to: '2030-06-14', break_name_contains: 'Ad Pod', weekdays: ['Sat', 'Sun'], apply: true, version: o.version });
    expect(done.isError).toBe(false);
    expect(await booked(id)).toBe(2);
    await call('undo_change', { change: changeOf(done.text) });
    expect(await booked(id)).toBe(all);
  });
});
