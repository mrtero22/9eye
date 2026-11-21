import { uuidv7 } from '@9eye/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { auth, ALL, block, makeCatalog, makeCompany, min, resetDb, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
const as = (f: Fixture) => ({
  get: (url: string) => request(app).get(url).set(auth(f.slug)),
  post: (url: string, body: object) => request(app).post(url).set(auth(f.slug)).send(body),
  put: (url: string, body: object) => request(app).put(url).set(auth(f.slug)).send(body),
});

const W1 = '2030-06-01'; // a Saturday: the fixture channel's week starts on Saturday
const SAT = '2030-06-01';
const SUN = '2030-06-02';
const sec = (s: number) => s * 25;

let a: Fixture;
let b: Fixture;
let cat: CatalogFixture;

type Ev = { id: string; kind: string; title: string; startFrames: number; lengthFrames: number; breakName: string | null; inBreak: boolean; media: string | null; contentType: string | null; episode: number | null };
type Blk = { id: string; name: string; plannedStartFrames: number; plannedLengthFrames: number; realStartFrames: number; realLengthFrames: number; gapFrames: number; events: Ev[] };

const day = (f: Fixture, date: string, kind = 'main') => as(f).get(`/api/channels/${f.channelId}/days/${date}?kind=${kind}`);

/** Saturday: Run Block 1 06:00 with two linked breaks, Half Block 07:00. Sunday: Run Block 1 06:00. One week, both playlists. */
async function makeWeek(f: Fixture) {
  const blocks = [block(6, f.types.run1, 0, 60, [f.breaks['Billboard 1 06'], f.breaks['AB 06']]), block(6, f.types.half, 60, 30), block(0, f.types.run1, 0)];
  await as(f).put(`/api/templates/${f.mainTemplateId}`, { version: 1, name: 'MAIN', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL, blocks }).expect(200);
  await as(f).post(`/api/channels/${f.channelId}/weeks`, { kinds: ['main', 'ads'], fromWeek: W1, toWeek: W1 }).expect(201);
}

/**
 * Fills Saturday's first block by hand, as the next parts will: a programme in two parts around the
 * Ad Pod break, whose two spots were copied in under it; a note; the gap compensator stays last.
 */
async function fillSaturday(f: Fixture) {
  const d = (await day(f, SAT).expect(200)).body.day;
  const [first] = d.blocks as Blk[];
  const [sp1, adBox, gap] = first.events;
  const ev = (sequence: number, kind: string, title: string, lengthFrames: number, more: object = {}) => ({ id: uuidv7(), blockId: first.id, sequence, kind, title, lengthFrames, ...more });
  await platformDb.production.update({ where: { id: cat.harborEps[1] }, data: { mediaStatus: 'not-ready' } });
  await platformDb.playlistEvent.update({ where: { id: gap.id }, data: { sequence: 20 } });
  await platformDb.playlistEvent.update({ where: { id: adBox.id }, data: { sequence: 3 } });
  await platformDb.playlistEvent.createMany({
    data: [
      ev(1, 'program', 'Harbor Nights - 1', min(20), { productionId: cat.harborEps[0], tcOutFrames: min(20) }),
      ev(2, 'note', 'Check the subtitles', 0),
      ev(4, 'ident', 'LumenPlus_Ident_1', sec(15), { productionId: cat.identItems[0], relatedEventId: adBox.id }),
      ev(5, 'commercial', 'Instagram_Social', sec(7), { relatedEventId: adBox.id }),
      ev(6, 'program', 'Harbor Nights - 2', min(25), { productionId: cat.harborEps[1], tcInFrames: min(20), tcOutFrames: min(45) }),
    ],
  });
  return { sp1: sp1.id, adBox: adBox.id };
}

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
  cat = await makeCatalog(a);
  await makeWeek(a);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

