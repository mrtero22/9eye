import { uuidv7 } from '@9eye/core';
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

// Saturdays far in the future: the fixture channel's week starts on Saturday.
const W1 = '2030-06-01'; // ISO week 22
const W2 = '2030-06-08';
const W3 = '2030-06-15';

let a: Fixture;
let b: Fixture;

type Week = { id: string; kind: string; name: string; firstDate: string; templateId: string; version: number; days: { id: string | null; date: string; state: string; blocks: number }[] };
type Problem = { code: string; kind?: string; firstDate?: string; message: string };

/** Saturday: Run Block 1 06:00 with two linked breaks, Half Block 07:00. Sunday: Run Block 1 06:00. */
async function fillMain(f: Fixture, breaks: string[] = [f.breaks['Billboard 1 06'], f.breaks['AB 06']]) {
  const blocks = [block(6, f.types.run1, 0, 60, breaks), block(6, f.types.half, 60, 30), block(0, f.types.run1, 0)];
  await as(f).put(`/api/templates/${f.mainTemplateId}`, { version: 1, name: 'MAIN', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL, blocks }).expect(200);
}

const run = (over: object = {}) => ({ kinds: ['ads', 'main'], fromWeek: W1, toWeek: W2, ...over });
const list = async (f: Fixture, kind = 'main', from = '2030-01-01', to = '2030-12-31'): Promise<Week[]> =>
  (await as(f).get(`/api/channels/${f.channelId}/weeks?kind=${kind}&from=${from}&to=${to}`).expect(200)).body;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
  await fillMain(a);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

