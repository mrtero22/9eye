import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { auth, makeCatalog, makeCompany, resetDb, type CatalogFixture, type Fixture } from './fixtures';

const app = createApp();
let a: Fixture;
let b: Fixture;
let cat: CatalogFixture;
const as = (f: Fixture) => ({
  get: (u: string) => request(app).get(`/api${u}`).set(auth(f.slug)),
  put: (u: string, body: object) => request(app).put(`/api${u}`).set(auth(f.slug)).send(body),
});

interface Pos {
  id: string;
  name: string;
  order: number;
  isDefault: boolean;
  color: string | null;
  priceModifier: number;
  contentTypeIds: string[];
  version: number;
}

const fresh = (name: string, more: Partial<Pos> = {}) => ({ id: null, version: null, name, isDefault: false, color: null, priceModifier: 0, contentTypeIds: [], ...more });
const keep = (p: Pos, more: Partial<Pos> = {}) => ({ id: p.id, version: p.version, name: p.name, isDefault: p.isDefault, color: p.color, priceModifier: p.priceModifier, contentTypeIds: p.contentTypeIds, ...more });
const list = async (f: Fixture) => (await as(f).get('/admin/break-positions').expect(200)).body as Pos[];

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
  cat = await makeCatalog(a);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

describe('break positions', () => {
  it('saves the whole list in order, with one default, colours, price modifiers and categories', async () => {
    expect(await list(a)).toEqual([]);
    const saved = (
      await as(a)
        .put('/admin/break-positions', {
          rows: [
            fresh('Channel Ident', { color: '#f8e71c' }),
            fresh(' Ad Top '),
            fresh('Ad', { isDefault: true, priceModifier: 12.345, contentTypeIds: [cat.identType, cat.identType] }),
          ],
          deletedIds: [],
        })
        .expect(200)
    ).body as Pos[];
    expect(saved.map((p) => [p.order, p.name, p.isDefault])).toEqual([
      [1, 'Channel Ident', false],
      [2, 'Ad Top', false],
      [3, 'Ad', true],
    ]);
    expect(saved[0].color).toBe('#f8e71c');
    expect(saved[2]).toMatchObject({ priceModifier: 12.35, contentTypeIds: [cat.identType], version: 1 });
    // each company has its own list
    expect(await list(b)).toEqual([]);
  });

  it('reorders, edits and removes; only changed rows get a new version', async () => {
    const [ident, top, com] = (
      await as(a).put('/admin/break-positions', { rows: [fresh('Channel Ident'), fresh('Ad Top'), fresh('Ad', { isDefault: true })], deletedIds: [] }).expect(200)
    ).body as Pos[];
    const after = (await as(a).put('/admin/break-positions', { rows: [keep(com), keep(ident, { name: 'Ident' })], deletedIds: [top.id] }).expect(200)).body as Pos[];
    expect(after.map((p) => [p.order, p.name, p.version])).toEqual([
      [1, 'Ad', 2],
      [2, 'Ident', 2],
    ]);
    // nothing changed: same versions
    const again = (await as(a).put('/admin/break-positions', { rows: after.map((p) => keep(p)), deletedIds: [] }).expect(200)).body as Pos[];
    expect(again.map((p) => p.version)).toEqual([2, 2]);
  });

  it('refuses names left empty, two defaults and unknown categories, and saves nothing', async () => {
    const r = await as(a).put('/admin/break-positions', { rows: [fresh('A', { isDefault: true }), fresh('  ', { isDefault: true })], deletedIds: [] }).expect(422);
    expect(r.body.problems.map((p: { message: string }) => p.message)).toEqual(['Position 2 has no name.', 'Only one position can be the default.']);
    await as(a).put('/admin/break-positions', { rows: [fresh('A', { contentTypeIds: [b.channelId] })], deletedIds: [] }).expect(422);
    await as(a).put('/admin/break-positions', { rows: [fresh('A', { color: 'red' as never })], deletedIds: [] }).expect(400);
    await as(a).put('/admin/break-positions', { rows: [fresh('A', { priceModifier: -101 })], deletedIds: [] }).expect(400);
    expect(await list(a)).toEqual([]);
  });

  it('stops when someone else changed the list meanwhile', async () => {
    const [x] = (await as(a).put('/admin/break-positions', { rows: [fresh('Ad')], deletedIds: [] }).expect(200)).body as Pos[];
    // a second person renames it
    await as(a).put('/admin/break-positions', { rows: [keep(x, { name: 'Ad 2' })], deletedIds: [] }).expect(200);
    // the first still holds version 1
    await as(a).put('/admin/break-positions', { rows: [keep(x, { name: 'Ad 3' })], deletedIds: [] }).expect(409);
    // a list that leaves out a saved position (neither kept nor removed) is refused too
    await as(a).put('/admin/break-positions', { rows: [fresh('Trailers')], deletedIds: [] }).expect(409);
    expect((await list(a)).map((p) => p.name)).toEqual(['Ad 2']);
    // another company's position cannot be touched
    const [y] = (await as(b).put('/admin/break-positions', { rows: [fresh('Theirs')], deletedIds: [] }).expect(200)).body as Pos[];
    await as(a).put('/admin/break-positions', { rows: [...(await list(a)).map((p) => keep(p)), keep(y)], deletedIds: [] }).expect(409);
    expect((await list(b)).map((p) => p.name)).toEqual(['Theirs']);
  });
});
