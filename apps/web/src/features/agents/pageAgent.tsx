// The agent in a page (decision 0024, phase B; mockup PlaylistAgent.dc.html): the Agent button in
// the header of Scheduling, Playlist, Ads, Media and Layouts opens the panel of the agents that work
// on that part. The agent sees what the page shows (each page says it with useAgentPage), the
// person's chat with it goes on there, its change cards can be approved there — and a change of the
// day on screen can be previewed on the Day grid. After an approval: "Make it a routine".

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { AgentChange, AgentRoutine, AgentThread, PartKey } from '@/lib/types';
import { AgentMark, Button, EmptyState, HeaderExtra, Notice, SelectField, SideSheet, TextField, useToast } from '@/ui';
import { useAgentsOverview } from './AgentsPage';
import { Conversation, pollWhileRunning, useThreadUpdate } from './Conversation';
import { useOverviewWhenDone } from './RoomView';

const PART_OF_PATH: [string, PartKey, string][] = [
  ['/playlist', 'playlist', 'Playlist'],
  ['/scheduling', 'scheduling', 'Scheduling'],
  ['/orders', 'ads', 'Ads'],
  ['/catalog', 'media', 'Media'],
  ['/templates', 'layouts', 'Layouts'],
];

const QUICK: Record<PartKey, string[]> = {
  playlist: ['What is wrong with this day?', 'Fill this day', 'Check tomorrow'],
  scheduling: ['What is planned this week?', 'Which blocks have no programme?'],
  ads: ['Which campaigns are not booked yet?', 'Is anything over-booked?'],
  media: ['Which items have no length?', 'Find the newest episodes'],
  layouts: ['Describe this layout', 'Which blocks have no break?'],
};

/** What a page shows, for its agent; `previewKey` names the day on screen (Playlist › Day). */
export interface AgentPageInfo {
  name: string;
  sees: string;
  previewKey?: string;
}

interface Ctx {
  setInfo: (i: AgentPageInfo | null) => void;
}
const PageCtx = createContext<Ctx>({ setInfo: () => {} });

/** A page says what it shows; the agent panel passes it with each message. */
export function useAgentPage(info: AgentPageInfo | null) {
  const { setInfo } = useContext(PageCtx);
  const name = info?.name;
  const sees = info?.sees;
  const previewKey = info?.previewKey;
  useEffect(() => {
    setInfo(name && sees ? { name, sees, previewKey } : null);
    return () => setInfo(null);
  }, [name, sees, previewKey, setInfo]);
}

/** The key of the day a change fills (matches a page's previewKey). */
export const dayKey = (channelId: string, kind: string, date: string) => `day:${channelId}:${kind}:${date}`;
const keyOfChange = (c: AgentChange) =>
  (c.tool === 'fill_day' || c.tool === 'edit_day') && c.target?.kind === 'day' && c.target.date ? dayKey(c.target.channelId, c.target.playlist, c.target.date) : null;

// ---------------------------------------------------------------- the preview on the page

let previewed: AgentChange | null = null;
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((w) => w());

/** The change shown on the page now (the Day tab reads it). */
export function useAgentPreview(): [AgentChange | null, (c: AgentChange | null) => void] {
  const c = useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    () => previewed,
  );
  return [c, setPreviewed];
}
function setPreviewed(c: AgentChange | null) {
  previewed = c;
  tell();
}

// ---------------------------------------------------------------- the button and the panel

const OPEN_KEY = '9eye.agent-panel';
const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
};

/** In the app shell: the Agent button in every page header of the five parts, and its panel. */
export function AgentPageProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const part = PART_OF_PATH.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  const [open, setOpen] = useState(readOpen);
  const [info, setInfo] = useState<AgentPageInfo | null>(null);
  const toggle = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? '1' : '0');
    } catch {
      /* stays for this page */
    }
  };
  const ctx = useMemo(() => ({ setInfo }), []);
  const button = part ? (
    <Button icon="agents" aria-pressed={open} onClick={() => toggle(!open)} title={open ? 'Close the agent panel' : `The agents of ${part[2]}`}>
      Agent
    </Button>
  ) : null;
  return (
    <PageCtx.Provider value={ctx}>
      <HeaderExtra.Provider value={button}>
        {children}
        {part && open && <AgentSheet part={part[1]} partLabel={part[2]} info={info} onClose={() => toggle(false)} />}
      </HeaderExtra.Provider>
    </PageCtx.Provider>
  );
}

const pickKey = (part: string) => `9eye.agent-of.${part}`;

