// Runs an agent (decision 0024): its job, skill and memory as the system prompt, the conversation so
// far, and the tools of its parts. It runs in the API, in the background of the request that started
// it; what it says goes into the room or the chat it was asked in. It never changes anything itself:
// a write tool only previews, and a preview that can be applied becomes a change card for a person.
// It can remember, propose a new skill, and hand work to the agents it works with (3 hand-offs at
// most in one chain; the answer comes back to the agent that handed it).

import { Prisma, type Agent, type AgentRun, type Tenant, type User } from '@prisma/client';
import { z } from 'zod';
import { uuidv7 } from '@9eye/core';
import { accessOf } from '../access';
import { platformDb, withTenant } from '../db';
import { HttpError } from '../errors';
import { eventsAtWork } from '../events';
import type { Principal } from '../mcp/auth';
import type { ToolDef } from '../mcp/common';
import { WORDS_TEXT, invokeTool, toolDefs } from '../mcp/tools';
import { TOOL_GRANT } from '../mcp/common';
import { aiOn, cellOf, companyTable } from '../aiPolicy';
import { PARTS, agentAccess, intersect, partsOf, toolNames } from './parts';
import { openSession, providerError, providerKey, type ProviderName, type ToolCall, type ToolSpec } from './providers';

/** Hand-offs in one chain, at most. */
export const MAX_CHAIN = 3;
/** Messages of the room or chat the agent reads before answering. */
const HISTORY = 30;
/** A tool answer longer than this is cut (the model reads the start). */
const MAX_RESULT = 40_000;

export type Trigger = 'chat' | 'room' | 'handoff' | 'report' | 'approved' | 'routine';

export interface RunStart {
  tenantId: string;
  agentId: string;
  trigger: Trigger;
  /** The person the run works for (the one who asked, or approved); null for none. */
  requestedById: string | null;
  roomId?: string | null;
  chatUserId?: string | null;
  threadId?: string | null;
  /** Agents earlier in the chain of hand-offs. */
  chain?: string[];
  /** The routine that starts it (phase B). */
  routineId?: string | null;
  /** What the agent is asked now (the conversation so far comes before it). */
  prompt: string;
}

// ---------------------------------------------------------------- messages

export interface Place {
  tenantId: string;
  roomId: string | null;
  /** An agent's own chat with one person: the agent and the person. */
  agentId: string | null;
  chatUserId: string | null;
  threadId: string | null;
}

export async function postMessage(
  place: Place,
  m: { id?: string; authorKind: 'person' | 'agent'; authorUserId?: string | null; authorAgentId?: string | null; kind?: string; text: string; payload?: object; runId?: string | null },
) {
  return platformDb.agentMessage.create({
    data: {
      id: m.id ?? uuidv7(), tenantId: place.tenantId, roomId: place.roomId, agentId: place.agentId, chatUserId: place.chatUserId, threadId: place.threadId,
      authorKind: m.authorKind, authorUserId: m.authorUserId ?? null, authorAgentId: m.authorAgentId ?? null, kind: m.kind ?? 'text', text: m.text,
      ...(m.payload ? { payload: m.payload as Prisma.InputJsonValue } : {}), runId: m.runId ?? null,
    },
  });
}

const placeOf = (run: AgentRun): Place => ({
  tenantId: run.tenantId, roomId: run.roomId, agentId: run.roomId ? null : run.agentId, chatUserId: run.roomId ? null : run.chatUserId, threadId: run.threadId,
});

// ---------------------------------------------------------------- starting and stopping

const inflight = new Map<string, Promise<void>>();
const stopping = new Set<string>();

/** Tests: wait until no run is going any more (runs can start runs, events can start routines). */
export async function settled(): Promise<void> {
  while (inflight.size || eventsAtWork().length) await Promise.allSettled([...inflight.values(), ...eventsAtWork()]);
}

export function requestStop(runId: string): boolean {
  if (!inflight.has(runId)) return false;
  stopping.add(runId);
  return true;
}

