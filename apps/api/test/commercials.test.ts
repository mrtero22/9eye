import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { auth, makeCompany, makeEmptyChannel, resetDb, type Fixture } from './fixtures';

const app = createApp();
let a: Fixture;
let b: Fixture;
const as = (f: Fixture) => ({
  get: (u: string) => request(app).get(`/api${u}`).set(auth(f.slug)),
  post: (u: string, body: object) => request(app).post(`/api${u}`).set(auth(f.slug)).send(body),
  put: (u: string, body: object) => request(app).put(`/api${u}`).set(auth(f.slug)).send(body),
  del: (u: string) => request(app).delete(`/api${u}`).set(auth(f.slug)),
});

const client = (name: string, more: object = {}) => ({
  name, type: 'advertiser', country: 'Iran', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null, ...more,
});
const contract = (clientId: string, name: string, channelIds: string[], more: object = {}) => ({
  clientId, name, startDate: '2026-10-23', endDate: '2026-12-04', currency: 'USD', totalAgreed: 0, notes: '', channelIds, ...more,
});

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
});

afterAll(async () => {
  await platformDb.$disconnect();
});

describe('clients', () => {
  it('adds, lists, changes and deletes clients of one company', async () => {
    const { id } = (await as(a).post('/commercials/clients', client(' NOVAMART ', { email: 'ads@novamart.example', toleranceSeconds: 30 })).expect(201)).body;
    await as(a).post('/commercials/clients', client('novamart')).expect(422);
    await as(a).post('/commercials/clients', client('Bad', { email: 'nope' })).expect(422);
    await as(a).post('/commercials/clients', client('  ')).expect(422);
    const [c] = (await as(a).get('/commercials/clients').expect(200)).body;
    expect(c).toMatchObject({ id, name: 'NOVAMART', type: 'advertiser', toleranceSeconds: 30, contracts: 0, version: 1 });
    expect((await as(b).get('/commercials/clients').expect(200)).body).toEqual([]);
    await as(a).put(`/commercials/clients/${id}`, { ...client('NOVAMART', { type: 'agency' }), version: 1 }).expect(204);
    await as(a).put(`/commercials/clients/${id}`, { ...client('NOVAMART'), version: 1 }).expect(409);
    await as(b).del(`/commercials/clients/${id}`).expect(404);
    await as(a).del(`/commercials/clients/${id}`).expect(204);
    expect((await as(a).get('/commercials/clients').expect(200)).body).toEqual([]);
  });
});

describe('deals and their campaigns', () => {
  it('makes a deal, one campaign per channel named as AURORA names them, and refuses what does not fit', async () => {
    const { id: clientId } = (await as(a).post('/commercials/clients', client('NOVAMART')).expect(201)).body;
    const bare = await makeEmptyChannel(a, 'AURORA BARE');
    await as(a).post('/commercials/contracts', contract(clientId, 'NOVAMART', [])).expect(422);
    await as(a).post('/commercials/contracts', contract(clientId, 'NOVAMART', [b.channelId])).expect(422);
    await as(a).post('/commercials/contracts', contract(clientId, 'NOVAMART', [a.channelId], { endDate: '2026-10-01' })).expect(422);
    await as(a).post('/commercials/contracts', contract(clientId, 'NOVAMART', [a.channelId], { currency: 'usd' })).expect(422);
    const { id } = (await as(a).post('/commercials/contracts', contract(clientId, 'NOVAMART', [a.channelId])).expect(201)).body;
    await as(a).post('/commercials/contracts', contract(clientId, 'novamart', [a.channelId])).expect(422);

    // a channel without a main template gets no order; nothing is made
    await as(a).post(`/commercials/contracts/${id}/orders`, { channelIds: [a.channelId, bare], startDate: '2026-10-23' }).expect(422);
    await as(a).post(`/commercials/contracts/${id}/orders`, { channelIds: [a.channelId], startDate: '2026-12-05' }).expect(422);
    const made = (await as(a).post(`/commercials/contracts/${id}/orders`, { channelIds: [a.channelId], startDate: '2026-10-23' }).expect(201)).body;
    expect(made.ids).toHaveLength(1);

    const full = (await as(a).get(`/commercials/contracts/${id}`).expect(200)).body;
    expect(full).toMatchObject({ name: 'NOVAMART', clientName: 'NOVAMART', startDate: '2026-10-23', endDate: '2026-12-04', currency: 'USD', channelIds: [a.channelId], orders: 1, spotsBooked: 0, version: 1 });
    expect(full.ordersList[0]).toMatchObject({ name: 'AURORA TV - NOVAMART - START 23 OCT 2026', channelId: a.channelId, startDate: '2026-10-23', endDate: '2026-12-04', status: 'draft', spots: 0 });
    const list = (await as(a).get('/commercials/contracts').expect(200)).body;
    expect(list).toMatchObject([{ id, name: 'NOVAMART', clientName: 'NOVAMART', orders: 1 }]);
    expect((await as(b).get('/commercials/contracts').expect(200)).body).toEqual([]);

    // commercial orders stay out of Scheduling
    const sched = (await as(a).get(`/channels/${a.channelId}/orders`).expect(200)).body;
    expect(sched.orders).toEqual([]);

    // the client and the contract cannot go while something uses them
    await as(a).del(`/commercials/clients/${clientId}`).expect(409);
    await as(a).del(`/commercials/contracts/${id}`).expect(409);
    // nor can a channel an order uses leave the contract
    const second = await makeEmptyChannel(a, 'AURORA TWO');
    const r = await as(a).put(`/commercials/contracts/${id}`, { ...contract(clientId, 'NOVAMART', [second]), version: 1 }).expect(409);
    expect(r.body.error).toBe('AURORA TV is used by the campaign AURORA TV - NOVAMART - START 23 OCT 2026.');
    await as(a).put(`/commercials/contracts/${id}`, { ...contract(clientId, 'NOVAMART 2026', [a.channelId, second], { totalAgreed: 1500.5 }), version: 1 }).expect(204);
    expect((await as(a).get(`/commercials/contracts/${id}`).expect(200)).body).toMatchObject({ name: 'NOVAMART 2026', channelIds: expect.arrayContaining([a.channelId, second]), totalAgreed: 1500.5, version: 2 });

    // a later order adds its channel to the contract
    const third = await makeEmptyChannel(a, 'AURORA THREE');
    await as(a).post(`/commercials/contracts/${id}/orders`, { channelIds: [third], startDate: '2026-11-14' }).expect(422);

    await as(a).del(`/commercials/orders/${made.ids[0]}`).expect(204);
    await as(a).del(`/commercials/contracts/${id}`).expect(204);
    await as(a).del(`/commercials/clients/${clientId}`).expect(204);
  });
});
