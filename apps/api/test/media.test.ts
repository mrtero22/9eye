// The tools of Media (decision 0025, group 6.5; src/mcp/media.ts): categories, titles, items, episodes,
// delete with everything under it, cuts and recut, rotation lists, relations — preview, apply at the
// version, and undo_change.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { preset } from '../src/aiPolicy';
import { platformDb } from '../src/db';
import type { Principal } from '../src/mcp/auth';
import { invokeTool, toolDefs } from '../src/mcp/tools';
import { makeCatalog, makeCatalogExtras, makeCompany, resetDb, type CatalogExtras, type CatalogFixture, type Fixture } from './fixtures';

let a: Fixture;
let cat: CatalogFixture;
let ex: CatalogExtras;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  cat = await makeCatalog(a);
  ex = await makeCatalogExtras(a, cat);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

async function principal(): Promise<Principal> {
  const tenant = await platformDb.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
  return { user: { id: null, name: 'Tester' }, tenant, tokenId: null, via: 'agent', access: { all: true, grants: new Set(), channelIds: null }, canWrite: true };
}
async function call(name: string, args: Record<string, unknown>) {
  const p = await principal();
  const def = toolDefs(p).find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return invokeTool(p, def, def.input.parse(args));
}
/** Applies what the preview showed (its applyWith). */
async function applied(name: string, args: Record<string, unknown>) {
  const preview = await call(name, args);
  expect(preview.isError, preview.text).toBe(false);
  expect(preview.applyWith, preview.text).toBeTruthy();
  const done = await call(name, { ...args, ...preview.applyWith });
  expect(done.isError, done.text).toBe(false);
  return { preview, done };
}
const changeOf = (text: string) => /Change id ([0-9a-f-]{36})/.exec(text)?.[1] ?? '';
const undo = async (text: string) => {
  const r = await call('undo_change', { change: changeOf(text) });
  expect(r.isError, r.text).toBe(false);
  return r;
};

const live = { deletedAt: null };
const titles = () => platformDb.content.findMany({ where: { tenantId: a.tenantId, ...live }, orderBy: { title: 'asc' } });
const listItems = async () =>
  (await platformDb.rotationListItem.findMany({ where: { listId: ex.list }, orderBy: { position: 'asc' } })).map((i) => `${i.position} ${i.name}`);

