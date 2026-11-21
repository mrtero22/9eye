// The tools of Scheduling (decision 0025, group 6.3; src/mcp/plans.ts): get_plan; create, duplicate,
// split and delete a plan; edit_plan; place_airings (auto, copy_week, rotation, blocks, repeats),
// remove_airings, shift_episodes, replace_items, move_airings; confirm_plan — preview, apply at the
// version, and undo_change.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { platformDb } from '../src/db';
import { preset as presetTable } from '../src/aiPolicy';
import type { Principal } from '../src/mcp/auth';
import { invokeTool, toolDefs } from '../src/mcp/tools';
import { fillMainTemplate, makeCatalog, makeCompany, resetDb, type Fixture } from './fixtures';

let a: Fixture;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  await fillMainTemplate(a);
  await makeCatalog(a);
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

const plans = () => platformDb.order.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, orderBy: { name: 'asc' } });
const plan = async (name: string) => (await plans()).find((o) => o.name === name)!;
const airings = async (name: string) =>
  platformDb.airing.findMany({ where: { orderId: (await plan(name)).id }, include: { items: { include: { orderItem: { include: { production: true } } } } }, orderBy: [{ date: 'asc' }] });
const firstsOf = async (name: string) =>
  (await airings(name)).filter((x) => !x.repeatOfId).map((x) => `${x.date.toISOString().slice(0, 10)} ${x.items.map((i) => i.orderItem.production.chapter).join('+')}`);
const codeAt = (text: string, at: string) => new RegExp(`${at}[^\\n]*· airing ([0-9a-f]{8})`).exec(text)?.[1] ?? '';

