import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { auth, ALL, block, makeCompany, min, resetDb, type Fixture } from './fixtures';

const app = createApp();
const as = (f: Fixture) => ({
  get: (url: string) => request(app).get(url).set(auth(f.slug)),
  post: (url: string, body: object) => request(app).post(url).set(auth(f.slug)).send(body),
  put: (url: string, body: object) => request(app).put(url).set(auth(f.slug)).send(body),
  patch: (url: string, body: object) => request(app).patch(url).set(auth(f.slug)).send(body),
  del: (url: string) => request(app).delete(url).set(auth(f.slug)),
});

let a: Fixture;
let b: Fixture;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
});

afterAll(async () => {
  await platformDb.$disconnect();
});

function draft(f: Fixture, version: number, blocks: ReturnType<typeof block>[]) {
  return { version, name: 'MAIN', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL, blocks };
}

describe('companies are isolated', () => {
  it('lists only the company’s own channels', async () => {
    const ra = await as(a).get('/api/channels').expect(200);
    expect(ra.body.map((c: { name: string }) => c.name)).toEqual(['AURORA TV']);
    const rb = await as(b).get('/api/channels').expect(200);
    expect(rb.body.map((c: { name: string }) => c.name)).toEqual(['OTHER TV']);
  });

  it('does not show or change another company’s layout', async () => {
    await as(a).get(`/api/templates/${b.mainTemplateId}`).expect(404);
    await as(a).put(`/api/templates/${b.mainTemplateId}`, draft(b, 1, [])).expect(404);
    await as(a).del(`/api/templates/${b.mainTemplateId}`).expect(404);
  });

  it('does not accept another company’s block type in a layout', async () => {
    const r = await as(a).put(`/api/templates/${a.mainTemplateId}`, draft(a, 1, [block(6, b.types.run1, 0)])).expect(422);
    expect(r.body.problems.map((p: { code: string }) => p.code)).toEqual(['unknown-block-type']);
  });

  it('refuses an unknown company', async () => {
    await request(app).get('/api/channels').set(auth('nobody')).expect(400);
  });
});

