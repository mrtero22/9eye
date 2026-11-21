// Playlist → Day, Orders part C: the ads playlist takes the booked spots of confirmed commercial orders
// (Commercial orders step), saves them linked to their booking, and its step and issues count them.

import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { ALL, auth, block, makeCatalog, makeCompany, resetDb, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
const SAT = '2030-06-01';
let a: Fixture;
let cat: CatalogFixture;

type Ev = Record<string, unknown> & { id: string; kind: string; title: string; productionId: string | null; airingItemId: string | null; orderId: string | null };
type Blk = { id: string; name: string; events: Ev[] };
const get = (url: string) => request(app).get(url).set(auth(a.slug));
const post = (url: string, body: object) => request(app).post(url).set(auth(a.slug)).send(body);
const put = (url: string, body: object) => request(app).put(url).set(auth(a.slug)).send(body);
const KEYS = ['id', 'kind', 'title', 'lengthFrames', 'productionId', 'segmentId', 'tcInFrames', 'tcOutFrames', 'fixed', 'hold', 'autoAdjust', 'note', 'breakTypeId', 'relatedEventId', 'orderId', 'rotationListId', 'airingItemId'];
const fields = (e: Ev) => Object.fromEntries(KEYS.map((k) => [k, e[k]]));
async function openAds() {
  const d = (await get(`/api/channels/${a.channelId}/days/${SAT}?kind=ads`).expect(200)).body.day;
  return { id: d.id as string, version: d.version as number, checks: d.checks, blocks: (d.blocks as Blk[]).map((x) => ({ id: x.id, name: x.name, rows: x.events.map(fields) })), raw: d.blocks as Blk[] };
}

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  cat = await makeCatalog(a);
  // Saturday: Run Block 1 06:00 with Billboard 1 06:00 and Ad Pod 06:30 linked
  const blocks = [block(6, a.types.run1, 0, 60, [a.breaks['Billboard 1 06'], a.breaks['AB 06']])];
  await put(`/api/templates/${a.mainTemplateId}`, { version: 1, name: 'MAIN', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL, blocks }).expect(200);
  await post(`/api/channels/${a.channelId}/weeks`, { kinds: ['main', 'ads'], fromWeek: SAT, toWeek: SAT }).expect(201);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

/** A confirmed order booking ident 1 twice in Billboard 1 06:00 (one booking of 2 passes) and ident 2 in Ad Pod 06:30. */
async function book(status: 'confirmed' | 'draft' = 'confirmed') {
  const empty = { type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null };
  const { id: clientId } = (await post('/api/commercials/clients', { name: 'NOVAMART', ...empty }).expect(201)).body;
  const { id: contractId } = (await post('/api/commercials/contracts', { clientId, name: 'NOVAMART', startDate: '2030-05-25', endDate: '2030-06-30', currency: 'USD', totalAgreed: 0, notes: '', channelIds: [a.channelId] }).expect(201)).body;
  const { ids } = (await post(`/api/commercials/contracts/${contractId}/orders`, { channelIds: [a.channelId], startDate: '2030-05-25' }).expect(201)).body;
  const id = ids[0];
  let o = (await get(`/api/commercials/orders/${id}`).expect(200)).body;
  await put(`/api/commercials/orders/${id}`, { version: o.version, name: o.name, status, startDate: o.startDate, endDate: o.endDate, items: [{ id: null, productionId: cat.identItems[0] }, { id: null, productionId: cat.identItems[1] }] }).expect(200);
  o = (await get(`/api/commercials/orders/${id}`).expect(200)).body;
  const [v1, v2] = o.items.map((i: { id: string }) => i.id);
  const at = (breakTypeId: string, orderItemId: string, passes = 1) => ({ date: SAT, blockTypeId: a.types.run1, breakTypeId, orderItemId, positionId: null, passes });
  await put(`/api/commercials/orders/${id}/week`, { version: o.version, from: '2030-05-25', to: '2030-06-01', bookings: [at(a.breaks['Billboard 1 06'], v1, 2), at(a.breaks['AB 06'], v2)] }).expect(200);
  return { id, v1, v2 };
}

describe('the ads playlist takes the booked spots', () => {
  it('places each play in its break, saves the link, and counts it in the step', async () => {
    const o = await book();
    let d = await openAds();
    expect(d.checks.booked).toHaveLength(2);
    const r = (await post(`/api/days/${d.id}/run`, { step: 'commercials', mode: 'missing', version: d.version, blocks: d.blocks }).expect(200)).body;
    // Billboard 1 06:00 is 5 min; ident 1 (15 s) twice — but never twice in a row, and nothing else is there
    expect(r.report.placed.map((l: { title: string; block: string; detail: string }) => [l.title, l.block])).toEqual([
      ['LumenPlus_Ident_1', 'Billboard 1 06:00'],
      ['LumenPlus_Ident_2', 'Ad Pod 06:30'],
    ]);
    expect(r.report.notPlaced.map((l: { title: string; detail: string }) => [l.title, l.detail])).toEqual([['LumenPlus_Ident_1', 'It would air right after itself. 1 of 2 plays placed. AURORA TV - NOVAMART - START 25 MAY 2030.']]);
    const sp1 = r.blocks.find((b: { id: string }) => b.id === d.blocks.find((x) => x.name === 'Billboard 1 06:00')!.id);
    expect(sp1.events).toHaveLength(1);
    expect(sp1.events[0]).toMatchObject({ productionId: cat.identItems[0], orderId: o.id, kind: 'filler' });

    // save it: the rows keep their booking
    const blocks = r.blocks.map((b: Blk) => ({ id: b.id, rows: b.events.map(fields) }));
    await put(`/api/days/${d.id}`, { version: d.version, blocks }).expect(200);
    d = await openAds();
    const rows = d.raw.flatMap((b) => b.events).filter((e) => e.airingItemId);
    expect(rows).toHaveLength(2);

    // the order's week saved again keeps its booked spots, so the links hold
    const ord = (await get(`/api/commercials/orders/${o.id}`).expect(200)).body;
    const week = (await get(`/api/commercials/orders/${o.id}/week?from=2030-05-26`).expect(200)).body;
    await put(`/api/commercials/orders/${o.id}/week`, { version: ord.version, from: week.from, to: week.to, bookings: week.bookings }).expect(200);
    d = await openAds();
    expect(d.raw.flatMap((b) => b.events).filter((e) => e.airingItemId)).toHaveLength(2);

    // a spot no longer booked: the row loses its link and the step says so
    const ord2 = (await get(`/api/commercials/orders/${o.id}`).expect(200)).body;
    await put(`/api/commercials/orders/${o.id}/week`, { version: ord2.version, from: week.from, to: week.to, bookings: week.bookings.filter((b: { orderItemId: string }) => b.orderItemId !== o.v2) }).expect(200);
    d = await openAds();
    expect(d.checks.booked).toHaveLength(1);
    const stale = d.raw.flatMap((b) => b.events).filter((e) => e.orderId && !e.airingItemId);
    expect(stale).toHaveLength(1);

    // a row that names a booking of another day is refused
    const bad = d.blocks.map((b) => ({ id: b.id, rows: b.rows.map((x) => (x.airingItemId ? { ...x, airingItemId: '019a0000-0000-7000-8000-000000000000' } : x)) }));
    await put(`/api/days/${d.id}`, { version: d.version, blocks: bad }).expect(422);
  });

  it('leaves draft campaigns out and says so', async () => {
    await book('draft');
    const d = await openAds();
    expect(d.checks.booked).toEqual([]);
    const r = (await post(`/api/days/${d.id}/run`, { step: 'commercials', mode: 'missing', version: d.version, blocks: d.blocks }).expect(200)).body;
    expect(r.report.placed).toEqual([]);
    expect(r.report.notes).toEqual(['No confirmed campaigns book this day.', '2 booked spots of draft campaigns were left out.']);
    // the main playlist takes no commercials
    const main = (await get(`/api/channels/${a.channelId}/days/${SAT}?kind=main`).expect(200)).body.day;
    const mainBlocks = (main.blocks as Blk[]).map((x) => ({ id: x.id, rows: x.events.map(fields) }));
    await post(`/api/days/${main.id}/run`, { step: 'commercials', mode: 'missing', version: main.version, blocks: mainBlocks }).expect(400);
  });
});