describe('a day playlist', () => {
  it('opens as the week left it: the layout’s blocks, each with its linked-break rows and a gap holder', async () => {
    const r = await day(a, SAT).expect(200);
    expect(r.body).toMatchObject({ kind: 'main', date: SAT, weekFirstDate: W1, missing: null, week: { name: 'Week 22 2030 AURORA TV M', number: 22, templateName: 'MAIN' } });
    expect(r.body.channel).toMatchObject({ frameRate: '25', dayStartFrames: min(360) });
    expect(r.body.day).toMatchObject({ state: 'draft', version: 1, totalFrames: 0, notReady: 0 });
    const blocks: Blk[] = r.body.day.blocks;
    expect(blocks.map((x) => [x.name, x.plannedStartFrames, x.plannedLengthFrames, x.realLengthFrames, x.gapFrames])).toEqual([
      ['Run Block 1', 0, min(60), 0, -min(60)],
      ['Half Block', min(60), min(30), 0, -min(30)],
    ]);
    expect(blocks[0].events.map((e) => [e.kind, e.title, e.startFrames, e.lengthFrames, e.breakName])).toEqual([
      ['linked-break', 'Billboard 1 06:00', 0, 0, 'Billboard 1 06:00'],
      ['linked-break', 'Ad Pod 06:30', 0, 0, 'Ad Pod 06:30'],
      ['gap-compensator', '', 0, 0, null],
    ]);
    expect(blocks[1].events.map((e) => e.kind)).toEqual(['gap-compensator']);
  });

  it('gives every row the time it really starts, and each block its gap or overrun', async () => {
    await fillSaturday(a);
    const d = (await day(a, SAT).expect(200)).body.day;
    const [first, second]: Blk[] = d.blocks;
    expect(first.events.map((e) => [e.kind, e.title, e.startFrames, e.lengthFrames])).toEqual([
      ['linked-break', 'Billboard 1 06:00', 0, 0],
      ['program', 'Harbor Nights - 1', 0, min(20)],
      ['note', 'Check the subtitles', min(20), 0],
      ['linked-break', 'Ad Pod 06:30', min(20), sec(22)],
      ['ident', 'LumenPlus_Ident_1', min(20), sec(15)],
      ['commercial', 'Instagram_Social', min(20) + sec(15), sec(7)],
      ['program', 'Harbor Nights - 2', min(20) + sec(22), min(25)],
      ['gap-compensator', '', min(45) + sec(22), 0],
    ]);
    expect(first.realLengthFrames).toBe(min(45) + sec(22));
    expect(first.gapFrames).toBe(-(min(14) + sec(38)));
    // the second block is planned at 07:00 but starts where the first ended
    expect(second.plannedStartFrames).toBe(min(60));
    expect(second.realStartFrames).toBe(min(45) + sec(22));
    expect(d.totalFrames).toBe(min(45) + sec(22));
  });

  it('names the break a spot sits under, the category, the episode and media that is not ready', async () => {
    await fillSaturday(a);
    const d = (await day(a, SAT).expect(200)).body.day;
    const rows: Ev[] = d.blocks[0].events;
    const by = (title: string) => rows.find((e) => e.title === title)!;
    expect(by('LumenPlus_Ident_1')).toMatchObject({ inBreak: true, breakName: 'Ad Pod 06:30', contentType: 'Idents', media: 'ready' });
    expect(by('Instagram_Social')).toMatchObject({ inBreak: true, breakName: 'Ad Pod 06:30', contentType: null, media: null });
    expect(by('Harbor Nights - 1')).toMatchObject({ inBreak: false, breakName: null, contentType: 'TV Series Drama', episode: 1, media: 'ready' });
    expect(by('Harbor Nights - 2')).toMatchObject({ episode: 2, media: 'not-ready' });
    expect(by('Ad Pod 06:30')).toMatchObject({ inBreak: false, breakName: 'Ad Pod 06:30' });
    expect(d.notReady).toBe(1);
  });

  it('has its own ads playlist, one block per break', async () => {
    const r = await day(a, SAT, 'ads').expect(200);
    expect(r.body.week.name).toBe('Week 22 2030 AURORA TV Ads');
    const blocks: Blk[] = r.body.day.blocks;
    expect(blocks).toHaveLength(48);
    expect(blocks.slice(0, 2).map((x) => [x.name, x.plannedStartFrames, x.plannedLengthFrames])).toEqual([
      ['Billboard 1 06:00', 0, min(5)],
      ['Ad Pod 06:30', min(10), min(18)],
    ]);
    expect(blocks[0].events).toEqual([]);
  });

  it('says why a day has no playlist: no week yet, or a weekday that is off', async () => {
    const none = await day(a, '2030-06-10').expect(200);
    expect(none.body).toMatchObject({ day: null, week: null, missing: 'no-week', weekFirstDate: '2030-06-08' });
    await as(a).post(`/api/channels/${a.channelId}/weeks`, { kinds: ['main'], fromWeek: '2030-06-08', toWeek: '2030-06-08', activeWeekdays: [true, false, true, true, true, true, true] }).expect(201);
    const off = await day(a, '2030-06-10').expect(200);
    expect(off.body).toMatchObject({ day: null, missing: 'not-active', week: { number: 23 } });
    expect((await day(a, '2030-06-09').expect(200)).body.day.blocks).toHaveLength(1);
  });

  it('lists the state of the days around it for the date picker', async () => {
    const d = (await day(a, SUN).expect(200)).body;
    await as(a).post(`/api/days/${d.day.id}/publish`, { version: 1 }).expect(200);
    const r = await day(a, SAT).expect(200);
    expect(r.body.marks).toHaveLength(7);
    expect(r.body.marks.slice(0, 3)).toEqual([
      { date: '2030-06-01', state: 'draft' },
      { date: '2030-06-02', state: 'published' },
      { date: '2030-06-03', state: 'draft' },
    ]);
  });

  it('refuses a date that does not exist, a playlist the channel does not have, and another company', async () => {
    await day(a, '2030-02-30').expect(400);
    await as(a).get(`/api/channels/${a.channelId}/days/${SAT}?kind=radio`).expect(400);
    const c = await makeCompany('public', { ads: false });
    await day(c, SAT, 'ads').expect(404);
    await day(b, SAT).expect(200).then((r) => expect(r.body.missing).toBe('no-week'));
    await as(b).get(`/api/channels/${a.channelId}/days/${SAT}?kind=main`).expect(404);
  });
});

