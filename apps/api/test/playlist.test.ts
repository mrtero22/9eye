// The rest of Playlist (decision 0025, group 6.2; src/mcp/playlist.ts): list_weeks, rename_week,
// delete_week, export_day; approve_day and reopen_day for AI apps under the table; Export is Allowed
// or Off.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { normalize, preset } from '../src/aiPolicy';
import { platformDb } from '../src/db';
import type { Principal } from '../src/mcp/auth';
import { invokeTool, toolDefs } from '../src/mcp/tools';
import { fillMainTemplate, makeCompany, resetDb, type Fixture } from './fixtures';

let a: Fixture;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  await fillMainTemplate(a);
});

afterAll(async () => {
  await platformDb.$disconnect();
});

async function principal(more: Partial<Principal> = {}): Promise<Principal> {
  const tenant = await platformDb.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
  return { user: { id: null, name: 'Tester' }, tenant, tokenId: null, via: 'agent', access: { all: true, grants: new Set(), channelIds: null }, canWrite: true, ...more };
}
async function call(name: string, args: Record<string, unknown>, more: Partial<Principal> = {}) {
  const p = await principal(more);
  const def = toolDefs(p).find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return invokeTool(p, def, def.input.parse(args));
}
async function applied(name: string, args: Record<string, unknown>, more: Partial<Principal> = {}) {
  const preview = await call(name, args, more);
  expect(preview.isError, preview.text).toBe(false);
  expect(preview.applyWith, preview.text).toBeTruthy();
  const done = await call(name, { ...args, ...preview.applyWith }, more);
  expect(done.isError, done.text).toBe(false);
  return { preview, done };
}
const changeOf = (text: string) => /Change id ([0-9a-f-]{36})/.exec(text)?.[1] ?? '';
const undo = async (text: string) => {
  const r = await call('undo_change', { change: changeOf(text) });
  expect(r.isError, r.text).toBe(false);
  return r;
};
const weeks = (kind: 'main' | 'ads') => platformDb.week.findMany({ where: { tenantId: a.tenantId, playlist: { kind } }, orderBy: { firstDate: 'asc' } });
const day = (date: string) => platformDb.dayPlaylist.findFirstOrThrow({ where: { date: new Date(`${date}T00:00:00Z`), playlist: { kind: 'main', channelId: a.channelId } } });

beforeEach(async () => {
  // two weeks of both playlists from Saturday 1 June 2030
  await applied('create_weeks', { channel: 'AURORA', from_week: '2030-06-01', to_week: '2030-06-08' });
});

describe('weeks', () => {
  it('list_weeks; rename_week and delete_week at the version, each undone; a week in use stays', async () => {
    const listed = (await call('list_weeks', { channel: 'AURORA', from: '2030-06-03', weeks: 2 })).text;
    expect(listed).toContain('AURORA TV · weeks 2030-06-01 → 2030-06-14 · 4 weeks');
    expect(listed).toMatch(/- Week \d+ "[^"]+" · main · 2030-06-01 → 2030-06-07 · layout "MAIN" · days: 7 drafts · version 1/);

    const was = (await weeks('main'))[0].name;
    const renamed = await applied('rename_week', { channel: 'AURORA', date: '2030-06-03', name: 'Opening week' });
    expect(renamed.preview.text).toContain(`- name: "${was}" → "Opening week"`);
    expect((await weeks('main'))[0].name).toBe('Opening week');
    expect((await call('rename_week', { channel: 'AURORA', date: '2030-06-03', name: 'x', apply: true, version: 1 })).status).toBe(409);
    await undo(renamed.done.text);
    expect((await weeks('main'))[0].name).toBe(was);

    const second = (await weeks('main'))[1].name;
    const del = await applied('delete_week', { channel: 'AURORA', date: '2030-06-10' });
    expect(del.preview.text).toContain('· main · 2030-06-08 → 2030-06-14');
    expect(await weeks('main')).toHaveLength(1);
    expect(await weeks('ads')).toHaveLength(2);
    await undo(del.done.text);
    expect((await weeks('main')).map((w) => w.name)).toEqual([expect.any(String), second]);

    await platformDb.dayPlaylist.updateMany({ where: { id: (await day('2030-06-01')).id }, data: { published: true } });
    const used = await call('delete_week', { channel: 'AURORA', date: '2030-06-01' });
    expect(used.text).toContain('Cannot: the week is in use.');
    expect(used.applyWith).toBeFalsy();
  });
});

describe('export and approval', () => {
  it("export_day hands over the day's playout file; a day without a playlist says so", async () => {
    const r = await call('export_day', { channel: 'AURORA', date: '2030-06-01' });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain('THE DAY IS A DRAFT: not approved for air yet');
    expect(r.text).toContain('```xml');
    const none = await call('export_day', { channel: 'AURORA', date: '2031-01-04' });
    expect(none.isError).toBe(true);
    expect(none.text).toContain('This day has no main playlist yet');
  });

  it('an AI app approves and reopens a day where the table allows it; asks first; never without Playlist › Approve', async () => {
    const names = async (policy: Principal['policy']) => new Set(toolDefs(await principal({ via: 'mcp', policy })).map((d) => d.name));
    const drafts = await names(preset('drafts'));
    expect(['approve_day', 'reopen_day', 'export_day'].some((n) => drafts.has(n))).toBe(false);
    expect(['list_weeks', 'rename_week', 'delete_week'].every((n) => drafts.has(n))).toBe(true);
    const ask = preset('drafts');
    ask.playlist = { ...ask.playlist, approve: 'ask' };
    const asking = toolDefs(await principal({ via: 'mcp', policy: ask })).find((d) => d.name === 'approve_day')!;
    expect(asking.description).toContain('a person approves this in 9eye first');

    const full = { via: 'mcp' as const, policy: preset('full') };
    expect((await names(full.policy)).has('export_day')).toBe(true);
    const approve = await applied('approve_day', { channel: 'AURORA', date: '2030-06-01' }, full);
    expect(approve.preview.text).toContain('preview: approving puts this day on air');
    expect((await day('2030-06-01')).published).toBe(true);
    await applied('reopen_day', { channel: 'AURORA', date: '2030-06-01' }, full);
    expect((await day('2030-06-01')).published).toBe(false);
  });

  it('Read and Export are Allowed or Off: a read asked first is Allowed, an export asked first is Off', () => {
    const t = normalize({ playlist: { read: 'ask', export: 'ask', approve: 'ask' } });
    expect(t.playlist).toMatchObject({ read: 'on', export: 'off', approve: 'ask' });
  });
});
