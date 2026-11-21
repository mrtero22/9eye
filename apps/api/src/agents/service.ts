// What the Agents page reads and changes (decision 0024, docs/design/agents-page.md): the company's
// provider keys, its agents (gallery, settings, skill history, memory), each person's chat with an
// agent, rooms, and the change cards people approve, reject or undo.

import type { Agent, AgentChange, AgentMessage, AgentRoom, AgentRoutine, AgentRun, Prisma, Tenant, User } from '@prisma/client';
import { uuidv7 } from '@9eye/core';
import { can, type Access } from '../access';
import { db } from '../db';
import { HttpError } from '../errors';
import type { Principal } from '../mcp/auth';
import { aiOn, canChange as canChangeTable, cellOf, companyTable, narrower, tokenTable } from '../aiPolicy';
import { accessOf } from '../access';
import { TOOL_GRANT, TO_AIR } from '../mcp/common';
import { dayEditPreview, fillDayPreview } from '../mcp/changes';
import { invokeTool, toolDefs } from '../mcp/tools';
import { encryptSecret } from '../secrets';
import { EMPTY_TEMPLATE, PARTS, TEMPLATES, WRITE_TITLE, agentAccess, intersect, partOfTool, partsOf, type Parts } from './parts';
import { CLAUDE_MODELS, DEFAULT_MODEL, PROVIDERS, PROVIDER_LABEL, type ProviderName } from './providers';
import { EVENT_LABEL, ROUTINE_EVENTS, fireRoutine, nextTime, validTimeZone, type RoutineEvent } from './routines';
import { postMessage, requestStop, startRun, type Place } from './runner';

export const COLORS = ['m1', 'm2', 'm3', 'm4', 'm5'] as const;
const canManage = (a: Access) => can(a, 'admin', 'edit');
const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const iso = (d: Date | null) => d?.toISOString() ?? null;

// ---------------------------------------------------------------- provider keys

export interface ProviderDto {
  provider: ProviderName;
  label: string;
  set: boolean;
  last4: string | null;
  updatedAt: string | null;
}

export async function listProviders(): Promise<ProviderDto[]> {
  const rows = await db.aiProvider.findMany();
  return PROVIDERS.map((provider) => {
    const r = rows.find((x) => x.provider === provider);
    return { provider, label: PROVIDER_LABEL[provider], set: !!r, last4: r?.last4 ?? null, updatedAt: iso(r?.updatedAt ?? null) };
  });
}

/** The key is encrypted at rest and never sent back; only its last 4 characters are shown. */
export async function saveProviderKey(provider: ProviderName, apiKey: string): Promise<ProviderDto[]> {
  const key = apiKey.trim();
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) throw new HttpError(422, 'This does not look like an API key: paste it whole, without spaces.');
  const data = { secret: encryptSecret(key), last4: key.slice(-4) };
  const found = await db.aiProvider.findFirst({ where: { provider } });
  if (found) await db.aiProvider.update({ where: { id: found.id }, data });
  else await db.aiProvider.create({ data: { id: uuidv7(), provider, ...data } as Prisma.AiProviderUncheckedCreateInput });
  return listProviders();
}

export async function deleteProviderKey(provider: ProviderName): Promise<ProviderDto[]> {
  await db.aiProvider.deleteMany({ where: { provider } });
  return listProviders();
}

// ---------------------------------------------------------------- agents

export interface AgentBrief {
  id: string;
  name: string;
  mark: string;
  color: string;
}

export interface AgentDto extends AgentBrief {
  job: string;
  provider: ProviderName;
  model: string;
  role: { id: string; name: string };
  parts: Parts;
  channelIds: string[];
  skill: string;
  worksWith: string[];
  enabled: boolean;
  maxSteps: number;
  monthlyTokens: number;
  /** Tokens its runs used this month. */
  usedTokens: number;
  /** Its change cards waiting for a person. */
  waiting: number;
  running: boolean;
  /** The next time one of its routines starts it. */
  nextRoutineAt: string | null;
  version: number;
  createdAt: string;
  deleted: boolean;
}

export interface AgentDetailDto extends AgentDto {
  memory: { id: string; text: string; source: string; createdAt: string }[];
  skills: { id: string; skill: string; via: string; changedBy: string | null; createdAt: string }[];
}

const brief = (a: Pick<Agent, 'id' | 'name' | 'mark' | 'color'>): AgentBrief => ({ id: a.id, name: a.name, mark: a.mark, color: a.color });

async function agentDtos(rows: (Agent & { role: { id: string; name: string } })[]): Promise<AgentDto[]> {
  const ids = rows.map((a) => a.id);
  const [waiting, running, used, routines] = await Promise.all([
    db.agentChange.groupBy({ by: ['agentId'], where: { agentId: { in: ids }, status: 'waiting' }, _count: { _all: true } }),
    db.agentRun.groupBy({ by: ['agentId'], where: { agentId: { in: ids }, status: 'running' }, _count: { _all: true } }),
    db.agentRun.groupBy({ by: ['agentId'], where: { agentId: { in: ids }, startedAt: { gte: monthStart() } }, _sum: { inputTokens: true, outputTokens: true } }),
    db.agentRoutine.groupBy({ by: ['agentId'], where: { agentId: { in: ids }, enabled: true, kind: 'time' }, _min: { nextRunAt: true } }),
  ]);
  return rows.map((a) => {
    const u = used.find((x) => x.agentId === a.id)?._sum;
    return {
      ...brief(a), job: a.job, provider: a.provider as ProviderName, model: a.model, role: { id: a.role.id, name: a.role.name }, parts: partsOf(a.parts),
      channelIds: a.channelIds, skill: a.skill, worksWith: a.worksWith, enabled: a.enabled, maxSteps: a.maxSteps, monthlyTokens: a.monthlyTokens,
      usedTokens: (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0), waiting: waiting.find((x) => x.agentId === a.id)?._count._all ?? 0,
      running: !!running.find((x) => x.agentId === a.id), nextRoutineAt: iso(routines.find((x) => x.agentId === a.id)?._min.nextRunAt ?? null),
      version: a.version, createdAt: a.createdAt.toISOString(), deleted: !!a.deletedAt,
    };
  });
}

