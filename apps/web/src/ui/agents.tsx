// Agents (decision 0024; mockups AgentTeam / AgentProfile): an agent's mark, the side list of rooms
// and agents, messages of people and agents, change and skill cards, and the message box.

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { IconButton } from './Button';
import { cx } from './cx';
import { Icon } from './icons';

// ---------------------------------------------------------------- marks

const MARK_BG: Record<string, string> = { m1: 'bg-agent-1', m2: 'bg-agent-2', m3: 'bg-agent-3', m4: 'bg-agent-4', m5: 'bg-agent-5' };
export const AGENT_COLORS = ['m1', 'm2', 'm3', 'm4', 'm5'] as const;

/** idle (green), working (accent), waiting for a person (amber), off (grey). */
export type AgentState = 'idle' | 'working' | 'waiting' | 'off';
const STATE_DOT: Record<AgentState, string> = { idle: 'bg-green', working: 'bg-accent', waiting: 'bg-amber', off: 'bg-border-strong' };

const MARK_SIZE = {
  sm: 'size-6 rounded-[6px] text-[10.5px]',
  md: 'size-8 rounded-item text-[12.5px]',
  lg: 'size-11 rounded-card text-[15px]',
} as const;

/** An agent's two letters on its colour, with an optional state dot. */
export function AgentMark({ mark, color, size = 'md', state }: { mark: string; color: string; size?: keyof typeof MARK_SIZE; state?: AgentState }) {
  return (
    <span aria-hidden="true" className={cx('relative inline-flex shrink-0 items-center justify-center font-semibold text-white', MARK_SIZE[size], MARK_BG[color] ?? 'bg-agent-1')}>
      {mark}
      {state && <span className={cx('absolute -bottom-1 -right-1 size-[9px] rounded-full ring-2 ring-surface', STATE_DOT[state])} />}
    </span>
  );
}

/** The colour of an agent's mark: its letters on each of the five colours. */
export function MarkColorPicker({ mark, value, onChange, disabled }: { mark: string; value: string; onChange: (c: string) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Colour of its mark" className="flex gap-1.5">
      {AGENT_COLORS.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={`Colour ${i + 1}`}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={cx('cursor-pointer rounded-[10px] border-2 bg-transparent p-0.5 disabled:cursor-default', c === value ? 'border-accent' : 'border-transparent')}
        >
          <AgentMark mark={mark || '··'} color={c} />
        </button>
      ))}
    </div>
  );
}

/** A row of the side list (a room, an agent, "Waiting for you"): something before it, a title, a quiet line, a count. */
export function NavRow({ to, lead, title, meta, count, current, dot }: { to: string; lead?: ReactNode; title: string; meta?: string; count?: number; current?: boolean; dot?: boolean }) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={cx('hov flex min-h-8 items-center gap-2.5 rounded-item px-2.5 py-1.5 no-underline', current ? 'bg-accent-soft text-accent-text' : 'text-text')}
    >
      {lead}
      <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
        <span className={cx('truncate', current && 'font-semibold')}>{title}</span>
        {meta && <span className="truncate text-meta text-text-3">{meta}</span>}
      </span>
      {dot && <span aria-label="New messages" className="size-[7px] shrink-0 rounded-full bg-accent" />}
      {count !== undefined && count > 0 && <span className="mono rounded-[9px] bg-amber-soft px-1.5 text-tiny font-semibold text-amber-text">{count}</span>}
    </Link>
  );
}

// ---------------------------------------------------------------- messages

/** Text with its @mentions of agents in the accent colour; line breaks kept. */
export function MentionText({ text, names }: { text: string; names: string[] }) {
  const sorted = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!sorted.length) return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</span>;
  const parts = text.split(new RegExp(`(@(?:${sorted.join('|')}))`, 'giu'));
  return (
    <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="font-medium text-accent-text">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </span>
  );
}

/** One message: who (a mark or a person's initials), "agent" for an agent, the time; then what it says. */
export function MessageItem({ lead, name, agent, time, note, children }: { lead: ReactNode; name: string; agent?: boolean; time: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      {lead}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 leading-[1.3]">
          <span className="font-semibold">{name}</span>
          {agent && <span className="rounded-badge bg-surface-2 px-1.5 text-tiny font-medium text-text-3">agent</span>}
          <span className="mono text-meta text-text-3">{time}</span>
          {note && <span className="text-meta text-text-3">· {note}</span>}
        </span>
        {children}
      </div>
    </div>
  );
}