describe('templates', () => {
  it('reads a main layout with the ads days its breaks point into', async () => {
    const r = await as(a).get(`/api/templates/${a.mainTemplateId}`).expect(200);
    expect(r.body.template).toMatchObject({ name: 'MAIN', kind: 'main', validFrom: '2024-03-23', validTo: '2099-05-29', version: 1 });
    expect(r.body.channel).toMatchObject({ frameRate: '25', weekStart: 6, dayStartFrames: min(360) });
    expect(r.body.ads.template.id).toBe(a.adsTemplateId);
    expect(r.body.ads.days).toHaveLength(7);
    expect(r.body.ads.days[6]).toHaveLength(48);
    expect(r.body.ads.days[6][0]).toEqual({ blockTypeId: a.breaks['Billboard 1 06'], startFrames: 0, lengthFrames: min(5) });
  });

  it('saves the whole layout and bumps its version', async () => {
    const blocks = [block(6, a.types.run1, 0, 60, [a.breaks['Billboard 1 06'], a.breaks['AB 06']]), block(6, a.types.half, 60, 30)];
    const r = await as(a).put(`/api/templates/${a.mainTemplateId}`, { ...draft(a, 1, blocks), name: 'Renamed', activeWeekdays: [true, true, true, true, true, false, true] }).expect(200);
    expect(r.body.template).toMatchObject({ name: 'Renamed', version: 2, activeWeekdays: [true, true, true, true, true, false, true] });
    expect(r.body.blocks).toHaveLength(2);
    expect(r.body.blocks[0]).toMatchObject({ id: blocks[0].id, breaks: [a.breaks['Billboard 1 06'], a.breaks['AB 06']] });
    // the ads template lists which main blocks use its breaks
    const ads = await as(a).get(`/api/templates/${a.adsTemplateId}`).expect(200);
    expect(ads.body.main.template.id).toBe(a.mainTemplateId);
    expect(ads.body.main.blocks.find((x: { id: string }) => x.id === blocks[0].id).breaks).toHaveLength(2);
  });

  it('refuses a layout that breaks a rule and keeps the saved one (all-or-nothing)', async () => {
    const ok = [block(6, a.types.run1, 0)];
    await as(a).put(`/api/templates/${a.mainTemplateId}`, draft(a, 1, ok)).expect(200);
    const bad = [block(6, a.types.run1, 0), block(6, a.types.run2, 30), block(0, a.types.fri, 120), block(1, a.types.run1, 1410)];
    const r = await as(a).put(`/api/templates/${a.mainTemplateId}`, draft(a, 2, bad)).expect(422);
    expect(r.body.problems.map((p: { code: string }) => p.code).sort()).toEqual(['outside-day', 'overlap', 'weekday']);
    const now = await as(a).get(`/api/templates/${a.mainTemplateId}`).expect(200);
    expect(now.body.template.version).toBe(2);
    expect(now.body.blocks.map((x: { id: string }) => x.id)).toEqual([ok[0].id]);
  });

  it('refuses a save over someone else’s newer save', async () => {
    await as(a).put(`/api/templates/${a.mainTemplateId}`, draft(a, 1, [block(6, a.types.run1, 0)])).expect(200);
    const r = await as(a).put(`/api/templates/${a.mainTemplateId}`, draft(a, 1, [])).expect(409);
    expect(r.body.error).toMatch(/Someone else saved/);
    const now = await as(a).get(`/api/templates/${a.mainTemplateId}`).expect(200);
    expect(now.body.blocks).toHaveLength(1);
  });

  it('allows linked breaks only on main layouts, and only ads block types', async () => {
    const onAds = await as(a).put(`/api/templates/${a.adsTemplateId}`, { ...draft(a, 1, [block(6, a.breaks['Billboard 1 06'], 0, 5, [a.breaks['AB 06']])]), validFrom: '2024-01-06', validTo: '2099-12-25' }).expect(422);
    expect(onAds.body.problems.map((p: { code: string }) => p.code)).toEqual(['no-breaks']);
    const notABreak = await as(a).put(`/api/templates/${a.mainTemplateId}`, draft(a, 1, [block(6, a.types.run1, 0, 60, [a.types.half])])).expect(422);
    expect(notABreak.body.problems.map((p: { code: string }) => p.code)).toEqual(['not-a-break']);
  });

  it('a main-only channel has no linked breaks', async () => {
    const c = await makeCompany('public', { ads: false });
    const r = await as(c).get(`/api/templates/${c.mainTemplateId}`).expect(200);
    expect(r.body.ads).toBeNull();
    expect(r.body.channel.adsPlaylistId).toBeNull();
    await as(c).post(`/api/channels/${c.channelId}/break-lists`, { name: 'Hourly', positions: [0] }).expect(409);
  });

  it('creates, clones and deletes layouts; dates follow the channel week', async () => {
    const bad = await as(a).post('/api/templates', { playlistId: a.mainPlaylistId, name: 'Winter', validFrom: '2026-10-19', validTo: '2026-12-25' }).expect(422);
    expect(bad.body.problems[0].message).toMatch(/start on a Saturday/);
    const created = await as(a).post('/api/templates', { playlistId: a.mainPlaylistId, name: 'Winter', validFrom: '2026-10-17', validTo: '2026-12-25' }).expect(201);
    expect(created.body.template).toMatchObject({ name: 'Winter', activeWeekdays: ALL, version: 1 });

    await as(a).put(`/api/templates/${a.mainTemplateId}`, draft(a, 1, [block(6, a.types.run1, 0, 60, [a.breaks['Billboard 1 06']])])).expect(200);
    const clone = await as(a).post(`/api/templates/${a.mainTemplateId}/clone`, { name: 'Copy', validFrom: '2026-10-17', validTo: '2026-12-25' }).expect(201);
    expect(clone.body.blocks).toHaveLength(1);
    expect(clone.body.blocks[0].breaks).toEqual([a.breaks['Billboard 1 06']]);

    await as(a).del(`/api/templates/${clone.body.template.id}`).expect(204);
    await as(a).get(`/api/templates/${clone.body.template.id}`).expect(404);
    const list = await as(a).get(`/api/channels/${a.channelId}/templates`).expect(200);
    expect(list.body.map((t: { name: string }) => t.name).sort()).toEqual(['ADS', 'MAIN', 'Winter']);
  });
});

