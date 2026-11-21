// The tools of Channels and Layouts (decision 0025, src/mcp/setup.ts): get_channel, create_channel,
// edit_channel, create / clone / rename / delete a layout, block types, break lists, break positions
// — preview, apply, and undo_change.

import { uuidv7 } from '@9eye/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { platformDb } from '../src/db';
import type { Principal } from '../src/mcp/auth';
import { invokeTool, toolDefs } from '../src/mcp/tools';
import { makeCompany, resetDb, type Fixture } from './fixtures';

let a: Fixture;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
});

afterAll(async () => {
  await platformDb.$disconnect();
});

async function call(name: string, args: Record<string, unknown>) {
  const tenant = await platformDb.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
  const p: Principal = { user: { id: null, name: 'Tester' }, tenant, tokenId: null, via: 'agent', access: { all: true, grants: new Set(), channelIds: null }, canWrite: true };
  const def = toolDefs(p).find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return invokeTool(p, def, def.input.parse(args));
}
const changeOf = (text: string) => /Change id ([0-9a-f-]{36})/.exec(text)?.[1] ?? '';
const undo = async (text: string) => {
  const r = await call('undo_change', { change: changeOf(text) });
  expect(r.isError, r.text).toBe(false);
  return r;
};
const channels = () => platformDb.channel.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, orderBy: { name: 'asc' } });

describe('channels', () => {
  it('create_channel previews, makes a channel with its playlists, refuses a taken code, and undo removes it', async () => {
    const preview = await call('create_channel', { name: 'Delta SD', code: 'DELTA', day_start: '06:00', week_start: 'Monday' });
    expect(preview.text).toContain('New channel "Delta SD" · code DELTA · 25 fps · day starts 06:00:00:00 · week starts Monday · main + ads playlists — preview');
    expect(preview.applyWith).toEqual({ apply: true });
    const made = await call('create_channel', { name: 'Delta SD', code: 'DELTA', day_start: '06:00', week_start: 'Monday', apply: true });
    expect(made.text).toContain('Channel "Delta SD" made (code DELTA)');
    const delta = (await channels()).find((c) => c.code === 'DELTA')!;
    expect(await platformDb.channelPlaylist.count({ where: { channelId: delta.id } })).toBe(2);
    expect((await call('create_channel', { name: 'Other', code: 'delta' })).text).toContain('There is a channel "Delta SD" (code DELTA) already');
    await undo(made.text);
    expect((await channels()).map((c) => c.code)).toEqual(['AURORA']);
  });

  it('get_channel shows the settings; edit_channel changes them at the version, and undo puts them back', async () => {
    const shown = (await call('get_channel', { channel: 'AURORA' })).text;
    expect(shown).toContain('AURORA TV · code AURORA · version 1');
    expect(shown).toContain('week starts Saturday');
    expect(shown).toContain('"MAIN" · main');
    const preview = await call('edit_channel', { channel: 'AURORA', name: 'AURORA TV HD', time_zone: 'Asia/Tehran' });
    expect(preview.text).toContain('- name: "AURORA TV" → "AURORA TV HD"');
    expect(preview.text).toContain('- timeZone: none → Asia/Tehran');
    expect(preview.applyWith).toEqual({ apply: true, version: 1 });
    const saved = await call('edit_channel', { channel: 'AURORA', name: 'AURORA TV HD', time_zone: 'Asia/Tehran', apply: true, version: 1 });
    expect(saved.text).toContain('AURORA TV HD — saved as version 2');
    expect((await channels())[0]).toMatchObject({ name: 'AURORA TV HD', timeZone: 'Asia/Tehran' });
    expect((await call('edit_channel', { channel: 'AURORA', name: 'X', apply: true, version: 1 })).status).toBe(409);
    await undo(saved.text);
    expect((await channels())[0]).toMatchObject({ name: 'AURORA TV', timeZone: null });
  });
});

