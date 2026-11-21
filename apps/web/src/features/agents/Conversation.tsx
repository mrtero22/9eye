// A conversation of people and agents (a room, or one person's chat with an agent): messages grouped
// by author, change cards to approve / reject / undo, skill cards, what is being worked on now, and
// the message box. Polls while an agent works.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { AgentChange, AgentMessage, AgentThread } from '@/lib/types';
import { AgentMark, Avatar, Button, ChangeCard, EmptyState, MentionText, MessageBox, MessageItem, MessageLine, SkillCard, WorkingLine, useToast } from '@/ui';
import { messageTime } from './agentWords';
import { useDecide } from './useDecide';

/** Messages of one author within five minutes share one header. */
function groups(messages: AgentMessage[]): AgentMessage[][] {
  const out: AgentMessage[][] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    const same =
      prev && prev.author.kind === m.author.kind && prev.author.id === m.author.id && prev.routine === m.routine && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
    if (same) last.push(m);
    else out.push([m]);
  }
  return out;
}

const firstLine = (s: string) => s.split('\n')[0];

export function Conversation({
  thread,
  names,
  canManage,
  empty,
  box,
  variant = 'page',
  changeAction,
}: {
  thread: AgentThread | undefined;
  /** Agent names, for the @mentions. */
  names: string[];
  canManage: boolean;
  empty: string;
  box: {
    label: string;
    placeholder: string;
    hint: string;
    onSend: (text: string) => Promise<unknown>;
    suggest?: { name: string; mark: string; color: string }[];
    /** Short requests offered while the box is empty. */
    quick?: string[];
  };
  /** page: a bordered conversation on a page; panel: fills the agent panel of a page. */
  variant?: 'page' | 'panel';
  /** Something more on a change card (the agent panel: "Preview on the page"). */
  changeAction?: (c: AgentChange) => ReactNode;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const messages = thread?.messages ?? [];
  const count = messages.length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count, thread?.running.length]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['agents'] });
  const send = useMutation({
    mutationFn: (t: string) => box.onSend(t),
    onSuccess: () => setText(''),
    onError: (e) => toast(errorText(e), 'red'),
  });
  const { decide, busyId, dialog } = useDecide();
  const skill = useMutation({
    mutationFn: ({ id, choice }: { id: string; choice: 'save' | 'once' | 'dismiss' }) => api('POST', `/agents/messages/${id}/skill`, { choice }),
    onSuccess: (_r, { choice }) => {
      toast(choice === 'save' ? 'Saved to its skill' : choice === 'once' ? 'Only in this conversation' : 'Dismissed');
      refresh();
    },
    onError: (e) => toast(errorText(e), 'red'),
  });
  const stop = useMutation({
    mutationFn: (runId: string) => api('POST', `/agents/runs/${runId}/stop`),
    onSuccess: () => toast('Stopping…'),
    onError: (e) => toast(errorText(e), 'red'),
  });

  const mention = /(?:^|\s)@([^@\n]{0,30})$/.exec(text);
  const suggestions = useMemo(() => {
    if (!mention || !box.suggest) return [];
    const q = mention[1].toLowerCase();
    return box.suggest.filter((a) => a.name.toLowerCase().startsWith(q) && a.name.toLowerCase() !== q).slice(0, 6);
  }, [mention, box.suggest]);

  const body = (m: AgentMessage) => {
    switch (m.kind) {
      case 'memory':
        return (
          <MessageLine key={m.id} icon="check">
            Saved to its memory: “{m.text}”
          </MessageLine>
        );
      case 'error':
        return (
          <MessageLine key={m.id} tone="red" icon="alert">
            {m.text}
          </MessageLine>
        );
      case 'change': {
        const c = m.change;
        if (!c) return <MessageLine key={m.id}>{m.text}</MessageLine>;
        const busy = busyId === c.id;
        return (
          <ChangeCard
            key={m.id}
            state={c.status}
            title={c.title}
            detail={firstLine(c.preview)}
            decided={c.decidedBy ? `${c.decidedBy}${c.decidedAt ? ` · ${messageTime(c.decidedAt)}` : ''}` : undefined}
            preview={c.preview}
            then={c.then}
            toAir={c.toAir}
            result={c.status === 'waiting' ? null : c.result}
            actions={
              c.status === 'waiting' ? (
                c.canDecide ? (
                  <>
                    {changeAction?.(c)}
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
        );
      }
      case 'skill': {
        const s = m.skill!;
        const busy = skill.isPending && skill.variables?.id === m.id;
        return (
          <SkillCard
            key={m.id}
            status={s.status}
            why={m.text}
            before={s.before}
            after={s.skill}
            decided={s.decidedBy ?? undefined}
            actions={
              s.status === 'waiting' ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || !canManage}
                    title={canManage ? undefined : 'Only someone who can change Settings saves a skill.'}
                    onClick={() => skill.mutate({ id: m.id, choice: 'save' })}
                  >
                    Save to its skill
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => skill.mutate({ id: m.id, choice: 'once' })}>
                    Only this time
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => skill.mutate({ id: m.id, choice: 'dismiss' })}>
                    Dismiss
                  </Button>
                </>
              ) : undefined
            }
          />
        );
      }
      default:
        return (
          <span key={m.id} className="leading-[1.55]">
            <MentionText text={m.text} names={names} />
          </span>
        );
    }
  };

  return (
    <div className={variant === 'panel' ? 'flex min-h-0 flex-1 flex-col gap-3' : 'flex min-h-0 flex-col gap-3'}>
      <div
        className={
          variant === 'panel'
            ? 'flex min-h-[160px] flex-1 flex-col gap-4 overflow-y-auto'
            : 'flex max-h-[calc(100vh-300px)] min-h-[320px] flex-col gap-5 overflow-y-auto rounded-panel border border-border bg-surface px-4 py-4 sm:px-5'
        }
      >
        {thread && !messages.length && <EmptyState>{empty}</EmptyState>}
        {groups(messages).map((g) => {
          const a = g[0].author;
          return (
            <MessageItem
              key={g[0].id}
              lead={a.kind === 'agent' ? <AgentMark mark={a.mark} color={a.color} /> : <Avatar name={a.name} />}
              name={a.name}
              agent={a.kind === 'agent'}
              time={messageTime(g[0].createdAt)}
              note={g[0].routine ? `routine “${g[0].routine}”` : undefined}
            >
              {g.map(body)}
            </MessageItem>
          );
        })}
        {(thread?.running ?? []).map((r) => (
          <WorkingLine key={r.id} onStop={() => stop.mutate(r.id)} stopLabel={`Stop ${r.agent.name}`}>
            <span>
              <span className="font-medium">{r.agent.name}</span> is working…
            </span>
          </WorkingLine>
        ))}
        <div ref={end} />
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Agents to mention">
          {suggestions.map((s) => (
            <Button
              key={s.name}
              size="xs"
              variant="secondary"
              onClick={() => setText(text.replace(/@([^@\n]{0,30})$/, `@${s.name} `))}
            >
              <AgentMark mark={s.mark} color={s.color} size="sm" />
              {s.name}
            </Button>
          ))}
        </div>
      )}
      {box.quick && !text && (
        <div className="flex flex-wrap gap-1.5" aria-label="Quick requests">
          {box.quick.map((q) => (
            <Button key={q} size="xs" variant="secondary" onClick={() => setText(q)}>
              {q}
            </Button>
          ))}
        </div>
      )}
      {dialog}
      <MessageBox value={text} onChange={setText} onSend={() => send.mutate(text.trim())} label={box.label} placeholder={box.placeholder} busy={send.isPending} hint={box.hint} />
    </div>
  );
}

/** Refetch a conversation every second and a half while an agent works on it. */
export const pollWhileRunning = (q: { state: { data: AgentThread | undefined } }) => (q.state.data?.running.length ? 1500 : false);

/** Put a thread the server answered with into the cache, and refresh the overview (counts, states). */
export function useThreadUpdate() {
  const qc = useQueryClient();
  return (key: readonly unknown[], thread: AgentThread) => {
    qc.setQueryData(key, thread);
    qc.invalidateQueries({ queryKey: keys.agents(), exact: true });
  };
}