/** At start: runs that were going when the server stopped did not finish. */
export async function recoverRuns(): Promise<void> {
  await platformDb.agentRun.updateMany({ where: { status: 'running' }, data: { status: 'failed', error: 'The server restarted during this run.', endedAt: new Date() } });
}

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export async function tokensThisMonth(agentId: string): Promise<number> {
  const s = await platformDb.agentRun.aggregate({ where: { agentId, startedAt: { gte: monthStart() } }, _sum: { inputTokens: true, outputTokens: true } });
  return (s._sum.inputTokens ?? 0) + (s._sum.outputTokens ?? 0);
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** Checks that the agent can run now (else 409 in words), then runs it in the background. */
export async function startRun(s: RunStart): Promise<string> {
  const agent = await platformDb.agent.findFirst({ where: { id: s.agentId, tenantId: s.tenantId, deletedAt: null } });
  if (!agent) throw new HttpError(404, 'No such agent.');
  if (!agent.enabled) throw new HttpError(409, `${agent.name} is paused: turn it on in its settings.`);
  const tenant = await platformDb.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });
  if (!aiOn(tenant)) throw new HttpError(409, `AI access is off for ${tenant.name}: a company admin can turn it on in Settings › AI access.`);
  await providerKey(s.tenantId, agent.provider as ProviderName);
  if ((await tokensThisMonth(agent.id)) >= agent.monthlyTokens) {
    throw new HttpError(409, `${agent.name} has used its ${fmt(agent.monthlyTokens)} tokens for this month: its limit is in its settings.`);
  }
  const run = await platformDb.agentRun.create({
    data: {
      id: uuidv7(), tenantId: s.tenantId, agentId: agent.id, trigger: s.trigger, requestedById: s.requestedById, roomId: s.roomId ?? null,
      chatUserId: s.roomId ? null : (s.chatUserId ?? null), threadId: s.threadId ?? null, chain: s.chain ?? [], routineId: s.routineId ?? null,
    },
  });
  const going = withTenant(s.tenantId, () => execute(run, agent, tenant, s.prompt))
    .catch((err) => console.error('agent run', run.id, err))
    .finally(() => {
      inflight.delete(run.id);
      stopping.delete(run.id);
    });
  inflight.set(run.id, going);
  return run.id;
}

// ---------------------------------------------------------------- the run

interface Step {
  at: string;
  kind: 'model' | 'tool';
  text?: string;
  stop?: string;
  tool?: string;
  input?: unknown;
  ok?: boolean;
}

const cut = (s: string, max = MAX_RESULT) => (s.length <= max ? s : `${s.slice(0, max)}\n… (cut: ${fmt(s.length - max)} more characters)`);
const firstLine = (s: string) => s.split('\n')[0].slice(0, 300);