describe('changing a day by hand', () => {
  type RawEv = Ev & { productionId: string | null; segmentId: string | null; tcInFrames: number; tcOutFrames: number; fixed: boolean; hold: boolean; autoAdjust: boolean; note: string; breakTypeId: string | null; relatedEventId: string | null; orderId: string | null; rotationListId: string | null };
  const fields = (e: RawEv) => ({
    id: e.id, kind: e.kind, title: e.title, lengthFrames: e.kind === 'linked-break' ? 0 : e.lengthFrames, productionId: e.productionId, segmentId: e.segmentId,
    tcInFrames: e.tcInFrames, tcOutFrames: e.tcOutFrames, fixed: e.fixed, hold: e.hold, autoAdjust: e.autoAdjust, note: e.note, breakTypeId: e.breakTypeId, relatedEventId: e.relatedEventId, orderId: e.orderId, rotationListId: e.rotationListId,
  });
  const newRow = (kind: string, title: string, lengthFrames: number, more: object = {}) => ({
    id: uuidv7(), kind, title, lengthFrames, productionId: null, segmentId: null, tcInFrames: 0, tcOutFrames: 0, fixed: false, hold: false, autoAdjust: false, note: '', breakTypeId: null, relatedEventId: null, orderId: null, rotationListId: null, ...more,
  });
  /** The day as the browser sends it back: every block with its rows. */
  async function open(f: Fixture, date = SAT, kind = 'main') {
    const d = (await day(f, date, kind).expect(200)).body.day;
    return { id: d.id as string, version: d.version as number, blocks: (d.blocks as (Blk & { events: RawEv[] })[]).map((x) => ({ id: x.id, rows: x.events.map(fields) })) };
  }
  const put = (f: Fixture, id: string, body: object) => request(app).put(`/api/days/${id}`).set(auth(f.slug)).send(body);

  it('turns catalog items into rows: the kind follows the category’s family', async () => {
    const r = await as(a).post('/api/days/catalog-rows', { productionIds: [cat.identItems[0], uuidv7(), cat.harborEps[0], cat.harborEps[2]] }).expect(200);
    expect(r.body).toEqual([
      { productionId: cat.identItems[0], title: 'LumenPlus_Ident_1', kind: 'filler', lengthFrames: min(0.25), media: 'ready', contentType: 'Idents', color: null, episode: null },
      { productionId: cat.harborEps[0], title: 'Harbor Nights - 1', kind: 'program', lengthFrames: min(45), media: 'ready', contentType: 'TV Series Drama', color: null, episode: 1 },
      { productionId: cat.harborEps[2], title: 'Harbor Nights - 3', kind: 'program', lengthFrames: null, media: 'ready', contentType: 'TV Series Drama', color: null, episode: 3 },
    ]);
    expect((await as(b).post('/api/days/catalog-rows', { productionIds: [cat.harborEps[0]] }).expect(200)).body).toEqual([]);
  });

  it('saves the whole day: new rows, a spot under its break, a note; times follow', async () => {
    const d = await open(a);
    const [sp1, adBox, gap] = d.blocks[0].rows;
    d.blocks[0].rows = [
      sp1,
      newRow('program', 'whatever the browser says', min(20), { productionId: cat.harborEps[0], tcOutFrames: min(20) }),
      newRow('note', '  Check the subtitles  ', 0),
      adBox,
      newRow('commercial', 'Instagram_Social', sec(7), { relatedEventId: adBox.id, hold: true, note: 'new copy' }),
      gap,
    ];
    const r = await put(a, d.id, { version: d.version, blocks: d.blocks }).expect(200);
    expect(r.body.day).toMatchObject({ version: 2, state: 'draft', totalFrames: min(20) + sec(7) });
    const rows: RawEv[] = r.body.day.blocks[0].events;
    expect(rows.map((e) => [e.kind, e.title, e.startFrames, e.lengthFrames])).toEqual([
      ['linked-break', 'Billboard 1 06:00', 0, 0],
      ['program', 'Harbor Nights - 1', 0, min(20)], // the title is the catalog's
      ['note', 'Check the subtitles', min(20), 0],
      ['linked-break', 'Ad Pod 06:30', min(20), sec(7)],
      ['commercial', 'Instagram_Social', min(20), sec(7)],
      ['gap-compensator', '', min(20) + sec(7), 0],
    ]);
    expect(rows[4]).toMatchObject({ inBreak: true, breakName: 'Ad Pod 06:30', relatedEventId: adBox.id, hold: true, note: 'new copy' });
    expect(rows[1]).toMatchObject({ productionId: cat.harborEps[0], episode: 1, tcOutFrames: min(20) });

    // saved again unchanged, the rows keep their ids and titles
    const again = await open(a);
    expect(again.version).toBe(2);
    const second = await put(a, again.id, { version: 2, blocks: again.blocks }).expect(200);
    expect(second.body.day.blocks[0].events.map((e: RawEv) => e.id)).toEqual(rows.map((e) => e.id));
    expect(second.body.day.version).toBe(3);
  });

  it('saves nothing when a row breaks a rule, and lists every reason', async () => {
    const d = await open(a);
    const [sp1, adBox, gap] = d.blocks[0].rows;
    d.blocks[0].rows = [
      newRow('program', 'Gone', min(10), { productionId: uuidv7() }),
      newRow('linked-break', '', 0, { breakTypeId: a.types.half }), // a main block type is not a break
      sp1,
      newRow('commercial', 'Loose spot', sec(5), { relatedEventId: adBox.id }), // not under Ad Pod
      adBox,
      newRow('note', ' ', 0),
      newRow('program', 'Harbor Nights - 1', min(5), { productionId: cat.harborEps[0], tcInFrames: min(10), tcOutFrames: min(20) }), // length ≠ range
      gap,
    ];
    const r = await put(a, d.id, { version: d.version, blocks: d.blocks }).expect(422);
    expect(r.body.error).toBe('5 problems: nothing was saved.');
    expect(r.body.problems.map((p: { code: string }) => p.code).sort()).toEqual(['break', 'link', 'note', 'production', 'tc']);
    expect(await open(a)).toMatchObject({ version: 1 });
    expect((await open(a)).blocks[0].rows).toHaveLength(3);

    // a block cannot be dropped or added by a save
    const short = await open(a);
    const less = await put(a, short.id, { version: 1, blocks: [short.blocks[0]] }).expect(422);
    expect(less.body.problems.map((p: { code: string }) => p.code)).toEqual(['blocks']);
    // the ads playlist has no linked breaks
    const ads = await open(a, SAT, 'ads');
    ads.blocks[0].rows = [newRow('linked-break', '', 0, { breakTypeId: a.breaks['Billboard 1 06'] })];
    const no = await put(a, ads.id, { version: 1, blocks: ads.blocks }).expect(422);
    expect(no.body.problems.map((p: { code: string }) => p.code)).toEqual(['break']);
    // but it takes spots
    ads.blocks[0].rows = [newRow('commercial', 'Telegram_Social', sec(7))];
    const ok = await put(a, ads.id, { version: 1, blocks: ads.blocks }).expect(200);
    expect(ok.body.day.blocks[0]).toMatchObject({ realLengthFrames: sec(7), gapFrames: sec(7) - min(5) });
  });

  it('refuses a stale version, an approved day and another company', async () => {
    const d = await open(a);
    d.blocks[1].rows = [newRow('program', 'x', min(30), { productionId: cat.brightEps[0], tcOutFrames: min(30) }), ...d.blocks[1].rows];
    await put(a, d.id, { version: 1, blocks: d.blocks }).expect(200);
    const stale = await put(a, d.id, { version: 1, blocks: d.blocks }).expect(409);
    expect(stale.body.error).toMatch(/Someone else changed/);
    await put(b, d.id, { version: 2, blocks: d.blocks }).expect(404);
    await as(a).post(`/api/days/${d.id}/publish`, { version: 2 }).expect(200);
    const now = await open(a);
    const pub = await put(a, d.id, { version: 3, blocks: now.blocks.map((x) => ({ ...x, rows: [] })) }).expect(409);
    expect(pub.body.error).toMatch(/approved/);
    expect((await open(a)).blocks[1].rows).toHaveLength(2);
    // a week whose day holds placed rows cannot be deleted
    const week = (await as(a).get(`/api/channels/${a.channelId}/weeks?kind=main&from=2030-06-01&to=2030-06-01`).expect(200)).body[0];
    const del = await request(app).delete(`/api/weeks/${week.id}`).set(auth(a.slug)).expect(409);
    expect(del.body.problems.map((p: { message: string }) => p.message)).toEqual(['Sat 1 Jun 2030 is approved.']);
  });
});

