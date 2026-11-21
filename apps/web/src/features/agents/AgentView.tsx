// One agent (docs/design/agents-page.md): its mark, name, job and state; Chat (only the person and
// the agent), Settings, Work done.

import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { Agent, AgentRun, AgentThread, AgentsOverview } from '@/lib/types';
import { AgentMark, Badge, EmptyState, Notice, StatusDot, TabBar, Table, TableRow, type DotTone } from '@/ui';
import { AgentSettings } from './AgentSettings';
import { Conversation, pollWhileRunning, useThreadUpdate } from './Conversation';
import { useOverviewWhenDone } from './RoomView';
import { TRIGGER_WORD, agentState, agentStatus, messageTime, tokensText } from './agentWords';

type Tab = 'chat' | 'settings' | 'work';
const TABS: { value: Tab; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'settings', label: 'Settings' },
  { value: 'work', label: 'Work done' },
];
const STATE_DOT: Record<string, DotTone> = { idle: 'green', working: 'green', waiting: 'amber', off: 'neutral' };

export function AgentView({ agent, tab, overview }: { agent: Agent; tab: Tab; overview: AgentsOverview }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <AgentMark mark={agent.mark} color={agent.color} size="lg" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-section font-semibold">{agent.name}</span>
            <StatusDot tone={STATE_DOT[agentState(agent)]}>{agentStatus(agent)}</StatusDot>
          </span>
          <span className="text-[12.5px] text-text-2">{agent.job || 'No job written yet.'}</span>
        </span>
        <TabBar label={`${agent.name}`} value={tab} tabs={TABS} onChange={(t) => navigate(t === 'chat' ? `/agents/${agent.id}` : `/agents/${agent.id}/${t}`)} />
      </div>
      {tab === 'chat' && <AgentChat agent={agent} overview={overview} />}
      {tab === 'settings' && <AgentSettings agentId={agent.id} overview={overview} />}
      {tab === 'work' && <AgentWork agent={agent} />}
    </>
  );
}

function AgentChat({ agent, overview }: { agent: Agent; overview: AgentsOverview }) {
  const update = useThreadUpdate();
  const key = keys.agentChat(agent.id);
  const chat = useQuery({ queryKey: key, queryFn: () => api<AgentThread>('GET', `/agents/${agent.id}/chat`), refetchInterval: pollWhileRunning });
  useOverviewWhenDone(chat.data?.running.length ?? 0);
  return (
    <>
      {!agent.enabled && <Notice tone="neutral">{agent.name} is paused: turn it on in its settings to give it work.</Notice>}
      {chat.error && <Notice tone="red">{errorText(chat.error)}</Notice>}
      <Conversation
        thread={chat.data}
        names={overview.agents.map((a) => a.name)}
        canManage={overview.canManage}
        empty={`Tell ${agent.name} what to do. Ask it to work differently from now on, and it proposes a new skill for you to save.`}
        box={{
          label: `Message ${agent.name}`,
          placeholder: `Tell ${agent.name} what to do, or how to work from now on…`,
          hint: `Only you and ${agent.name} see this chat. Every change it prepares waits for a person.`,
          onSend: async (text) => update(key, await api<AgentThread>('POST', `/agents/${agent.id}/chat`, { text })),
        }}
      />
    </>
  );
}

const RUN_TONE: Record<AgentRun['status'], 'neutral' | 'green' | 'amber' | 'red' | 'accent'> = { running: 'accent', done: 'green', stopped: 'amber', failed: 'red' };
const RUN_WORD: Record<AgentRun['status'], string> = { running: 'Working', done: 'Done', stopped: 'Stopped', failed: 'Failed' };
const CHANGE_WORD: Record<string, string> = { waiting: 'waiting', applying: 'applying', approved: 'approved', rejected: 'rejected', failed: 'failed', undone: 'undone' };

function AgentWork({ agent }: { agent: Agent }) {
  const runs = useQuery({ queryKey: keys.agentRuns(agent.id), queryFn: () => api<AgentRun[]>('GET', `/agents/${agent.id}/runs`), refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? 3000 : false) });
  const rows = runs.data ?? [];
  return (
    <>
      <span className="text-[12.5px] text-text-3">
        Its last 50 runs. {tokensText(agent.usedTokens)} of {tokensText(agent.monthlyTokens)} tokens used this month.
      </span>
      {runs.error && <Notice tone="red">{errorText(runs.error)}</Notice>}
      {runs.isSuccess && !rows.length && <EmptyState>{agent.name} has not worked yet.</EmptyState>}
      {rows.length > 0 && (
        <Table columns="110px minmax(140px,1fr) minmax(160px,1.4fr) minmax(140px,1fr) 80px 90px" head={['When', 'Asked', 'What it used', 'Changes', 'Tokens', 'State']} minWidth={860}>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <span className="mono text-meta text-text-2">{messageTime(r.startedAt)}</span>
              <span className="flex flex-col leading-[1.3]">
                <span>{TRIGGER_WORD[r.trigger] ?? r.trigger}</span>
                <span className="text-meta text-text-3">{[r.requestedBy, r.room ? `#${r.room}` : r.trigger === 'chat' ? 'chat' : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="mono text-meta text-text-2 [overflow-wrap:anywhere]">{r.tools.length ? r.tools.join(', ') : '—'}</span>
              <span className="flex flex-wrap gap-1">
                {r.changes.length
                  ? r.changes.map((c) => (
                      <Badge key={c.id} tone={c.status === 'approved' ? 'green' : c.status === 'waiting' ? 'amber' : c.status === 'failed' ? 'red' : 'neutral'}>
                        {c.title} · {CHANGE_WORD[c.status]}
                      </Badge>
                    ))
                  : <span className="text-meta text-text-3">—</span>}
              </span>
              <span className="mono text-meta text-text-2">{tokensText(r.tokens)}</span>
              <span title={r.error ?? undefined}>
                <Badge tone={RUN_TONE[r.status]}>{RUN_WORD[r.status]}</Badge>
              </span>
            </TableRow>
          ))}
        </Table>
      )}
    </>
  );
}