export interface OverviewDto {
  agents: AgentDto[];
  rooms: { id: string; name: string; description: string }[];
  waiting: number;
  providers: ProviderDto[];
  roles: { id: string; name: string }[];
  templates: typeof TEMPLATES;
  parts: { key: string; label: string; canChange: boolean }[];
  claudeModels: typeof CLAUDE_MODELS;
  defaultModel: typeof DEFAULT_MODEL;
  canManage: boolean;
  aiAccess: string;
}

export async function overview(tenant: Tenant, access: Access): Promise<OverviewDto> {
  const [agents, rooms, waiting, providers, roles] = await Promise.all([
    db.agent.findMany({ where: { deletedAt: null }, include: { role: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } }),
    db.agentRoom.findMany({ orderBy: { name: 'asc' } }),
    db.agentChange.count({ where: { status: 'waiting' } }),
    listProviders(),
    db.role.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return {
    agents: await agentDtos(agents), rooms: rooms.map((r) => ({ id: r.id, name: r.name, description: r.description })), waiting, providers, roles,
    templates: TEMPLATES, parts: PARTS.map((p) => ({ key: p.key, label: p.label, canChange: p.edit.length > 0 })), claudeModels: CLAUDE_MODELS,
    defaultModel: DEFAULT_MODEL, canManage: canManage(access),
    // off · read (the table lets AI change nothing) · edit
    aiAccess: !aiOn(tenant) ? 'off' : canChangeTable(companyTable(tenant)) ? 'edit' : 'read',
  };
}

async function findAgent(id: string, withDeleted = false) {
  const a = await db.agent.findFirst({ where: { id, ...(withDeleted ? {} : { deletedAt: null }) }, include: { role: { select: { id: true, name: true } } } });
  if (!a) throw new HttpError(404, 'No such agent.');
  return a;
}

export async function getAgent(id: string): Promise<AgentDetailDto> {
  const a = await findAgent(id);
  const [dto] = await agentDtos([a]);
  const [memory, skills] = await Promise.all([
    db.agentMemory.findMany({ where: { agentId: id }, orderBy: { createdAt: 'desc' } }),
    db.agentSkillVersion.findMany({ where: { agentId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  const people = await names(skills.flatMap((s) => (s.changedById ? [s.changedById] : [])));
  return {
    ...dto,
    memory: memory.map((m) => ({ id: m.id, text: m.text, source: m.source, createdAt: m.createdAt.toISOString() })),
    skills: skills.map((s) => ({ id: s.id, skill: s.skill, via: s.via, changedBy: s.changedById ? (people.get(s.changedById) ?? null) : null, createdAt: s.createdAt.toISOString() })),
  };
}

async function names(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  return new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}

const initials = (name: string) =>
  (name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || 'AG').toUpperCase().padEnd(2, name.trim()[1]?.toUpperCase() ?? 'G');

async function checkName(name: string, except?: string) {
  const same = await db.agent.findFirst({ where: { deletedAt: null, name: { equals: name, mode: 'insensitive' }, ...(except ? { id: { not: except } } : {}) } });
  if (same) throw new HttpError(409, `There is an agent called "${same.name}" already: people @mention agents by name, so each needs its own.`);
}

async function checkRole(roleId: string) {
  if (!(await db.role.findFirst({ where: { id: roleId } }))) throw new HttpError(422, 'Pick a role of this company for the agent to act with.');
}

export interface NewAgentInput {
  template: string;
  name?: string;
  roleId: string;
  provider?: ProviderName;
  model?: string;
}

export async function createAgent(user: User, input: NewAgentInput): Promise<AgentDetailDto> {
  const t = input.template === 'empty' ? EMPTY_TEMPLATE : TEMPLATES.find((x) => x.key === input.template);
  if (!t) throw new HttpError(422, `No agent "${input.template}" in the gallery.`);
  const name = (input.name ?? t.name).trim();
  if (!name || name.length > 60) throw new HttpError(422, 'A name of 1 to 60 characters.');
  await checkName(name);
  await checkRole(input.roleId);
  const provider = input.provider ?? DEFAULT_MODEL.provider;
  const model = (input.model ?? (provider === 'anthropic' ? DEFAULT_MODEL.model : '')).trim();
  if (!model) throw new HttpError(422, `Name the ${PROVIDER_LABEL[provider]} model the agent uses.`);
  const id = uuidv7();
  await db.agent.create({
    data: {
      id, name, mark: input.name && input.name !== t.name ? initials(name) : t.mark, color: t.color, job: t.job, provider, model, roleId: input.roleId,
      parts: t.parts as Prisma.InputJsonValue, skill: t.skill, createdById: user.id,
    } as Prisma.AgentUncheckedCreateInput,
  });
  if (t.skill) await db.agentSkillVersion.create({ data: { id: uuidv7(), agentId: id, skill: t.skill, changedById: user.id, via: 'settings' } });
  return getAgent(id);
}

export interface AgentInput {
  version: number;
  name: string;
  mark: string;
  color: string;
  job: string;
  provider: ProviderName;
  model: string;
  roleId: string;
  parts: Parts;
  channelIds: string[];
  skill: string;
  worksWith: string[];
  enabled: boolean;
  maxSteps: number;
  monthlyTokens: number;
}

export async function updateAgent(user: User, id: string, input: AgentInput): Promise<AgentDetailDto> {
  const a = await findAgent(id);
  if (a.version !== input.version) throw new HttpError(409, 'Someone changed this agent since you opened it: open it again.');
  const name = input.name.trim();
  await checkName(name, id);
  await checkRole(input.roleId);
  const channels = await db.channel.count({ where: { id: { in: input.channelIds }, deletedAt: null } });
  if (channels !== new Set(input.channelIds).size) throw new HttpError(422, 'Some of the channels are not channels of this company.');
  const others = await db.agent.findMany({ where: { id: { in: input.worksWith }, deletedAt: null }, select: { id: true } });
  if (input.worksWith.includes(id) || others.length !== new Set(input.worksWith).size) throw new HttpError(422, 'An agent works with other agents of this company, not with itself.');
  const skill = input.skill.trim();
  const updated = await db.agent.updateMany({
    where: { id, version: input.version },
    data: {
      name, mark: input.mark.trim().slice(0, 2).toUpperCase() || initials(name), color: input.color, job: input.job.trim(), provider: input.provider, model: input.model.trim(),
      roleId: input.roleId, parts: input.parts as Prisma.InputJsonValue, channelIds: [...new Set(input.channelIds)], skill, worksWith: [...new Set(input.worksWith)],
      enabled: input.enabled, maxSteps: input.maxSteps, monthlyTokens: input.monthlyTokens, version: { increment: 1 },
    },
  });
  if (!updated.count) throw new HttpError(409, 'Someone changed this agent since you opened it: open it again.');
  if (skill !== a.skill) await db.agentSkillVersion.create({ data: { id: uuidv7(), agentId: id, skill, changedById: user.id, via: 'settings' } });
  return getAgent(id);
}

/** An agent is put away (its work done stays); its waiting changes are rejected. */
export async function deleteAgent(user: User, id: string): Promise<void> {
  await findAgent(id);
  await db.agent.updateMany({ where: { id }, data: { deletedAt: new Date(), enabled: false } });
  await db.agentChange.updateMany({ where: { agentId: id, status: 'waiting' }, data: { status: 'rejected', decidedById: user.id, decidedAt: new Date(), result: 'The agent was deleted.' } });
}

export async function forget(agentId: string, memoryId: string): Promise<void> {
  await findAgent(agentId);
  const r = await db.agentMemory.deleteMany({ where: { id: memoryId, agentId } });
  if (!r.count) throw new HttpError(404, 'No such memory.');
}

// ---------------------------------------------------------------- messages

export interface ChangeDto {
  id: string;
  agent: AgentBrief;
  tool: string;
  title: string;
  preview: string;
  /** waiting · applying · approved · rejected · failed · undone */
  status: string;
  result: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  room: { id: string; name: string } | null;
  /** What it changes, for the page that shows it (the agent panel previews a day on its grid). */
  target: ChangeTarget | null;
  /** What the agent does next once it is applied (a chained change). */
  then: string | null;
  /** It puts a day on air: a person approves it twice. */
  toAir: boolean;
  /** An agent prepared it, or an AI app asked first (decision 0025): its token and whose it is. */
  from: { kind: 'agent' } | { kind: 'app'; token: string; person: string };
  canDecide: boolean;
  canUndo: boolean;
}

export type ChangeTarget =
  | { kind: 'day'; channelId: string; date: string | null; playlist: 'main' | 'ads'; step: string; mode: string }
  | { kind: 'weeks'; channelId: string; from: string; to: string }
  | { kind: 'campaign'; campaignId: string; from: string | null; to: string | null };

function targetOf(c: AgentChange, channels: { id: string; name: string; code: string }[]): ChangeTarget | null {
  const a = (c.args ?? {}) as Record<string, unknown>;
  const ref = String(a.channel ?? '').trim().toLowerCase();
  const ch = ref ? channels.find((x) => x.id === ref || x.code.toLowerCase() === ref || x.name.toLowerCase() === ref) : undefined;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  if (['fill_day', 'edit_day', 'approve_day', 'reopen_day'].includes(c.tool) && ch) {
    const step = c.tool === 'fill_day' ? String(a.step ?? '') : c.tool;
    return { kind: 'day', channelId: ch.id, date: str(a.date), playlist: a.playlist === 'ads' ? 'ads' : 'main', step, mode: String(a.mode ?? 'missing') };
  }
  if (c.tool === 'create_weeks' && ch) return { kind: 'weeks', channelId: ch.id, from: String(a.from_week), to: String(a.to_week ?? a.from_week) };
  if (c.tool === 'book_campaign_spots') return { kind: 'campaign', campaignId: String(a.campaign), from: str(a.from), to: str(a.to) };
  return null;
}

export interface MessageDto {
  id: string;
  roomId: string | null;
  threadId: string | null;
  author: { kind: 'person'; id: string | null; name: string } | ({ kind: 'agent' } & AgentBrief);
  kind: string;
  text: string;
  /** A skill card: the proposed skill, the one before, and what the person chose. */
  skill: { skill: string; before: string; status: string; decidedBy: string | null } | null;
  change: ChangeDto | null;
  /** The routine whose run wrote it. */
  routine: string | null;
  createdAt: string;
}

export interface RunBrief {
  id: string;
  agent: AgentBrief;
  trigger: string;
  startedAt: string;
}

const mayDecide = (access: Access, tool: string) => {
  const g = TOOL_GRANT[tool];
  return !!g && can(access, g[0], g[1]);
};

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'AI';

async function changeDtos(rows: (AgentChange & { agent: Agent | null })[], access: Access): Promise<ChangeDto[]> {
  const people = await names(rows.flatMap((c) => [...(c.decidedById ? [c.decidedById] : []), ...(c.userId ? [c.userId] : [])]));
  const tokenIds = [...new Set(rows.flatMap((c) => (c.tokenId ? [c.tokenId] : [])))];
  const tokens = new Map(tokenIds.length ? (await db.accessToken.findMany({ where: { id: { in: tokenIds } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]) : []);
  const runs = await db.agentRun.findMany({ where: { id: { in: rows.flatMap((c) => (c.runId ? [c.runId] : [])) } }, select: { id: true, roomId: true } });
  const roomIds = [...new Set(runs.flatMap((r) => (r.roomId ? [r.roomId] : [])))];
  const rooms = new Map((await db.agentRoom.findMany({ where: { id: { in: roomIds } } })).map((r) => [r.id, r]));
  const channels = rows.length ? await db.channel.findMany({ where: { deletedAt: null }, select: { id: true, name: true, code: true } }) : [];
  return rows.map((c) => {
    const roomId = runs.find((r) => r.id === c.runId)?.roomId;
    const room = roomId ? rooms.get(roomId) : undefined;
    return {
      id: c.id, tool: c.tool, title: WRITE_TITLE[c.tool] ?? c.tool, preview: c.preview, status: c.status, result: c.result,
      ...(c.agent
        ? { agent: brief(c.agent), from: { kind: 'agent' as const } }
        : (() => {
            const person = people.get(c.userId ?? '') ?? 'Someone';
            return { agent: { id: c.tokenId ?? c.id, name: person, mark: initialsOf(person), color: 'm2' }, from: { kind: 'app' as const, token: tokens.get(c.tokenId ?? '') ?? 'an AI app', person } };
          })()),
      decidedBy: c.decidedById ? (people.get(c.decidedById) ?? null) : null, decidedAt: iso(c.decidedAt), createdAt: c.createdAt.toISOString(),
      room: room ? { id: room.id, name: room.name } : null, target: targetOf(c, channels), then: c.then, toAir: TO_AIR.has(c.tool),
      canDecide: c.status === 'waiting' && mayDecide(access, c.tool),
      canUndo: c.status === 'approved' && !!c.changeId && mayDecide(access, c.tool),
    };
  });
}

async function messageDtos(rows: AgentMessage[], access: Access): Promise<MessageDto[]> {
  const changeIds = rows.flatMap((m) => (m.kind === 'change' ? [String((m.payload as { changeId?: string } | null)?.changeId ?? '')] : [])).filter(Boolean);
  const changes = new Map((await changeDtos(await db.agentChange.findMany({ where: { id: { in: changeIds } }, include: { agent: true } }), access)).map((c) => [c.id, c]));
  const agentIds = [...new Set(rows.flatMap((m) => (m.authorAgentId ? [m.authorAgentId] : [])))];
  const agents = new Map((await db.agent.findMany({ where: { id: { in: agentIds } } })).map((a) => [a.id, a]));
  const skillDeciders = rows.flatMap((m) => (m.kind === 'skill' ? [String((m.payload as { decidedById?: string } | null)?.decidedById ?? '')] : [])).filter(Boolean);
  const people = await names([...rows.flatMap((m) => (m.authorUserId ? [m.authorUserId] : [])), ...skillDeciders]);
  const runIds = [...new Set(rows.flatMap((m) => (m.runId ? [m.runId] : [])))];
  const routineRuns = runIds.length ? await db.agentRun.findMany({ where: { id: { in: runIds }, routineId: { not: null } }, select: { id: true, routineId: true } }) : [];
  const routineNames = new Map(
    (await db.agentRoutine.findMany({ where: { id: { in: routineRuns.map((r) => r.routineId!) } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]),
  );
  const routineOf = new Map(routineRuns.map((r) => [r.id, routineNames.get(r.routineId!) ?? null]));
  return rows.map((m) => {
    const a = m.authorAgentId ? agents.get(m.authorAgentId) : undefined;
    const p = (m.payload ?? {}) as { changeId?: string; skill?: string; before?: string; status?: string; decidedById?: string };
    return {
      id: m.id, roomId: m.roomId, threadId: m.threadId,
      author: m.authorKind === 'agent' && a ? { kind: 'agent', ...brief(a) } : { kind: 'person', id: m.authorUserId, name: people.get(m.authorUserId ?? '') ?? 'Someone' },
      kind: m.kind, text: m.text,
      skill: m.kind === 'skill' ? { skill: p.skill ?? '', before: p.before ?? '', status: p.status ?? 'waiting', decidedBy: p.decidedById ? (people.get(p.decidedById) ?? null) : null } : null,
      change: m.kind === 'change' && p.changeId ? (changes.get(p.changeId) ?? null) : null,
      routine: m.runId ? (routineOf.get(m.runId) ?? null) : null,
      createdAt: m.createdAt.toISOString(),
    };
  });
}

async function running(where: Prisma.AgentRunWhereInput): Promise<RunBrief[]> {
  const rows = await db.agentRun.findMany({ where: { ...where, status: 'running' }, include: { agent: true }, orderBy: { startedAt: 'asc' } });
  return rows.map((r) => ({ id: r.id, agent: brief(r.agent), trigger: r.trigger, startedAt: r.startedAt.toISOString() }));
}

const LAST = 200;

async function thread(where: Prisma.AgentMessageWhereInput, runs: Prisma.AgentRunWhereInput, access: Access) {
  const rows = (await db.agentMessage.findMany({ where, orderBy: { createdAt: 'desc' }, take: LAST })).reverse();
  return { messages: await messageDtos(rows, access), running: await running(runs) };
}

/** Why the agent cannot answer, as its own message in the conversation. */
async function cannotStart(place: Place, agentId: string, e: unknown) {
  if (!(e instanceof HttpError) || e.status >= 500) throw e;
  await postMessage(place, { authorKind: 'agent', authorAgentId: agentId, kind: 'error', text: e.message });
}

// ---------------------------------------------------------------- chat with one agent

export async function getChat(agentId: string, user: User, access: Access) {
  await findAgent(agentId, true);
  return thread({ roomId: null, agentId, chatUserId: user.id }, { agentId, roomId: null, chatUserId: user.id }, access);
}

/** The page a person writes from (the agent panel of a page, phase B): its name and what it shows. */
export interface PageContext {
  name: string;
  sees: string;
}

export async function sendChat(tenant: Tenant, user: User, access: Access, agentId: string, text: string, page?: PageContext | null) {
  const a = await findAgent(agentId);
  const place: Place = { tenantId: tenant.id, roomId: null, agentId: a.id, chatUserId: user.id, threadId: null };
  await postMessage(place, { authorKind: 'person', authorUserId: user.id, text, ...(page ? { payload: { page } } : {}) });
  const where = page ? ` They write from the ${page.name} page of 9eye, which shows: ${page.sees}. "This day", "here" and the like mean what that page shows.` : '';
  await startRun({ tenantId: tenant.id, agentId: a.id, trigger: 'chat', requestedById: user.id, chatUserId: user.id, prompt: `Answer the last message of ${user.name}.${where}` })
    .catch((e) => cannotStart(place, a.id, e));
  return getChat(agentId, user, access);
}

/** A skill card: save it to the agent's skill (people who manage agents), use it only this time, or dismiss it. */
export async function decideSkill(user: User, access: Access, messageId: string, choice: 'save' | 'once' | 'dismiss') {
  const m = await db.agentMessage.findFirst({ where: { id: messageId, kind: 'skill' } });
  if (!m) throw new HttpError(404, 'No such skill card.');
  if (!m.roomId && m.chatUserId !== user.id) throw new HttpError(403, 'This card is in someone else’s chat.');
  const p = (m.payload ?? {}) as { skill: string; before?: string; status?: string };
  if (p.status !== 'waiting') throw new HttpError(409, 'This card was decided already.');
  const status = { save: 'saved', once: 'once', dismiss: 'dismissed' }[choice];
  if (choice === 'save') {
    if (!canManage(access)) throw new HttpError(403, 'Only someone who can change Settings saves an agent’s skill: choose “Only this time”, or ask them.');
    const agentId = m.authorAgentId!;
    const a = await findAgent(agentId);
    await db.agent.update({ where: { id: a.id }, data: { skill: p.skill, version: { increment: 1 } } });
    await db.agentSkillVersion.create({ data: { id: uuidv7(), agentId: a.id, skill: p.skill, changedById: user.id, via: 'chat' } });
  }
  await db.agentMessage.update({ where: { id: m.id }, data: { payload: { ...p, status, decidedById: user.id } } });
  return (await messageDtos([{ ...m, payload: { ...p, status, decidedById: user.id } }], access))[0];
}

// ---------------------------------------------------------------- rooms

async function findRoom(id: string): Promise<AgentRoom> {
  const r = await db.agentRoom.findFirst({ where: { id } });
  if (!r) throw new HttpError(404, 'No such room.');
  return r;
}

export async function createRoom(input: { name: string; description: string }) {
  const name = input.name.trim().replace(/^#/, '');
  if (await db.agentRoom.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) throw new HttpError(409, `There is a room #${name} already.`);
  return db.agentRoom.create({ data: { id: uuidv7(), name, description: input.description.trim() } as Prisma.AgentRoomUncheckedCreateInput });
}

export async function updateRoom(id: string, input: { name: string; description: string }) {
  await findRoom(id);
  const name = input.name.trim().replace(/^#/, '');
  if (await db.agentRoom.findFirst({ where: { id: { not: id }, name: { equals: name, mode: 'insensitive' } } })) throw new HttpError(409, `There is a room #${name} already.`);
  return db.agentRoom.update({ where: { id }, data: { name, description: input.description.trim() } });
}

export async function deleteRoom(id: string) {
  await findRoom(id);
  await db.agentRoutine.updateMany({ where: { roomId: id }, data: { roomId: null } });
  await db.agentMessage.deleteMany({ where: { roomId: id } });
  await db.agentRoom.deleteMany({ where: { id } });
}

export async function getRoom(id: string, access: Access) {
  const room = await findRoom(id);
  return { room: { id: room.id, name: room.name, description: room.description }, ...(await thread({ roomId: id }, { roomId: id }, access)) };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The agents a message @mentions, by name (longest names first, so "@Gap filler 2" is not "@Gap filler"). */
export function mentioned<T extends { name: string }>(text: string, agents: T[]): T[] {
  let rest = text;
  const found: T[] = [];
  for (const a of [...agents].sort((x, y) => y.name.length - x.name.length)) {
    const re = new RegExp(`@${escape(a.name)}(?![\\p{L}\\p{N}_])`, 'giu');
    if (re.test(rest)) {
      found.push(a);
      rest = rest.replace(re, ' ');
    }
  }
  return found;
}

/** A person's message in a room; every agent it @mentions answers in its thread. */
export async function postToRoom(tenant: Tenant, user: User, access: Access, roomId: string, input: { text: string; threadId?: string | null }) {
  await findRoom(roomId);
  let threadId: string | null = null;
  if (input.threadId) {
    const parent = await db.agentMessage.findFirst({ where: { id: input.threadId, roomId } });
    if (!parent) throw new HttpError(404, 'No such message in this room.');
    threadId = parent.threadId ?? parent.id;
  }
  const msg = await postMessage({ tenantId: tenant.id, roomId, agentId: null, chatUserId: null, threadId }, { authorKind: 'person', authorUserId: user.id, text: input.text });
  const agents = mentioned(input.text, await db.agent.findMany({ where: { deletedAt: null } }));
  const place: Place = { tenantId: tenant.id, roomId, agentId: null, chatUserId: null, threadId: threadId ?? msg.id };
  for (const a of agents) {
    await startRun({ tenantId: tenant.id, agentId: a.id, trigger: 'room', requestedById: user.id, roomId, threadId: threadId ?? msg.id, prompt: `${user.name} @mentioned you: answer their last message.` })
      .catch((e) => cannotStart(place, a.id, e));
  }
  return getRoom(roomId, access);
}

// ---------------------------------------------------------------- runs (Work done)

export interface RunDto {
  id: string;
  trigger: string;
  status: string;
  requestedBy: string | null;
  room: string | null;
  startedAt: string;
  endedAt: string | null;
  tokens: number;
  error: string | null;
  tools: string[];
  changes: { id: string; title: string; status: string }[];
}

export async function agentRuns(agentId: string): Promise<RunDto[]> {
  await findAgent(agentId, true);
  const rows = await db.agentRun.findMany({ where: { agentId }, orderBy: { startedAt: 'desc' }, take: 50 });
  const changes = await db.agentChange.findMany({ where: { runId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'asc' } });
  const people = await names(rows.flatMap((r) => (r.requestedById ? [r.requestedById] : [])));
  const rooms = new Map((await db.agentRoom.findMany({ where: { id: { in: rows.flatMap((r) => (r.roomId ? [r.roomId] : [])) } } })).map((r) => [r.id, r.name]));
  return rows.map((r: AgentRun) => {
    const steps = (Array.isArray(r.steps) ? r.steps : []) as { kind?: string; tool?: string }[];
    return {
      id: r.id, trigger: r.trigger, status: r.status, requestedBy: r.requestedById ? (people.get(r.requestedById) ?? null) : null, room: r.roomId ? (rooms.get(r.roomId) ?? null) : null,
      startedAt: r.startedAt.toISOString(), endedAt: iso(r.endedAt), tokens: r.inputTokens + r.outputTokens, error: r.error,
      tools: [...new Set(steps.flatMap((s) => (s.kind === 'tool' && s.tool ? [s.tool] : [])))],
      changes: changes.filter((c) => c.runId === r.id).map((c) => ({ id: c.id, title: WRITE_TITLE[c.tool] ?? c.tool, status: c.status })),
    };
  });
}

export async function stopRun(user: User, access: Access, runId: string): Promise<void> {
  const run = await db.agentRun.findFirst({ where: { id: runId } });
  if (!run) throw new HttpError(404, 'No such run.');
  if (run.status !== 'running') throw new HttpError(409, 'This run has ended already.');
  if (run.requestedById !== user.id && !canManage(access)) throw new HttpError(403, 'Only the person who asked, or someone who can change Settings, stops a run.');
  if (!requestStop(run.id)) {
    // Not going in this server (it restarted): it ended already.
    await db.agentRun.update({ where: { id: run.id }, data: { status: 'stopped', endedAt: new Date(), error: 'Stopped by a person.' } });
  }
}

// ---------------------------------------------------------------- change cards

export async function listChanges(access: Access, q: { status: 'waiting' | 'decided'; agentId?: string }): Promise<ChangeDto[]> {
  const rows = await db.agentChange.findMany({
    where: { ...(q.status === 'waiting' ? { status: 'waiting' } : { status: { not: 'waiting' } }), ...(q.agentId ? { agentId: q.agentId } : {}) },
    include: { agent: true },
    orderBy: { createdAt: q.status === 'waiting' ? 'asc' : 'desc' },
    take: 100,
  });
  return changeDtos(rows, access);
}

async function findChange(id: string) {
  const c = await db.agentChange.findFirst({ where: { id }, include: { agent: true } });
  if (!c) throw new HttpError(404, 'No such change.');
  return c;
}

const STATUS_WORD: Record<string, string> = { applying: 'being applied', approved: 'approved', rejected: 'rejected', failed: 'tried and failed', undone: 'undone' };

/**
 * A person approves or rejects an agent's change. Approving applies it with what both the agent and
 * the person may do, at the version the preview showed (a newer version answers that the item
 * changed); the audit log keeps it as done via the agent, by the person who approved.
 */
export async function decideChange(tenant: Tenant, user: User, access: Access, id: string, decision: 'approve' | 'reject', confirmed = false): Promise<ChangeDto> {
  const c = await findChange(id);
  if (c.status !== 'waiting') throw new HttpError(409, `This change was ${STATUS_WORD[c.status] ?? c.status} already.`);
  const part = partOfTool(c.tool);
  if (!part || !mayDecide(access, c.tool)) {
    const verb = TOOL_GRANT[c.tool]?.[1] === 'approve' ? 'approve days of' : 'change';
    throw new HttpError(403, `Your role does not let you ${verb} ${part?.label ?? 'this'}: someone who can must decide this change.`);
  }
  if (decision === 'approve' && TO_AIR.has(c.tool) && !confirmed) {
    throw new HttpError(409, 'This change puts a day on air: approve it a second time to confirm.');
  }
  const decided = { decidedById: user.id, decidedAt: new Date() };

  if (decision === 'reject') {
    const r = await db.agentChange.updateMany({ where: { id, status: 'waiting' }, data: { status: 'rejected', ...decided } });
    if (!r.count) throw new HttpError(409, 'Someone decided this change a moment ago.');
    return (await changeDtos([await findChange(id)], access))[0];
  }

  const company = companyTable(tenant);
  if (!aiOn(tenant) || cellOf(company, c.tool) === 'off') {
    throw new HttpError(409, `AI may not do this in ${tenant.name} now (Settings › AI access): nothing was changed. Reject the change.`);
  }
  let principal: Principal;
  if (c.agent) {
    if (c.agent.deletedAt) throw new HttpError(409, 'The agent was deleted: reject the change.');
    if (partsOf(c.agent.parts)[part.key] !== 'edit') throw new HttpError(409, `${c.agent.name} may not change ${part.label} any more: reject the change.`);
    principal = {
      user: { id: user.id, name: user.name }, tenant, tokenId: null, via: 'agent', agentId: c.agent.id, access: intersect(await agentAccess(c.agent), access), canWrite: true,
      policy: company, approved: true,
    };
  } else {
    // an AI app's change: what its token and its person may do, and what the approver may do
    const token = c.tokenId ? await db.accessToken.findFirst({ where: { id: c.tokenId }, include: { user: true } }) : null;
    const owner = token ? await accessOf(token.user, tenant.id) : null;
    if (!token || token.revokedAt || !owner) throw new HttpError(409, 'The token of this change is revoked, or its person left: reject the change.');
    const own = tokenTable(token);
    principal = {
      user: { id: user.id, name: user.name }, tenant, tokenId: token.id, via: 'mcp', access: intersect(owner, access), canWrite: true,
      policy: own ? narrower(own, company) : company, approved: true,
    };
  }
  const def = toolDefs(principal).find((d) => d.name === c.tool);
  if (!def) throw new HttpError(409, `There is no tool ${c.tool} any more: reject the change.`);
  const claimed = await db.agentChange.updateMany({ where: { id, status: 'waiting' }, data: { status: 'applying', ...decided } });
  if (!claimed.count) throw new HttpError(409, 'Someone decided this change a moment ago.');

  const r = await invokeTool(principal, def, c.args);
  if (r.isError && r.status === 403) {
    await db.agentChange.update({ where: { id }, data: { status: 'waiting', decidedById: null, decidedAt: null } });
    throw new HttpError(403, `${r.text}\nIts role or yours does not allow it: nothing was changed.`);
  }
  await db.agentChange.update({ where: { id }, data: r.isError ? { status: 'failed', result: r.text } : { status: 'approved', result: r.text, changeId: r.changeId } });

  // The agent goes on: with what it said follows (a chained change, once applied), or — handed this
  // work in a room — to tell the agent that handed it (the chain goes on from there).
  const run = c.runId ? await db.agentRun.findFirst({ where: { id: c.runId } }) : null;
  const goOn = c.then ? !r.isError : !!(run?.roomId && run.chain.length);
  if (c.agent && run && goOn && !c.agent.deletedAt) {
    // The card already says it is applied: when the agent cannot go on now (paused, no key, its
    // limit), nothing more is said.
    const next = c.then
      ? `\n\nYou said that once it is applied you would: ${c.then}\nDo that now; your changes wait for a person, as always.`
      : '\n\nSay in a sentence or two what changed.';
    await startRun({
      tenantId: tenant.id, agentId: c.agent.id, trigger: 'approved', requestedById: user.id, roomId: run.roomId, chatUserId: run.roomId ? null : run.chatUserId,
      threadId: run.threadId, chain: run.chain,
      prompt: `${user.name} ${r.isError ? 'approved your change, but applying it failed' : 'approved your change, and it is applied'} (${def.title}). What applying answered:\n${r.text}${next}`,
    }).catch((e) => {
      if (!(e instanceof HttpError)) console.error('agent goes on after approval', e);
    });
  }
  return (await changeDtos([await findChange(id)], access))[0];
}

/** Puts back what an approved change did, as the person (only while nobody changed the item since). */
export async function undoChange(tenant: Tenant, user: User, access: Access, id: string): Promise<ChangeDto> {
  const c = await findChange(id);
  if (c.status !== 'approved' || !c.changeId) throw new HttpError(409, 'Only an applied change can be undone.');
  const principal: Principal = { user: { id: user.id, name: user.name }, tenant, tokenId: null, via: 'web', access, canWrite: true };
  const def = toolDefs(principal).find((d) => d.name === 'undo_change')!;
  const r = await invokeTool(principal, def, { change: c.changeId });
  if (r.isError) throw new HttpError(r.status && r.status < 500 ? r.status : 409, r.text);
  await db.agentChange.update({ where: { id }, data: { status: 'undone', result: `${c.result ?? ''}\n\nUndone by ${user.name}: ${r.text}`.trim() } });
  return (await changeDtos([await findChange(id)], access))[0];
}

// ---------------------------------------------------------------- routines (phase B)

export interface RoutineDto {
  id: string;
  agentId: string;
  name: string;
  kind: 'time' | 'event';
  time: string | null;
  weekdays: boolean[];
  timeZone: string;
  event: RoutineEvent | null;
  eventLabel: string | null;
  channelIds: string[];
  request: string;
  room: { id: string; name: string } | null;
  enabled: boolean;
  createdBy: { id: string; name: string };
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** The person may change, run or delete it (theirs, or they manage agents). */
  canChange: boolean;
}

export interface RoutineInput {
  name: string;
  kind: 'time' | 'event';
  time?: string | null;
  weekdays?: boolean[];
  timeZone?: string;
  event?: RoutineEvent | null;
  channelIds?: string[];
  request: string;
  roomId?: string | null;
  enabled?: boolean;
}

async function routineDtos(rows: AgentRoutine[], user: User, access: Access): Promise<RoutineDto[]> {
  const people = await names(rows.map((r) => r.createdById));
  const rooms = new Map((await db.agentRoom.findMany({ where: { id: { in: rows.flatMap((r) => (r.roomId ? [r.roomId] : [])) } } })).map((r) => [r.id, r]));
  return rows.map((r) => {
    const room = r.roomId ? rooms.get(r.roomId) : undefined;
    const event = r.event && (ROUTINE_EVENTS as readonly string[]).includes(r.event) ? (r.event as RoutineEvent) : null;
    return {
      id: r.id, agentId: r.agentId, name: r.name, kind: r.kind === 'event' ? 'event' : 'time', time: r.time, weekdays: r.weekdays, timeZone: r.timeZone,
      event, eventLabel: event ? EVENT_LABEL[event] : null, channelIds: r.channelIds, request: r.request, room: room ? { id: room.id, name: room.name } : null,
      enabled: r.enabled, createdBy: { id: r.createdById, name: people.get(r.createdById) ?? 'Someone' }, nextRunAt: iso(r.nextRunAt), lastRunAt: iso(r.lastRunAt),
      canChange: r.createdById === user.id || canManage(access),
    };
  });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Checks a routine and works out its next time. */
async function routineData(input: RoutineInput) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new HttpError(422, 'Name the routine (up to 80 characters).');
  const request = input.request.trim();
  if (!request) throw new HttpError(422, 'Say what the agent should do each time.');
  const enabled = input.enabled ?? true;
  if (input.roomId && !(await db.agentRoom.findFirst({ where: { id: input.roomId } }))) throw new HttpError(422, 'That room does not exist any more.');
  const channelIds = [...new Set(input.channelIds ?? [])];
  if (channelIds.length && (await db.channel.count({ where: { id: { in: channelIds }, deletedAt: null } })) !== channelIds.length) {
    throw new HttpError(422, 'Some of the channels are not channels of this company.');
  }
  const base = { name, kind: input.kind, request, roomId: input.roomId ?? null, enabled, channelIds };
  if (input.kind === 'time') {
    const time = input.time ?? '';
    if (!HHMM.test(time)) throw new HttpError(422, 'A time as HH:MM, e.g. 18:00.');
    const weekdays = input.weekdays ?? [];
    if (weekdays.length !== 7 || !weekdays.some(Boolean)) throw new HttpError(422, 'Pick at least one day of the week.');
    const timeZone = input.timeZone ?? 'UTC';
    if (!validTimeZone(timeZone)) throw new HttpError(422, `"${timeZone}" is not a time zone.`);
    return { ...base, time, weekdays, timeZone, event: null, nextRunAt: enabled ? nextTime(time, weekdays, timeZone, new Date()) : null };
  }
  if (!input.event || !(ROUTINE_EVENTS as readonly string[]).includes(input.event)) throw new HttpError(422, 'Pick what starts the routine.');
  return { ...base, time: null, weekdays: [], timeZone: input.timeZone && validTimeZone(input.timeZone) ? input.timeZone : 'UTC', event: input.event, nextRunAt: null };
}

async function findRoutine(id: string) {
  const r = await db.agentRoutine.findFirst({ where: { id } });
  if (!r) throw new HttpError(404, 'No such routine.');
  return r;
}

function mayChangeRoutine(r: AgentRoutine, user: User, access: Access) {
  if (r.createdById !== user.id && !canManage(access)) throw new HttpError(403, 'Only the person who made this routine, or someone who can change Settings, changes it.');
}

export async function listRoutines(agentId: string, user: User, access: Access): Promise<RoutineDto[]> {
  await findAgent(agentId, true);
  return routineDtos(await db.agentRoutine.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } }), user, access);
}

/** Every member may make a routine: it works for them, with their role. */
export async function createRoutine(user: User, access: Access, agentId: string, input: RoutineInput): Promise<RoutineDto> {
  await findAgent(agentId);
  const data = await routineData(input);
  const r = await db.agentRoutine.create({ data: { id: uuidv7(), agentId, createdById: user.id, ...data } as Prisma.AgentRoutineUncheckedCreateInput });
  return (await routineDtos([r], user, access))[0];
}

export async function updateRoutine(user: User, access: Access, id: string, input: RoutineInput): Promise<RoutineDto> {
  const r = await findRoutine(id);
  mayChangeRoutine(r, user, access);
  const data = await routineData(input);
  const saved = await db.agentRoutine.update({ where: { id }, data });
  return (await routineDtos([saved], user, access))[0];
}

export async function deleteRoutine(user: User, access: Access, id: string): Promise<void> {
  const r = await findRoutine(id);
  mayChangeRoutine(r, user, access);
  await db.agentRoutine.deleteMany({ where: { id } });
}

/** Runs it now, as at its time (it still works for the person who made it). */
export async function runRoutineNow(user: User, access: Access, id: string): Promise<{ runId: string | null }> {
  const r = await findRoutine(id);
  mayChangeRoutine(r, user, access);
  await findAgent(r.agentId);
  await db.agentRoutine.update({ where: { id }, data: { lastRunAt: new Date() } });
  return { runId: await fireRoutine(r, 'Run now.', { id: user.id, name: user.name }) };
}

// ---------------------------------------------------------------- a day change, shown on the day page (phase C1)

/**
 * The day as a waiting change would leave it (fill_day, edit_day): nothing is saved. Worked out with
 * what the agent may do; the person must be able to open that day.
 */
export async function changeDayPreview(tenant: Tenant, user: User, access: Access, id: string) {
  const c = await findChange(id);
  if (c.tool !== 'fill_day' && c.tool !== 'edit_day') throw new HttpError(422, 'Only a change of a day’s rows is shown on the day page.');
  if (c.status !== 'waiting') throw new HttpError(409, `This change was ${STATUS_WORD[c.status] ?? c.status} already.`);
  const channels = await db.channel.findMany({ where: { deletedAt: null }, select: { id: true, name: true, code: true } });
  const t = targetOf(c, channels);
  if (t?.kind !== 'day' || !can(access, 'playlist', 'view', t.channelId)) throw new HttpError(403, 'Your role does not let you view Playlist on this channel.');
  let who: Access;
  if (c.agent) who = await agentAccess(c.agent);
  else {
    const token = c.tokenId ? await db.accessToken.findFirst({ where: { id: c.tokenId }, include: { user: true } }) : null;
    const owner = token ? await accessOf(token.user, tenant.id) : null;
    if (!owner) throw new HttpError(409, 'The token of this change is revoked, or its person left.');
    who = owner;
  }
  const principal: Principal = { user: { id: user.id, name: user.name }, tenant, tokenId: c.tokenId, via: 'web', agentId: c.agent?.id, access: who, canWrite: true };
  const a = c.args as never;
  return c.tool === 'fill_day' ? fillDayPreview(principal, a) : dayEditPreview(principal, a);
}

