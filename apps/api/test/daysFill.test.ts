// Playlist → Day, part 3: filling a day from what exists — program placements of confirmed orders,
// the ads playlist's spots under their linked breaks, rotation lists in the free time — and saving
// what a step placed (orders, segments, the rotation list moving on).

import { uuidv7, playoutXmlFirstItemId, playoutXmlPrefix } from '@9eye/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { fromIsoDate, platformDb } from '../src/db';
import { ALL, auth, block, makeCatalog, makeCatalogExtras, makeCompany, min, resetDb, type CatalogExtras, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
const SAT = '2030-06-01';
const sec = (s: number) => s * 25;

let a: Fixture;
let b: Fixture;
let cat: CatalogFixture;
let extra: CatalogExtras;
let order: string;

type Ev = { id: string; kind: string; title: string; lengthFrames: number; productionId: string | null; segmentId: string | null; tcInFrames: number; tcOutFrames: number; fixed: boolean; hold: boolean; autoAdjust: boolean; note: string; breakTypeId: string | null; relatedEventId: string | null; orderId: string | null; rotationListId: string | null };
type Blk = { id: string; name: string; events: Ev[] };
type Line = { title: string; block: string; detail: string; frames: number | null };

const get = (f: Fixture, url: string) => request(app).get(url).set(auth(f.slug));
const post = (f: Fixture, url: string, body: object) => request(app).post(url).set(auth(f.slug)).send(body);
const put = (f: Fixture, url: string, body: object) => request(app).put(url).set(auth(f.slug)).send(body);
const fields = (e: Ev) => ({
  id: e.id, kind: e.kind, title: e.title, lengthFrames: e.kind === 'linked-break' ? 0 : e.lengthFrames, productionId: e.productionId, segmentId: e.segmentId, tcInFrames: e.tcInFrames, tcOutFrames: e.tcOutFrames,
  fixed: e.fixed, hold: e.hold, autoAdjust: e.autoAdjust, note: e.note, breakTypeId: e.breakTypeId, relatedEventId: e.relatedEventId, orderId: e.orderId, rotationListId: e.rotationListId,
});

/** The day as the browser holds it: id, version, every block with its rows. */
async function open(f: Fixture, kind = 'main') {
  const r = await get(f, `/api/channels/${f.channelId}/days/${SAT}?kind=${kind}`).expect(200);
  const d = r.body.day;
  return { id: d.id as string, version: d.version as number, checks: d.checks, blocks: (d.blocks as Blk[]).map((x) => ({ id: x.id, rows: x.events.map(fields) })), names: (d.blocks as Blk[]).map((x) => x.name) };
}
const run = (f: Fixture, d: Awaited<ReturnType<typeof open>>, step: string, more: object = {}) => post(f, `/api/days/${d.id}/run`, { step, mode: 'missing', version: d.version, blocks: d.blocks, ...more });
const titles = (blocks: Blk[], i: number) => blocks[i].events.map((e) => (e.kind === 'gap-compensator' ? 'GC' : e.title));
const asDraft = (blocks: Blk[]) => blocks.map((x) => ({ id: x.id, rows: x.events.map(fields) }));

/**
 * Saturday: Run Block 1 06:00 (opens with its break Billboard 1, then Ad Pod), Half Block 07:00. Harbor Nights 1
 * has three 15-minute segments. Orders: Harbor (series, confirmed) — episode 1 in Run Block 1, its
 * repeat in Half Block, episode 2 in Run Block 2 (not in this day); a draft and a promo order.
 * The ads playlist has two spots in Billboard 1 06:00 and one in Ad Pod 06:30.
 */
async function setUp() {
  const blocks = [block(6, a.types.run1, 0, 60, [a.breaks['Billboard 1 06'], a.breaks['AB 06']]), block(6, a.types.half, 60, 30)];
  await put(a, `/api/templates/${a.mainTemplateId}`, { version: 1, name: 'MAIN', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL, blocks }).expect(200);
  await post(a, `/api/channels/${a.channelId}/weeks`, { kinds: ['main', 'ads'], fromWeek: SAT, toWeek: SAT }).expect(201);

  const mkOrder = async (name: string, mode: string, status: string, productions: string[]) => {
    const id = uuidv7();
    await platformDb.order.create({ data: { id, tenantId: a.tenantId, name, mode, status, startDate: fromIsoDate('2030-05-01'), endDate: fromIsoDate('2030-07-01'), color: '#0284c7' } });
    await platformDb.orderChannel.create({ data: { id: uuidv7(), orderId: id, channelId: a.channelId, templateId: a.mainTemplateId, position: 0 } });
    const items = productions.map((productionId, position) => ({ id: uuidv7(), orderId: id, position, productionId }));
    await platformDb.orderItem.createMany({ data: items });
    const air = async (blockTypeId: string, itemIds: string[], repeatOfId: string | null = null) => {
      const airingId = uuidv7();
      await platformDb.airing.create({ data: { id: airingId, tenantId: a.tenantId, orderId: id, channelId: a.channelId, date: fromIsoDate(SAT), blockTypeId, passes: repeatOfId ? 0 : 1, repeatOfId } });
      await platformDb.airingItem.createMany({ data: itemIds.map((orderItemId, position) => ({ id: uuidv7(), airingId, position, orderItemId })) });
      return airingId;
    };
    return { id, items: items.map((i) => i.id), air };
  };
  const harbor = await mkOrder('Harbor - Lumen Plus', 'series', 'confirmed', [cat.harborEps[0], cat.harborEps[1]]);
  const first = await harbor.air(a.types.run1, [harbor.items[0]]);
  await harbor.air(a.types.half, [], first);
  await harbor.air(a.types.run2, [harbor.items[1]]);
  const draft = await mkOrder('Bright Lanes - draft', 'series', 'draft', [cat.brightEps[0]]);
  await draft.air(a.types.half, [draft.items[0]]);
  const promo = await mkOrder('Idents', 'promos', 'confirmed', [cat.identItems[0]]);
  await promo.air(a.types.half, [promo.items[0]]);
  order = harbor.id;

  // the ads playlist's spots
  const ads = await platformDb.dayPlaylist.findFirstOrThrow({ where: { playlistId: a.adsPlaylistId!, date: fromIsoDate(SAT) }, include: { blocks: true } });
  const sp1 = ads.blocks.find((x) => x.blockTypeId === a.breaks['Billboard 1 06'])!;
  const ab = ads.blocks.find((x) => x.blockTypeId === a.breaks['AB 06'])!;
  const spot = (blockId: string, sequence: number, title: string, seconds: number, productionId: string | null = null) => ({ id: uuidv7(), blockId, sequence, kind: 'commercial', title, lengthFrames: sec(seconds), tcOutFrames: sec(seconds), productionId });
  await platformDb.playlistEvent.createMany({ data: [spot(sp1.id, 0, 'Spot A', 30), spot(sp1.id, 1, 'Spot B', 20), spot(ab.id, 0, 'LumenPlus_Ident_1', 15, cat.identItems[0])] });
  // the rotation list walks in order here
  await platformDb.rotationList.update({ where: { id: extra.list }, data: { randomInsert: false, lastItemPosition: null } });
}

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
  cat = await makeCatalog(a);
  extra = await makeCatalogExtras(a, cat);
  await setUp();
});

