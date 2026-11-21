import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { auth, makeCatalog, makeCatalogExtras, makeCompany, makeOrderUsing, min, resetDb, type CatalogExtras, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
const as = (f: Fixture) => ({
  get: (url: string) => request(app).get(url).set(auth(f.slug)),
  post: (url: string, body: object) => request(app).post(url).set(auth(f.slug)).send(body),
  put: (url: string, body: object) => request(app).put(url).set(auth(f.slug)).send(body),
});

let a: Fixture;
let b: Fixture;
let cat: CatalogFixture;
let x: CatalogExtras;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
  cat = await makeCatalog(a);
  x = await makeCatalogExtras(a, cat);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

const names = (r: request.Response) => r.body.rows.map((row: { name: string }) => row.name);
const cond = (c: object[]) => encodeURIComponent(JSON.stringify(c));

describe('catalog columns', () => {
  it('lists each level under its parent with counts, lengths and the layout mark', async () => {
    const types = await as(a).get('/api/catalog/columns/content-type').expect(200);
    expect(types.body.rows.map((r: { name: string; meta: string }) => [r.name, r.meta])).toEqual([['Idents', '1'], ['TV Series Drama', '2']]);
    const prods = await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}`).expect(200);
    expect(prods.body.total).toBe(7);
    const rows = prods.body.rows as { name: string; meta: string; metaTone: string | null }[];
    expect(rows[0]).toMatchObject({ name: '[TEMPLATE]-Harbor Nights', meta: 'template' });
    expect(rows.find((r) => r.name === 'Harbor Nights - 3')).toMatchObject({ meta: 'no length', metaTone: 'amber' });
    expect(rows.find((r) => r.name === 'Harbor Nights - 1')?.meta).toBe('00:45:00');
    const segs = await as(a).get(`/api/catalog/columns/segment?parent=${x.harborSegm}`).expect(200);
    expect(segs.body.rows.map((r: { meta: string }) => r.meta)).toEqual(['00:00:00–00:15:00', '00:15:00–00:30:00', '00:30:00–00:45:00']);
    const items = await as(a).get(`/api/catalog/columns/list-item?parent=${x.list}`).expect(200);
    expect(items.body.rows.map((r: { meta: string; last: boolean }) => [r.meta, r.last])).toEqual([['#1', false], ['#2', true], ['#3', false]]);
  });

  it('searches, orders by a field and runs the advanced search', async () => {
    const q = await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}&q=nights - 5`).expect(200);
    expect(names(q)).toEqual(['Harbor Nights - 5']);
    const desc = await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}&sort=Chapter&dir=desc`).expect(200);
    expect(names(desc)[0]).toBe('Harbor Nights - 6');
    const noLength = await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}&conditions=${cond([{ field: 'Duration', op: 'empty', value: '' }])}`).expect(200);
    expect(names(noLength)).toEqual(['[TEMPLATE]-Harbor Nights', 'Harbor Nights - 3']);
    const between = await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}&conditions=${cond([{ field: 'Chapter', op: 'between', value: '2 .. 4' }])}`).expect(200);
    expect(names(between)).toEqual(['Harbor Nights - 2', 'Harbor Nights - 3', 'Harbor Nights - 4']);
    const star = await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}&conditions=${cond([{ field: 'STAR', op: 'contains', value: 'moura' }])}`).expect(200);
    expect(names(star)).toEqual(['Harbor Nights - 1']);
    const both = await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}&conditions=${cond([{ field: 'Title', op: 'contains', value: 'nights' }, { field: 'Chapter', op: 'is', value: '6' }])}`).expect(200);
    expect(names(both)).toEqual(['Harbor Nights - 6']);
    const bad = await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}&conditions=${cond([{ field: 'Chapter', op: 'is', value: 'six' }])}`).expect(400);
    expect(bad.body.error).toContain('not a valid value');
  });

  it('hides expired items unless asked', async () => {
    await platformDb.production.update({ where: { id: cat.harborEps[5] }, data: { expires: new Date('2020-01-01T00:00:00Z') } });
    expect((await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}`).expect(200)).body.total).toBe(6);
    expect((await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}&expired=1`).expect(200)).body.total).toBe(7);
  });

  it('keeps companies apart', async () => {
    await as(b).get(`/api/catalog/columns/production?parent=${cat.harbor}`).expect(404);
    await as(b).get(`/api/catalog/items/production/${cat.harborEps[0]}`).expect(404);
    expect((await as(b).get('/api/catalog/columns/content-type').expect(200)).body.total).toBe(0);
  });
});

