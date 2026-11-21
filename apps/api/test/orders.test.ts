import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, uuidv7, weekStartOn } from '@9eye/core';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { auth, fillMainTemplate, makeCatalog, makeCompany, makeEmptyChannel, resetDb, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
const as = (f: Fixture) => ({
  get: (url: string) => request(app).get(url).set(auth(f.slug)),
  post: (url: string, body: object) => request(app).post(url).set(auth(f.slug)).send(body),
  put: (url: string, body: object) => request(app).put(url).set(auth(f.slug)).send(body),
  del: (url: string) => request(app).delete(url).set(auth(f.slug)),
});

let a: Fixture;
let b: Fixture;
let cat: CatalogFixture;
let today: string;
let week: string; // first day of this channel week (Saturday)

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
  await fillMainTemplate(a);
  cat = await makeCatalog(a);
  const ch = (await as(a).get(`/api/channels/${a.channelId}`).expect(200)).body;
  today = ch.today ?? (await as(a).get('/api/channels').expect(200)).body[0].today;
  week = weekStartOn(today, 6);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

const NO_LIMITS = { maxAirings: null, totalAirings: null, timeWindows: { allowed: [], rejected: [] } };

async function newSeries(name = 'Harbor - AURORA', start = addDays(week, -7), end = addDays(week, 20)) {
  const r = await as(a)
    .post('/api/orders', { name, mode: 'series', channelIds: [a.channelId], startDate: start, endDate: end, productionIds: cat.harborEps, firstProductionId: null, reuseInLoop: false, ...NO_LIMITS })
    .expect(201);
  return r.body;
}

/** The order as the page sends it back on save. */
function draftOf(full: { order: Record<string, unknown>; channels: { channel: { id: string }; template: { id: string } }[]; items: { id: string; productionId: string; lengthFrames: number | null }[]; airings: unknown[] }) {
  const { id: _id, version, updatedAt: _u, ...o } = full.order as Record<string, unknown>;
  return {
    ...o,
    version,
    channels: full.channels.map((c) => ({ channelId: c.channel.id, templateId: c.template.id })),
    items: full.items.map((i) => ({ id: i.id, productionId: i.productionId, lengthFrames: i.lengthFrames })),
    airings: full.airings,
  };
}

const firstAiring = (date: string, blockTypeId: string, itemId: string, channelId = a.channelId) => ({
  id: uuidv7(), channelId, date, blockTypeId, passes: 1, repeatOfId: null, repeatIndex: 0, blockColor: null, items: [{ itemId, passes: 0, jingle: null }],
});
const repeatOf = (f: { id: string }, date: string, blockTypeId: string) => ({
  id: uuidv7(), channelId: a.channelId, date, blockTypeId, passes: 0, repeatOfId: f.id, repeatIndex: 0, blockColor: null, items: [],
});

describe('orders', () => {
  it('are born as empty drafts on the channel’s main layout', async () => {
    const full = await newSeries();
    expect(full.order).toMatchObject({ name: 'Harbor - AURORA', mode: 'series', status: 'draft' });
    expect(full.airings).toEqual([]);
    expect(full.items.map((i: { title: string; chapter: number }) => i.chapter)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(full.items[2].lengthFrames).toBeNull(); // episode 3 has no length in the catalog
    expect(full.channels[0].template.blocks).toHaveLength(21);
    const other = await makeEmptyChannel(a, 'NO TEMPLATE');
    const r = await as(a)
      .post('/api/orders', { name: 'x', mode: 'series', channelIds: [other], startDate: week, endDate: addDays(week, 6), productionIds: [], firstProductionId: null, reuseInLoop: false, ...NO_LIMITS })
      .expect(422);
    expect(r.body.error).toBe('NO TEMPLATE has no main layout for these dates.');
  });

  it('saves the whole plan all-or-nothing, with first airings, repeats and the version check', async () => {
    const full = await newSeries();
    const [e1, e2] = full.items;
    const f = firstAiring(week, a.types.run1, e1.id);
    const d = { ...draftOf(full), status: 'confirmed', airings: [f, repeatOf(f, week, a.types.half), repeatOf(f, addDays(week, 1), a.types.run2), firstAiring(addDays(week, 2), a.types.run1, e2.id)] };
    const saved = (await as(a).put(`/api/orders/${full.order.id}`, d).expect(200)).body;
    expect(saved.order.version).toBe(2);
    expect(saved.airings).toHaveLength(4);
    expect(saved.airings.filter((x: { repeatOfId: string | null }) => x.repeatOfId === f.id)).toHaveLength(2);

    // outside the dates and a repeat before its first airing: refused, nothing written
    const bad = { ...draftOf(saved), airings: [...saved.airings, firstAiring(addDays(week, 40), a.types.run1, e2.id), repeatOf(f, addDays(week, -1), a.types.run2)] };
    const r = await as(a).put(`/api/orders/${full.order.id}`, bad).expect(422);
    expect(r.body.problems.map((p: { code: string }) => p.code)).toEqual(['outside', 'repeat']);
    expect((await as(a).get(`/api/orders/${full.order.id}`).expect(200)).body.airings).toHaveLength(4);
    // a stale version
    await as(a).put(`/api/orders/${full.order.id}`, { ...draftOf(saved), version: 1 }).expect(409);
  });

  it('airings keep their blocks when the layout is saved again (blocks are named by block type)', async () => {
    const full = await newSeries();
    const saved = (await as(a).put(`/api/orders/${full.order.id}`, { ...draftOf(full), airings: [firstAiring(week, a.types.run2, full.items[0].id)] }).expect(200)).body;
    const t = (await as(a).get(`/api/templates/${a.mainTemplateId}`).expect(200)).body;
    await as(a).put(`/api/templates/${a.mainTemplateId}`, { version: t.template.version, name: t.template.name, validFrom: t.template.validFrom, validTo: t.template.validTo, activeWeekdays: t.template.activeWeekdays, blocks: t.blocks.map((x: object) => ({ ...x, id: uuidv7() })) }).expect(200);
    const again = (await as(a).get(`/api/orders/${full.order.id}`).expect(200)).body;
    expect(again.airings).toEqual(saved.airings);
    await as(a).put(`/api/orders/${full.order.id}`, draftOf(again)).expect(200);
  });

  it('lists a channel’s plans with this week and their first issue', async () => {
    const s1 = await newSeries('Ending soon');
    const items = s1.items;
    // confirmed, its last episode airs this week and nothing follows in its block
    const last = firstAiring(addDays(today, 1), a.types.run1, items[5].id);
    await as(a).put(`/api/orders/${s1.order.id}`, { ...draftOf(s1), status: 'confirmed', endDate: addDays(today, 30), airings: [firstAiring(addDays(week, -7), a.types.run1, items[0].id), last, repeatOf(last, addDays(today, 1), a.types.half)] }).expect(200);
    const s2 = await newSeries('A draft', today, addDays(today, 30));
    await as(a).put(`/api/orders/${s2.order.id}`, { ...draftOf(s2), airings: [firstAiring(addDays(today, 2), a.types.run2, s2.items[0].id)] }).expect(200);
    const list = (await as(a).get(`/api/channels/${a.channelId}/orders`).expect(200)).body;
    expect(list.weekFrom).toBe(week);
    const byName = Object.fromEntries(list.orders.map((o: { name: string }) => [o.name, o]));
    expect(byName['Ending soon'].issue.short).toMatch(/^Last episode /);
    expect(byName['Ending soon'].issue.fix).toMatchObject({ action: 'new-order', date: addDays(today, 2) });
    expect(byName['Ending soon'].placed).toBe(2);
    expect(byName['Ending soon'].week.repeats).toBe(addDays(today, 1) <= addDays(week, 6) ? 1 : 0);
    expect(byName['A draft'].issue).toMatchObject({ short: 'Draft: left out of the playlist', fix: { action: 'confirm' } });
    expect(byName['A draft'].itemCount).toBe(6);
  });

  it('flags two programmes in one block', async () => {
    const one = await newSeries('One', today, addDays(today, 20));
    const two = await newSeries('Two', today, addDays(today, 20));
    await as(a).put(`/api/orders/${one.order.id}`, { ...draftOf(one), status: 'confirmed', airings: [firstAiring(addDays(today, 3), a.types.run1, one.items[0].id)] }).expect(200);
    await as(a).put(`/api/orders/${two.order.id}`, { ...draftOf(two), status: 'confirmed', airings: [firstAiring(addDays(today, 3), a.types.run1, two.items[0].id)] }).expect(200);
    const list = (await as(a).get(`/api/channels/${a.channelId}/orders`).expect(200)).body;
    for (const o of list.orders) expect(o.issue.short).toBe('Two programmes in 1 block');
  });

  it('shows a channel’s week with every plan’s airings', async () => {
    const full = await newSeries();
    const f = firstAiring(week, a.types.run1, full.items[1].id);
    await as(a).put(`/api/orders/${full.order.id}`, { ...draftOf(full), airings: [f, repeatOf(f, addDays(week, 1), a.types.run2)] }).expect(200);
    const w = (await as(a).get(`/api/channels/${a.channelId}/schedule-week?from=${week}`).expect(200)).body;
    expect(w.template.id).toBe(a.mainTemplateId);
    expect(w.airings.map((x: { kind: string; titles: string[]; firstDate: string | null }) => [x.kind, x.titles[0], x.firstDate])).toEqual(
      expect.arrayContaining([
        ['first', 'Harbor Nights - 2', null],
        ['repeat', 'Harbor Nights - 2', week],
      ]),
    );
  });

  it('duplicates, splits, moves airings and deletes', async () => {
    const full = await newSeries('Harbor', addDays(week, -7), addDays(week, 13));
    const [e1, e2, e3] = full.items;
    const f1 = firstAiring(addDays(week, -7), a.types.run1, e1.id);
    const f2 = firstAiring(week, a.types.run1, e2.id);
    const f3 = firstAiring(addDays(week, 7), a.types.run1, e3.id);
    const saved = (await as(a).put(`/api/orders/${full.order.id}`, { ...draftOf(full), airings: [f1, f2, repeatOf(f2, addDays(week, 1), a.types.run2), f3] }).expect(200)).body;

    const dup = (await as(a).post(`/api/orders/${full.order.id}/duplicate`, { name: 'Harbor copy' }).expect(201)).body;
    const copy = (await as(a).get(`/api/orders/${dup.id}`).expect(200)).body;
    expect(copy.order).toMatchObject({ name: 'Harbor copy', status: 'draft' });
    expect(copy.airings).toHaveLength(4);
    expect(copy.airings[0].id).not.toBe(saved.airings[0].id);

    // move episode 3's airing into the copy: refused, the copy already holds that block
    const targets = (await as(a).get(`/api/orders/${full.order.id}/move-targets`).expect(200)).body;
    expect(targets.map((t: { name: string }) => t.name)).toEqual(['Harbor copy']);
    const clash = await as(a).post(`/api/orders/${full.order.id}/move`, { version: saved.order.version, itemIds: [e3.id], targetId: dup.id, targetVersion: copy.order.version }).expect(422);
    expect(clash.body.error).toMatch(/already hold an airing of the other plan/);
    const cleared = (await as(a).put(`/api/orders/${dup.id}`, { ...draftOf(copy), airings: [] }).expect(200)).body;
    const moved = (await as(a).post(`/api/orders/${full.order.id}/move`, { version: saved.order.version, itemIds: [e3.id], targetId: dup.id, targetVersion: cleared.order.version }).expect(200)).body;
    expect(moved.moved).toBe(1);
    expect((await as(a).get(`/api/orders/${dup.id}`).expect(200)).body.airings).toHaveLength(1);
    const after = (await as(a).get(`/api/orders/${full.order.id}`).expect(200)).body;
    expect(after.airings).toHaveLength(3);

    // split on the Sunday: the Saturday first airing stays, its Sunday repeat goes, the rest moves
    const s = (await as(a).post(`/api/orders/${full.order.id}/split`, { version: after.order.version, date: addDays(week, 1), name: 'Harbor part 2' }).expect(201)).body;
    expect(s).toMatchObject({ moved: 0, droppedRepeats: 1 });
    const kept = (await as(a).get(`/api/orders/${full.order.id}`).expect(200)).body;
    expect(kept.order.endDate).toBe(week);
    expect(kept.airings).toHaveLength(2);
    expect((await as(a).get(`/api/orders/${s.id}`).expect(200)).body.order).toMatchObject({ name: 'Harbor part 2', startDate: addDays(week, 1), endDate: addDays(week, 13) });

    await as(a).del(`/api/orders/${s.id}`).expect(204);
    const list = (await as(a).get(`/api/channels/${a.channelId}/orders`).expect(200)).body;
    expect(list.orders.map((o: { name: string }) => o.name).sort()).toEqual(['Harbor', 'Harbor copy']);
  });

  it('a multi-channel plan places on each channel’s own layout', async () => {
    const second = await makeEmptyChannel(a, 'AURORA TWO');
    const full = await newSeries();
    // the second channel has no template yet: refused
    const bad = await as(a).put(`/api/orders/${full.order.id}`, { ...draftOf(full), channels: [...draftOf(full).channels, { channelId: second, templateId: a.mainTemplateId }] }).expect(422);
    expect(bad.body.error).toBe('The channel has no such main layout.');
    // give it one (a copy of the first channel's template) and place on both
    const ch = (await as(a).get(`/api/channels/${second}`).expect(200)).body;
    const t2 = (await as(a).post('/api/templates', { playlistId: ch.mainPlaylistId, name: 'TWO', validFrom: '2024-03-23', validTo: '2099-05-29' }).expect(201)).body;
    const t1 = (await as(a).get(`/api/templates/${a.mainTemplateId}`).expect(200)).body;
    await as(a).put(`/api/templates/${t2.template.id}`, { version: t2.template.version, name: 'TWO', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: t1.template.activeWeekdays, blocks: t1.blocks.map((x: object) => ({ ...x, id: uuidv7() })) }).expect(200);
    const d = { ...draftOf(full), channels: [...draftOf(full).channels, { channelId: second, templateId: t2.template.id }], airings: [firstAiring(week, a.types.run1, full.items[0].id), firstAiring(week, a.types.run1, full.items[0].id, second)] };
    const saved = (await as(a).put(`/api/orders/${full.order.id}`, d).expect(200)).body;
    expect(saved.channels.map((c: { channel: { name: string }; template: { name: string } }) => [c.channel.name, c.template.name])).toEqual([['AURORA TV', 'MAIN'], ['AURORA TWO', 'TWO']]);
    expect(saved.airings.map((x: { channelId: string }) => x.channelId).sort()).toEqual([a.channelId, second].sort());
    const list = (await as(a).get(`/api/channels/${second}/orders`).expect(200)).body;
    expect(list.orders.map((o: { name: string }) => o.name)).toEqual(['Harbor - AURORA']);
  });

  it('is the company’s own', async () => {
    const full = await newSeries();
    await as(b).get(`/api/orders/${full.order.id}`).expect(404);
    await as(b).put(`/api/orders/${full.order.id}`, draftOf(full)).expect(404);
    await as(b).get(`/api/channels/${a.channelId}/orders`).expect(404);
    // another company's production cannot be put in an order
    const theirs = await makeCatalog(b);
    const r = await as(a).put(`/api/orders/${full.order.id}`, { ...draftOf(full), items: [...draftOf(full).items, { id: uuidv7(), productionId: theirs.harborEps[0], lengthFrames: null }] }).expect(422);
    expect(r.body.error).toBe('Some items are not in the catalog.');
  });
});