afterAll(async () => {
  await platformDb.$disconnect();
});

describe('what a day is filled from', () => {
  it('the day lists the airings it should play and the ads playlist’s breaks', async () => {
    const d = await open(a);
    expect(d.checks.placements.map((p: { blockName: string; titles: string[]; repeat: boolean; blockId: string | null }) => [p.blockName, p.titles, p.repeat, !!p.blockId])).toEqual([
      ['Run Block 1', ['Harbor Nights - 1'], false, true],
      ['Half Block', ['Harbor Nights - 1'], true, true],
      ['Run Block 2', ['Harbor Nights - 2'], false, false],
    ]);
    const adsBreaks = d.checks.adsBreaks as { name: string; spots: { title: string }[] }[];
    expect(adsBreaks.filter((x) => x.spots.length).map((x) => [x.name, x.spots.map((s) => s.title)])).toEqual([
      ['Billboard 1 06:00', ['Spot A', 'Spot B']],
      ['Ad Pod 06:30', ['LumenPlus_Ident_1']],
    ]);
    expect(d.checks.defaultListId).toBeNull();
    const ads = await open(a, 'ads');
    expect(ads.checks).toEqual({ placements: [], adsBreaks: null, defaultListId: null, booked: [] });
  });

  it('lists the rotation lists of the company', async () => {
    expect((await get(a, '/api/rotation-lists').expect(200)).body).toEqual([{ id: extra.list, name: 'Lumen Fillers', items: 3 }]);
    expect((await get(b, '/api/rotation-lists').expect(200)).body).toEqual([]);
  });
});