describe('publishing a day', () => {
  it('publishes and unpublishes with a version check', async () => {
    const d = (await day(a, SAT).expect(200)).body.day;
    const pub = await as(a).post(`/api/days/${d.id}/publish`, { version: 1 }).expect(200);
    expect(pub.body).toEqual({ id: d.id, state: 'published', version: 2 });
    expect((await day(a, SAT).expect(200)).body.day).toMatchObject({ state: 'published', version: 2 });
    const twice = await as(a).post(`/api/days/${d.id}/publish`, { version: 2 }).expect(409);
    expect(twice.body.error).toMatch(/already approved/);
    const stale = await as(a).post(`/api/days/${d.id}/unpublish`, { version: 1 }).expect(409);
    expect(stale.body.error).toMatch(/Someone else changed/);
    await as(a).post(`/api/days/${d.id}/unpublish`, { version: 2 }).expect(200);
    expect((await day(a, SAT).expect(200)).body.day).toMatchObject({ state: 'draft', version: 3 });
    await as(a).post(`/api/days/${d.id}/unpublish`, { version: 3 }).expect(409);
  });

  it('never changes a reconciled day, and keeps companies apart', async () => {
    const d = (await day(a, SAT).expect(200)).body.day;
    await as(b).post(`/api/days/${d.id}/publish`, { version: 1 }).expect(404);
    await platformDb.dayPlaylist.update({ where: { id: d.id }, data: { published: true, reconciled: true } });
    const r = await as(a).post(`/api/days/${d.id}/unpublish`, { version: 1 }).expect(409);
    expect(r.body.error).toMatch(/reconciled/);
    expect((await day(a, SAT).expect(200)).body.day.state).toBe('reconciled');
  });
});
