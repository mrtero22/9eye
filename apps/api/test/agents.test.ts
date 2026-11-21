// Agents (decision 0024, docs/design/agents-page.md), with a scripted provider (no network, no cost):
// phase A and B —
// provider keys, the gallery and settings, chat, change cards a person approves / rejects / undoes,
// what an agent may do (its role ∩ its parts ∩ the person), rooms, @mentions, hand-offs and their
// limit, memory, skill cards and the step limit.

import { uuidv7 } from '@9eye/core';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { SESSION_COOKIE, createSession } from '../src/auth';
import { platformDb } from '../src/db';
import { setTestProvider, type SessionInput, type Turn } from '../src/agents/providers';
import { nextTime, tick } from '../src/agents/routines';
import { settled } from '../src/agents/runner';
import { mentioned } from '../src/agents/service';
import { ALL, auth, block, makeCatalog, makeCompany, resetDb, type Fixture } from './fixtures';

const app = createApp();
let a: Fixture;
let roleId: string;

const SAT = '2030-06-01'; // the fixture channel's week starts on Saturday

// ---------------------------------------------------------------- the scripted provider

type Behaviour = (input: SessionInput, turn: number) => Turn;
const scripts = new Map<string, Turn[] | Behaviour>();
interface Seen {
  agent: string;
  system: string;
  prompt: string;
  tools: string[];
  schemas: Record<string, Record<string, unknown>>;
  results: { text: string; isError: boolean }[];
}
let seen: Seen[] = [];

const end = (text: string): Turn => ({ text, calls: [], stop: 'end', inputTokens: 100, outputTokens: 20 });
const call = (name: string, input: object): Turn => ({ text: '', calls: [{ id: uuidv7(), name, input }], stop: 'tools', inputTokens: 100, outputTokens: 10 });

setTestProvider((_cfg, input) => {
  const agent = /^You are "([^"]+)"/.exec(input.system)?.[1] ?? '?';
  const log: Seen = {
    agent, system: input.system, prompt: input.prompt, tools: input.tools.map((t) => t.name),
    schemas: Object.fromEntries(input.tools.map((t) => [t.name, t.schema])), results: [],
  };
  seen.push(log);
  let turn = 0;
  return {
    async next() {
      const s = scripts.get(agent);
      if (typeof s === 'function') return s(input, turn++);
      return s?.shift() ?? end('Done.');
    },
    answer(results) {
      log.results.push(...results.map((r) => ({ text: r.text, isError: r.isError })));
    },
  };
});

// ---------------------------------------------------------------- set-up

const as = (headers: Record<string, string>) => ({
  get: (u: string) => request(app).get(`/api${u}`).set(headers),
  post: (u: string, body: object = {}) => request(app).post(`/api${u}`).set(headers).send(body),
  put: (u: string, body: object) => request(app).put(`/api${u}`).set(headers).send(body),
  delete: (u: string) => request(app).delete(`/api${u}`).set(headers),
});
const admin = () => as(auth(a.slug));

/** A member with these grants (on every channel). */
async function member(grants: string[], name = 'Dana Ellis') {
  const user = await platformDb.user.create({ data: { id: uuidv7(), email: `${uuidv7()}@test.example`, name } });
  const role = await platformDb.role.create({
    data: { id: uuidv7(), tenantId: a.tenantId, name: `Role of ${name} ${user.id}`, allChannels: true, grants: { create: grants.map((g) => ({ id: uuidv7(), module: g.split(':')[0], action: g.split(':')[1] })) } },
  });
  await platformDb.membership.create({ data: { id: uuidv7(), tenantId: a.tenantId, userId: user.id, roleId: role.id, status: 'active' } });
  const { token } = await createSession(user.id);
  return { user, ...as({ Cookie: `${SESSION_COOKIE}=${token}`, 'X-Tenant': a.slug }) };
}

beforeEach(async () => {
  await resetDb();
  scripts.clear();
  seen = [];
  a = await makeCompany('aurora');
  await platformDb.tenant.update({ where: { id: a.tenantId }, data: { aiAccess: 'edit' } });
  // Saturdays: Run Block 1 06:00 with its breaks, then Half Block 07:00 (create_weeks then has weeks to make)
  const blocks = [block(6, a.types.run1, 0, 60, [a.breaks['Billboard 1 06'], a.breaks['AB 06']]), block(6, a.types.half, 60, 30)];
  await admin().put(`/templates/${a.mainTemplateId}`, { version: 1, name: 'MAIN', validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: ALL, blocks }).expect(200);
  const role = await platformDb.role.create({
    data: {
      id: uuidv7(), tenantId: a.tenantId, name: 'Agents', allChannels: true,
      grants: { create: ['playlist:view', 'playlist:edit', 'playlist:approve', 'catalog:view', 'orders:view', 'templates:view'].map((g) => ({ id: uuidv7(), module: g.split(':')[0], action: g.split(':')[1] })) },
    },
  });
  roleId = role.id;
  await admin().put('/admin/ai-providers/anthropic', { apiKey: 'sk-ant-test-0123456789abcdefWXYZ' }).expect(200);
});

afterEach(async () => {
  await settled();
});

afterAll(async () => {
  setTestProvider(null);
  await platformDb.$disconnect();
});

async function newAgent(template: string, name?: string, settings: Record<string, unknown> = {}) {
  const made = (await admin().post('/agents', { template, roleId, ...(name ? { name } : {}) }).expect(201)).body;
  if (!Object.keys(settings).length) return made;
  const body = {
    version: made.version, name: made.name, mark: made.mark, color: made.color, job: made.job, provider: made.provider, model: made.model, roleId: made.role.id,
    parts: made.parts, channelIds: made.channelIds, skill: made.skill, worksWith: made.worksWith, enabled: made.enabled, maxSteps: made.maxSteps,
    monthlyTokens: made.monthlyTokens, ...settings,
  };
  return (await admin().put(`/agents/${made.id}`, body).expect(200)).body;
}

const weeks = () => platformDb.week.count({ where: { playlist: { channelId: a.channelId } } });