describe('import program placements', () => {
  it('places each airing in its block, split across the breaks; says what was not placed and why', async () => {
    const d = await open(a);
    const r = await run(a, d, 'programs').expect(200);
    const blocks: Blk[] = r.body.blocks;
    // Run Block 1 opens with Billboard 1 (not a split point): part 1 before Ad Pod, parts 2 and 3 at the end
    expect(titles(blocks, 0)).toEqual(['Billboard 1 06:00', 'Harbor Nights - 1', 'Ad Pod 06:30', 'Harbor Nights - 1', 'Harbor Nights - 1', 'GC']);
    expect(blocks[0].events.filter((e) => e.kind === 'program').map((e) => [e.segmentId, e.tcInFrames, e.tcOutFrames, e.orderId])).toEqual(
      extra.harborSegs.map((s, i) => [s, min(15 * i), min(15 * (i + 1)), order]),
    );
    // the repeat in Half Block: the first airing's episode, whole
    expect(titles(blocks, 1)).toEqual(['Harbor Nights - 1', 'Harbor Nights - 1', 'Harbor Nights - 1', 'GC']);
    const report = r.body.report as { placed: Line[]; notPlaced: Line[]; notes: string[]; kept: number };
    expect(report.placed).toEqual([
      { title: 'Harbor Nights - 1', block: 'Run Block 1', detail: 'Harbor - Lumen Plus · 3 parts', frames: min(45) },
      { title: 'Harbor Nights - 1', block: 'Half Block', detail: 'Harbor - Lumen Plus · 3 parts · repeat', frames: min(45) },
    ]);
    expect(report.notPlaced).toEqual([{ title: 'Harbor Nights - 2', block: 'Run Block 2', detail: 'This day has no block “Run Block 2”: the week was made from another layout.', frames: null }]);
    expect(report.notes).toEqual([
      '1 airing of draft plans was left out: only confirmed plans reach the playlist.',
      '1 airing of trailer, sting or graphics plans is not placed by this step (not built yet).',
    ]);
    // nothing is saved until the person saves
    expect((await open(a)).blocks[0].rows).toHaveLength(3);

    // saved, then run again: only what is missing keeps what is there
    await put(a, `/api/days/${d.id}`, { version: d.version, blocks: asDraft(blocks) }).expect(200);
    const saved = await open(a);
    expect(saved.blocks[0].rows.filter((x) => x.orderId === order)).toHaveLength(3);
    const again = await run(a, saved, 'programs').expect(200);
    expect(again.body.report).toMatchObject({ kept: 2, placed: [] });
    const all = await run(a, saved, 'programs', { mode: 'all' }).expect(200);
    expect(all.body.report).toMatchObject({ removed: 6, kept: 0 });
    expect(all.body.report.placed).toHaveLength(2);
  });

  it('refuses a stale draft, an approved day, another company’s day, and an ads playlist', async () => {
    const d = await open(a);
    expect((await run(a, { ...d, version: d.version + 1 }, 'programs').expect(409)).body.error).toMatch(/Someone else changed this day/);
    await run(b, d, 'programs').expect(404);
    const ads = await open(a, 'ads');
    await run(a, ads, 'programs').expect(400);
    await post(a, `/api/days/${d.id}/publish`, { version: d.version }).expect(200);
    expect((await run(a, { ...d, version: d.version + 1 }, 'programs').expect(409)).body.error).toMatch(/approved/);
  });
});