describe('catalog forms', () => {
  it('reads an item with every field and saves it with its version', async () => {
    const p = await as(a).get(`/api/catalog/items/production/${cat.harborEps[0]}`).expect(200);
    expect(p.body).toMatchObject({ title: 'Harbor Nights - 1', contentTitle: 'Harbor Nights', customValues: { STAR: 'WAGNER MOURA' }, version: 1, sourcePattern: 'TV S-%A - %P' });
    const body = { ...p.body, genres: 'Crime', expires: '2027-01-31', customValues: { STAR: 'WAGNER MOURA', GRAPHICS: 'SERIES' }, channelIds: [a.channelId], secondaryActionIds: [x.action] };
    const saved = await as(a).put(`/api/catalog/items/production/${cat.harborEps[0]}`, body).expect(200);
    expect(saved.body.version).toBe(2);
    const again = await as(a).get(`/api/catalog/items/production/${cat.harborEps[0]}`).expect(200);
    expect(again.body).toMatchObject({ genres: 'Crime', expires: '2027-01-31', customValues: { GRAPHICS: 'SERIES' }, channelIds: [a.channelId] });
    // an old version is refused, nothing written
    const stale = await as(a).put(`/api/catalog/items/production/${cat.harborEps[0]}`, { ...body, genres: 'Drama' }).expect(409);
    expect(stale.body.error).toContain('Someone else saved');
    expect((await as(a).get(`/api/catalog/items/production/${cat.harborEps[0]}`)).body.genres).toBe('Crime');
  });

  it('refuses missing required fields, foreign references and logos of another type', async () => {
    const p = (await as(a).get(`/api/catalog/items/production/${cat.harborEps[0]}`)).body;
    await as(a).put(`/api/catalog/items/production/${cat.harborEps[0]}`, { ...p, title: '' }).expect(400);
    const c = (await as(a).get(`/api/catalog/items/content/${cat.harbor}`)).body;
    const wrongLogo = await as(a).put(`/api/catalog/items/content/${cat.harbor}`, { ...c, ageLogoId: x.seriesLogo }).expect(400);
    expect(wrongLogo.body.error).toContain('not a logo of that type');
    const bChannel = (await as(b).get('/api/channels')).body[0].id;
    await as(a).put(`/api/catalog/items/content/${cat.harbor}`, { ...c, channelIds: [bChannel] }).expect(400);
    await as(a).put(`/api/catalog/items/content/${cat.harbor}`, { ...c, ageLogoId: x.ageLogo, logo1Id: x.seriesLogo, companies: ['AURORA TV'] }).expect(200);
  });

  it('creates items under their parent; an item without an Id gets one from its source', async () => {
    const t = await as(a).post('/api/catalog/items/content-type', { name: 'Movies Hollywood', code: 'MoviesHollywood', color: '#9b9b9b', family: 'program', showInGrid: true }).expect(201);
    const c = await as(a).post('/api/catalog/items/content', { parentId: t.body.id, title: 'Zootopia (2016)', code: 'ZOO', nextProductionId: 7 }).expect(201);
    const p = await as(a).post('/api/catalog/items/production', { parentId: c.body.id, title: 'Zootopia (2016) - 0', chapter: 0, sourceId: x.server, lengthFrames: min(108) }).expect(201);
    const got = await as(a).get(`/api/catalog/items/production/${p.body.id}`).expect(200);
    expect(got.body.code).toBe('TV S-000007 - 0');
    expect((await as(a).get(`/api/catalog/items/content/${c.body.id}`)).body.nextProductionId).toBe(8);
    await as(a).post('/api/catalog/items/production', { title: 'No parent', chapter: 1, sourceId: x.server }).expect(400);
    const seg = await as(a).post('/api/catalog/items/segment', { parentId: x.harborSegm, code: 4, sourceId: x.server, tcInFrames: min(45), tcOutFrames: min(50), lengthFrames: min(5) }).expect(201);
    expect((await as(a).get(`/api/catalog/items/segment/${seg.body.id}`)).body).toMatchObject({ code: 4, segmentationName: 'HAR-1-1' });
    const g = await as(a).post('/api/catalog/items/graphic-object', { name: 'Age 12', code: 'AGE12', sourceId: x.graphicSource, layer: '2' }).expect(201);
    expect((await as(a).get(`/api/catalog/items/graphic-object/${g.body.id}`)).body.layer).toBe('2');
  });
});