/** A short line inside a conversation: something remembered, a problem, a hand-off. */
export function MessageLine({ tone = 'neutral', icon, children }: { tone?: 'neutral' | 'red' | 'green'; icon?: 'check' | 'alert'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'flex items-start gap-1.5 self-start rounded-item px-2.5 py-1.5 text-[12.5px]',
        tone === 'neutral' && 'bg-surface-2 text-text-2',
        tone === 'red' && 'bg-red-soft text-red-text',
        tone === 'green' && 'bg-green-soft text-green-text',
      )}
    >
      {icon && <Icon name={icon} size={13} className="mt-[3px] shrink-0" />}
      <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{children}</span>
    </span>
  );
}

/** waiting · applying · approved · rejected · failed · undone */
export type ChangeState = 'waiting' | 'applying' | 'approved' | 'rejected' | 'failed' | 'undone';
const CHANGE_LOOK: Record<ChangeState, { label: string; line: string; text: string }> = {
  waiting: { label: 'Waiting for a person', line: 'border-l-amber', text: 'text-amber-text' },
  applying: { label: 'Applying…', line: 'border-l-accent', text: 'text-accent-text' },
  approved: { label: 'Approved · applied', line: 'border-l-green', text: 'text-green-text' },
  rejected: { label: 'Rejected', line: 'border-l-border-strong', text: 'text-text-3' },
  failed: { label: 'Could not be applied', line: 'border-l-red', text: 'text-red-text' },
  undone: { label: 'Undone', line: 'border-l-border-strong', text: 'text-text-3' },
};

/**
 * A change an agent prepared: its state, what and where; the preview (folded) and, once decided,
 * who decided and what applying answered; the actions while it waits.
 */
export function ChangeCard({
  state,
  title,
  detail,
  decided,
  preview,
  result,
  actions,
  then,
  toAir,
}: {
  state: ChangeState;
  title: string;
  detail?: string;
  decided?: string;
  preview: string;
  result?: string | null;
  actions?: ReactNode;
  /** What the agent does next once it is applied. */
  then?: string | null;
  /** It puts a day on air: approved twice. */
  toAir?: boolean;
}) {
  const look = CHANGE_LOOK[state];
  return (
    <div className={cx('flex flex-col gap-2 self-stretch rounded-item border border-l-[3px] border-border bg-surface px-3 py-2.5', look.line)}>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className={cx('text-meta font-semibold', look.text)}>{look.label}</span>
        {decided && <span className="text-meta text-text-3">{decided}</span>}
      </span>
      <span className="flex flex-col leading-[1.35]">
        <span className="font-medium">{title}</span>
        {detail && <span className="text-[12.5px] text-text-2 [overflow-wrap:anywhere]">{detail}</span>}
      </span>
      {toAir && state === 'waiting' && (
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-amber-text">
          <Icon name="alert" size={13} />
          Puts the day on air: you approve it twice.
        </span>
      )}
      {then && (
        <span className="text-[12.5px] text-text-2">
          <span className="text-text-3">Then it goes on: </span>
          {then}
        </span>
      )}
      <details className="group text-[12.5px]">
        <summary className="cursor-pointer list-none text-text-3 hover:text-text-2 [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-1">
            <Icon name="chevronRight" size={13} className="transition-transform group-open:rotate-90" />
            The preview
          </span>
        </summary>
        <pre className="mono m-0 mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap rounded-ctl bg-surface-2 p-2.5 text-meta text-text-2">{preview}</pre>
      </details>
      {result && <pre className="mono m-0 max-h-48 overflow-auto whitespace-pre-wrap rounded-ctl bg-surface-2 p-2.5 text-meta text-text-2">{result}</pre>}
      {actions && <span className="flex flex-wrap gap-2">{actions}</span>}
    </div>
  );
}