describe('create weeks', () => {
  it('checks a run without writing, then creates it week by week, main before ads', async () => {
    const check = await as(a).post(`/api/channels/${a.channelId}/weeks/check`, run()).expect(200);
    expect(check.body.problems).toEqual([]);
    expect(check.body.warnings).toEqual([]);
    expect(check.body.weeks.map((w: { firstDate: string; kind: string; name: string }) => [w.firstDate, w.kind, w.name])).toEqual([
      [W1, 'main', 'Week 22 2030 AURORA TV M'],
      [W1, 'ads', 'Week 22 2030 AURORA TV Ads'],
      [W2, 'main', 'Week 23 2030 AURORA TV M'],
      [W2, 'ads', 'Week 23 2030 AURORA TV Ads'],
    ]);
    expect(await list(a)).toEqual([]);

    const made = await as(a).post(`/api/channels/${a.channelId}/weeks`, run()).expect(201);
    expect(made.body.weeks.map((w: Week) => [w.firstDate, w.kind])).toEqual([[W1, 'main'], [W1, 'ads'], [W2, 'main'], [W2, 'ads']]);
    expect(made.body.weeks[0]).toMatchObject({ number: 22, lastDate: '2030-06-07', templateId: a.mainTemplateId, templateName: 'MAIN', version: 1, createdBy: 'Local user', updatedBy: 'Local user' });

    const mains = await list(a);
    expect(mains.map((w) => w.name)).toEqual(['Week 22 2030 AURORA TV M', 'Week 23 2030 AURORA TV M']);
    expect(mains[0].days.map((d) => [d.date, d.state, d.blocks])).toEqual([
      ['2030-06-01', 'draft', 2],
      ['2030-06-02', 'draft', 1],
      ['2030-06-03', 'draft', 0],
      ['2030-06-04', 'draft', 0],
      ['2030-06-05', 'draft', 0],
      ['2030-06-06', 'draft', 0],
      ['2030-06-07', 'draft', 0],
    ]);
    expect((await list(a, 'ads')).map((w) => w.days[0].blocks)).toEqual([48, 48]);
    expect(await list(a, 'main', '2030-06-08', '2030-06-08')).toHaveLength(1);
  });

  it('copies the layout’s blocks; a main block starts with its linked-break rows and a gap holder', async () => {
    const made = await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ toWeek: W1 })).expect(201);
    const main = await as(a).get(`/api/weeks/${made.body.weeks[0].id}`).expect(200);
    expect(main.body.channel).toMatchObject({ weekStart: 6, frameRate: '25' });
    const sat = main.body.days[0];
    expect(sat.blockList.map((x: { blockTypeId: string; startFrames: number; lengthFrames: number }) => [x.blockTypeId, x.startFrames, x.lengthFrames])).toEqual([
      [a.types.run1, 0, min(60)],
      [a.types.half, min(60), min(30)],
    ]);
    expect(sat.blockList[0].events.map((e: { kind: string; breakTypeId: string | null; lengthFrames: number }) => [e.kind, e.breakTypeId, e.lengthFrames])).toEqual([
      ['linked-break', a.breaks['Billboard 1 06'], 0],
      ['linked-break', a.breaks['AB 06'], 0],
      ['gap-compensator', null, 0],
    ]);
    expect(sat.blockList[1].events.map((e: { kind: string }) => e.kind)).toEqual(['gap-compensator']);
    const ads = await as(a).get(`/api/weeks/${made.body.weeks[1].id}`).expect(200);
    expect(ads.body.days[0].blockList).toHaveLength(48);
    expect(ads.body.days[0].blockList[0].events).toEqual([]);
    // the template is untouched
    const t = await as(a).get(`/api/templates/${a.mainTemplateId}`).expect(200);
    expect(t.body.blocks).toHaveLength(3);
  });

  it('never creates a week twice, and creates nothing when one week of the run is refused', async () => {
    await as(a).post(`/api/channels/${a.channelId}/weeks`, run()).expect(201);
    const again = await as(a).post(`/api/channels/${a.channelId}/weeks`, run()).expect(422);
    expect(again.body.error).toBe('4 problems: nothing was created.');
    expect(again.body.problems.map((p: Problem) => [p.code, p.kind, p.firstDate])).toEqual([
      ['exists', 'main', W1],
      ['exists', 'ads', W1],
      ['exists', 'main', W2],
      ['exists', 'ads', W2],
    ]);
    const overlap = await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ fromWeek: W2, toWeek: W3 })).expect(422);
    expect(overlap.body.problems.map((p: Problem) => p.firstDate)).toEqual([W2, W2]);
    expect((await list(a)).map((w) => w.firstDate)).toEqual([W1, W2]);
    expect((await list(a, 'ads')).map((w) => w.firstDate)).toEqual([W1, W2]);
  });

  it('needs week starts and a layout whose dates hold the week', async () => {
    const notAStart = await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ fromWeek: '2030-06-02', toWeek: '2030-06-02' })).expect(422);
    expect(notAStart.body.error).toMatch(/starts on a Saturday/);
    const early = await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ kinds: ['main'], fromWeek: '2023-01-07', toWeek: '2023-01-07' })).expect(422);
    expect(early.body.problems.map((p: Problem) => p.code)).toEqual(['no-template']);
    await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ fromWeek: '2030-13-45' })).expect(422);
    expect(await list(a, 'main', '2020-01-01', '2031-01-01')).toEqual([]);
  });

  it('asks which layout when several fit and uses the picked one', async () => {
    const winter = await as(a).post('/api/templates', { playlistId: a.mainPlaylistId, name: 'Winter', validFrom: '2030-01-05', validTo: '2030-12-27' }).expect(201);
    const ask = await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ kinds: ['main'], toWeek: W1 })).expect(422);
    expect(ask.body.problems.map((p: Problem) => p.code)).toEqual(['pick-template']);
    const made = await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ kinds: ['main'], toWeek: W1, templates: { main: winter.body.template.id } })).expect(201);
    expect(made.body.weeks[0]).toMatchObject({ templateName: 'Winter', templateId: winter.body.template.id });
    expect(made.body.weeks[0].days.map((d: { blocks: number }) => d.blocks)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('makes no day playlist for a day that is not active', async () => {
    const noFriday = [true, true, true, true, true, false, true];
    const made = await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ kinds: ['main'], toWeek: W1, activeWeekdays: noFriday })).expect(201);
    const days = made.body.weeks[0].days;
    expect(days[6]).toEqual({ id: null, date: '2030-06-07', weekday: 5, state: 'not-active', blocks: 0 });
    expect(days.filter((d: { id: string | null }) => d.id).length).toBe(6);
    await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ kinds: ['main'], fromWeek: W2, activeWeekdays: [false, false, false, false, false, false, false] })).expect(422);
  });

  it('a main-only channel has main weeks only', async () => {
    const c = await makeCompany('public', { ads: false });
    const both = await as(c).post(`/api/channels/${c.channelId}/weeks`, run({ toWeek: W1 })).expect(422);
    expect(both.body.problems.map((p: Problem) => [p.code, p.kind])).toEqual([['no-playlist', 'ads']]);
    await as(c).post(`/api/channels/${c.channelId}/weeks`, run({ kinds: [], toWeek: W1 })).expect(422);
    const made = await as(c).post(`/api/channels/${c.channelId}/weeks`, run({ kinds: ['main'], toWeek: W1 })).expect(201);
    expect(made.body.weeks.map((w: Week) => w.kind)).toEqual(['main']);
    expect(await list(c, 'ads')).toEqual([]);
  });

  it('warns about past weeks and linked breaks without an ads block, and still creates', async () => {
    const base = { color: '#4a90e2', textColor: '#ffffff', validFrom: '2024-01-06', validTo: '2099-12-25', validWeekdays: ALL, fillGaps: false, opensWithBreak: false, note: '' };
    const extra = await as(a).post('/api/block-types/bulk', { playlistId: a.adsPlaylistId, items: [{ ...base, groupId: a.groupId, name: 'SP9 06:45', lengthFrames: min(5) }] }).expect(201);
    const blocks = [block(6, a.types.run1, 0, 60, [a.breaks['Billboard 1 06'], extra.body[0].id])];
    await as(a).put(`/api/templates/${a.mainTemplateId}`, { version: 2, name: 'MAIN', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL, blocks }).expect(200);
    const past = '2025-01-04';
    const made = await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ fromWeek: past, toWeek: past })).expect(201);
    expect(made.body.warnings.map((w: Problem) => [w.code, w.firstDate])).toEqual([['past', past], ['unmatched-breaks', past]]);
    expect(made.body.warnings[1].message).toBe('Week 1: 1 linked break has no block in the ads layout (first: the block at Saturday 06:00). The week is still created.');
    expect(made.body.weeks).toHaveLength(2);
  });
});