/** A tool's JSON Schema as the model sees it; a write tool has no apply or version for an agent. */
function toSpec(def: ToolDef): ToolSpec {
  const schema = z.toJSONSchema(def.input, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  let description = def.description;
  if (def.kind === 'write') {
    const props = { ...((schema.properties ?? {}) as Record<string, unknown>) };
    delete props.apply;
    delete props.version;
    schema.properties = props;
    if (Array.isArray(schema.required)) schema.required = schema.required.filter((r) => r !== 'apply' && r !== 'version');
    description += ' For you it always makes a preview; a preview that can be applied becomes a change card that a person approves or rejects.';
    props.then = {
      type: 'string',
      maxLength: 2000,
      description: 'What you do next once a person approves this and it is applied (e.g. "fill the days of the week it creates"). You go on by yourself then. Leave it out when nothing follows.',
    };
  }
  return { name: def.name, description, schema };
}

const OWN_TOOLS = {
  remember: {
    name: 'remember',
    description: 'Keep one thing the team told you (a preference, a fact about the channels, a way of working) for every later conversation. One sentence.',
    schema: { type: 'object', properties: { text: { type: 'string', maxLength: 1000 } }, required: ['text'] },
  },
  propose_skill_change: {
    name: 'propose_skill_change',
    description: 'When a person asks you to work differently from now on: propose your whole new skill. The person sees a card and saves it to your skill, or uses it only this time.',
    schema: {
      type: 'object',
      properties: { skill: { type: 'string', maxLength: 8000, description: 'The whole new skill: numbered steps.' }, why: { type: 'string', maxLength: 1000, description: 'What changed, in one sentence.' } },
      required: ['skill', 'why'],
    },
  },
  hand_off: {
    name: 'hand_off',
    description: 'Hand work to another agent you work with, in this room. Say everything it needs (channel, day, what is wrong). Its answer comes back to you.',
    schema: {
      type: 'object',
      properties: { agent: { type: 'string', description: 'Its name.' }, task: { type: 'string', maxLength: 4000, description: 'What it should do, with the details.' } },
      required: ['agent', 'task'],
    },
  },
} satisfies Record<string, ToolSpec>;

interface Ctx {
  run: AgentRun;
  agent: Agent;
  tenant: Tenant;
  person: User | null;
  place: Place;
  room: { id: string; name: string } | null;
  principal: Principal;
  defs: Map<string, ToolDef>;
  partners: Agent[];
  canHandOff: boolean;
  steps: Step[];
  inputTokens: number;
  outputTokens: number;
}

async function execute(run: AgentRun, agent: Agent, tenant: Tenant, prompt: string): Promise<void> {
  const person = run.requestedById ? await platformDb.user.findUnique({ where: { id: run.requestedById } }) : null;
  const place = placeOf(run);
  const ctx: Partial<Ctx> & { steps: Step[]; inputTokens: number; outputTokens: number } = { run, agent, tenant, person, place, steps: [], inputTokens: 0, outputTokens: 0 };
  try {
    // Never more than its role, its parts and channels allow — and than the person it works for may do.
    let access = await agentAccess(agent);
    if (person) {
      const theirs = await accessOf(person, tenant.id);
      if (!theirs) throw new HttpError(403, `${person.name} is not a member of ${tenant.name} any more.`);
      access = intersect(access, theirs);
    }
    // What AI may do in the company (decision 0025): its Off cells take the tools away; agents ask first anyway.
    const company = companyTable(tenant);
    const allowed = new Set([...toolNames(partsOf(agent.parts), true)].filter((n) => cellOf(company, n) !== 'off'));
    const canChange = [...allowed].some((n) => n in TOOL_GRANT);
    const principal: Principal = {
      user: { id: person?.id ?? null, name: person?.name ?? agent.name }, tenant, tokenId: null, via: 'agent', agentId: agent.id, access, canWrite: canChange, policy: company,
    };
    const defs = new Map(toolDefs(principal).filter((d) => allowed.has(d.name)).map((d) => [d.name, d]));
    const room = run.roomId ? await platformDb.agentRoom.findFirst({ where: { id: run.roomId, tenantId: tenant.id }, select: { id: true, name: true } }) : null;
    const partners = room && agent.worksWith.length
      ? await platformDb.agent.findMany({ where: { id: { in: agent.worksWith }, tenantId: tenant.id, deletedAt: null, enabled: true }, orderBy: { name: 'asc' } })
      : [];
    const canHandOff = !!room && partners.length > 0 && run.chain.length < MAX_CHAIN;
    Object.assign(ctx, { principal, defs, room, partners, canHandOff });
    const c = ctx as Ctx;

    const tools: ToolSpec[] = [...[...defs.values()].map(toSpec), OWN_TOOLS.remember, OWN_TOOLS.propose_skill_change, ...(canHandOff ? [OWN_TOOLS.hand_off] : [])];
    const session = openSession(
      { provider: agent.provider as ProviderName, model: agent.model, apiKey: await providerKey(tenant.id, agent.provider as ProviderName) },
      { system: await systemPrompt(c, canChange), tools, prompt: `${await historyText(c)}\n\n${prompt}` },
    );
    const usedBefore = await tokensThisMonth(agent.id);

    for (let turn = 0; ; turn++) {
      if (stopping.has(run.id)) return await finish(c, 'stopped', `Stopped by a person after ${turn} ${turn === 1 ? 'step' : 'steps'}.`);
      if (turn >= agent.maxSteps) return await finish(c, 'stopped', `${agent.name} stopped at its limit of ${agent.maxSteps} steps; ask it to go on, or raise the limit in its settings.`);
      if (usedBefore + c.inputTokens + c.outputTokens >= agent.monthlyTokens) return await finish(c, 'stopped', `${agent.name} reached its ${fmt(agent.monthlyTokens)} tokens for this month.`);

      const t = await session.next();
      c.inputTokens += t.inputTokens;
      c.outputTokens += t.outputTokens;
      c.steps.push({ at: new Date().toISOString(), kind: 'model', text: t.text.slice(0, 2000), stop: t.stop });
      await save(c);

      if (t.stop === 'refusal') return await finish(c, 'done', null, `${agent.name}'s model declined this request.`);
      if (t.stop !== 'tools' || !t.calls.length) {
        const text = t.stop === 'limit' ? `${t.text}\n\n(The answer was cut short.)`.trim() : t.text;
        return await finish(c, 'done', null, null, text);
      }
      const results = [];
      for (const call of t.calls) results.push({ id: call.id, ...(await callTool(c, call)) });
      session.answer(results);
    }
  } catch (e) {
    const message = e instanceof HttpError ? e.message : providerError(e);
    await finish(ctx as Ctx, 'failed', message).catch((err) => console.error('agent run finish', err));
  }
}

async function save(c: Pick<Ctx, 'run' | 'steps' | 'inputTokens' | 'outputTokens'>) {
  await platformDb.agentRun.update({ where: { id: c.run.id }, data: { steps: c.steps as unknown as Prisma.InputJsonValue, inputTokens: c.inputTokens, outputTokens: c.outputTokens } });
}

/**
 * Ends the run: its answer (or why it stopped) goes to the room or chat. An agent that was handed
 * work (or whose change was approved) reports back to the agent that handed it.
 */
async function finish(c: Ctx, status: 'done' | 'stopped' | 'failed', problem: string | null, declined: string | null = null, answer = '') {
  await platformDb.agentRun.update({
    where: { id: c.run.id },
    data: { status, error: problem ?? declined, endedAt: new Date(), steps: c.steps as unknown as Prisma.InputJsonValue, inputTokens: c.inputTokens, outputTokens: c.outputTokens },
  });
  const from = { authorKind: 'agent' as const, authorAgentId: c.agent.id, runId: c.run.id };
  if (problem || declined) await postMessage(c.place, { ...from, kind: 'error', text: (problem ?? declined)! });
  if (answer.trim()) await postMessage(c.place, { ...from, text: answer.trim() });

  const reports = (c.run.trigger === 'handoff' || c.run.trigger === 'approved') && c.run.chain.length > 0 && !!c.run.roomId;
  if (!reports) return;
  const to = c.run.chain[c.run.chain.length - 1];
  const chain = [...c.run.chain, c.agent.id];
  const said = answer.trim() || problem || declined || '(no answer)';
  if (chain.length > MAX_CHAIN) {
    await postMessage(c.place, { ...from, kind: 'error', text: 'This chain of hand-offs is as long as it may be: nothing more goes back automatically.' });
    return;
  }
  await startRun({
    tenantId: c.tenant.id, agentId: to, trigger: 'report', requestedById: c.run.requestedById, roomId: c.run.roomId, threadId: c.run.threadId, chain,
    prompt: `${c.agent.name} reports back on the work you handed over:\n${said}\n\nCarry on with your job from here: tell the room the outcome in a sentence or two.`,
  }).catch(async (e) => {
    await postMessage(c.place, { ...from, kind: 'error', text: `The answer could not go back: ${e instanceof HttpError ? e.message : providerError(e)}` });
  });
}

// ---------------------------------------------------------------- tool calls

async function callTool(c: Ctx, call: ToolCall): Promise<{ text: string; isError: boolean }> {
  const step: Step = { at: new Date().toISOString(), kind: 'tool', tool: call.name, input: call.input, ok: true };
  c.steps.push(step);
  const out = await toolAnswer(c, call).catch((e) => ({ text: e instanceof HttpError ? e.message : 'Something went wrong on the server.', isError: true }));
  step.ok = !out.isError;
  step.text = out.text.slice(0, 500);
  return out;
}

const fail = (text: string) => ({ text, isError: true });
const ok = (text: string) => ({ text, isError: false });

async function toolAnswer(c: Ctx, call: ToolCall): Promise<{ text: string; isError: boolean }> {
  const from = { authorKind: 'agent' as const, authorAgentId: c.agent.id, runId: c.run.id };

  if (call.name === 'remember') {
    const a = z.object({ text: z.string().trim().min(1).max(1000) }).safeParse(call.input);
    if (!a.success) return fail(`The arguments do not fit: ${z.prettifyError(a.error)}`);
    const where = c.room ? ` in #${c.room.name}` : ' in the chat';
    await platformDb.agentMemory.create({ data: { id: uuidv7(), agentId: c.agent.id, text: a.data.text, source: c.person ? `${c.person.name}${where}` : `a hand-off${where}` } });
    await postMessage(c.place, { ...from, kind: 'memory', text: a.data.text });
    return ok('Remembered: it is in your memory from the next conversation on.');
  }

  if (call.name === 'propose_skill_change') {
    const a = z.object({ skill: z.string().trim().min(1).max(8000), why: z.string().trim().max(1000).default('') }).safeParse(call.input);
    if (!a.success) return fail(`The arguments do not fit: ${z.prettifyError(a.error)}`);
    await postMessage(c.place, { ...from, kind: 'skill', text: a.data.why || 'A new way of working.', payload: { skill: a.data.skill, before: c.agent.skill, status: 'waiting' } });
    return ok('The person sees a card: they save it to your skill, or use it only this time. Until it is saved, follow it in this conversation only.');
  }

  if (call.name === 'hand_off') {
    if (!c.canHandOff) return fail('You cannot hand work to another agent here.');
    const a = z.object({ agent: z.string().trim().min(1).max(200), task: z.string().trim().min(1).max(4000) }).safeParse(call.input);
    if (!a.success) return fail(`The arguments do not fit: ${z.prettifyError(a.error)}`);
    const name = a.data.agent.replace(/^@/, '').toLowerCase();
    const target = c.partners.find((p) => p.id === a.data.agent || p.name.toLowerCase() === name);
    if (!target || target.id === c.agent.id) return fail(`You can hand work only to: ${c.partners.map((p) => p.name).join(', ')}.`);
    // Never back to an agent earlier in this chain: its answer comes back to it by itself (no loops).
    if (c.run.chain.includes(target.id)) return fail(`${target.name} is earlier in this chain of hand-offs: your answer goes back to it by itself. Finish the work, or tell the person what is left.`);
    const msg = await postMessage(c.place, { ...from, text: `@${target.name} ${a.data.task}`, payload: { handoff: target.id } });
    try {
      await startRun({
        tenantId: c.tenant.id, agentId: target.id, trigger: 'handoff', requestedById: c.run.requestedById, roomId: c.run.roomId, threadId: c.run.threadId ?? msg.id,
        chain: [...c.run.chain, c.agent.id], prompt: `${c.agent.name} handed this to you:\n${a.data.task}`,
      });
    } catch (e) {
      const why = e instanceof HttpError ? e.message : providerError(e);
      await postMessage(c.place, { ...from, kind: 'error', text: `${target.name} cannot take it: ${why}` });
      return fail(`${target.name} cannot take it: ${why}`);
    }
    return ok(`Handed to ${target.name}. Its answer comes back to you as a new message; you do not need to wait for it now.`);
  }

  const def = c.defs.get(call.name);
  if (!def) return fail(`There is no tool "${call.name}" for you.`);
  const parsed = def.input.safeParse(call.input ?? {});
  if (!parsed.success) return fail(`The arguments do not fit: ${z.prettifyError(parsed.error)}`);
  if (def.kind === 'read') {
    const r = await invokeTool(c.principal, def, parsed.data);
    return { text: cut(r.text), isError: r.isError };
  }

  // A write tool: only ever a preview; one that can be applied becomes a change card.
  const args: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>), apply: false };
  delete args.version;
  const raw = (call.input ?? {}) as Record<string, unknown>;
  const then = typeof raw.then === 'string' && raw.then.trim() ? raw.then.trim().slice(0, 2000) : null;
  const r = await invokeTool(c.principal, def, args);
  if (r.isError || !r.applyWith) return { text: cut(r.text), isError: r.isError };
  const applyArgs = { ...args, ...r.applyWith };
  const same = await platformDb.agentChange.findFirst({
    where: { tenantId: c.tenant.id, agentId: c.agent.id, tool: def.name, status: 'waiting', args: { equals: applyArgs as Prisma.InputJsonValue } },
  });
  if (same) return ok(`${cut(r.text)}\n\nThis same change is already waiting for a person: do not prepare it again.`);
  const changeId = uuidv7();
  const messageId = uuidv7();
  await platformDb.agentChange.create({
    data: { id: changeId, tenantId: c.tenant.id, agentId: c.agent.id, runId: c.run.id, messageId, tool: def.name, args: applyArgs as Prisma.InputJsonValue, preview: r.text, then },
  });
  await postMessage(c.place, { ...from, id: messageId, kind: 'change', text: `${def.title}: ${firstLine(r.text)}`, payload: { changeId } });
  return ok(
    `${cut(r.text)}\n\nThis preview is now a change card waiting for a person. You cannot apply it yourself, and it is not done until a person approves it.${then ? ' Once it is applied you go on by yourself with what you said follows.' : ''}`,
  );
}