/** Harbor Nights, episodes 1–6, every day 06:00–07:00 (Run Block 1), 2030-06-01 (a Saturday) → 06-14. */
const HARBOR = {
  channel: 'AURORA', name: 'Harbor', kind: 'series', from: '2030-06-01', to: '2030-06-14', items: ['Harbor Nights'],
  allowed_times: [{ days: ['every day'], from: '06:00', to: '07:00' }],
};
async function harborPlaced() {
  await applied('create_plan', HARBOR);
  await applied('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'auto' });
}

describe('plans', () => {
  it('create_plan previews and makes a draft with its items; get_plan shows it; auto places it; confirm_plan; undo', async () => {
    const preview = await call('create_plan', HARBOR);
    expect(preview.text).toContain('New plan "Harbor" on AURORA TV · Series · Draft · 2030-06-01 → 2030-06-14 · layout "MAIN" — preview, nothing is made');
    expect(preview.text).toContain('Items (6): ep 1 "Harbor Nights - 1", ep 2 "Harbor Nights - 2"');
    expect(preview.text).toContain('Allowed times: every day 06:00–07:00');
    expect(preview.applyWith).toEqual({ apply: true });
    expect(await plans()).toHaveLength(0);
    const made = await call('create_plan', { ...HARBOR, apply: true });
    expect(made.text).toContain('Plan "Harbor" made on AURORA TV (draft, no airings yet');
    expect(await platformDb.orderItem.count({ where: { orderId: (await plan('Harbor')).id } })).toBe(6);

    const shown = (await call('get_plan', { channel: 'AURORA', plan: 'harbor', from: '2030-06-01' })).text;
    expect(shown).toContain('"Harbor" · Series · Draft · 2030-06-01 → 2030-06-14');
    expect(shown).toContain('- item 3 · ep 3 "Harbor Nights - 3" · code HAR-3 · no length · not placed');
    expect(shown).toContain('- "Run Block 1" · 06:00 every day');
    expect(shown).toContain('first episode to place: the first of the list · start again when the list runs out: no');

    const auto = await call('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'auto' });
    expect(auto.text).toContain('Airings: 6 new first airings');
    expect(auto.text).toContain('+ Sat 2030-06-01 06:00 Run Block 1 · first airing · ep 1 "Harbor Nights - 1"');
    expect(auto.applyWith).toEqual({ apply: true, version: 1 });
    expect(await airings('Harbor')).toHaveLength(0);
    const placed = await call('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'auto', apply: true, version: 1 });
    expect(placed.text).toContain('is at version 2');
    expect(await firstsOf('Harbor')).toEqual(['2030-06-01 1', '2030-06-02 2', '2030-06-03 3', '2030-06-04 4', '2030-06-05 5', '2030-06-06 6']);
    // the version the preview showed is old now
    expect((await call('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'auto', apply: true, version: 1 })).status).toBe(409);

    // a repeat of the first airing, in Run Block 2 the same day
    const first = codeAt((await call('get_plan', { channel: 'AURORA', plan: 'Harbor', from: '2030-06-01' })).text, 'Sat 2030-06-01 06:00 Run Block 1');
    const rep = await applied('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'repeats', repeat_of: `airing ${first}`, blocks: [{ date: '2030-06-01', block: 'Run Block 2' }] });
    expect(rep.preview.text).toContain('+ Sat 2030-06-01 07:00 Run Block 2 · repeat of Sat 2030-06-01 06:00 Run Block 1 (ep 1 "Harbor Nights - 1")');
    expect((await airings('Harbor')).filter((x) => x.repeatOfId)).toHaveLength(1);

    const confirm = await applied('confirm_plan', { channel: 'AURORA', plan: 'Harbor' });
    expect(confirm.preview.text).toContain('"Harbor" on AURORA TV · Draft → Confirmed — preview');
    expect((await plan('Harbor')).status).toBe('confirmed');
    expect((await call('confirm_plan', { channel: 'AURORA', plan: 'Harbor' })).text).toContain('is Confirmed already');

    await undo(confirm.done.text);
    expect((await plan('Harbor')).status).toBe('draft');
    // undo is a change too: an older change cannot be undone over it
    const older = await call('undo_change', { change: changeOf(rep.done.text) });
    expect(older.text).toContain('The plan was changed after that change');
    expect((await airings('Harbor')).filter((x) => x.repeatOfId)).toHaveLength(1);
  });

  it('a plan made and not changed since is deleted by undo', async () => {
    const { done } = await applied('create_plan', HARBOR);
    await undo(done.text);
    expect(await plans()).toHaveLength(0);
  });

  it('edit_plan changes settings and items, refuses what would lose airings; remove_airings, shift_episodes, replace_items; undo', async () => {
    await harborPlaced();
    const edit = await applied('edit_plan', { channel: 'AURORA', plan: 'Harbor', name: 'Harbor S1', start_again: true, add_items: ['BRI-1'], colour: '#059669' });
    expect(edit.preview.text).toContain('- name: "Harbor" → "Harbor S1"');
    expect(edit.preview.text).toContain('- items added: item 7 ep 1 "Bright Lanes - 1"');
    expect(edit.preview.text).toContain('- start again when the list runs out: no → yes');
    expect(await plan('Harbor S1')).toMatchObject({ reuseInLoop: true, color: '#059669' });
    expect((await call('edit_plan', { channel: 'AURORA', plan: 'Harbor S1', remove_items: ['item 1'] })).text).toContain('ep 1 "Harbor Nights - 1" has airings: take them out first');
    expect((await call('edit_plan', { channel: 'AURORA', plan: 'Harbor S1', to: '2030-06-03' })).text).toContain('3 airings fall outside 2030-06-01 → 2030-06-03');
    expect((await call('edit_plan', { channel: 'AURORA', plan: 'Harbor S1', remove_items: ['item 1'], apply: true, version: 3 })).status).toBe(422);
    const ALL = ['2030-06-01 1', '2030-06-02 2', '2030-06-03 3', '2030-06-04 4', '2030-06-05 5', '2030-06-06 6'];

    const removed = await applied('remove_airings', { channel: 'AURORA', plan: 'Harbor S1', from: '2030-06-05' });
    expect(removed.preview.text).toContain('Airings: 2 airings taken out');
    expect(await firstsOf('Harbor S1')).toEqual(ALL.slice(0, 4));
    expect((await call('remove_airings', { channel: 'AURORA', plan: 'Harbor S1' })).isError).toBe(true);
    await undo(removed.done.text);
    expect(await firstsOf('Harbor S1')).toEqual(ALL);

    // ep 2 and after go one airing day later: 06-02 is left empty, a new day continues the pattern
    const shown = (await call('get_plan', { channel: 'AURORA', plan: 'Harbor S1', from: '2030-06-01' })).text;
    const shift = await applied('shift_episodes', { channel: 'AURORA', plan: 'Harbor S1', from_airing: codeAt(shown, 'Sun 2030-06-02 06:00 Run Block 1'), by: 1 });
    expect(shift.preview.text).toContain('5 episodes move');
    expect(await firstsOf('Harbor S1')).toEqual(['2030-06-01 1', '2030-06-03 2', '2030-06-04 3', '2030-06-05 4', '2030-06-06 5', '2030-06-08 6']);
    await undo(shift.done.text);
    expect(await firstsOf('Harbor S1')).toEqual(ALL);

    const replaced = await applied('replace_items', { channel: 'AURORA', plan: 'Harbor S1', items: ['item 3'], with: 'item 7' });
    expect(replaced.preview.text).toContain('ep 3 "Harbor Nights - 3" → ep 1 "Bright Lanes - 1" in 1 airing');
    expect(await firstsOf('Harbor S1')).toContain('2030-06-03 1');
    await undo(replaced.done.text);
    expect(await firstsOf('Harbor S1')).toEqual(ALL);
  });

  it('copy_week, blocks one by one, and rotation for trailers', async () => {
    await applied('create_plan', { ...HARBOR, start_again: true });
    await applied('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'blocks', blocks: [{ date: '2030-06-01', block: 'Run Block 1' }, { date: '2030-06-03', block: 'Half Block', item: 'item 5' }] });
    expect(await firstsOf('Harbor')).toEqual(['2030-06-01 1', '2030-06-03 5']);
    expect((await call('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'blocks', blocks: [{ date: '2030-06-01', block: 'Run Block 1' }] })).text).toContain('holds an airing of this plan already');
    expect((await call('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'blocks', blocks: [{ date: '2030-06-07', block: 'Friday Only' }] })).text).toContain('No block "Friday Only" in layout "MAIN"');

    const copy = await applied('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'copy_week', week: '2030-06-01' });
    expect(copy.preview.text).toContain('The week 2030-06-01 → 2030-06-07 is copied over 1 other week: 4 first airings');
    expect(await firstsOf('Harbor')).toHaveLength(4);

    await applied('create_plan', { channel: 'AURORA', name: 'Idents', kind: 'trailers', from: '2030-06-01', to: '2030-06-07', items: ['Lumen Plus'] });
    const rot = await applied('place_airings', { channel: 'AURORA', plan: 'Idents', how: 'rotation', plays_per_day: 6 });
    expect(rot.preview.text).toContain('A day: "LumenPlus_Ident_1" ×2, "LumenPlus_Ident_2" ×2, "LumenPlus_Ident_3" ×2');
    expect((await airings('Idents')).reduce((n, x) => n + x.passes, 0)).toBe(42);
    expect((await call('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'rotation', plays_per_day: 2 })).text).toContain('rotation is for trailers, stings and graphics');
  });

  it('duplicate, split, move airings to another plan and delete — each undone', async () => {
    await harborPlaced();
    const dup = await applied('duplicate_plan', { channel: 'AURORA', plan: 'Harbor', name: 'Harbor copy' });
    expect((await plans()).map((o) => o.name)).toEqual(['Harbor', 'Harbor copy']);
    await undo(dup.done.text);
    expect((await plans()).map((o) => o.name)).toEqual(['Harbor']);

    const sp = await applied('split_plan', { channel: 'AURORA', plan: 'Harbor', date: '2030-06-04', name: 'Harbor part 2' });
    expect(sp.preview.text).toContain('"Harbor" ends on 2030-06-03 and keeps 3 airings; "Harbor part 2" runs 2030-06-04 → 2030-06-14 with 3 airings.');
    expect(await firstsOf('Harbor part 2')).toEqual(['2030-06-04 4', '2030-06-05 5', '2030-06-06 6']);
    await undo(sp.done.text);
    expect((await plans()).map((o) => o.name)).toEqual(['Harbor']);
    expect(await firstsOf('Harbor')).toHaveLength(6);

    await applied('create_plan', { ...HARBOR, name: 'Ben', items: ['Bright Lanes'] });
    const mv = await applied('move_airings', { channel: 'AURORA', plan: 'Harbor', items: ['item 1'], to_plan: 'Ben' });
    // Harbor: placed (2), split (3), split undone (4)
    expect(mv.preview.applyWith).toMatchObject({ apply: true, version: 4, to_version: 1 });
    expect(await firstsOf('Ben')).toEqual(['2030-06-01 1']);
    expect(await firstsOf('Harbor')).toHaveLength(5);
    await undo(mv.done.text);
    expect(await firstsOf('Ben')).toEqual([]);
    expect(await firstsOf('Harbor')).toHaveLength(6);

    const del = await applied('delete_plan', { channel: 'AURORA', plan: 'Harbor' });
    expect(del.preview.text).toContain('Delete "Harbor" on AURORA TV: Series · Draft · 2030-06-01 → 2030-06-14 · 6 items · 6 airings');
    expect((await plans()).map((o) => o.name)).toEqual(['Ben']);
    await undo(del.done.text);
    expect((await plans()).map((o) => o.name)).toEqual(['Ben', 'Harbor']);
  });

  it('the AI table decides the tools: Drafts hides them, Scheduling › Change on and Create off keeps only the change tools', async () => {
    const p = await principal();
    const names = (policy: Principal['policy']) => new Set(toolDefs({ ...p, via: 'mcp', policy }).map((d) => d.name));
    const drafts = names(presetTable('drafts'));
    expect(drafts.has('get_plan')).toBe(true);
    expect(drafts.has('place_airings')).toBe(false);
    const t = presetTable('drafts');
    t.scheduling = { ...t.scheduling, change: 'on', approve: 'ask' };
    const some = names(t);
    expect(['place_airings', 'edit_plan', 'confirm_plan'].every((n) => some.has(n))).toBe(true);
    expect(['create_plan', 'delete_plan', 'split_plan'].some((n) => some.has(n))).toBe(false);
    expect(names(presetTable('full')).has('create_plan')).toBe(true);
  });
});
