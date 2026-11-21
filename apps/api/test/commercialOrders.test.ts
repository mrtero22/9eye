import { uuidv7 } from '@9eye/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { auth, makeCatalog, makeCompany, min, resetDb, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
let a: Fixture;
let cat: CatalogFixture;
const as = (f: Fixture) => ({
  get: (u: string) => request(app).get(`/api${u}`).set(auth(f.slug)),
  post: (u: string, body: object) => request(app).post(`/api${u}`).set(auth(f.slug)).send(body),
  put: (u: string, body: object) => request(app).put(`/api${u}`).set(auth(f.slug)).send(body),
});

/**
 * Main template: Run Block 1 06:00 with Billboard 1 06:00 and Ad Pod 06:30 linked — on Friday only Billboard 1 —
 * and Run Block 2 07:00 with Billboard 1 07:00 and Ad Pod 07:30, every day.
 */
async function mainWithBreaks(f: Fixture) {
  for (let d = 0; d < 7; d++) {
    const b1 = uuidv7();
    const b2 = uuidv7();
    await platformDb.templateBlock.createMany({
      data: [
        { id: b1, templateId: f.mainTemplateId, weekday: d, blockTypeId: f.types.run1, startFrames: 0, lengthFrames: min(60), fillGaps: true, opensWithBreak: false },
        { id: b2, templateId: f.mainTemplateId, weekday: d, blockTypeId: f.types.run2, startFrames: min(60), lengthFrames: min(60), fillGaps: true, opensWithBreak: false },
      ],
    });
    const links = [{ blockId: b1, breakTypeId: f.breaks['Billboard 1 06'] }, ...(d === 5 ? [] : [{ blockId: b1, breakTypeId: f.breaks['AB 06'] }]), { blockId: b2, breakTypeId: f.breaks['Billboard 1 07'] }, { blockId: b2, breakTypeId: f.breaks['AB 07'] }];
    await platformDb.linkedBreak.createMany({ data: links.map((l, i) => ({ id: uuidv7(), position: i, ...l })) });
  }
}

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  cat = await makeCatalog(a);
  await mainWithBreaks(a);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

async function makeOrder() {
  const { id: clientId } = (await as(a).post('/commercials/clients', { name: 'NOVAMART', type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null }).expect(201)).body;
  const { id: contractId } = (await as(a).post('/commercials/contracts', { clientId, name: 'NOVAMART', startDate: '2026-11-14', endDate: '2026-11-20', currency: 'USD', totalAgreed: 0, notes: '', channelIds: [a.channelId] }).expect(201)).body;
  const { ids } = (await as(a).post(`/commercials/contracts/${contractId}/orders`, { channelIds: [a.channelId], startDate: '2026-11-14' }).expect(201)).body;
  return { id: ids[0] as string, contractId };
}