describe('block types', () => {
  it('creates several numbered block types at once, edits and deletes them', async () => {
    const r = await as(a)
      .post('/api/block-types', {
        playlistId: a.mainPlaylistId, newGroupName: '1H Series Repeat 9', names: ['Repeat 9 Block 1', 'Repeat 9 Block 2'],
        color: '#4a90e2', textColor: '#ffffff', lengthFrames: min(60), validFrom: '2024-01-06', validTo: '2099-12-25',
        validWeekdays: ALL, fillGaps: true, opensWithBreak: true, note: '',
      })
      .expect(201);
    expect(r.body.map((t: { name: string }) => t.name)).toEqual(['Repeat 9 Block 1', 'Repeat 9 Block 2']);
    const id = r.body[0].id;
    const edited = await as(a).patch(`/api/block-types/${id}`, { name: 'Repeat 9 Block 1b', lengthFrames: min(45) }).expect(200);
    expect(edited.body).toMatchObject({ name: 'Repeat 9 Block 1b', lengthFrames: min(45) });
    await as(a).patch(`/api/block-types/${id}`, { validWeekdays: [false, false, false, false, false, false, false] }).expect(422);
    await as(a).del(`/api/block-types/${id}`).expect(204);
    const groups = await as(a).get('/api/block-groups').expect(200);
    expect(groups.body.map((g: { name: string }) => g.name)).toContain('1H Series Repeat 9');
  });

  it('refuses to delete a block type that a layout uses', async () => {
    await as(a).put(`/api/templates/${a.mainTemplateId}`, draft(a, 1, [block(6, a.types.run1, 0)])).expect(200);
    const r = await as(a).del(`/api/block-types/${a.types.run1}`).expect(409);
    expect(r.body.error).toMatch(/used by 1 block/);
    const list = await as(a).get('/api/block-types').expect(200);
    expect(list.body.find((t: { id: string }) => t.id === a.types.run1).usedCount).toBe(1);
  });
});

describe('block types in bulk', () => {
  it('creates many different ones all-or-nothing, in the plan given', async () => {
    const base = { color: '#4a90e2', textColor: '#ffffff', validFrom: '2024-01-06', validTo: '2099-12-25', validWeekdays: ALL, fillGaps: false, opensWithBreak: false, note: '' };
    const r = await as(a)
      .post('/api/block-types/bulk', { playlistId: a.adsPlaylistId, items: [{ ...base, groupId: a.groupId, name: 'sp 7', lengthFrames: min(5) }, { ...base, groupId: a.groupId, name: 'addbox 3', lengthFrames: min(18) }] })
      .expect(201);
    expect(r.body.map((t: { name: string; lengthFrames: number }) => [t.name, t.lengthFrames])).toEqual([['sp 7', min(5)], ['addbox 3', min(18)]]);
    const bad = await as(a)
      .post('/api/block-types/bulk', { playlistId: a.adsPlaylistId, items: [{ ...base, groupId: a.groupId, name: 'sp 8', lengthFrames: min(5) }, { ...base, groupId: a.groupId, name: 'sp 9', lengthFrames: 0 }] })
      .expect(422);
    expect(bad.body.error).toMatch(/length/);
    const all = (await as(a).get('/api/block-types').expect(200)).body.map((t: { name: string }) => t.name);
    expect(all).not.toContain('sp 8');
    await as(a).post('/api/block-types/bulk', { playlistId: b.adsPlaylistId, items: [{ ...base, groupId: a.groupId, name: 'x', lengthFrames: min(5) }] }).expect(404);
  });
});

describe('break lists', () => {
  it('are each channel’s own positions', async () => {
    const r = await as(a).post(`/api/channels/${a.channelId}/break-lists`, { name: 'Hourly', positions: [0, 1] }).expect(201);
    await as(a).post(`/api/channels/${a.channelId}/break-lists`, { name: 'Twice', positions: [0, 0] }).expect(422);
    await as(a).patch(`/api/break-lists/${r.body.id}`, { name: 'First two' }).expect(200);
    const list = await as(a).get(`/api/channels/${a.channelId}/break-lists`).expect(200);
    expect(list.body).toEqual([{ id: r.body.id, channelId: a.channelId, name: 'First two', positions: [0, 1] }]);
    await as(b).get(`/api/channels/${a.channelId}/break-lists`).expect(404);
    await as(b).del(`/api/break-lists/${r.body.id}`).expect(404);
    await as(a).del(`/api/break-lists/${r.body.id}`).expect(204);
  });
});