describe('media', () => {
  it('categories, titles and items: create, change, read, delete with everything under them — each undone', async () => {
    expect((await call('list_categories', {})).text).toContain('- "Idents" · Trailers and stings · code none · colour none · 1 title');
    const cat1 = await applied('create_category', { name: 'Films', kind: 'programmes' });
    expect(cat1.preview.text).toContain('New category "Films" · Programmes · code FILMS · colour #64748b — preview');
    const recolour = await applied('edit_category', { category: 'films', colour: '#FF0000' });
    expect(recolour.preview.text).toContain('- colour: "#64748b" → "#ff0000"');
    await undo(recolour.done.text);
    expect((await platformDb.contentType.findFirstOrThrow({ where: { name: 'Films' } })).color).toBe('#64748b');

    const film = await applied('create_title', { category: 'Films', title: 'The Long Night', length: '01:40:00:00', genres: 'Drama' });
    expect(film.preview.text).toContain('New title "The Long Night" in "Films" · code THELONGN — preview');
    expect(film.preview.text).toContain('- length: 01:40:00:00');
    const item = await applied('create_item', { title: 'The Long Night', length: '01:38:00:00', source: 'SERVER' });
    expect(item.preview.text).toContain('New item "The Long Night - 1" of "The Long Night" · ep 1 · 01:38:00:00 · source SERVER');
    expect(item.preview.applyWith).toEqual({ apply: true, episode: 1 });
    expect((await call('undo_change', { change: changeOf(film.done.text) })).text).toContain('has items now: it stays');
    expect((await call('create_item', { title: 'The Long Night', episode: 1 })).text).toContain('has episode 1 already');

    const edit = await applied('edit_title', { title_ref: 'The Long Night', season: '1' });
    expect(edit.preview.text).toContain('- season: none → "1"');
    await undo(edit.done.text);
    const shown = (await call('get_title', { title: 'the long night' })).text;
    expect(shown).toContain('Title "The Long Night" · category "Films" (Programmes) · code THELONGN');
    expect(shown).toContain('Items (1; the next free episode is 2):');
    expect(shown).toContain('- "The Long Night - 1" · ep 1');

    const del = await applied('delete_media', { what: 'titles', refs: ['The Long Night'] });
    expect(del.preview.text).toContain('Delete 1 title: "The Long Night" · 1 item · 0 cuts — preview');
    expect((await titles()).map((t) => t.title)).not.toContain('The Long Night');
    await undo(del.done.text);
    expect((await titles()).map((t) => t.title)).toContain('The Long Night');
    expect(await platformDb.production.count({ where: { title: 'The Long Night - 1', ...live } })).toBe(1);

    expect((await call('delete_media', { what: 'items', refs: ['LumenPlus_Ident_1'] })).text).toContain('Cannot: "LumenPlus_Ident_1": Used in rotation lists.');
  });

  it('episodes in one go, a new cut and a recut — undone', async () => {
    const eps = await applied('create_episodes', { title: 'Harbor Nights', count: 3, length: '00:45:00:00', parts: 3 });
    expect(eps.preview.text).toContain('"Harbor Nights" · 3 new episodes 7–9: "Harbor Nights - 7", "Harbor Nights - 8", "Harbor Nights - 9" · 00:45:00:00 · 3 parts each · source LIVE');
    expect(await platformDb.production.count({ where: { contentId: cat.harbor, chapter: { in: [7, 8, 9] }, ...live } })).toBe(3);
    expect((await call('create_episodes', { title: 'Harbor Nights', count: 1, first: 8 })).text).toContain('episodes 8 exist already');
    await undo(eps.done.text);
    expect(await platformDb.production.count({ where: { contentId: cat.harbor, chapter: { in: [7, 8, 9] }, ...live } })).toBe(0);

    const cut = await applied('create_cut', { item: 'HAR-2', parts: 2 });
    expect(cut.preview.text).toContain('Item "Harbor Nights - 2" · new cut "HAR-2-1" · 2 parts of 00:22:30:00');
    await undo(cut.done.text);

    const parts = () => platformDb.segment.count({ where: { segmentationId: ex.harborSegm, ...live } });
    expect(await parts()).toBe(3);
    const re = await applied('recut', { cut: 'HAR-1-1', parts: 2 });
    expect(re.preview.text).toContain('Cut "HAR-1-1" of "Harbor Nights - 1" · version 1 · 3 parts → 2 parts of 00:22:30:00');
    expect(await parts()).toBe(2);
    await undo(re.done.text);
    expect(await parts()).toBe(3);
  });

  it('rotation lists: read, change, shuffle, create, clone, delete — each undone', async () => {
    expect((await call('get_rotation_lists', {})).text).toContain('- "Lumen Fillers" · 3 items · random · version 1');
    expect((await call('get_rotation_lists', { list: 'lumen' })).text).toContain('2. "LumenPlus_Ident_2" · item "LumenPlus_Ident_2" (LUM-0) · 00:00:15:00 · played last');

    const edit = await applied('edit_rotation_list', { list: 'Lumen Fillers', name: 'Lumen Idents', random_insert: false, remove_items: ['3'], move: [{ item: '2', to: 1 }] });
    expect(edit.preview.text).toContain('- name: "Lumen Fillers" → "Lumen Idents"');
    expect(edit.preview.text).toContain('- random: true → false');
    expect(edit.preview.text).toContain('- taken out: "LumenPlus_Ident_3"');
    expect(edit.preview.text).toContain('- new order: 1 "LumenPlus_Ident_2", 2 "LumenPlus_Ident_1"');
    expect(await listItems()).toEqual(['1 LumenPlus_Ident_2', '2 LumenPlus_Ident_1']);
    expect((await platformDb.rotationList.findUniqueOrThrow({ where: { id: ex.list } })).lastItemPosition).toBe(1);
    await undo(edit.done.text);
    expect(await listItems()).toEqual(['1 LumenPlus_Ident_1', '2 LumenPlus_Ident_2', '3 LumenPlus_Ident_3']);
    expect(await platformDb.rotationList.findUniqueOrThrow({ where: { id: ex.list } })).toMatchObject({ name: 'Lumen Fillers', randomInsert: true, lastItemPosition: 2 });

    const shuffled = await applied('shuffle_rotation_list', { list: 'Lumen Fillers' });
    expect(shuffled.done.text).toContain('New order: ');
    await undo(shuffled.done.text);
    expect(await listItems()).toEqual(['1 LumenPlus_Ident_1', '2 LumenPlus_Ident_2', '3 LumenPlus_Ident_3']);

    const made = await applied('create_rotation_list', { name: 'Night fillers', items: ['Lumen Plus'], days_between: 2 });
    expect(made.preview.text).toContain('New rotation list "Night fillers" · 2 days between plays · in turn · 3 items');
    await undo(made.done.text);
    const clone = await applied('clone_rotation_list', { list: 'Lumen Fillers' });
    expect(clone.done.text).toContain('Rotation list "Lumen Fillers (Clone)" made');
    await undo(clone.done.text);
    const del = await applied('delete_rotation_list', { list: 'Lumen Fillers' });
    expect(await platformDb.rotationList.count({ where: live })).toBe(0);
    await undo(del.done.text);
    expect((await platformDb.rotationList.findMany({ where: live })).map((l) => l.name)).toEqual(['Lumen Fillers']);
  });

  it('relations: stings, time windows and graphics set and undone; a deleted item brings its relations back', async () => {
    const stings = await applied('edit_relations', { title: 'Harbor Nights', kind: 'stings', rows: [{ sting: 'LumenPlus_Ident_1', when: 'pre' }] });
    expect(stings.preview.text).toContain('Now: none of its own');
    expect(stings.preview.text).toContain('New: pre sting "LumenPlus_Ident_1" · parts all');
    expect(await platformDb.catalogRelation.count({ where: { itemId: cat.harbor, kind: 'linear' } })).toBe(1);
    expect((await call('edit_relations', { title: 'Harbor Nights', kind: 'product_codes', rows: [] })).text).toContain('only ads have product codes');

    const kids = await applied('edit_relations', { item: 'HAR-1', kind: 'time_windows', rows: [{ window: 'Kids', rule: 'rejected' }] });
    expect(kids.preview.text).toContain('New: rejected in "Kids"');
    const gfx = await applied('edit_relations', { item: 'HAR-1', kind: 'graphics', rows: [{ graphic: '10 SEC BEFORE THE END', parts: 'last' }] });
    expect(gfx.preview.text).toContain('New: graphic "10 SEC BEFORE THE END" · parts last · layer auto');
    await undo(gfx.done.text);
    await undo(stings.done.text);
    expect(await platformDb.catalogRelation.count({ where: { itemId: cat.harbor } })).toBe(0);

    const del = await applied('delete_media', { what: 'items', refs: ['HAR-1'] });
    expect(await platformDb.catalogRelation.count({ where: { itemId: cat.harborEps[0] } })).toBe(0);
    await undo(del.done.text);
    expect(await platformDb.catalogRelation.count({ where: { itemId: cat.harborEps[0], kind: 'time-window' } })).toBe(1);
    expect(await platformDb.segment.count({ where: { segmentationId: ex.harborSegm, ...live } })).toBe(3);
  });

  it('the AI table: Drafts reads Media and changes nothing; Full has every Media tool', async () => {
    const p = await principal();
    const names = (policy: Principal['policy']) => new Set(toolDefs({ ...p, via: 'mcp', policy }).map((d) => d.name));
    const drafts = names(preset('drafts'));
    expect(['list_categories', 'get_title', 'get_rotation_lists'].every((n) => drafts.has(n))).toBe(true);
    expect(['edit_title', 'create_item', 'delete_media', 'edit_relations'].some((n) => drafts.has(n))).toBe(false);
    const full = names(preset('full'));
    expect(['create_category', 'create_episodes', 'recut', 'shuffle_rotation_list', 'edit_relations'].every((n) => full.has(n))).toBe(true);
  });
});