describe('layouts', () => {
  it('create, clone, rename and delete a layout, each undone', async () => {
    const made = await call('create_layout', { channel: 'AURORA', name: 'WINTER', valid_from: '2030-01-05', valid_to: '2030-03-29', apply: true });
    expect(made.isError, made.text).toBe(false);
    const layouts = () => platformDb.template.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, orderBy: { name: 'asc' } });
    expect((await layouts()).map((t) => t.name)).toEqual(['ADS', 'MAIN', 'WINTER']);
    await undo(made.text);
    expect((await layouts()).map((t) => t.name)).toEqual(['ADS', 'MAIN']);

    const cloned = await call('clone_layout', { channel: 'AURORA', layout: 'MAIN', name: 'MAIN 2031', valid_from: '2031-01-04', valid_to: '2031-12-26', apply: true });
    expect(cloned.text).toContain('Layout "MAIN 2031" made from "MAIN"');
    await undo(cloned.text);

    const main = (await layouts()).find((t) => t.name === 'MAIN')!;
    const renamePreview = await call('rename_layout', { channel: 'AURORA', layout: 'MAIN', name: 'CORE', weekdays: ['Sat', 'Sun'] });
    expect(renamePreview.text).toContain('- name: "MAIN" → "CORE"');
    expect(renamePreview.text).toContain('- active: every day → Sat Sun');
    const renamed = await call('rename_layout', { channel: 'AURORA', layout: 'MAIN', name: 'CORE', weekdays: ['Sat', 'Sun'], apply: true, version: main.version });
    expect(renamed.isError, renamed.text).toBe(false);
    expect((await platformDb.template.findUniqueOrThrow({ where: { id: main.id } })).name).toBe('CORE');
    await undo(renamed.text);
    expect((await platformDb.template.findUniqueOrThrow({ where: { id: main.id } })).name).toBe('MAIN');

    const gone = await call('delete_layout', { channel: 'AURORA', layout: 'MAIN', apply: true });
    expect((await layouts()).map((t) => t.name)).toEqual(['ADS']);
    await undo(gone.text);
    expect((await layouts()).map((t) => t.name)).toEqual(['ADS', 'MAIN']);
  });

  it('block types: create, change and delete, each undone; one in use is not deleted', async () => {
    const made = await call('create_block_type', { channel: 'AURORA', name: 'Prime Block', group: 'Series', length: '01:30:00:00', apply: true });
    expect(made.isError, made.text).toBe(false);
    const prime = await platformDb.blockType.findFirstOrThrow({ where: { name: 'Prime Block' } });
    expect(prime.lengthFrames).toBe(90 * 60 * 25);
    const edited = await call('edit_block_type', { channel: 'AURORA', block_type: 'Prime Block', length: '02:00:00:00', name: 'Prime 2h', apply: true });
    expect(edited.text).toContain('Block type "Prime 2h" saved');
    expect((await platformDb.blockType.findUniqueOrThrow({ where: { id: prime.id } })).lengthFrames).toBe(120 * 60 * 25);
    await undo(edited.text);
    expect(await platformDb.blockType.findUniqueOrThrow({ where: { id: prime.id } })).toMatchObject({ name: 'Prime Block', lengthFrames: 90 * 60 * 25 });
    const deleted = await call('delete_block_type', { channel: 'AURORA', block_type: 'Prime Block', apply: true });
    expect((await platformDb.blockType.findUniqueOrThrow({ where: { id: prime.id } })).deletedAt).not.toBeNull();
    await undo(deleted.text);
    expect((await platformDb.blockType.findUniqueOrThrow({ where: { id: prime.id } })).deletedAt).toBeNull();
    await undo(made.text);
    expect((await platformDb.blockType.findUniqueOrThrow({ where: { id: prime.id } })).deletedAt).not.toBeNull();
    // in use by a layout's block
    await platformDb.templateBlock.create({ data: { id: uuidv7(), templateId: a.mainTemplateId, weekday: 1, blockTypeId: a.types.run1, startFrames: 0, lengthFrames: 90000, fillGaps: true, opensWithBreak: false } });
    expect((await call('delete_block_type', { channel: 'AURORA', block_type: 'Run Block 1' })).text).toContain('It is used by 1 block in layouts');
  });

  it('break lists and break positions, each undone', async () => {
    const made = await call('create_break_list', { channel: 'AURORA', name: 'Prime', positions: [1, 2, 3], apply: true });
    const list = await platformDb.breakList.findFirstOrThrow({ where: { name: 'Prime' } });
    const edited = await call('edit_break_list', { channel: 'AURORA', list: 'prime', positions: [1, 3], apply: true });
    expect((await platformDb.breakList.findUniqueOrThrow({ where: { id: list.id } })).positions).toEqual([1, 3]);
    await undo(edited.text);
    expect((await platformDb.breakList.findUniqueOrThrow({ where: { id: list.id } })).positions).toEqual([1, 2, 3]);
    const deleted = await call('delete_break_list', { channel: 'AURORA', list: 'Prime', apply: true });
    expect(await platformDb.breakList.count({ where: { id: list.id } })).toBe(0);
    await undo(deleted.text);
    expect(await platformDb.breakList.count({ where: { id: list.id } })).toBe(1);
    await undo(made.text);
    expect(await platformDb.breakList.count({ where: { id: list.id } })).toBe(0);

    const positions = () => platformDb.breakPosition.findMany({ where: { tenantId: a.tenantId }, orderBy: { sortOrder: 'asc' } });
    const before = (await positions()).map((x) => x.name);
    const added = await call('edit_break_positions', { add: ['First in break', 'Last in break'], default: 'First in break', apply: true });
    expect(added.isError, added.text).toBe(false);
    expect((await positions()).map((x) => x.name)).toEqual([...before, 'First in break', 'Last in break']);
    expect((await positions()).find((x) => x.isDefault)?.name).toBe('First in break');
    await undo(added.text);
    expect((await positions()).map((x) => x.name)).toEqual(before);
  });
});