describe('import break events', () => {
  it('copies the ads playlist’s spots in under their linked breaks', async () => {
    const d = await open(a);
    const r = await run(a, d, 'breaks').expect(200);
    const blocks: Blk[] = r.body.blocks;
    expect(titles(blocks, 0)).toEqual(['Billboard 1 06:00', 'Spot A', 'Spot B', 'Ad Pod 06:30', 'LumenPlus_Ident_1', 'GC']);
    const [sp1, , , ab] = blocks[0].events;
    expect(blocks[0].events.filter((e) => e.relatedEventId).map((e) => [e.title, e.relatedEventId === sp1.id ? 'Billboard 1' : e.relatedEventId === ab.id ? 'AB' : '?'])).toEqual([
      ['Spot A', 'Billboard 1'],
      ['Spot B', 'Billboard 1'],
      ['LumenPlus_Ident_1', 'AB'],
    ]);
    // a linked break shows the length of its spots
    expect(sp1.lengthFrames).toBe(sec(50));
    expect(r.body.report.placed).toEqual([
      { title: 'Billboard 1 06:00', block: 'Run Block 1', detail: '2 spots', frames: sec(50) },
      { title: 'Ad Pod 06:30', block: 'Run Block 1', detail: '1 spot', frames: sec(15) },
    ]);
    await put(a, `/api/days/${d.id}`, { version: d.version, blocks: asDraft(blocks) }).expect(200);
    expect((await run(a, await open(a), 'breaks').expect(200)).body.report).toMatchObject({ kept: 2, placed: [] });
  });
});

describe('import rotation lists', () => {
  it('fills the free time of each block from a list, and the list moves on when the day is saved', async () => {
    // Run Block 1 has a 45-minute programme: 15 minutes free; Half Block is empty
    const d = await open(a);
    const programmes = (await run(a, d, 'programs').expect(200)).body.blocks as Blk[];
    const draft = { ...d, blocks: asDraft(programmes) };
    const r = await run(a, draft, 'rotation', { listId: extra.list }).expect(200);
    const blocks: Blk[] = r.body.blocks;
    // three 15-second idents, each once a day: all go into Run Block 1
    expect(titles(blocks, 0).slice(-4)).toEqual(['LumenPlus_Ident_1', 'LumenPlus_Ident_2', 'LumenPlus_Ident_3', 'GC']);
    expect(blocks[0].events.filter((e) => e.rotationListId === extra.list)).toHaveLength(3);
    expect(r.body.report.placed).toEqual([{ title: 'Lumen Fillers', block: 'Run Block 1', detail: '3 items', frames: sec(45) }]);
    // Half Block runs over with its 45-minute repeat: nothing to fill there
    expect(r.body.report.notPlaced).toEqual([]);

    // without a list for the blocks, nothing can be filled
    const none = await run(a, draft, 'rotation').expect(200);
    expect(none.body.report.notPlaced.map((l: Line) => l.detail)).toEqual(['No rotation list is set for this block.', 'No rotation list is set for this block.']);
    await run(a, draft, 'rotation', { listId: uuidv7() }).expect(404);
    // …unless the channel names a default list: a block without its own list takes that one
    await platformDb.channel.update({ where: { id: a.channelId }, data: { defaultRotationListName: 'Lumen Fillers' } });
    const byDefault = await run(a, draft, 'rotation').expect(200);
    expect(byDefault.body.report.placed).toEqual([{ title: 'Lumen Fillers', block: 'Run Block 1', detail: '3 items', frames: sec(45) }]);
    await platformDb.channel.update({ where: { id: a.channelId }, data: { defaultRotationListName: null } });

    await put(a, `/api/days/${d.id}`, { version: d.version, blocks: asDraft(blocks) }).expect(200);
    const list = await platformDb.rotationList.findUniqueOrThrow({ where: { id: extra.list }, include: { items: { orderBy: { position: 'asc' } } } });
    expect(list.lastItemPosition).toBe(3);
    expect(list.items.map((i) => i.insertedAt?.toISOString().slice(0, 10))).toEqual([SAT, SAT, SAT]);
    // already in the day: the idents do not go in twice
    const again = await run(a, await open(a), 'rotation', { listId: extra.list }).expect(200);
    expect(again.body.report.placed).toEqual([]);
  });

  it('fills only the blocks asked for (a gap row)', async () => {
    const d = await open(a);
    const r = await run(a, d, 'rotation', { listId: extra.list, blockIds: [d.blocks[1].id] }).expect(200);
    expect(titles(r.body.blocks, 0)).toEqual(['Billboard 1 06:00', 'Ad Pod 06:30', 'GC']);
    expect(titles(r.body.blocks, 1)).toEqual(['LumenPlus_Ident_1', 'LumenPlus_Ident_2', 'LumenPlus_Ident_3', 'GC']);
  });
});