function AgentSheet({ part, partLabel, info, onClose }: { part: PartKey; partLabel: string; info: AgentPageInfo | null; onClose: () => void }) {
  const overview = useAgentsOverview();
  const o = overview.data;
  const agents = (o?.agents ?? []).filter((a) => a.enabled && a.parts[part]);
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem(pickKey(part));
    } catch {
      return null;
    }
  });
  const agent = agents.find((a) => a.id === picked) ?? agents[0];
  const pick = (id: string) => {
    setPicked(id);
    try {
      localStorage.setItem(pickKey(part), id);
    } catch {
      /* stays for this page */
    }
  };

  return (
    <SideSheet
      label="Agent panel"
      title={agent ? (
        <>
          <AgentMark mark={agent.mark} color={agent.color} size="sm" />
          <span className="truncate">{agent.name}</span>
        </>
      ) : (
        'Agent'
      )}
      onClose={onClose}
    >
      {overview.error && <Notice tone="red">{errorText(overview.error)}</Notice>}
      {o && !agents.length && (
        <EmptyState action={<Link to="/agents" className="text-small font-medium text-accent-text no-underline hover:underline">Open Agents</Link>}>
          No agent works on {partLabel} yet. {o.canManage ? 'Add one from the gallery, and give it this part.' : 'Someone who can change Settings adds one.'}
        </EmptyState>
      )}
      {o && agent && (
        <>
          {agents.length > 1 && (
            <SelectField label="Agent" inline value={agent.id} onChange={(e) => pick(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </SelectField>
          )}
          <span className="flex flex-wrap items-baseline gap-x-2 text-meta text-text-3">
            <span>{agent.parts[part] === 'edit' ? 'Reads and prepares changes' : 'Reads'} · acts as {agent.role.name}</span>
            <Link to={`/agents/${agent.id}`} className="text-accent-text no-underline hover:underline">
              Its page
            </Link>
          </span>
          <span className="rounded-item bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-text-2">
            Sees this page: <span className="font-medium text-text">{info?.sees ?? `the ${partLabel} page`}</span>
          </span>
          <PanelChat key={agent.id} agentId={agent.id} agentName={agent.name} part={part} info={info} partLabel={partLabel} canManage={o.canManage} names={o.agents.map((a) => a.name)} />
        </>
      )}
    </SideSheet>
  );
}

function PanelChat({ agentId, agentName, part, partLabel, info, canManage, names }: { agentId: string; agentName: string; part: PartKey; partLabel: string; info: AgentPageInfo | null; canManage: boolean; names: string[] }) {
  const update = useThreadUpdate();
  const key = keys.agentChat(agentId);
  const chat = useQuery({ queryKey: key, queryFn: () => api<AgentThread>('GET', `/agents/${agentId}/chat`), refetchInterval: pollWhileRunning });
  useOverviewWhenDone(chat.data?.running.length ?? 0);
  const [shown, setShown] = useAgentPreview();
  const page = { name: info?.name ?? partLabel, sees: info?.sees ?? `the ${partLabel} page` };

  // the last approved change, and the person's request before it: "Make it a routine"
  const messages = chat.data?.messages ?? [];
  const lastApproved = [...messages].reverse().find((m) => m.change?.status === 'approved');
  const request = lastApproved ? [...messages.slice(0, messages.indexOf(lastApproved))].reverse().find((m) => m.author.kind === 'person')?.text : undefined;

  return (
    <>
      {chat.error && <Notice tone="red">{errorText(chat.error)}</Notice>}
      <Conversation
        variant="panel"
        thread={chat.data}
        names={names}
        canManage={canManage}
        empty={`Ask ${agentName} about what this page shows. Every change it prepares waits for you.`}
        changeAction={(c) =>
          info?.previewKey && keyOfChange(c) === info.previewKey ? (
            <Button size="sm" variant="secondary" aria-pressed={shown?.id === c.id} onClick={() => setShown(shown?.id === c.id ? null : c)}>
              {shown?.id === c.id ? 'On the page' : 'Preview on the page'}
            </Button>
          ) : null
        }
        box={{
          label: `Ask ${agentName}`,
          placeholder: `Ask ${agentName}…`,
          hint: 'Every change waits for you; approving a day for air asks twice.',
          quick: QUICK[part],
          onSend: async (text) => update(key, await api<AgentThread>('POST', `/agents/${agentId}/chat`, { text, page })),
        }}
      />
      {lastApproved && request && <MakeRoutine key={lastApproved.id} agentId={agentId} agentName={agentName} request={request} />}
    </>
  );
}

const EVERY_DAY = [true, true, true, true, true, true, true];
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** After an approved change: do the same every day at a time, as a routine of this person. */
function MakeRoutine({ agentId, agentName, request }: { agentId: string; agentName: string; request: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [time, setTime] = useState('19:00');
  const [made, setMade] = useState<AgentRoutine | null>(null);
  const make = useMutation({
    mutationFn: () =>
      api<AgentRoutine>('POST', `/agents/${agentId}/routines`, {
        name: request.length > 60 ? `${request.slice(0, 57)}…` : request, kind: 'time', time, weekdays: EVERY_DAY, timeZone: browserZone(), request, roomId: null,
      }),
    onSuccess: (r) => {
      setMade(r);
      qc.invalidateQueries({ queryKey: ['agents'] });
      toast('Routine made');
    },
  });
  if (made) {
    return (
      <Notice tone="green">
        Routine made: every day at {made.time} ({made.timeZone}). {agentName} answers in your chat; its changes wait for you.
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-item border border-border p-3">
      <span className="text-[12.5px] text-text-2">Do this every day?</span>
      <div className="flex items-end gap-2">
        <TextField label="Every day at" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" mono />
        <Button size="md" onClick={() => make.mutate()} disabled={!time || make.isPending}>
          Make it a routine
        </Button>
      </div>
      {make.error && <Notice tone="red">{errorText(make.error)}</Notice>}
    </div>
  );
}