// ---------------------------------------------------------------- what the agent reads

async function systemPrompt(c: Ctx, canChange: boolean): Promise<string> {
  const parts = partsOf(c.agent.parts);
  const works = PARTS.filter((p) => parts[p.key]).map((p) => `${p.label} (${parts[p.key] === 'edit' && canChange ? 'reads and prepares changes' : 'reads'})`);
  const channels = c.agent.channelIds.length
    ? (await platformDb.channel.findMany({ where: { id: { in: c.agent.channelIds }, tenantId: c.tenant.id }, select: { name: true } })).map((x) => x.name)
    : [];
  const memory = await platformDb.agentMemory.findMany({ where: { agentId: c.agent.id }, orderBy: { createdAt: 'asc' }, take: 60 });
  const handedBy = c.run.trigger === 'handoff' && c.run.chain.length
    ? (await platformDb.agent.findUnique({ where: { id: c.run.chain[c.run.chain.length - 1] }, select: { name: true } }))?.name
    : null;
  return [
    `You are "${c.agent.name}", an agent on the team of ${c.tenant.name} in 9eye, a broadcast scheduling and traffic system. You work with the people of the company and with other agents.`,
    '',
    `Your job: ${c.agent.job.trim() || '(not written yet: ask the person what you should do)'}`,
    '',
    'How you do it (your skill: follow it):',
    c.agent.skill.trim() || '(empty)',
    ...(memory.length ? ['', 'What the team asked you to remember:', ...memory.map((m) => `- ${m.text}`)] : []),
    '',
    `What you work on: ${works.length ? works.join(', ') : 'nothing yet, only the list of channels'}.${channels.length ? ` Channels: ${channels.join(', ')}.` : ''}`,
    '',
    'Rules:',
    canChange
      ? '- Every change waits for a person. A write tool only makes a preview for you; a preview that can be applied becomes a change card that a person approves or rejects. Never say a change is done before a person approved it.'
      : '- You cannot prepare changes now (Settings › AI access allows AI only to read here, or your parts are read only): say what a person should change.',
    '- Look things up with the tools; never guess times, lengths or names.',
    '- When a person tells you something to keep (a preference, a fact about the channels), call remember with it in one sentence.',
    '- When a person asks you to work differently from now on, call propose_skill_change with your whole new skill.',
    ...(c.canHandOff ? [`- You can hand work to: ${c.partners.map((p) => `${p.name} (${p.job || 'no job written'})`).join('; ')}. Use hand_off; its answer comes back to you.`] : []),
    ...(handedBy ? [`- ${handedBy} handed you this work; your answer goes back to them.`] : []),
    ...(c.run.trigger === 'routine'
      ? [`- This is one of your routines${c.person ? `, made by ${c.person.name}` : ''}: nobody is waiting for you live. Say briefly what you found and what waits for a person; when all is fine, one line.`]
      : []),
    '- Answer briefly and plainly, in the language the person writes in. Clock times as HH:MM:SS, lengths as timecode.',
    '- Write plain text: short sentences, lists with "-" or "1.", @Name for an agent. No Markdown headings, tables or bold: the page shows your text as it is.',
    `- Today is ${new Date().toISOString().slice(0, 10)} (UTC).`,
    '',
    WORDS_TEXT,
  ].join('\n');
}