describe('catalog operations', () => {
  it('delete: refused for items used by a plan (nothing deleted), otherwise everything under them goes', async () => {
    await makeOrderUsing(a, [cat.harborEps[0]]);
    const check = await as(a).post('/api/catalog/delete-check/production', { ids: [cat.harborEps[0], cat.harborEps[1]] }).expect(200);
    expect(check.body.map((r: { name: string; usedBy: string | null }) => [r.name, r.usedBy])).toEqual([['Harbor Nights - 1', 'Used in plans or playlists'], ['Harbor Nights - 2', null]]);
    const refused = await as(a).post('/api/catalog/delete/production', { ids: [cat.harborEps[0], cat.harborEps[1]] }).expect(409);
    expect(refused.body.problems[0].message).toBe('Harbor Nights - 1: Used in plans or playlists');
    expect((await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}`)).body.total).toBe(7);
    // a content whose productions are in a rotation list is used too
    const idents = await as(a).post('/api/catalog/delete-check/content', { ids: [cat.idents] }).expect(200);
    expect(idents.body[0].usedBy).toBe('Used in rotation lists');
    // Bright Lanes is not used: the content, its productions and their relations go
    await as(a).put(`/api/catalog/relations/content/${cat.bright}`, { kinds: ['time-window'], rows: [{ kind: 'time-window', params: { timeWindowId: x.kids, rule: 'allowed' } }] }).expect(200);
    await as(a).post('/api/catalog/delete/content', { ids: [cat.bright] }).expect(200);
    expect(names(await as(a).get(`/api/catalog/columns/content?parent=${cat.seriesType}`))).toEqual(['Harbor Nights']);
    expect(await platformDb.production.count({ where: { contentId: cat.bright, deletedAt: null } })).toBe(0);
    expect(await platformDb.catalogRelation.count({ where: { itemId: cat.bright } })).toBe(0);
  });

  it('bulk edit: at most 50 items, every value checked first, all-or-nothing', async () => {
    const many = Array.from({ length: 51 }, () => cat.harborEps[0]);
    const over = await as(a).post('/api/catalog/bulk-edit/production', { ids: many, changes: [{ field: 'Genres', op: 'set', value: 'Crime' }] }).expect(400);
    expect(over.body.error).toBe('You have ticked 51 items. Bulk edit takes at most 50; tick fewer.');
    const bad = await as(a).post('/api/catalog/bulk-edit/production', { ids: cat.harborEps, changes: [{ field: 'Genres', op: 'set', value: 'Crime' }, { field: 'Starts', op: 'set', value: '31/12/2026' }] }).expect(400);
    expect(bad.body.error).toContain('YYYY-MM-DD');
    expect((await as(a).get(`/api/catalog/items/production/${cat.harborEps[1]}`)).body.genres).toBe('');
    await as(a).post('/api/catalog/bulk-edit/production', {
      ids: cat.harborEps.slice(0, 3),
      changes: [{ field: 'Genres', op: 'set', value: 'Crime' }, { field: 'STAR', op: 'clear' }, { field: 'GRAPHICS', op: 'set', value: 'SERIES' }, { field: 'Channels', op: 'set', value: 'AURORA TV' }],
    }).expect(200);
    const p1 = (await as(a).get(`/api/catalog/items/production/${cat.harborEps[0]}`)).body;
    expect(p1).toMatchObject({ genres: 'Crime', customValues: { GRAPHICS: 'SERIES' }, channelIds: [a.channelId], version: 2 });
    expect(p1.customValues.STAR).toBeUndefined();
    expect((await as(a).get(`/api/catalog/items/production/${cat.harborEps[3]}`)).body.genres).toBe('');
  });

  it('create series: numbered items with Ids and one cut each; existing episode numbers refused', async () => {
    expect((await as(a).get(`/api/catalog/contents/${cat.harbor}/next-episode`)).body.next).toBe(7);
    await as(a).post(`/api/catalog/contents/${cat.harbor}/series`, { title: 'Harbor Nights', first: 7, count: 3, lengthFrames: min(45), segments: 3, sourceId: x.server }).expect(201);
    const prods = names(await as(a).get(`/api/catalog/columns/production?parent=${cat.harbor}&sort=Chapter&dir=desc`));
    expect(prods.slice(0, 3)).toEqual(['Harbor Nights - 9', 'Harbor Nights - 8', 'Harbor Nights - 7']);
    const ep9 = await platformDb.production.findFirstOrThrow({ where: { contentId: cat.harbor, chapter: 9 }, include: { segmentations: { include: { segments: true } } } });
    expect(ep9.segmentations).toHaveLength(1);
    expect(ep9.segmentations[0].segments.map((s) => s.lengthFrames)).toEqual([min(15), min(15), min(15)]);
    const again = await as(a).post(`/api/catalog/contents/${cat.harbor}/series`, { title: 'Harbor Nights', first: 9, count: 2, lengthFrames: null, segments: 1, sourceId: x.server }).expect(409);
    expect(again.body.error).toBe('Episodes 9 already exist in Harbor Nights. Nothing was created.');
    expect(await platformDb.production.count({ where: { contentId: cat.harbor, chapter: 10 } })).toBe(0);
  });

  it('cuts: create with equal parts, regenerate replaces them', async () => {
    const s = await as(a).post(`/api/catalog/productions/${cat.harborEps[1]}/segmentations`, { name: 'HAR-2-1', sourceId: x.server, segments: 2, lengthFrames: min(40) }).expect(201);
    expect((await as(a).get(`/api/catalog/columns/segment?parent=${s.body.id}`)).body.rows.map((r: { meta: string }) => r.meta)).toEqual(['00:00:00–00:20:00', '00:20:00–00:40:00']);
    await as(a).post(`/api/catalog/segmentations/${x.harborSegm}/regenerate`, { name: 'HAR-1-1', sourceId: x.server, segments: 4, lengthFrames: min(48), version: 1 }).expect(200);
    const segs = await as(a).get(`/api/catalog/columns/segment?parent=${x.harborSegm}`).expect(200);
    expect(segs.body.total).toBe(4);
    expect(segs.body.rows[3].meta).toBe('00:36:00–00:48:00');
    await as(a).post(`/api/catalog/segmentations/${x.harborSegm}/regenerate`, { name: 'HAR-1-1', sourceId: x.server, segments: 1, lengthFrames: min(48), version: 1 }).expect(409);
  });

  it('rotation lists: clone with items, add items (none twice), shuffle', async () => {
    const c = await as(a).post(`/api/catalog/rotation-lists/${x.list}/clone`, {}).expect(201);
    expect(c.body.name).toBe('Lumen Fillers (Clone)');
    expect((await as(a).post(`/api/catalog/rotation-lists/${x.list}/clone`, {}).expect(201)).body.name).toBe('Lumen Fillers (Clone1)');
    expect((await as(a).get(`/api/catalog/columns/list-item?parent=${c.body.id}`)).body.total).toBe(3);
    const dup = await as(a).post(`/api/catalog/rotation-lists/${x.list}/items`, { productionIds: [cat.harborEps[0], cat.identItems[0]] }).expect(409);
    expect(dup.body.error).toBe('LumenPlus_Ident_1 is in the list already. Nothing was added.');
    await as(a).post(`/api/catalog/rotation-lists/${x.list}/items`, { productionIds: [cat.harborEps[0]] }).expect(201);
    const items = await as(a).get(`/api/catalog/columns/list-item?parent=${x.list}`).expect(200);
    expect(items.body.rows.map((r: { name: string; meta: string }) => [r.name, r.meta]).at(-1)).toEqual(['Harbor Nights - 1', '#4']);
    const added = await platformDb.rotationListItem.findFirstOrThrow({ where: { listId: x.list, productionId: cat.harborEps[0] } });
    expect(added.segmentationId).toBe(x.harborSegm);
    await as(a).post(`/api/catalog/rotation-lists/${x.list}/shuffle`, {}).expect(200);
    const after = await platformDb.rotationListItem.findMany({ where: { listId: x.list } });
    expect(after.map((i) => i.position).sort()).toEqual([1, 2, 3, 4]);
  });

  it('relations: own rows saved all-or-nothing, parents\' rows shown as inherited', async () => {
    const tabs = await as(a).get(`/api/catalog/relations/production/${cat.harborEps[0]}`).expect(200);
    expect(tabs.body.tabs).toEqual(['linear', 'graphics', 'time-window', 'rights', 'history']);
    await as(a).put(`/api/catalog/relations/content/${cat.harbor}`, {
      kinds: ['linear', 'time-window'],
      rows: [
        { kind: 'linear', channelId: a.channelId, params: { jingle: 'pre', segments: 'first', productionId: cat.identItems[0] } },
        { kind: 'time-window', params: { timeWindowId: x.prime, rule: 'allowed' } },
      ],
    }).expect(200);
    const g = { graphicTemplateId: x.graphicTemplate, segments: 'last', startType: 'to-end', startOffsetFrames: 1000, tcInFrames: 0, endType: 'duration', durationFrames: 750, tcOutFrames: 0, frequency: 'once', intervalFrames: 0, repetitions: 0, layer: 'auto' };
    await as(a).put(`/api/catalog/relations/production/${cat.harborEps[0]}`, { kinds: ['graphics'], rows: [{ kind: 'graphics', params: g }] }).expect(200);
    const rel = await as(a).get(`/api/catalog/relations/production/${cat.harborEps[0]}`).expect(200);
    expect(rel.body.rows.map((r: { kind: string; inherited: boolean; from: string | null }) => [r.kind, r.inherited, r.from])).toEqual([
      ['linear', true, 'Title · Harbor Nights'],
      ['time-window', true, 'Title · Harbor Nights'],
      ['graphics', false, null],
    ]);
    expect(rel.body.names[cat.identItems[0]]).toBe('LumenPlus_Ident_1');
    expect(rel.body.names[x.graphicTemplate]).toBe('10 SEC BEFORE THE END');
    // an incomplete row: nothing written
    await as(a).put(`/api/catalog/relations/production/${cat.harborEps[0]}`, { kinds: ['graphics', 'time-window'], rows: [{ kind: 'time-window', params: { timeWindowId: x.kids, rule: 'allowed' } }, { kind: 'graphics', params: { graphicTemplateId: x.graphicTemplate } }] }).expect(400);
    expect((await as(a).get(`/api/catalog/relations/production/${cat.harborEps[0]}`)).body.rows).toHaveLength(3);
    // the ident used as a jingle cannot be deleted
    expect((await as(a).post('/api/catalog/delete-check/production', { ids: [cat.identItems[0]] })).body[0].usedBy).toBe('Used in rotation lists');
    // product codes only for advertising
    await as(a).put(`/api/catalog/relations/content/${cat.harbor}`, { kinds: ['product-code'], rows: [] }).expect(400);
  });

  it('lookups: frame rate, the week of the date fields, sources, logos, custom fields, graphics, time windows', async () => {
    const l = await as(a).get('/api/catalog/lookups').expect(200);
    expect(l.body).toMatchObject({ frameRate: '25', weekStart: 6, bulkMax: 50 });
    expect(l.body.sources.map((s: { name: string }) => s.name)).toEqual(['LIVE', 'SERVER']);
    expect(l.body.customFields.map((c: { key: string }) => c.key)).toEqual(['STAR', 'GRAPHICS']);
    expect(l.body.timeWindows.map((w: { name: string }) => w.name)).toEqual(['Family Prime Time', 'Kids']);
    expect(l.body.graphicTemplates[0].name).toBe('10 SEC BEFORE THE END');
  });
});