/** A skill change an agent proposes: the new skill, its new lines marked; the choice while it waits. */
export function SkillCard({ status, why, before, after, decided, actions }: { status: string; why: string; before: string; after: string; decided?: string; actions?: ReactNode }) {
  const old = new Set(before.split('\n').map((l) => l.trim()));
  const label = { waiting: 'Skill change · waiting for you', saved: 'Saved to its skill', once: 'Only this time', dismissed: 'Dismissed' }[status] ?? status;
  return (
    <div className={cx('flex flex-col gap-2 self-stretch rounded-item border border-l-[3px] border-border bg-surface px-3 py-2.5', status === 'waiting' ? 'border-l-amber' : status === 'saved' ? 'border-l-green' : 'border-l-border-strong')}>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className={cx('text-meta font-semibold', status === 'waiting' ? 'text-amber-text' : status === 'saved' ? 'text-green-text' : 'text-text-3')}>{label}</span>
        {decided && <span className="text-meta text-text-3">{decided}</span>}
      </span>
      <span className="text-[12.5px] text-text-2">{why}</span>
      <div className="mono flex flex-col rounded-ctl bg-surface-2 py-1.5 text-meta">
        {after.split('\n').map((line, i) => {
          const added = !!line.trim() && !old.has(line.trim());
          return (
            <span key={i} className={cx('whitespace-pre-wrap px-2.5 [overflow-wrap:anywhere]', added ? 'bg-green-soft text-green-text' : 'text-text-2')}>
              {added ? '+ ' : '  '}
              {line || ' '}
            </span>
          );
        })}
      </div>
      {actions && <span className="flex flex-wrap gap-2">{actions}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- the box

/** The message box: Enter sends, Shift+Enter starts a new line; it grows to six lines. */
export function MessageBox({ value, onChange, onSend, label, placeholder, busy, hint }: { value: string; onChange: (v: string) => void; onSend: () => void; label: string; placeholder: string; busy?: boolean; hint?: ReactNode }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 6 * 21 + 16)}px`;
  }, [value]);
  const send = () => {
    if (value.trim() && !busy) onSend();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2 rounded-card border border-border-strong bg-surface p-1.5 pl-3 focus-within:border-accent">
        <textarea
          ref={ref}
          rows={1}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="min-h-[21px] flex-1 resize-none border-0 bg-transparent py-1.5 text-body leading-[21px] text-text outline-none placeholder:text-text-3"
        />
        <button
          type="button"
          aria-label="Send"
          title="Send (Enter)"
          onClick={send}
          disabled={!value.trim() || busy}
          className="ctl inline-flex size-ctl shrink-0 cursor-pointer items-center justify-center rounded-ctl border-0 bg-accent p-0 text-on-accent hover:not-disabled:bg-accent-hover disabled:cursor-default disabled:opacity-40"
        >
          <Icon name="send" size={16} strokeWidth={2} />
        </button>
      </div>
      {hint && <span className="text-meta text-text-3">{hint}</span>}
    </div>
  );
}

/** "Media fixer is working…" while runs are going, with a Stop for each. */
export function WorkingLine({ children, onStop, stopLabel }: { children: ReactNode; onStop?: () => void; stopLabel?: string }) {
  return (
    <span className="flex items-center gap-2 text-[12.5px] text-text-2">
      <span className="size-[7px] shrink-0 animate-pulse rounded-full bg-accent" />
      {children}
      {onStop && <IconButton icon="stop" label={stopLabel ?? 'Stop'} size="xs" tone="quiet" onClick={onStop} />}
    </span>
  );
}

/**
 * A panel docked on the right under the top bar (the agent of a page): on wide screens the page
 * makes room for it, on narrow ones it lies over the page. Escape does not close it (a box inside).
 */
export function SideSheet({ label, title, onClose, children }: { label: string; title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add('with-sheet');
    return () => document.body.classList.remove('with-sheet');
  }, []);
  return (
    <aside aria-label={label} className="no-print fixed bottom-0 right-0 top-[52px] z-30 flex w-[400px] max-w-full flex-col border-l border-border bg-surface shadow-pop">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline pl-4 pr-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold">{title}</span>
        <IconButton icon="close" label={`Close ${label}`} onClick={onClose} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}

