// Waiting for you: every change the agents prepared that waits for a person, oldest first, where it
// was asked; and what was decided lately.

import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { AgentChange } from '@/lib/types';
import { AgentMark, Avatar, Button, ChangeCard, EmptyState, MessageItem, Notice, SectionHead, Segmented } from '@/ui';
import { messageTime } from './agentWords';
import { useDecide } from './useDecide';

export function WaitingView() {
  const [show, setShow] = useState<'waiting' | 'decided'>('waiting');
  const list = useQuery({ queryKey: keys.agentChanges(show), queryFn: () => api<AgentChange[]>('GET', `/agents/changes?status=${show}`), refetchInterval: 15_000 });
  const { decide, busyId, dialog } = useDecide();
  const rows = list.data ?? [];

  return (
    <>
      <SectionHead title="Waiting for you" description="Every change an agent prepares, and every change an AI app asked first (Settings › AI access), waits here until a person approves or rejects it.">
        <Segmented
          label="Show"
          size="sm"
          value={show}
          onChange={setShow}
          options={[
            { value: 'waiting', label: 'Waiting' },
            { value: 'decided', label: 'Decided' },
          ]}
        />
      </SectionHead>
      {list.error && <Notice tone="red">{errorText(list.error)}</Notice>}
      {list.isSuccess && !rows.length && <EmptyState>{show === 'waiting' ? 'Nothing waits for a person.' : 'Nothing was decided yet.'}</EmptyState>}
      {dialog}
      <div className="flex max-w-[860px] flex-col gap-5">
        {rows.map((c) => {
          const busy = busyId === c.id;
          return (
            <MessageItem
              key={c.id}
              lead={c.from.kind === 'app' ? <Avatar name={c.from.person} /> : <AgentMark mark={c.agent.mark} color={c.agent.color} />}
              name={c.from.kind === 'app' ? c.from.person : c.agent.name}
              agent={c.from.kind === 'agent'}
              time={messageTime(c.createdAt)}
              note={c.from.kind === 'app' ? `AI app · via ${c.from.token} · asked first` : c.room ? undefined : 'in a chat'}
            >
              {c.room && (
                <Link to={`/agents/rooms/${c.room.id}`} className="self-start text-meta text-accent-text no-underline hover:underline">
                  in #{c.room.name}
                </Link>
              )}
              <ChangeCard
                state={c.status}
                title={c.title}
                detail={c.preview.split('\n')[0]}
                decided={c.decidedBy ? `${c.decidedBy}${c.decidedAt ? ` · ${messageTime(c.decidedAt)}` : ''}` : undefined}
                preview={c.preview}
                then={c.then}
                toAir={c.toAir}
                result={c.status === 'waiting' ? null : c.result}
                actions={
                  c.status === 'waiting' ? (
                    c.canDecide ? (
                      <>
                        <Button variant="primary" size="sm" icon="check" disabled={busy} onClick={() => decide(c, 'approve')}>
                          Approve
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => decide(c, 'reject')}>
                          Reject
                        </Button>
                      </>
                    ) : (
                      <span className="text-meta text-text-3">Someone who can change this decides.</span>
                    )
                  ) : c.canUndo ? (
                    <Button variant="ghost" size="sm" icon="undo" disabled={busy} onClick={() => decide(c, 'undo')}>
                      Undo
                    </Button>
                  ) : undefined
                }
              />
            </MessageItem>
          );
        })}
      </div>
    </>
  );
}