describe('saving what a step placed', () => {
  it('refuses a part of another item, a plan that does not air here, and an unknown rotation list', async () => {
    const d = await open(a);
    const row = (more: object) => ({
      id: uuidv7(), kind: 'program', title: 'x', lengthFrames: min(15), productionId: cat.harborEps[1], segmentId: null, tcInFrames: 0, tcOutFrames: min(15), fixed: false, hold: false, autoAdjust: false, note: '',
      breakTypeId: null, relatedEventId: null, orderId: null, rotationListId: null, ...more,
    });
    const otherOrder = uuidv7();
    await platformDb.order.create({ data: { id: otherOrder, tenantId: a.tenantId, name: 'Elsewhere', mode: 'series', status: 'confirmed', startDate: fromIsoDate('2030-05-01'), endDate: fromIsoDate('2030-07-01'), color: '#0284c7' } });
    const blocks = d.blocks.map((x, i) => (i === 1 ? { ...x, rows: [row({ segmentId: extra.harborSegs[0] }), row({ orderId: otherOrder }), row({ rotationListId: uuidv7() }), ...x.rows] } : x));
    const r = await put(a, `/api/days/${d.id}`, { version: d.version, blocks }).expect(422);
    expect(r.body.problems.map((p: { code: string }) => p.code)).toEqual(['segment', 'order', 'rotation']);
    // the right ones are saved
    const ok = d.blocks.map((x, i) => (i === 1 ? { ...x, rows: [row({ productionId: cat.harborEps[0], segmentId: extra.harborSegs[0], orderId: order }), ...x.rows] } : x));
    await put(a, `/api/days/${d.id}`, { version: d.version, blocks: ok }).expect(200);
  });
});

describe('export to the playout', () => {
  it('Playout XML: the saved main playlist, one item per playable row; linked breaks, gap rows and notes left out', async () => {
    const d = await open(a);
    const placed = (await run(a, d, 'programs', { mode: 'all' }).expect(200)).body.blocks as Blk[];
    const filled = (await run(a, { ...d, blocks: asDraft(placed) }, 'breaks', { mode: 'all' }).expect(200)).body.blocks as Blk[];
    await put(a, `/api/days/${d.id}`, { version: d.version, blocks: asDraft(filled) }).expect(200);
    const rows = filled.flatMap((x) => x.events).filter((e) => !['linked-break', 'gap-compensator', 'note'].includes(e.kind));
    const at = rows.findIndex((e) => e.productionId);
    await platformDb.production.update({ where: { id: rows[at].productionId! }, data: { additionalData: 'M:\\FTP\\Harbor & Co\\EP01.mp4', notes: 'Program', customValues: { STAR: 'AURORA' } } });

    const r = await get(a, `/api/channels/${a.channelId}/days/${SAT}/export?format=playout-xml`).expect(200);
    const ymd = SAT.replace(/-/g, '_');
    expect(r.body.fileName).toMatch(new RegExp(`^${ymd}_\\d\\d_\\d\\d_\\d\\d\\.xml$`));
    const lines: string[] = r.body.content.split('\n');
    expect(lines[0]).toBe('<?xml version="1.0" encoding="utf-8"?>');
    expect(lines[1]).toMatch(new RegExp(`^<PBPlaylist   id="\\d+" name="${playoutXmlPrefix(a.slug)}_${ymd}\\.xml - \\d\\d:\\d\\d:\\d\\d:\\d\\d">$`));
    expect(lines.slice(-2)).toEqual(['</PBPlaylist>', '']);
    const items = lines.slice(2, -2);
    expect(r.body.items).toBe(rows.length);
    expect(items.map((l) => /title="([^"]*)"/.exec(l)![1])).toEqual(rows.map((e) => e.title.replace(/ - 0$/, '')));
    expect(items.map((l) => Number(/ id="(\d+)"/.exec(l)![1]))).toEqual(rows.map((_, i) => playoutXmlFirstItemId(SAT) + i));
    expect(items[at]).toContain('file="M:\\FTP\\Harbor &amp; Co\\EP01.mp4"');
    expect(items[at]).toContain('category="Program" star="AURORA" notes=""');
    expect(r.body.noFile).not.toContain(rows[at].title);
    expect(r.body.draft).toBe(true);

    await get(a, `/api/channels/${a.channelId}/days/${SAT}/export?format=bxf`).expect(400);
    await get(a, `/api/channels/${a.channelId}/days/2031-01-01/export?format=playout-xml`).expect(404);
  });
});