async function chat(agentId: string, text: string, who = admin()) {
  await who.post(`/agents/${agentId}/chat`, { text }).expect(201);
  await settled();
  return (await who.get(`/agents/${agentId}/chat`).expect(200)).body as { messages: { kind: string; text: string; author: { kind: string; name: string }; change: { id: string; status: string; canDecide: boolean; [k: string]: unknown } | null; skill: { status: string } | null; id: string }[]; running: unknown[] };
}

/** The audit log is written when the answer has gone out (audit.ts, on finish): wait for the row, at most 3 s. */
async function auditRow(action: string) {
  for (let i = 0; i < 30; i++) {
    const row = await platformDb.auditEvent.findFirst({ where: { action } });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return platformDb.auditEvent.findFirstOrThrow({ where: { action } });
}

// ---------------------------------------------------------------- tests

describe('provider keys', () => {
  it('are kept encrypted, never sent back, and hidden in the audit log', async () => {
    const list = (await admin().get('/admin/ai-providers').expect(200)).body;
    expect(list).toEqual([
      expect.objectContaining({ provider: 'anthropic', label: 'Claude (Anthropic)', set: true, last4: 'WXYZ' }),
      expect.objectContaining({ provider: 'openai', set: false, last4: null }),
      expect.objectContaining({ provider: 'xai', label: 'Grok (xAI)', set: false }),
    ]);
    expect(JSON.stringify(list)).not.toContain('sk-ant');
    const row = await platformDb.aiProvider.findFirstOrThrow({ where: { tenantId: a.tenantId } });
    expect(row.secret).not.toContain('sk-ant');
    const audit = await auditRow('PUT /admin/ai-providers/:provider');
    expect(audit.input).toEqual({ apiKey: '[hidden]' });
    await admin().put('/admin/ai-providers/openai', { apiKey: 'not a key' }).expect(422);
    expect((await admin().delete('/admin/ai-providers/anthropic').expect(200)).body[0]).toMatchObject({ set: false });
  });

  it('without a key the agent says so in the chat', async () => {
    const ag = await newAgent('gap-filler');
    await admin().delete('/admin/ai-providers/anthropic').expect(200);
    const { messages } = await chat(ag.id, 'Fill Saturday');
    expect(messages.map((m) => [m.kind, m.text])).toEqual([
      ['text', 'Fill Saturday'],
      ['error', 'There is no key for Claude (Anthropic): a company admin adds one in Settings › AI access.'],
    ]);
  });
});

describe('the gallery and settings', () => {
  it('makes an agent from the gallery on Claude Opus 5.5, keeps its skill history, and checks names and versions', async () => {
    const ag = await newAgent('playlist-checker');
    expect(ag).toMatchObject({ name: 'Playlist checker', mark: 'PC', provider: 'anthropic', model: 'claude-opus-5-5', parts: { playlist: 'read', media: 'read' }, enabled: true });
    expect(ag.skills).toHaveLength(1);
    await admin().post('/agents', { template: 'playlist-checker', roleId }).expect(409);
    const empty = (await admin().post('/agents', { template: 'empty', name: 'Night watch', roleId }).expect(201)).body;
    expect(empty).toMatchObject({ name: 'Night watch', mark: 'NW', job: '', skill: '', skills: [] });

    const changed = await newAgent('gap-filler', undefined, { skill: '1. Only fill blocks short by more than a minute.' });
    expect(changed.skills.map((s: { via: string }) => s.via)).toEqual(['settings', 'settings']);
    await admin().put(`/agents/${changed.id}`, { ...changed, roleId, version: 1 }).expect(409);

    const overview = (await admin().get('/agents').expect(200)).body;
    expect(overview.agents.map((x: { name: string }) => x.name)).toEqual(['Gap filler', 'Night watch', 'Playlist checker']);
    expect(overview).toMatchObject({ canManage: true, waiting: 0, defaultModel: { provider: 'anthropic', model: 'claude-opus-5-5' } });
  });

  it('only people who can change Settings manage agents; every member can see and chat', async () => {
    const ag = await newAgent('gap-filler');
    const m = await member(['playlist:view']);
    await m.post('/agents', { template: 'gap-filler', roleId }).expect(403);
    await m.delete(`/agents/${ag.id}`).expect(403);
    expect((await m.get('/agents').expect(200)).body.canManage).toBe(false);
    await m.get(`/agents/${ag.id}`).expect(200);
  });
});

describe('chat and change cards', () => {
  it('a write tool only previews; the change waits for a person, who approves it — then undo puts it back', async () => {
    const ag = await newAgent('weeks-builder');
    scripts.set('Weeks builder', [call('create_weeks', { channel: 'AURORA', from_week: SAT, apply: true }), end('Two weeks are ready for your approval.')]);
    const { messages } = await chat(ag.id, 'Make the week of 1 June');

    const s = seen[0];
    expect(s.tools).toEqual(expect.arrayContaining(['list_channels', 'get_day_playlist', 'check_day', 'create_weeks', 'fill_day', 'remember', 'propose_skill_change']));
    expect(s.tools).not.toContain('undo_change');
    expect(s.tools).not.toContain('hand_off');
    expect(s.tools).not.toContain('book_campaign_spots');
    expect(Object.keys((s.schemas.create_weeks.properties ?? {}) as object)).not.toContain('apply');
    expect(s.system).toContain('Every change waits for a person');
    expect(s.prompt).toContain('[Local user] Make the week of 1 June');
    expect(s.results[0].text).toContain('preview — nothing is created');
    expect(s.results[0].text).toContain('change card waiting for a person');
    expect(await weeks()).toBe(0);

    expect(messages.map((m) => m.kind)).toEqual(['text', 'change', 'text']);
    const card = messages[1].change!;
    expect(card).toMatchObject({ status: 'waiting', canDecide: true });
    expect((await admin().get('/agents').expect(200)).body.waiting).toBe(1);

    // the same preview again: no second card
    scripts.set('Weeks builder', [call('create_weeks', { channel: 'AURORA', from_week: SAT }), end('Still waiting.')]);
    await chat(ag.id, 'Again');
    expect(seen[1].results[0].text).toContain('already waiting');
    expect(await platformDb.agentChange.count()).toBe(1);

    const approved = (await admin().post(`/agents/changes/${card.id}/approve`).expect(200)).body;
    expect(approved).toMatchObject({ status: 'approved', decidedBy: 'Local user', canUndo: true });
    expect(approved.result).toContain('2 weeks created');
    expect(await weeks()).toBe(2);
    const applied = (await platformDb.auditEvent.findMany({ where: { action: 'tool create_weeks', ok: true } })).filter((e) => e.after);
    expect(applied).toEqual([expect.objectContaining({ via: 'agent' })]);
    await admin().post(`/agents/changes/${card.id}/approve`).expect(409);

    const undone = (await admin().post(`/agents/changes/${card.id}/undo`).expect(200)).body;
    expect(undone.status).toBe('undone');
    expect(await weeks()).toBe(0);
  });

  it('a person who may not change it cannot approve; rejecting leaves everything as it was', async () => {
    const ag = await newAgent('weeks-builder');
    scripts.set('Weeks builder', [call('create_weeks', { channel: 'AURORA', from_week: SAT }), end('Ready.')]);
    const card = (await chat(ag.id, 'Make it')).messages[1].change!;
    const viewer = await member(['playlist:view'], 'Viewer');
    const r = await viewer.post(`/agents/changes/${card.id}/approve`).expect(403);
    expect(r.body.error).toContain('Your role does not let you change Playlist');
    expect((await viewer.get('/agents/changes').expect(200)).body[0]).toMatchObject({ status: 'waiting', canDecide: false });
    const editor = await member(['playlist:view', 'playlist:edit'], 'Editor');
    expect((await editor.post(`/agents/changes/${card.id}/reject`).expect(200)).body).toMatchObject({ status: 'rejected', decidedBy: 'Editor' });
    expect(await weeks()).toBe(0);
  });

  it('never more than its role, its parts and the person who asks allow', async () => {
    // the person can only view the playlist: the agent cannot prepare a change for them
    const ag = await newAgent('weeks-builder');
    const viewer = await member(['playlist:view'], 'Viewer');
    scripts.set('Weeks builder', [call('create_weeks', { channel: 'AURORA', from_week: SAT }), end('I cannot.')]);
    await chat(ag.id, 'Make it', viewer);
    expect(seen[0].results[0]).toEqual({ isError: true, text: 'Your role does not let you change Playlist.' });

    // read only parts: no write tools at all
    const reader = await newAgent('playlist-checker');
    scripts.set('Playlist checker', [end('ok')]);
    await chat(reader.id, 'hi');
    expect(seen[1].tools).not.toContain('create_weeks');

    // the company lets AI apps only read: no write tools, and approving is refused
    scripts.set('Weeks builder', [call('create_weeks', { channel: 'AURORA', from_week: SAT }), end('Ready.')]);
    const card = (await chat(ag.id, 'Make it')).messages.find((m) => m.change)!.change!;
    await platformDb.tenant.update({ where: { id: a.tenantId }, data: { aiAccess: 'read' } });
    expect((await admin().post(`/agents/changes/${card.id}/approve`).expect(409)).body.error).toContain('AI may not do this in aurora now');
    scripts.set('Weeks builder', [end('ok')]);
    await chat(ag.id, 'hi');
    expect(seen[seen.length - 1].tools).not.toContain('create_weeks');
  });
});

describe('memory, skill cards and limits', () => {
  it('remembers what it is told; a skill card is saved by a manager or used only this time', async () => {
    const ag = await newAgent('gap-filler');
    scripts.set('Gap filler', [
      call('remember', { text: 'AURORA TV fills short blocks with idents first.' }),
      call('propose_skill_change', { skill: '1. Fill with idents first.\n2. Then trailers.', why: 'Idents first, as Dana asked.' }),
      end('Noted, and I proposed a new skill.'),
    ]);
    const { messages } = await chat(ag.id, 'From now on use idents first');
    expect(messages.map((m) => m.kind)).toEqual(['text', 'memory', 'skill', 'text']);
    const detail = (await admin().get(`/agents/${ag.id}`).expect(200)).body;
    expect(detail.memory).toEqual([expect.objectContaining({ text: 'AURORA TV fills short blocks with idents first.', source: 'Local user in the chat' })]);

    const card = messages[2];
    const saved = (await admin().post(`/agents/messages/${card.id}/skill`, { choice: 'save' }).expect(200)).body;
    expect(saved.skill).toMatchObject({ status: 'saved', decidedBy: 'Local user' });
    const after = (await admin().get(`/agents/${ag.id}`).expect(200)).body;
    expect(after.skill).toBe('1. Fill with idents first.\n2. Then trailers.');
    expect(after.skills[0]).toMatchObject({ via: 'chat', changedBy: 'Local user' });
    await admin().post(`/agents/messages/${card.id}/skill`, { choice: 'save' }).expect(409);

    // the next run reads its memory and new skill
    scripts.set('Gap filler', [end('ok')]);
    await chat(ag.id, 'hi');
    expect(seen[1].system).toContain('AURORA TV fills short blocks with idents first.');
    expect(seen[1].system).toContain('1. Fill with idents first.');

    await admin().delete(`/agents/${ag.id}/memory/${detail.memory[0].id}`).expect(204);

    // a member who cannot change Settings: only this time
    const m = await member(['playlist:view', 'playlist:edit']);
    scripts.set('Gap filler', [call('propose_skill_change', { skill: 'x', why: 'y' }), end('ok')]);
    const card2 = (await chat(ag.id, 'change it', m)).messages.find((x) => x.kind === 'skill')!;
    await m.post(`/agents/messages/${card2.id}/skill`, { choice: 'save' }).expect(403);
    expect((await m.post(`/agents/messages/${card2.id}/skill`, { choice: 'once' }).expect(200)).body.skill.status).toBe('once');
  });

  it('stops at its step limit and at its tokens for the month', async () => {
    const ag = await newAgent('gap-filler', undefined, { maxSteps: 2 });
    scripts.set('Gap filler', () => call('list_channels', {}));
    const { messages } = await chat(ag.id, 'Loop');
    expect(messages[messages.length - 1]).toMatchObject({ kind: 'error', text: expect.stringContaining('limit of 2 steps') });
    const run = await platformDb.agentRun.findFirstOrThrow({ where: { agentId: ag.id } });
    expect(run).toMatchObject({ status: 'stopped', inputTokens: 200, outputTokens: 20 });

    await platformDb.agent.update({ where: { id: ag.id }, data: { monthlyTokens: 10_000 } });
    await platformDb.agentRun.update({ where: { id: run.id }, data: { inputTokens: 10_000 } });
    const after = await chat(ag.id, 'Again');
    expect(after.messages[after.messages.length - 1]).toMatchObject({ kind: 'error', text: expect.stringContaining('has used its 10,000 tokens') });
  });
});

describe('rooms and hand-offs', () => {
  it('@mentioned agents answer; a hand-off goes to the agent it works with, and the answer comes back', async () => {
    const fixer = await newAgent('media-fixer');
    const checker = await newAgent('playlist-checker', undefined, { worksWith: [fixer.id] });
    const room = (await admin().post('/agents/rooms', { name: 'playlist-checks', description: 'Daily checks' }).expect(201)).body;

    scripts.set('Playlist checker', [
      call('hand_off', { agent: 'Media fixer', task: 'Row 3 of Saturday has no media.' }),
      end('I handed the missing media to Media fixer.'),
      end('Media fixer found the item: Saturday is fine now.'),
    ]);
    scripts.set('Media fixer', [end('Found it: Harbor S01E03 v2.')]);
    await admin().post(`/agents/rooms/${room.id}/messages`, { text: '@Playlist checker check Saturday please' }).expect(201);
    await settled();
    const { messages } = (await admin().get(`/agents/rooms/${room.id}`).expect(200)).body;
    expect(messages.map((m: { author: { name: string }; text: string }) => `${m.author.name}: ${m.text}`)).toEqual([
      'Local user: @Playlist checker check Saturday please',
      'Playlist checker: @Media fixer Row 3 of Saturday has no media.',
      'Playlist checker: I handed the missing media to Media fixer.',
      'Media fixer: Found it: Harbor S01E03 v2.',
      'Playlist checker: Media fixer found the item: Saturday is fine now.',
    ]);
    const runs = await platformDb.agentRun.findMany({ orderBy: { startedAt: 'asc' } });
    expect(runs.map((r) => [r.trigger, r.chain.length])).toEqual([['room', 0], ['handoff', 1], ['report', 2]]);
    expect(seen[0].tools).toContain('hand_off');
    expect(seen[1].tools).not.toContain('hand_off'); // the fixer works with nobody
    expect(seen[2].prompt).toContain('Media fixer reports back');

    // only to agents it works with
    scripts.set('Playlist checker', [call('hand_off', { agent: 'Gap filler', task: 'x' }), end('ok')]);
    await admin().post(`/agents/rooms/${room.id}/messages`, { text: '@playlist checker again' }).expect(201);
    await settled();
    expect(seen[3].results[0]).toEqual({ isError: true, text: 'You can hand work only to: Media fixer.' });
  });

  it('never hands back to an agent earlier in the chain, and a chain ends after 3 hand-offs', async () => {
    // Four ends the chain One → Two → Three → Four; Two also works with One
    const four = await newAgent('empty', 'Four');
    const three = await newAgent('empty', 'Three', { worksWith: [four.id] });
    const two = await newAgent('empty', 'Two', { worksWith: [three.id] });
    const one = await newAgent('empty', 'One', { worksWith: [two.id] });
    await newAgent('empty', 'One2'); // a longer name that starts the same is not a mention of "One"
    const twoAgain = (await admin().get(`/agents/${two.id}`).expect(200)).body;
    await admin().put(`/agents/${two.id}`, { ...twoAgain, roleId, worksWith: [three.id, one.id] }).expect(200);
    const fourAgain = (await admin().get(`/agents/${four.id}`).expect(200)).body;
    await admin().put(`/agents/${four.id}`, { ...fourAgain, roleId, worksWith: [one.id] }).expect(200);
    const room = (await admin().post('/agents/rooms', { name: 'chain' }).expect(201)).body;
    const handTo = (...others: string[]) => (input: SessionInput, turn: number): Turn =>
      turn < others.length && input.tools.some((t) => t.name === 'hand_off') && !input.prompt.includes('reports back') ? call('hand_off', { agent: others[turn], task: 'your turn' }) : end('done');
    scripts.set('One', handTo('Two'));
    scripts.set('Two', handTo('One', 'Three')); // back to One is refused, then on to Three
    scripts.set('Three', handTo('Four'));
    scripts.set('Four', handTo('One'));
    await admin().post(`/agents/rooms/${room.id}/messages`, { text: '@One start' }).expect(201);
    await settled();

    const two1 = seen.find((s) => s.agent === 'Two')!;
    expect(two1.results[0]).toEqual({ isError: true, text: expect.stringContaining('One is earlier in this chain of hand-offs') });
    const runs = await platformDb.agentRun.findMany({ include: { agent: true }, orderBy: { startedAt: 'asc' } });
    expect(runs.filter((r) => r.trigger !== 'report').map((r) => [r.agent.name, r.trigger, r.chain.length])).toEqual([
      ['One', 'room', 0], ['Two', 'handoff', 1], ['Three', 'handoff', 2], ['Four', 'handoff', 3],
    ]);
    expect(seen.find((s) => s.agent === 'Four')!.tools).not.toContain('hand_off'); // the chain is full
    expect(Math.max(...runs.map((r) => r.chain.length))).toBeLessThanOrEqual(3);
    expect(runs.every((r) => r.status === 'done')).toBe(true);
    const { messages } = (await admin().get(`/agents/rooms/${room.id}`).expect(200)).body;
    expect(messages.some((m: { kind: string; text: string }) => m.kind === 'error' && m.text.includes('as long as it may be'))).toBe(true);
  });

  it('finds @mentions by whole name, longest first', () => {
    const agents = [{ name: 'Gap filler' }, { name: 'Gap filler 2' }, { name: 'Ads booker' }];
    expect(mentioned('@Gap filler 2 and @ads BOOKER, not Gap filler', agents).map((x) => x.name)).toEqual(['Gap filler 2', 'Ads booker']);
    expect(mentioned('@Gap fillers', agents)).toEqual([]);
    expect(mentioned('email@Gap filler', agents).map((x) => x.name)).toEqual(['Gap filler']);
  });
});

// ---------------------------------------------------------------- phase B

const EVERY_DAY = [true, true, true, true, true, true, true];
const routineBody = (over: Record<string, unknown> = {}) => ({
  name: 'Evening check', kind: 'time', time: '18:00', weekdays: EVERY_DAY, timeZone: 'Asia/Tehran', request: 'Check tomorrow on every channel.', ...over,
});

describe('routines: the clock', () => {
  it('works out the next time in a time zone, on chosen weekdays, over a clock change', () => {
    const at = (iso: string) => new Date(iso);
    // Tehran is UTC+03:30 all year
    expect(nextTime('18:00', EVERY_DAY, 'Asia/Tehran', at('2026-11-17T10:00:00Z'))?.toISOString()).toBe('2026-11-17T14:30:00.000Z');
    expect(nextTime('18:00', EVERY_DAY, 'Asia/Tehran', at('2026-11-17T14:30:00Z'))?.toISOString()).toBe('2026-11-18T14:30:00.000Z');
    // only Mondays (2026-11-17 is a Tuesday)
    const mondays = [false, true, false, false, false, false, false];
    expect(nextTime('09:00', mondays, 'UTC', at('2026-11-17T10:00:00Z'))?.toISOString()).toBe('2026-11-23T09:00:00.000Z');
    // Berlin: 02:30 does not exist on 28 March 2027 (clocks go 02:00 → 03:00): it runs at 03:30 CEST
    expect(nextTime('02:30', EVERY_DAY, 'Europe/Berlin', at('2027-03-28T00:00:00Z'))?.toISOString()).toBe('2027-03-28T01:30:00.000Z');
    expect(nextTime('02:30', EVERY_DAY, 'Europe/Berlin', at('2027-03-29T00:00:00Z'))?.toISOString()).toBe('2027-03-29T00:30:00.000Z');
    expect(nextTime('09:00', [false, false, false, false, false, false, false], 'UTC', at('2026-11-17T10:00:00Z'))).toBeNull();
  });

  it('checks a routine; its maker or a manager changes it', async () => {
    const ag = await newAgent('playlist-checker');
    const made = (await admin().post(`/agents/${ag.id}/routines`, routineBody()).expect(201)).body;
    expect(made).toMatchObject({ name: 'Evening check', kind: 'time', time: '18:00', timeZone: 'Asia/Tehran', canChange: true, createdBy: { name: 'Local user' } });
    expect(new Date(made.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect((await admin().get('/agents').expect(200)).body.agents[0].nextRoutineAt).toBe(made.nextRunAt);

    await admin().post(`/agents/${ag.id}/routines`, routineBody({ time: '25:00' })).expect(422);
    await admin().post(`/agents/${ag.id}/routines`, routineBody({ timeZone: 'Mars/Olympus' })).expect(422);
    await admin().post(`/agents/${ag.id}/routines`, routineBody({ weekdays: [false, false, false, false, false, false, false] })).expect(422);
    await admin().post(`/agents/${ag.id}/routines`, routineBody({ kind: 'event', event: null })).expect(422);

    const m = await member(['playlist:view']);
    const theirs = (await m.post(`/agents/${ag.id}/routines`, routineBody({ name: 'Mine' })).expect(201)).body;
    await m.put(`/agents/routines/${made.id}`, routineBody({ name: 'Taken' })).expect(403);
    await m.put(`/agents/routines/${theirs.id}`, routineBody({ name: 'Mine, later', time: '19:30' })).expect(200);
    expect((await m.get(`/agents/${ag.id}/routines`).expect(200)).body.map((r: { name: string; canChange: boolean }) => [r.name, r.canChange])).toEqual([
      ['Evening check', false], ['Mine, later', true],
    ]);
    await admin().delete(`/agents/routines/${theirs.id}`).expect(204);
    // paused: no next time
    expect((await admin().put(`/agents/routines/${made.id}`, routineBody({ enabled: false })).expect(200)).body.nextRunAt).toBeNull();
  });

  it('starts a routine that is due, once, for its maker, in its room; a very late one only moves on', async () => {
    const ag = await newAgent('playlist-checker');
    const room = (await admin().post('/agents/rooms', { name: 'checks' }).expect(201)).body;
    const r = (await admin().post(`/agents/${ag.id}/routines`, routineBody({ roomId: room.id })).expect(201)).body;
    const now = new Date();
    await platformDb.agentRoutine.update({ where: { id: r.id }, data: { nextRunAt: new Date(now.getTime() - 60_000) } });
    scripts.set('Playlist checker', [end('Tomorrow is fine on every channel.')]);
    expect(await tick(now)).toBe(1);
    expect(await tick(now)).toBe(0);
    await settled();
    const run = await platformDb.agentRun.findFirstOrThrow({ where: { agentId: ag.id } });
    expect(run).toMatchObject({ trigger: 'routine', routineId: r.id, roomId: room.id, status: 'done' });
    expect(seen[0].prompt).toContain('Your routine "Evening check" asks you:\nCheck tomorrow on every channel.');
    expect(seen[0].system).toContain('This is one of your routines, made by Local user');
    const { messages } = (await admin().get(`/agents/rooms/${room.id}`).expect(200)).body;
    expect(messages).toEqual([expect.objectContaining({ text: 'Tomorrow is fine on every channel.', routine: 'Evening check' })]);
    const after = await platformDb.agentRoutine.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());

    // the API was down for two hours: not run, only moved on
    await platformDb.agentRoutine.update({ where: { id: r.id }, data: { nextRunAt: new Date(now.getTime() - 2 * 3_600_000) } });
    expect(await tick(now)).toBe(0);
    expect(await platformDb.agentRun.count()).toBe(1);
    expect((await platformDb.agentRoutine.findUniqueOrThrow({ where: { id: r.id } })).nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  it('runs now on request; a routine whose maker left says it did not run', async () => {
    const ag = await newAgent('playlist-checker');
    const m = await member(['playlist:view'], 'Omar Haddad');
    const r = (await m.post(`/agents/${ag.id}/routines`, routineBody()).expect(201)).body;
    scripts.set('Playlist checker', [end('Checked.')]);
    const { runId } = (await m.post(`/agents/routines/${r.id}/run`).expect(200)).body;
    await settled();
    expect(await platformDb.agentRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({ trigger: 'routine', requestedById: m.user.id, chatUserId: m.user.id });
    expect(seen[0].prompt).toContain('Omar Haddad asked to run it now.');
    expect((await m.get(`/agents/${ag.id}/chat`).expect(200)).body.messages.map((x: { text: string }) => x.text)).toEqual(['Checked.']);

    await platformDb.membership.deleteMany({ where: { userId: m.user.id } });
    await admin().post(`/agents/routines/${r.id}/run`).expect(200);
    await settled();
    const run = await platformDb.agentRun.findFirstOrThrow({ where: { agentId: ag.id }, orderBy: { startedAt: 'desc' } });
    expect(run).toMatchObject({ status: 'failed', error: 'Omar Haddad is not a member of aurora any more.' });
  });
});

describe('routines: events', () => {
  it('a week created and a campaign confirmed start the routines that wait for them, on their channels', async () => {
    const cat = await makeCatalog(a);
    const ag = await newAgent('weeks-builder');
    const room = (await admin().post('/agents/rooms', { name: 'weeks' }).expect(201)).body;
    const onWeeks = (await admin().post(`/agents/${ag.id}/routines`, { name: 'New weeks', kind: 'event', event: 'week_created', channelIds: [a.channelId], request: 'Check the new weeks.', roomId: room.id }).expect(201)).body;
    const other = await platformDb.channel.create({ data: { id: uuidv7(), tenantId: a.tenantId, name: 'OTHER TV', code: 'OTHER', frameRate: '25', dayStartFrames: 0, weekStart: 6 } });
    await admin().post(`/agents/${ag.id}/routines`, { name: 'Other weeks', kind: 'event', event: 'week_created', channelIds: [other.id], request: 'x', roomId: room.id }).expect(201);
    await admin().post(`/agents/${ag.id}/routines`, { name: 'Confirmed', kind: 'event', event: 'campaign_confirmed', request: 'Book it into prime time.', roomId: room.id }).expect(201);
    scripts.set('Weeks builder', () => end('Seen.'));

    await admin().post(`/channels/${a.channelId}/weeks`, { kinds: ['main', 'ads'], fromWeek: SAT, toWeek: SAT }).expect(201);
    await settled();
    expect(seen.map((x) => x.prompt.match(/Your routine "([^"]+)"/)?.[1])).toEqual(['New weeks']);
    expect(seen[0].prompt).toContain('Something happened: AURORA TV: 2 weeks created (main and ads playlist), from 2030-06-01.');
    expect(await platformDb.agentRun.findFirstOrThrow({ where: { routineId: onWeeks.id } })).toMatchObject({ trigger: 'routine', roomId: room.id });

    // a campaign: draft, then confirmed
    const empty = { type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null };
    const { id: clientId } = (await admin().post('/commercials/clients', { name: 'Clearwater', ...empty }).expect(201)).body;
    const { id: dealId } = (await admin().post('/commercials/contracts', { clientId, name: 'Clearwater', startDate: '2030-05-25', endDate: '2030-06-30', currency: 'USD', totalAgreed: 0, notes: '', channelIds: [a.channelId] }).expect(201)).body;
    const { ids } = (await admin().post(`/commercials/contracts/${dealId}/orders`, { channelIds: [a.channelId], startDate: '2030-05-25' }).expect(201)).body;
    const o = (await admin().get(`/commercials/orders/${ids[0]}`).expect(200)).body;
    const body = { version: o.version, name: o.name, startDate: o.startDate, endDate: o.endDate, items: [{ id: null, productionId: cat.identItems[0] }] };
    await admin().put(`/commercials/orders/${ids[0]}`, { ...body, status: 'draft' }).expect(200);
    await settled();
    expect(seen).toHaveLength(1);
    const v = (await admin().get(`/commercials/orders/${ids[0]}`).expect(200)).body;
    await admin().put(`/commercials/orders/${ids[0]}`, { ...body, version: v.version, items: v.items.map((i: { id: string; productionId: string }) => ({ id: i.id, productionId: i.productionId })), status: 'confirmed' }).expect(200);
    await settled();
    expect(seen).toHaveLength(2);
    expect(seen[1].prompt).toMatch(/Something happened: Campaign "[^"]+" of Clearwater on AURORA TV is confirmed \(2030-05-25 → /);
  });
});

describe('the agent in a page', () => {
  it('reads the page it is asked from; a change card names the day it changes', async () => {
    const ag = await newAgent('gap-filler');
    scripts.set('Gap filler', [end('ok')]);
    await admin().post(`/agents/${ag.id}/chat`, { text: 'Fill this day', page: { name: 'Playlist › Day', sees: 'AURORA TV · Main playlist · Saturday 2030-06-01 · Draft, version 3' } }).expect(201);
    await settled();
    expect(seen[0].prompt).toContain('They write from the Playlist › Day page of 9eye, which shows: AURORA TV · Main playlist · Saturday 2030-06-01 · Draft, version 3.');

    const run = await platformDb.agentRun.findFirstOrThrow({ where: { agentId: ag.id } });
    await platformDb.agentChange.create({
      data: {
        id: uuidv7(), tenantId: a.tenantId, agentId: ag.id, runId: run.id, tool: 'fill_day', preview: 'AURORA TV · Main playlist · Saturday 2030-06-01 · Draft · version 3 — preview',
        args: { channel: 'aurora', date: '2030-06-01', playlist: 'main', step: 'rotation', mode: 'missing', apply: true, version: 3 },
      },
    });
    const [card] = (await admin().get('/agents/changes').expect(200)).body;
    expect(card.target).toEqual({ kind: 'day', channelId: a.channelId, date: '2030-06-01', playlist: 'main', step: 'rotation', mode: 'missing' });
  });
});

// ---------------------------------------------------------------- phase C1

describe('phase C2: Scheduling (decision 0025, plan tools)', () => {
  it('an agent with Scheduling prepares a plan and its airings; each waits, is applied once approved, and undo puts it back', async () => {
    await admin().put('/admin/ai-access', { on: true, table: { scheduling: { read: 'on', change: 'on', create: 'on', approve: 'ask' }, media: { read: 'on' } }, maxDays: 90 }).expect(200);
    await platformDb.role.update({ where: { id: roleId }, data: { grants: { create: [{ id: uuidv7(), module: 'orders', action: 'edit' }] } } });
    await makeCatalog(a);
    const ag = await newAgent('weeks-builder', 'Planner', { parts: { scheduling: 'edit', media: 'read' } });
    const plan = { channel: 'AURORA', name: 'Harbor', kind: 'series', from: SAT, to: '2030-06-07', items: ['Harbor Nights'], allowed_times: [{ days: ['every day'], from: '06:00', to: '07:00' }] };
    scripts.set('Planner', [call('create_plan', plan), end('The plan waits for you.')]);
    const made = (await chat(ag.id, 'Make a Harbor plan for the week of 1 June')).messages.find((m) => m.change)!.change!;
    expect(seen[0].tools).toEqual(expect.arrayContaining(['list_plans', 'get_plan', 'create_plan', 'place_airings', 'confirm_plan', 'search_media']));
    expect(made).toMatchObject({ status: 'waiting', title: 'Create a plan', canDecide: true });
    expect(await platformDb.order.count()).toBe(0);
    expect((await admin().post(`/agents/changes/${made.id}/approve`).expect(200)).body.status).toBe('approved');
    expect(await platformDb.order.count()).toBe(1);

    scripts.set('Planner', [call('place_airings', { channel: 'AURORA', plan: 'Harbor', how: 'auto' }), end('Placed, when you approve.')]);
    const place = (await chat(ag.id, 'Place it')).messages.reverse().find((m) => m.change)!.change!;
    expect(place.preview).toContain('+ Sat 2030-06-01 06:00 Run Block 1 · first airing · ep 1 "Harbor Nights - 1"');
    expect((await admin().post(`/agents/changes/${place.id}/approve`).expect(200)).body.status).toBe('approved');
    expect(await platformDb.airing.count()).toBe(1);
    expect((await admin().post(`/agents/changes/${place.id}/undo`).expect(200)).body.status).toBe('undone');
    expect(await platformDb.airing.count()).toBe(0);
  });
});

describe('Ads tools (decision 0025)', () => {
  it('an agent with Ads prepares a client, then its deal; each waits and is made once approved', async () => {
    await admin().put('/admin/ai-access', { on: true, table: { ads: { read: 'on', change: 'on', create: 'ask', approve: 'off' } }, maxDays: 90 }).expect(200);
    await platformDb.role.update({ where: { id: roleId }, data: { grants: { create: [{ id: uuidv7(), module: 'orders', action: 'edit' }] } } });
    const ag = await newAgent('weeks-builder', 'Sales', { parts: { ads: 'edit' } });
    const deal = { client: 'Novamart', name: 'NOVAMART JUNE', from: SAT, to: '2030-06-30', currency: 'EUR', channels: ['AURORA'] };
    scripts.set('Sales', [call('create_client', { name: 'Novamart', type: 'advertiser' }), call('create_deal', deal), end('The client waits for you; the deal comes once it is made.')]);
    const first = await chat(ag.id, 'Add Novamart and its June deal');
    expect(seen[0].tools).toEqual(expect.arrayContaining(['list_clients', 'create_client', 'edit_deal', 'create_campaigns', 'book_campaign_spots']));
    expect(seen[0].tools).not.toContain('confirm_campaign');
    // the deal cannot be previewed before its client exists
    expect(seen[0].results[1]).toMatchObject({ isError: true, text: expect.stringContaining('No client "Novamart"') });
    const client = first.messages.find((m) => m.change)!.change!;
    expect(client).toMatchObject({ title: 'Create a client', status: 'waiting' });
    expect((await admin().post(`/agents/changes/${client.id}/approve`).expect(200)).body.status).toBe('approved');

    scripts.set('Sales', [call('create_deal', deal), end('The deal waits for you.')]);
    const card = (await chat(ag.id, 'Now the deal')).messages.reverse().find((m) => m.change)!.change!;
    expect(card).toMatchObject({ title: 'Create a deal', status: 'waiting' });
    expect((await admin().post(`/agents/changes/${card.id}/approve`).expect(200)).body.status).toBe('approved');
    expect((await platformDb.contract.findFirstOrThrow({ include: { client: true } })).client.name).toBe('Novamart');
  });
});

describe('Media tools (decision 0025)', () => {
  it('an agent with Media prepares a title and its episodes; approved they are made, and undo takes the episodes away', async () => {
    await admin().put('/admin/ai-access', { on: true, table: { media: { read: 'on', change: 'on', create: 'ask' } }, maxDays: 90 }).expect(200);
    await platformDb.role.update({ where: { id: roleId }, data: { grants: { create: [{ id: uuidv7(), module: 'catalog', action: 'edit' }] } } });
    await makeCatalog(a);
    await platformDb.source.create({ data: { id: uuidv7(), tenantId: a.tenantId, name: 'SERVER', code: 'SVR' } });
    const ag = await newAgent('weeks-builder', 'Librarian', { parts: { media: 'edit' } });
    scripts.set('Librarian', [call('create_title', { category: 'TV Series Drama', title: 'Dark Water' }), end('The title waits for you.')]);
    const title = (await chat(ag.id, 'Add the series Dark Water')).messages.find((m) => m.change)!.change!;
    expect(seen[0].tools).toEqual(expect.arrayContaining(['search_media', 'get_title', 'create_title', 'create_episodes', 'edit_relations', 'edit_rotation_list']));
    expect(title).toMatchObject({ title: 'Create a title', status: 'waiting' });
    expect((await admin().post(`/agents/changes/${title.id}/approve`).expect(200)).body.status).toBe('approved');

    scripts.set('Librarian', [call('create_episodes', { title: 'Dark Water', count: 10, length: '00:42:00:00' }), end('Ten episodes wait for you.')]);
    const eps = (await chat(ag.id, 'Make its 10 episodes')).messages.reverse().find((m) => m.change)!.change!;
    expect(eps.preview).toContain('"Dark Water" · 10 new episodes 1–10');
    expect((await admin().post(`/agents/changes/${eps.id}/approve`).expect(200)).body.status).toBe('approved');
    const count = () => platformDb.production.count({ where: { content: { title: 'Dark Water' }, deletedAt: null } });
    expect(await count()).toBe(10);
    expect((await admin().post(`/agents/changes/${eps.id}/undo`).expect(200)).body.status).toBe('undone');
    expect(await count()).toBe(0);
  });
});

describe('phase C1: day changes, approving twice, going on after an approval', () => {
  it('a day approved for air: a person approves it twice', async () => {
    // the company lets AI approve days (Settings › AI access, decision 0025): Full
    await admin().put('/admin/ai-access', { on: true, table: { playlist: { read: 'on', change: 'on', create: 'on', approve: 'ask', export: 'off' }, layouts: { read: 'on' } }, maxDays: 90 }).expect(200);
    await admin().post(`/channels/${a.channelId}/weeks`, { kinds: ['main', 'ads'], fromWeek: SAT, toWeek: SAT }).expect(201);
    const ag = await newAgent('weeks-builder');
    scripts.set('Weeks builder', [call('approve_day', { channel: 'AURORA', date: SAT }), end('It is ready for air when you approve it.')]);
    const card = (await chat(ag.id, 'Approve Saturday')).messages.find((m) => m.change)!.change!;
    expect(seen[0].tools).toEqual(expect.arrayContaining(['edit_day', 'approve_day', 'reopen_day', 'get_layout']));
    expect(card).toMatchObject({ status: 'waiting', toAir: true, canDecide: true });
    const once = await admin().post(`/agents/changes/${card.id}/approve`).expect(409);
    expect(once.body.error).toBe('This change puts a day on air: approve it a second time to confirm.');
    expect((await admin().post(`/agents/changes/${card.id}/approve`, { confirm: true }).expect(200)).body.status).toBe('approved');
    expect((await platformDb.dayPlaylist.findFirstOrThrow({ where: { date: new Date(`${SAT}T00:00:00Z`), playlist: { kind: 'main' } } })).published).toBe(true);
    // a person who may change the playlist but not approve it cannot decide such a change
    scripts.set('Weeks builder', [call('reopen_day', { channel: 'AURORA', date: SAT }), end('ok')]);
    const reopen = (await chat(ag.id, 'Reopen it')).messages.reverse().find((m) => m.change)!.change!;
    const editor = await member(['playlist:view', 'playlist:edit'], 'Editor');
    expect((await editor.post(`/agents/changes/${reopen.id}/approve`).expect(403)).body.error).toContain('Your role does not let you approve days of Playlist');
  });

  it('a chained change: once it is applied the agent goes on with what it said follows', async () => {
    const ag = await newAgent('weeks-builder');
    scripts.set('Weeks builder', [
      call('create_weeks', { channel: 'AURORA', from_week: SAT, then: 'Fill Saturday 1 June from the plans.' }),
      end('First the week; then I fill Saturday.'),
    ]);
    const card = (await chat(ag.id, 'Make the week and fill Saturday')).messages.find((m) => m.change)!.change!;
    expect(card.then).toBe('Fill Saturday 1 June from the plans.');
    expect(seen[0].schemas.create_weeks.properties).toHaveProperty('then');
    scripts.set('Weeks builder', [end('The week is there; filling Saturday next.')]);
    await admin().post(`/agents/changes/${card.id}/approve`).expect(200);
    await settled();
    const followUp = await platformDb.agentRun.findFirstOrThrow({ where: { agentId: ag.id, trigger: 'approved' } });
    expect(followUp.chatUserId).not.toBeNull();
    expect(seen[1].prompt).toContain('You said that once it is applied you would: Fill Saturday 1 June from the plans.');
    const { messages } = (await admin().get(`/agents/${ag.id}/chat`).expect(200)).body;
    expect(messages[messages.length - 1].text).toBe('The week is there; filling Saturday next.');
  });

  it('the day page shows what a day change would leave: new and changed rows', async () => {
    await admin().post(`/channels/${a.channelId}/weeks`, { kinds: ['main', 'ads'], fromWeek: SAT, toWeek: SAT }).expect(201);
    const cat = await makeCatalog(a);
    const ag = await newAgent('weeks-builder');
    scripts.set('Weeks builder', [call('edit_day', { channel: 'AURORA', date: SAT, changes: [{ op: 'add', item: cat.brightEps[0], block: 'Run Block 1' }] }), end('ok')]);
    const card = (await chat(ag.id, 'Put Bright Lanes 1 in')).messages.find((m) => m.change)!.change!;
    expect(card).toMatchObject({ title: 'Change rows of a day', target: { kind: 'day', channelId: a.channelId, date: SAT, playlist: 'main', step: 'edit_day' } });
    const day = (await admin().get(`/agents/changes/${card.id}/day`).expect(200)).body;
    const rows = day.blocks.flatMap((b: { events: { id: string; title: string }[] }) => b.events);
    const added = rows.filter((e: { id: string }) => day.changed.includes(e.id));
    expect(added.map((e: { title: string }) => e.title)).toEqual(['Bright Lanes - 1']);
    expect(day).toMatchObject({ removed: 0, problems: [] });
    // nothing was saved
    expect(await platformDb.playlistEvent.count({ where: { title: 'Bright Lanes - 1' } })).toBe(0);
  });
});