/** The room or chat so far, oldest first, as plain lines. */
async function historyText(c: Ctx): Promise<string> {
  const where = c.run.roomId
    ? { tenantId: c.tenant.id, roomId: c.run.roomId }
    : { tenantId: c.tenant.id, roomId: null, agentId: c.agent.id, chatUserId: c.run.chatUserId };
  const rows = (await platformDb.agentMessage.findMany({ where, orderBy: { createdAt: 'desc' }, take: HISTORY })).reverse();
  if (!rows.length) return '';
  const userIds = [...new Set(rows.flatMap((m) => (m.authorUserId ? [m.authorUserId] : [])))];
  const agentIds = [...new Set(rows.flatMap((m) => (m.authorAgentId ? [m.authorAgentId] : [])))];
  const users = new Map((await platformDb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const agents = new Map((await platformDb.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const lines = rows.map((m) => {
    const who = m.authorKind === 'person' ? (users.get(m.authorUserId ?? '') ?? 'A person') : (agents.get(m.authorAgentId ?? '') ?? 'An agent');
    if (m.kind === 'skill') {
      const p = (m.payload ?? {}) as { skill?: string; status?: string };
      const state = { waiting: 'not decided yet', saved: 'saved to the skill', once: 'use it only in this conversation', dismissed: 'dismissed' }[p.status ?? ''] ?? p.status;
      return `[${who} · skill change proposed: ${state}] ${m.text}\n${p.skill ?? ''}`;
    }
    const tag = { change: ' · change card', memory: ' · remembered', error: ' · problem' }[m.kind] ?? '';
    return `[${who}${tag}] ${m.text}`;
  });
  return `${c.room ? `The room #${c.room.name}` : 'Your chat'} so far, oldest first:\n${lines.join('\n')}`;
}
