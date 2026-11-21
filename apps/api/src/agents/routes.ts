// The Agents API (decision 0024). Every member works with agents (chat, rooms, change cards: the
// role decides each change); people who can change Settings manage agents, rooms and provider keys.

import { z } from 'zod';
import { signedInUser } from '../auth';
import { accessOfRequest, type guarded } from '../rules';
import { PART_KEYS } from './parts';
import { PROVIDERS } from './providers';
import { ROUTINE_EVENTS } from './routines';
import {
  COLORS, agentRuns, changeDayPreview, createAgent, createRoom, createRoutine, decideChange, decideSkill, deleteAgent, deleteProviderKey, deleteRoom, deleteRoutine, forget, getAgent,
  getChat, getRoom, listChanges, listProviders, listRoutines, overview, postToRoom, runRoutineNow, saveProviderKey, sendChat, stopRun, undoChange, updateAgent,
  updateRoom, updateRoutine,
} from './service';

const id = z.uuid();
const text = z.string().trim().min(1, 'Write a message.').max(8000);
const provider = z.enum(PROVIDERS);
const parts = z.partialRecord(z.enum(PART_KEYS), z.enum(['read', 'edit']));
const page = z.object({ name: z.string().trim().min(1).max(100), sees: z.string().trim().min(1).max(600) });
const routine = z.object({
  name: z.string().max(80),
  kind: z.enum(['time', 'event']),
  time: z.string().max(5).nullish(),
  weekdays: z.array(z.boolean()).length(7).optional(),
  timeZone: z.string().max(100).optional(),
  event: z.enum(ROUTINE_EVENTS).nullish(),
  channelIds: z.array(id).max(500).optional(),
  request: z.string().max(4000),
  roomId: id.nullish(),
  enabled: z.boolean().optional(),
});
const room = z.object({ name: z.string().trim().min(1).max(60).regex(/^#?[\p{L}\p{N}][\p{L}\p{N} _-]*$/u, 'Letters, digits, spaces, - and _.'), description: z.string().max(500).default('') });

export function agentRoutes(g: ReturnType<typeof guarded>) {
  // ---------------------------------------------------------------- provider keys (Settings › AI access)
  g.get('/admin/ai-providers', async (_req, res) => {
    res.json(await listProviders());
  });

  g.put('/admin/ai-providers/:provider', async (req, res) => {
    const body = z.object({ apiKey: z.string().max(400) }).parse(req.body);
    res.json(await saveProviderKey(provider.parse(req.params.provider), body.apiKey));
  });

  g.delete('/admin/ai-providers/:provider', async (req, res) => {
    res.json(await deleteProviderKey(provider.parse(req.params.provider)));
  });

  // ---------------------------------------------------------------- agents
  g.get('/agents', async (_req, res) => {
    res.json(await overview(res.locals.tenant, accessOfRequest(res)));
  });

  g.post('/agents', async (req, res) => {
    const body = z
      .object({ template: z.string().max(60), name: z.string().max(60).optional(), roleId: id, provider: provider.optional(), model: z.string().max(100).optional() })
      .parse(req.body);
    res.status(201).json(await createAgent(signedInUser(res), body));
  });

  // Change cards (before /agents/:id, whose id would otherwise take "changes").
  g.get('/agents/changes', async (req, res) => {
    const q = z.object({ status: z.enum(['waiting', 'decided']).default('waiting'), agent: id.optional() }).parse(req.query);
    res.json(await listChanges(accessOfRequest(res), { status: q.status, agentId: q.agent }));
  });

  g.post('/agents/changes/:id/approve', async (req, res) => {
    const body = z.object({ confirm: z.boolean().optional() }).parse(req.body ?? {});
    res.json(await decideChange(res.locals.tenant, signedInUser(res), accessOfRequest(res), id.parse(req.params.id), 'approve', body.confirm === true));
  });

  // The day as a waiting day change would leave it, for the day page (phase C1).
  g.get('/agents/changes/:id/day', async (req, res) => {
    res.json(await changeDayPreview(res.locals.tenant, signedInUser(res), accessOfRequest(res), id.parse(req.params.id)));
  });

  g.post('/agents/changes/:id/reject', async (req, res) => {
    res.json(await decideChange(res.locals.tenant, signedInUser(res), accessOfRequest(res), id.parse(req.params.id), 'reject'));
  });

  g.post('/agents/changes/:id/undo', async (req, res) => {
    res.json(await undoChange(res.locals.tenant, signedInUser(res), accessOfRequest(res), id.parse(req.params.id)));
  });

  g.post('/agents/messages/:id/skill', async (req, res) => {
    const body = z.object({ choice: z.enum(['save', 'once', 'dismiss']) }).parse(req.body);
    res.json(await decideSkill(signedInUser(res), accessOfRequest(res), id.parse(req.params.id), body.choice));
  });

  // ---------------------------------------------------------------- routines (phase B)
  g.put('/agents/routines/:id', async (req, res) => {
    res.json(await updateRoutine(signedInUser(res), accessOfRequest(res), id.parse(req.params.id), routine.parse(req.body)));
  });

  g.delete('/agents/routines/:id', async (req, res) => {
    await deleteRoutine(signedInUser(res), accessOfRequest(res), id.parse(req.params.id));
    res.status(204).end();
  });

  g.post('/agents/routines/:id/run', async (req, res) => {
    res.json(await runRoutineNow(signedInUser(res), accessOfRequest(res), id.parse(req.params.id)));
  });

  g.post('/agents/runs/:id/stop', async (req, res) => {
    await stopRun(signedInUser(res), accessOfRequest(res), id.parse(req.params.id));
    res.status(204).end();
  });

  // ---------------------------------------------------------------- rooms
  g.post('/agents/rooms', async (req, res) => {
    const r = await createRoom(room.parse(req.body));
    res.status(201).json({ id: r.id, name: r.name, description: r.description });
  });

  g.get('/agents/rooms/:id', async (req, res) => {
    res.json(await getRoom(id.parse(req.params.id), accessOfRequest(res)));
  });

  g.put('/agents/rooms/:id', async (req, res) => {
    const r = await updateRoom(id.parse(req.params.id), room.parse(req.body));
    res.json({ id: r.id, name: r.name, description: r.description });
  });

  g.delete('/agents/rooms/:id', async (req, res) => {
    await deleteRoom(id.parse(req.params.id));
    res.status(204).end();
  });

  g.post('/agents/rooms/:id/messages', async (req, res) => {
    const body = z.object({ text, threadId: id.nullish() }).parse(req.body);
    res.status(201).json(await postToRoom(res.locals.tenant, signedInUser(res), accessOfRequest(res), id.parse(req.params.id), body));
  });

  // ---------------------------------------------------------------- one agent
  g.get('/agents/:id', async (req, res) => {
    res.json(await getAgent(id.parse(req.params.id)));
  });

  g.put('/agents/:id', async (req, res) => {
    const body = z
      .object({
        version: z.number().int(),
        name: z.string().trim().min(1).max(60),
        mark: z.string().max(2).default(''),
        color: z.enum(COLORS),
        job: z.string().max(1000),
        provider,
        model: z.string().trim().min(1, 'Name the model.').max(100),
        roleId: id,
        parts,
        channelIds: z.array(id).max(500),
        skill: z.string().max(8000),
        worksWith: z.array(id).max(50),
        enabled: z.boolean(),
        maxSteps: z.number().int().min(1).max(100),
        monthlyTokens: z.number().int().min(10_000).max(1_000_000_000),
      })
      .parse(req.body);
    res.json(await updateAgent(signedInUser(res), id.parse(req.params.id), body));
  });

  g.delete('/agents/:id', async (req, res) => {
    await deleteAgent(signedInUser(res), id.parse(req.params.id));
    res.status(204).end();
  });

  g.delete('/agents/:id/memory/:memoryId', async (req, res) => {
    await forget(id.parse(req.params.id), id.parse(req.params.memoryId));
    res.status(204).end();
  });

  g.get('/agents/:id/chat', async (req, res) => {
    res.json(await getChat(id.parse(req.params.id), signedInUser(res), accessOfRequest(res)));
  });

  g.post('/agents/:id/chat', async (req, res) => {
    const body = z.object({ text, page: page.nullish() }).parse(req.body);
    res.status(201).json(await sendChat(res.locals.tenant, signedInUser(res), accessOfRequest(res), id.parse(req.params.id), body.text, body.page));
  });

  g.get('/agents/:id/routines', async (req, res) => {
    res.json(await listRoutines(id.parse(req.params.id), signedInUser(res), accessOfRequest(res)));
  });

  g.post('/agents/:id/routines', async (req, res) => {
    res.status(201).json(await createRoutine(signedInUser(res), accessOfRequest(res), id.parse(req.params.id), routine.parse(req.body)));
  });

  g.get('/agents/:id/runs', async (req, res) => {
    res.json(await agentRuns(id.parse(req.params.id)));
  });
}
