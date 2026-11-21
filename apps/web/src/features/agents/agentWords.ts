// Words and small helpers of the Agents page (decision 0024, docs/design/agents-page.md).

import type { Agent, AgentsOverview, ProviderName } from '@/lib/types';
import type { AgentState } from '@/ui';

export const PROVIDER_LABEL: Record<ProviderName, string> = { anthropic: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)', xai: 'Grok (xAI)' };

export function agentState(a: Pick<Agent, 'enabled' | 'running' | 'waiting'>): AgentState {
  if (!a.enabled) return 'off';
  if (a.running) return 'working';
  if (a.waiting) return 'waiting';
  return 'idle';
}

export function agentStatus(a: Pick<Agent, 'enabled' | 'running' | 'waiting'> & { nextRoutineAt?: string | null }): string {
  if (!a.enabled) return 'Paused';
  if (a.running) return 'Working…';
  if (a.waiting) return a.waiting === 1 ? '1 change waits for a person' : `${a.waiting} changes wait for a person`;
  return a.nextRoutineAt ? `Idle · next ${messageTime(a.nextRoutineAt)}` : 'Idle';
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** A message's time: "14:05" today, else "17 Nov 14:05" (the person's own clock). */
export function messageTime(iso: string): string {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sameDay(d, new Date()) ? hm : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm}`;
}

export const tokensText = (n: number) => n.toLocaleString('en-US');

/** Why agents cannot work now, if they cannot. */
export function blockedText(o: AgentsOverview): { tone: 'amber' | 'neutral'; text: string } | null {
  if (o.aiAccess === 'off') return { tone: 'amber', text: 'AI access is off in this company: agents cannot work until a company admin turns it on in Settings › AI access.' };
  if (!o.providers.some((p) => p.set)) return { tone: 'amber', text: 'Agents need a key of Claude, ChatGPT or Grok: a company admin adds the company’s own key in Settings › AI access.' };
  if (o.aiAccess === 'read') return { tone: 'neutral', text: 'AI apps may only read in this company: agents look things up and report, but prepare no changes.' };
  return null;
}

export const TRIGGER_WORD: Record<string, string> = { chat: 'Chat', room: 'Room', handoff: 'Handed work', report: 'Heard back', approved: 'After approval', routine: 'Routine' };
