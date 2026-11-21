// Routines (decision 0024, phase B): an agent starts by itself — at a time on chosen weekdays (in a
// time zone), or when something happens in the company (a week is created, a campaign is
// confirmed). It works for the person who made the routine (never more than their role) and answers
// in the routine's room, else in that person's chat with it.
//
// The clock: every 30 s the API starts the routines that are due. A routine that is due is claimed
// once (its next time moves on first), so two API processes never run it twice; one more than an
// hour late (the API was down) is not run, only moved to its next time.

import type { AgentRoutine } from '@prisma/client';
import { platformDb, withTenant } from '../db';
import { HttpError } from '../errors';
import { onCompanyEvent, type CompanyEvent } from '../events';
import { providerError } from './providers';
import { postMessage, startRun } from './runner';

export const ROUTINE_EVENTS = ['week_created', 'campaign_confirmed'] as const;
export type RoutineEvent = (typeof ROUTINE_EVENTS)[number];
export const EVENT_LABEL: Record<RoutineEvent, string> = { week_created: 'A week is created', campaign_confirmed: 'A campaign is confirmed' };

/** A routine more late than this (the API was down) is skipped to its next time. */
const LATE_MS = 60 * 60_000;
const TICK_MS = 30_000;

// ---------------------------------------------------------------- time

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall clock of `d` in `tz`. */
function wall(d: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), min: Number(parts.minute), s: Number(parts.second) };
}

/** How far `tz` is ahead of UTC at `d`, in ms. */
function offset(d: Date, tz: string): number {
  const w = wall(d, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant of a wall-clock time in `tz` (a time skipped by a clock change moves on by the change). */
function instant(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - offset(new Date(guess), tz);
  return new Date(guess - offset(new Date(first), tz));
}

/** The next time after `after` that `time` ("HH:MM") falls on one of `weekdays` (0 = Sunday) in `tz`; null when no weekday is on. */
export function nextTime(time: string, weekdays: boolean[], tz: string, after: Date): Date | null {
  const [h, min] = time.split(':').map(Number);
  if (!weekdays.some(Boolean)) return null;
  const today = wall(after, tz);
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    if (!weekdays[day.getUTCDay()]) continue;
    const at = instant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, min, tz);
    if (at.getTime() > after.getTime()) return at;
  }
  return null;
}

// ---------------------------------------------------------------- starting a routine

/** Starts the routine's agent; when it cannot run, says why where it would have answered. */
export async function fireRoutine(r: AgentRoutine, reason: string, by?: { id: string; name: string }): Promise<string | null> {
  const room = r.roomId ? await platformDb.agentRoom.findFirst({ where: { id: r.roomId, tenantId: r.tenantId } }) : null;
  const place = { tenantId: r.tenantId, roomId: room?.id ?? null, agentId: room ? null : r.agentId, chatUserId: room ? null : r.createdById, threadId: null };
  try {
    return await withTenant(r.tenantId, () =>
      startRun({
        tenantId: r.tenantId, agentId: r.agentId, trigger: 'routine', routineId: r.id, requestedById: r.createdById, roomId: room?.id ?? null,
        chatUserId: room ? null : r.createdById,
        prompt: `${reason}${by ? ` ${by.name} asked to run it now.` : ''}\n\nYour routine "${r.name}" asks you:\n${r.request}`,
      }),
    );
  } catch (e) {
    const why = e instanceof HttpError ? e.message : providerError(e);
    await postMessage(place, { authorKind: 'agent', authorAgentId: r.agentId, kind: 'error', text: `The routine "${r.name}" did not run: ${why}` });
    return null;
  }
}

/** Starts every routine that is due; answers how many started. */
export async function tick(now = new Date()): Promise<number> {
  const due = await platformDb.agentRoutine.findMany({ where: { enabled: true, kind: 'time', nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: 50 });
  let started = 0;
  for (const r of due) {
    const next = r.time ? nextTime(r.time, r.weekdays, r.timeZone, now) : null;
    const late = now.getTime() - r.nextRunAt!.getTime() > LATE_MS;
    // claimed by whoever moves its next time first
    const claimed = await platformDb.agentRoutine.updateMany({ where: { id: r.id, nextRunAt: r.nextRunAt }, data: { nextRunAt: next, ...(late ? {} : { lastRunAt: now }) } });
    if (!claimed.count || late) continue;
    const agent = await platformDb.agent.findFirst({ where: { id: r.agentId, deletedAt: null } });
    if (!agent) continue;
    await fireRoutine(r, `It is ${r.time} (${r.timeZone}).`);
    started++;
  }
  return started;
}

let timer: NodeJS.Timeout | null = null;

export function startClock(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => console.error('agent routines', err));
  }, TICK_MS);
  timer.unref();
}

// ---------------------------------------------------------------- events

async function onEvent(tenantId: string, e: CompanyEvent) {
  const routines = await platformDb.agentRoutine.findMany({ where: { tenantId, enabled: true, kind: 'event', event: e.kind } });
  for (const r of routines) {
    if (r.channelIds.length && !r.channelIds.includes(e.channelId)) continue;
    const agent = await platformDb.agent.findFirst({ where: { id: r.agentId, deletedAt: null } });
    if (!agent) continue;
    await platformDb.agentRoutine.update({ where: { id: r.id }, data: { lastRunAt: new Date() } });
    await fireRoutine(r, `Something happened: ${e.text}`);
  }
}

let listening = false;

/** Routines start on company events from here on (once per process). */
export function listenForEvents(): void {
  if (listening) return;
  listening = true;
  onCompanyEvent(onEvent);
}