describe('a campaign', () => {
  it('shows each day its own blocks and breaks, books by hand and keeps to the layout', async () => {
    const { id } = await makeOrder();
    let o = (await as(a).get(`/commercials/orders/${id}`).expect(200)).body;
    expect(o).toMatchObject({ status: 'draft', startDate: '2026-11-14', endDate: '2026-11-20', items: [], booked: 0, contract: { name: 'NOVAMART', clientName: 'NOVAMART' }, template: { name: 'MAIN' } });
    expect(o.breaks.map((b: { name: string; weekdays: boolean[] }) => [b.name, b.weekdays.filter(Boolean).length])).toEqual([
      ['Billboard 1 06:00', 7],
      ['Ad Pod 06:30', 6],
      ['Billboard 1 07:00', 7],
      ['Ad Pod 07:30', 7],
    ]);

    // two spots
    await as(a).put(`/commercials/orders/${id}`, { version: o.version, name: o.name, status: 'confirmed', startDate: o.startDate, endDate: o.endDate, items: [{ id: null, productionId: cat.identItems[0] }, { id: null, productionId: cat.identItems[1] }] }).expect(200);
    o = (await as(a).get(`/commercials/orders/${id}`).expect(200)).body;
    expect(o.items.map((i: { title: string; lengthFrames: number }) => [i.title, i.lengthFrames])).toEqual([
      ['LumenPlus_Ident_1', 375],
      ['LumenPlus_Ident_2', 375],
    ]);
    const [v1, v2] = o.items.map((i: { id: string }) => i.id);

    const week = (await as(a).get(`/commercials/orders/${id}/week?from=2026-11-14`).expect(200)).body;
    const fri = week.days.find((d: { date: string }) => d.date === '2026-11-20');
    expect(fri.boxes.map((b: { name: string; breaks: { name: string }[] }) => [b.name, b.breaks.map((x) => x.name)])).toEqual([
      ['Run Block 1', ['Billboard 1 06:00']],
      ['Run Block 2', ['Billboard 1 07:00', 'Ad Pod 07:30']],
    ]);
    expect(week.days[0].boxes[0].breaks[1]).toMatchObject({ name: 'Ad Pod 06:30', startFrames: min(10), lengthFrames: min(18), othersFrames: 0 });

    const sat = { date: '2026-11-14', blockTypeId: a.types.run1, breakTypeId: a.breaks['AB 06'], orderItemId: v1, positionId: null, passes: 1 };
    // Friday's Run Block 1 has no Ad Pod; a day outside the week; a spot of another order
    await as(a).put(`/commercials/orders/${id}/week`, { version: o.version, from: '2026-11-14', to: '2026-11-20', bookings: [{ ...sat, date: '2026-11-20' }] }).expect(422);
    await as(a).put(`/commercials/orders/${id}/week`, { version: o.version, from: '2026-11-14', to: '2026-11-20', bookings: [{ ...sat, date: '2026-11-21' }] }).expect(422);
    await as(a).put(`/commercials/orders/${id}/week`, { version: o.version, from: '2026-11-14', to: '2026-11-20', bookings: [{ ...sat, orderItemId: uuidv7() }] }).expect(422);
    const saved = (await as(a).put(`/commercials/orders/${id}/week`, { version: o.version, from: '2026-11-14', to: '2026-11-20', bookings: [sat, { ...sat, orderItemId: v2 }] }).expect(200)).body;
    await as(a).put(`/commercials/orders/${id}/week`, { version: o.version, from: '2026-11-14', to: '2026-11-20', bookings: [] }).expect(409);
    const after = (await as(a).get(`/commercials/orders/${id}/week?from=2026-11-14`).expect(200)).body;
    expect(after.bookings).toHaveLength(2);
    expect((await as(a).get(`/commercials/orders/${id}`).expect(200)).body).toMatchObject({ booked: 2, version: saved.version });

    // a spot that is booked cannot leave the order
    o = (await as(a).get(`/commercials/orders/${id}`).expect(200)).body;
    await as(a).put(`/commercials/orders/${id}`, { version: o.version, name: o.name, status: o.status, startDate: o.startDate, endDate: o.endDate, items: [{ id: v2, productionId: cat.identItems[1] }] }).expect(422);
    // nor can the dates leave bookings out
    await as(a).put(`/commercials/orders/${id}`, { version: o.version, name: o.name, status: o.status, startDate: '2026-11-15', endDate: o.endDate, items: o.items.map((i: { id: string; productionId: string }) => ({ id: i.id, productionId: i.productionId })) }).expect(422);
  });

  it('books spots over a range, rotating over each day’s breaks and keeping what is booked', async () => {
    const { id, contractId } = await makeOrder();
    let o = (await as(a).get(`/commercials/orders/${id}`).expect(200)).body;
    await as(a).put(`/commercials/orders/${id}`, { version: o.version, name: o.name, status: 'confirmed', startDate: o.startDate, endDate: o.endDate, items: [{ id: null, productionId: cat.identItems[0] }, { id: null, productionId: cat.identItems[1] }] }).expect(200);
    o = (await as(a).get(`/commercials/orders/${id}`).expect(200)).body;
    const [v1, v2] = o.items.map((i: { id: string }) => i.id);
    // Saturday's Ad Pod 06:30 is booked already
    await as(a).put(`/commercials/orders/${id}/week`, { version: o.version, from: '2026-11-14', to: '2026-11-20', bookings: [{ date: '2026-11-14', blockTypeId: a.types.run1, breakTypeId: a.breaks['AB 06'], orderItemId: v2, positionId: null, passes: 1 }] }).expect(200);
    o = (await as(a).get(`/commercials/orders/${id}`).expect(200)).body;
    const pos = (await as(a).put('/admin/break-positions', { rows: [{ id: null, version: null, name: 'Ad', isDefault: true, color: null, priceModifier: 0, contentTypeIds: [] }], deletedIds: [] }).expect(200)).body[0];
    const body = { version: o.version, from: '2026-11-01', to: '2026-12-31', breakTypeIds: [a.breaks['AB 06'], a.breaks['Billboard 1 07']], weekdays: Array(7).fill(true), itemIds: [v1, v2], spread: 'rotate', positionId: pos.id, passes: 1, apply: false };
    const preview = (await as(a).post(`/commercials/orders/${id}/book`, body).expect(200)).body;
    // 7 days × 2 breaks, less Friday's Ad Pod 06:30 and Saturday's booked one
    expect(preview).toMatchObject({ added: 12, kept: 1, addedFrames: 12 * 375, skipped: [{ weekday: 5, breakTypeIds: [a.breaks['AB 06']] }], version: o.version });
    const done = (await as(a).post(`/commercials/orders/${id}/book`, { ...body, apply: true }).expect(200)).body;
    expect(done.version).toBe(o.version + 1);
    const week = (await as(a).get(`/commercials/orders/${id}/week?from=2026-11-14`).expect(200)).body;
    const on = (date: string) => week.bookings.filter((b: { date: string }) => b.date === date).map((b: { breakTypeId: string; orderItemId: string }) => [b.breakTypeId, b.orderItemId]);
    // Sunday: Ad Pod 06:30 → V1, Billboard 1 07:00 → V2; Friday starts again: Billboard 1 07:00 → V1; Saturday keeps V2 and books V1 next
    expect(on('2026-11-15')).toEqual([[a.breaks['AB 06'], v1], [a.breaks['Billboard 1 07'], v2]]);
    expect(on('2026-11-20')).toEqual([[a.breaks['Billboard 1 07'], v1]]);
    expect(on('2026-11-14')).toEqual([[a.breaks['AB 06'], v2], [a.breaks['Billboard 1 07'], v1]]);
    // booked again: nothing new
    expect((await as(a).post(`/commercials/orders/${id}/book`, { ...body, version: done.version }).expect(200)).body).toMatchObject({ added: 0, kept: 13 });
    // the contract counts them; a position in use cannot go
    expect((await as(a).get(`/commercials/contracts/${contractId}`).expect(200)).body.spotsBooked).toBe(13);
    await as(a).put('/admin/break-positions', { rows: [], deletedIds: [pos.id] }).expect(422);
  });
});
