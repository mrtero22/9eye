// Agents (decision 0024; mockups AgentTeam / AgentProfile, page doc docs/design/agents-page.md): a
// team of agents beside the people. The side list: New agent, Waiting for you, Rooms, Agents; the
// main area: a room, one agent (Chat, Settings, Work done), or what waits for a person.

import { useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { AgentsOverview } from '@/lib/types';
import { AgentMark, Button, EditorLayout, EmptyState, Icon, ListGroup, NavRow, Notice, PageHeader } from '@/ui';
import { AgentView } from './AgentView';
import { NewAgentDialog } from './NewAgentDialog';
import { RoomDialog } from './RoomDialog';
import { RoomView } from './RoomView';
import { WaitingView } from './WaitingView';
import { agentState, agentStatus, blockedText } from './agentWords';

export const useAgentsOverview = () =>
  useQuery({ queryKey: keys.agents(), queryFn: () => api<AgentsOverview>('GET', '/agents'), refetchInterval: 20_000 });

export function AgentsPage() {
  const { roomId, agentId, tab } = useParams();
  const { pathname } = useLocation();
  const overview = useAgentsOverview();
  const [creating, setCreating] = useState(false);
  const [newRoom, setNewRoom] = useState(false);
  const o = overview.data;
  const waitingPage = pathname === '/agents/waiting';

  if (o && pathname === '/agents') {
    const to = o.waiting ? '/agents/waiting' : o.rooms[0] ? `/agents/rooms/${o.rooms[0].id}` : o.agents[0] ? `/agents/${o.agents[0].id}` : null;
    if (to) return <Navigate to={to} replace />;
  }
  const agent = agentId ? o?.agents.find((a) => a.id === agentId) : undefined;
  const blocked = o ? blockedText(o) : null;

  const side = o && (
    <>
      <Button icon="plus" onClick={() => setCreating(true)} disabled={!o.canManage} title={o.canManage ? undefined : 'Only people who can change Settings add agents.'} className="self-start">
        New agent
      </Button>
      <nav aria-label="Rooms and agents" className="flex flex-col gap-3.5">
        <NavRow to="/agents/waiting" lead={<Icon name="check" size={15} className="text-text-3" />} title="Waiting for you" count={o.waiting} current={waitingPage} />
        <ListGroup label="Rooms">
          {o.rooms.map((r) => (
            <NavRow key={r.id} to={`/agents/rooms/${r.id}`} lead={<Icon name="hash" size={15} className="text-text-3" />} title={r.name} current={r.id === roomId} />
          ))}
          {o.canManage && (
            <button type="button" onClick={() => setNewRoom(true)} className="hov flex h-8 cursor-pointer items-center gap-2.5 rounded-item border-0 bg-transparent px-2.5 text-left text-small text-text-3">
              <Icon name="plus" size={15} />
              New room
            </button>
          )}
          {!o.rooms.length && !o.canManage && <span className="px-3 text-small text-text-3">No rooms yet.</span>}
        </ListGroup>
        <ListGroup label="Agents">
          {o.agents.map((a) => (
            <NavRow
              key={a.id}
              to={`/agents/${a.id}`}
              lead={<AgentMark mark={a.mark} color={a.color} size="sm" state={agentState(a)} />}
              title={a.name}
              meta={agentStatus(a)}
              current={a.id === agentId}
            />
          ))}
          {!o.agents.length && <span className="px-3 text-small text-text-3">No agents yet.</span>}
        </ListGroup>
      </nav>
      <Link to="/admin/ai-access" className="px-2.5 text-meta text-text-3 no-underline hover:text-text-2 hover:underline">
        Providers and keys are in Settings › AI access
      </Link>
    </>
  );

  let main = null;
  if (o) {
    if (waitingPage) main = <WaitingView />;
    else if (roomId) main = o.rooms.some((r) => r.id === roomId) ? <RoomView key={roomId} roomId={roomId} overview={o} /> : <Notice tone="red">This room does not exist any more.</Notice>;
    else if (agentId) main = agent ? <AgentView key={agentId} agent={agent} tab={tab === 'settings' || tab === 'work' ? tab : 'chat'} overview={o} /> : <Notice tone="red">This agent does not exist any more.</Notice>;
    else
      main = (
        <EmptyState
          action={
            o.canManage ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                New agent
              </Button>
            ) : undefined
          }
        >
          Agents work beside your team: they check playlists, fill gaps, book campaigns and hand work to each other. Every change they prepare waits for a person.
        </EmptyState>
      );
  }

  return (
    <>
      <PageHeader title="Agents" description="Your team of agents: give them work in a room or in their own chat. Every change waits for a person." />
      <EditorLayout
        leftLabel="Rooms and agents"
        left={side ?? <span />}
        main={
          <>
            {overview.error && <Notice tone="red">{errorText(overview.error)}</Notice>}
            {blocked && <Notice tone={blocked.tone}>{blocked.text}</Notice>}
            {main}
          </>
        }
      />
      {creating && o && <NewAgentDialog overview={o} onClose={() => setCreating(false)} />}
      {newRoom && <RoomDialog onClose={() => setNewRoom(false)} />}
    </>
  );
}
