import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { auth, makeCatalog, makeCompany, min, resetDb, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
const get = (f: Fixture, url: string) => request(app).get(url).set(auth(f.slug));

let a: Fixture;
let b: Fixture;
let cat: CatalogFixture;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
  cat = await makeCatalog(a);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

describe('catalog for the picker', () => {
  it('lists categories of the asked families with their title counts', async () => {
    const all = await get(a, '/api/catalog/types').expect(200);
    expect(all.body.map((t: { name: string; family: string; contentCount: number }) => [t.name, t.family, t.contentCount])).toEqual([
      ['Idents', 'filling', 1],
      ['TV Series Drama', 'program', 2],
    ]);
    const programmes = await get(a, '/api/catalog/types?families=program').expect(200);
    expect(programmes.body.map((t: { name: string }) => t.name)).toEqual(['TV Series Drama']);
  });

  it('lists titles with item counts that leave the layout item out', async () => {
    const r = await get(a, `/api/catalog/types/${cat.seriesType}/contents`).expect(200);
    expect(r.body.map((c: { title: string; productionCount: number }) => [c.title, c.productionCount])).toEqual([
      ['Bright Lanes', 3],
      ['Harbor Nights', 6],
    ]);
  });

  it('lists items in episode plan, marking the layout one and unknown lengths', async () => {
    const r = await get(a, `/api/catalog/contents/${cat.harbor}/productions`).expect(200);
    expect(r.body.content).toMatchObject({ title: 'Harbor Nights', productionCount: 6, typeName: 'TV Series Drama' });
    const ps = r.body.productions as { title: string; chapter: number; isTemplate: boolean; lengthFrames: number | null }[];
    expect(ps.map((p) => p.chapter)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ps[0].isTemplate).toBe(true);
    expect(ps[3]).toMatchObject({ title: 'Harbor Nights - 3', lengthFrames: null });
    expect(ps[1].lengthFrames).toBe(min(45));
  });

  it('searches titles and house IDs inside the families, never the layout item', async () => {
    const r = await get(a, '/api/catalog/search?q=harbor&families=program').expect(200);
    expect(r.body.contents.map((c: { title: string }) => c.title)).toEqual(['Harbor Nights']);
    expect(r.body.productions).toHaveLength(6);
    expect(r.body.productions[0]).toMatchObject({ title: 'Harbor Nights - 1', contentTitle: 'Harbor Nights', typeName: 'TV Series Drama' });
    const byCode = await get(a, '/api/catalog/search?q=BRI-2').expect(200);
    expect(byCode.body.productions.map((p: { title: string }) => p.title)).toEqual(['Bright Lanes - 2']);
    const wrongFamily = await get(a, '/api/catalog/search?q=harbor&families=filling').expect(200);
    expect(wrongFamily.body).toEqual({ contents: [], productions: [] });
  });

  it('is the company’s own', async () => {
    expect((await get(b, '/api/catalog/types').expect(200)).body).toEqual([]);
    await get(b, `/api/catalog/contents/${cat.harbor}/productions`).expect(404);
    expect((await get(b, '/api/catalog/search?q=harbor').expect(200)).body.productions).toEqual([]);
  });
});