describe('one week', () => {
  let week: Week;
  let adsWeek: Week;

  beforeEach(async () => {
    const made = await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ toWeek: W1 })).expect(201);
    [week, adsWeek] = made.body.weeks;
  });

  it('is renamed with a version check', async () => {
    const r = await as(a).patch(`/api/weeks/${week.id}`, { name: '  Eid special  ', version: 1 }).expect(200);
    expect(r.body).toMatchObject({ name: 'Eid special', version: 2, updatedBy: 'Local user' });
    await as(a).patch(`/api/weeks/${week.id}`, { name: 'x'.repeat(51), version: 2 }).expect(422);
    await as(a).patch(`/api/weeks/${week.id}`, { name: ' ', version: 2 }).expect(422);
    const stale = await as(a).patch(`/api/weeks/${week.id}`, { name: 'Late', version: 1 }).expect(409);
    expect(stale.body.error).toMatch(/Someone else changed/);
    expect((await list(a))[0].name).toBe('Eid special');
  });

  it('is deleted with its day playlists, and can be created again', async () => {
    await as(a).del(`/api/weeks/${week.id}`).expect(204);
    await as(a).get(`/api/weeks/${week.id}`).expect(404);
    expect(await list(a)).toEqual([]);
    expect(await list(a, 'ads')).toHaveLength(1);
    expect(await platformDb.dayPlaylist.count({ where: { weekId: week.id } })).toBe(0);
    expect(await platformDb.playlistBlock.count({ where: { day: { weekId: adsWeek.id } } })).toBe(7 * 48);
    await as(a).post(`/api/channels/${a.channelId}/weeks`, run({ kinds: ['main'], toWeek: W1 })).expect(201);
  });

  it('is not deleted while a day is approved, reconciled or holds placed events', async () => {
    await platformDb.dayPlaylist.update({ where: { id: week.days[0].id! }, data: { published: true, reconciled: true } });
    await platformDb.dayPlaylist.update({ where: { id: week.days[1].id! }, data: { published: true } });
    const sunday = await platformDb.playlistBlock.findFirstOrThrow({ where: { dayId: week.days[1].id! } });
    const monday = await platformDb.playlistBlock.create({ data: { id: uuidv7(), dayId: week.days[2].id!, blockTypeId: a.types.run2, startFrames: 0, lengthFrames: min(60), fillGaps: true, opensWithBreak: false } });
    await platformDb.playlistEvent.create({ data: { id: uuidv7(), blockId: sunday.id, sequence: 5, kind: 'program', lengthFrames: min(45) } });
    await platformDb.playlistEvent.create({ data: { id: uuidv7(), blockId: monday.id, sequence: 0, kind: 'program', lengthFrames: min(45) } });
    const r = await as(a).del(`/api/weeks/${week.id}`).expect(409);
    expect(r.body.error).toBe('This week is in use: nothing was deleted.');
    expect(r.body.problems.map((p: Problem) => p.message)).toEqual(['Sat 1 Jun 2030 is reconciled.', 'Sun 2 Jun 2030 is approved.', 'Mon 3 Jun 2030 holds 1 placed event.']);
    expect((await list(a))[0].days.map((d) => d.state).slice(0, 3)).toEqual(['reconciled', 'published', 'draft']);
  });

  it('belongs to its company', async () => {
    await as(b).get(`/api/weeks/${week.id}`).expect(404);
    await as(b).patch(`/api/weeks/${week.id}`, { name: 'Mine', version: 1 }).expect(404);
    await as(b).del(`/api/weeks/${week.id}`).expect(404);
    await as(b).get(`/api/channels/${a.channelId}/weeks?kind=main&from=2030-01-01&to=2030-12-31`).expect(404);
    await as(b).post(`/api/channels/${a.channelId}/weeks`, run()).expect(404);
    expect(await list(b)).toEqual([]);
    expect((await list(a))[0].name).toBe('Week 22 2030 AURORA TV M');
  });
});
