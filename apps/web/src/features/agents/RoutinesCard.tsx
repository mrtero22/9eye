// An agent's routines (decision 0024, phase B): it starts by itself at a time on chosen weekdays,
// or when a week is created / a campaign is confirmed, and answers in a room or in the chat of the
// person who made the routine — working for that person, with their role.

import { useState } from 'react';
import { WEEKDAYS, weekOrder } from '@9eye/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, currentCompany, errorText } from '@/lib/api';
import { useChannels } from '@/lib/queries';
import type { Agent, AgentRoutine, AgentsOverview, RoutineEvent } from '@/lib/types';
import { Button, Card, Checkbox, ConfirmDialog, DayToggles, Dialog, EmptyState, IconButton, Notice, Segmented, SelectField, Switch, TextArea, TextField, useToast } from '@/ui';
import { messageTime } from './agentWords';

const EVENTS: { value: RoutineEvent; label: string }[] = [
  { value: 'week_created', label: 'A week is created' },
  { value: 'campaign_confirmed', label: 'A campaign is confirmed' },
];
const EVERY_DAY = [true, true, true, true, true, true, true];
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
const zones = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return undefined;
  }
})();

export const routinesKey = (agentId: string) => ['agents', currentCompany(), 'routines', agentId] as const;

/** "Every day at 18:00", "Mon, Wed at 09:00", "When a week is created". */
export function whenText(r: Pick<AgentRoutine, 'kind' | 'time' | 'weekdays' | 'timeZone' | 'eventLabel'>, weekStart = 1): string {
  if (r.kind === 'event') return `When ${(r.eventLabel ?? 'something happens').toLowerCase().replace(/^a /, 'a ')}`;
  const on = weekOrder(weekStart).filter((d) => r.weekdays[d]);
  const days = on.length === 7 ? 'Every day' : on.length === 5 && !r.weekdays[0] && !r.weekdays[6] ? 'Weekdays' : on.map((d) => WEEKDAYS[d].short).join(', ');
  return `${days} at ${r.time} (${r.timeZone})`;
}

export function RoutinesCard({ agent, overview }: { agent: Agent; overview: AgentsOverview }) {
  const qc = useQueryClient();
  const toast = useToast();
  const channels = useChannels();
  const list = useQuery({ queryKey: routinesKey(agent.id), queryFn: () => api<AgentRoutine[]>('GET', `/agents/${agent.id}/routines`) });
  const [editing, setEditing] = useState<AgentRoutine | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AgentRoutine | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['agents'] });
  const toggle = useMutation({
    mutationFn: (r: AgentRoutine) => api<AgentRoutine>('PUT', `/agents/routines/${r.id}`, { ...bodyOf(r), enabled: !r.enabled }),
    onSuccess: (r) => {
      refresh();
      toast(r.enabled ? `“${r.name}” is on` : `“${r.name}” is paused`);
    },
    onError: (e) => toast(errorText(e), 'red'),
  });
  const runNow = useMutation({
    mutationFn: (r: AgentRoutine) => api<{ runId: string | null }>('POST', `/agents/routines/${r.id}/run`),
    onSuccess: (x, r) => {
      refresh();
      toast(x.runId ? `“${r.name}” is running: it answers ${r.room ? `in #${r.room.name}` : 'in the chat'}` : `“${r.name}” did not run: see why ${r.room ? `in #${r.room.name}` : 'in the chat'}`);
    },
    onError: (e) => toast(errorText(e), 'red'),
  });
  const remove = useMutation({
    mutationFn: (r: AgentRoutine) => api('DELETE', `/agents/routines/${r.id}`),
    onSuccess: () => {
      refresh();
      toast('Routine deleted');
    },
    onError: (e) => toast(errorText(e), 'red'),
  });
  const chName = (id: string) => channels.data?.find((c) => c.id === id)?.name ?? 'a channel';
  const rows = list.data ?? [];

  return (
    <Card title="Routines" subtitle="It starts by itself, at a time or when something happens. A routine works for the person who made it, with their role.">
      {list.error && <Notice tone="red">{errorText(list.error)}</Notice>}
      {list.isSuccess && !rows.length && <EmptyState>No routines yet.</EmptyState>}
      {rows.map((r) => (
        <div key={r.id} className="flex flex-col gap-1.5 rounded-item bg-surface-2 px-3 py-2.5">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{r.name}</span>
            {r.canChange && <Switch checked={r.enabled} onChange={() => toggle.mutate(r)} label={`${r.name} on`} />}
          </span>
          <span className="text-[12.5px] text-text-2">
            {whenText(r)}
            {r.kind === 'event' && r.channelIds.length ? ` · on ${r.channelIds.map(chName).join(', ')}` : ''} · answers {r.room ? `in #${r.room.name}` : `in ${r.createdBy.name}’s chat`}
          </span>
          <span className="text-meta text-text-3">
            Made by {r.createdBy.name}
            {r.enabled && r.nextRunAt ? ` · next ${messageTime(r.nextRunAt)}` : ''}
            {!r.enabled ? ' · paused' : ''}
            {r.lastRunAt ? ` · last ${messageTime(r.lastRunAt)}` : ''}
          </span>
          <span className="whitespace-pre-wrap text-[12.5px] text-text-2">“{r.request}”</span>
          {r.canChange && (
            <span className="flex flex-wrap gap-1.5">
              <Button size="xs" icon="send" disabled={runNow.isPending || !agent.enabled} onClick={() => runNow.mutate(r)}>
                Run now
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setEditing(r)}>
                Change
              </Button>
              <IconButton icon="close" size="xs" tone="quiet" label={`Delete ${r.name}`} onClick={() => setDeleting(r)} />
            </span>
          )}
        </div>
      ))}
      <Button icon="plus" className="self-start" onClick={() => setEditing('new')}>
        New routine
      </Button>
      {editing && <RoutineDialog agent={agent} overview={overview} routine={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={`${agent.name} stops doing this by itself. What it did stays in Work done.`}
        confirmLabel="Delete routine"
        danger
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
          setDeleting(null);
        }}
      />
    </Card>
  );
}

const bodyOf = (r: AgentRoutine) => ({
  name: r.name, kind: r.kind, time: r.time, weekdays: r.kind === 'time' ? r.weekdays : undefined, timeZone: r.timeZone, event: r.event, channelIds: r.channelIds,
  request: r.request, roomId: r.room?.id ?? null, enabled: r.enabled,
});

function RoutineDialog({ agent, overview, routine, onClose }: { agent: Agent; overview: AgentsOverview; routine: AgentRoutine | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const channels = useChannels();
  const [name, setName] = useState(routine?.name ?? '');
  const [kind, setKind] = useState<'time' | 'event'>(routine?.kind ?? 'time');
  const [time, setTime] = useState(routine?.time ?? '18:00');
  const [weekdays, setWeekdays] = useState<boolean[]>(routine?.kind === 'time' ? routine.weekdays : EVERY_DAY);
  const [timeZone, setTimeZone] = useState(routine?.timeZone ?? browserZone());
  const [event, setEvent] = useState<RoutineEvent>(routine?.event ?? 'week_created');
  const [channelIds, setChannelIds] = useState<string[]>(routine?.channelIds ?? []);
  const [request, setRequest] = useState(routine?.request ?? '');
  const [roomId, setRoomId] = useState(routine?.room?.id ?? '');
  const weekStart = channels.data?.[0]?.weekStart ?? 1;
  const save = useMutation({
    mutationFn: () => {
      const body = { name, kind, time: kind === 'time' ? time : null, weekdays: kind === 'time' ? weekdays : undefined, timeZone, event: kind === 'event' ? event : null, channelIds: kind === 'event' ? channelIds : [], request, roomId: roomId || null, enabled: routine?.enabled ?? true };
      return routine ? api<AgentRoutine>('PUT', `/agents/routines/${routine.id}`, body) : api<AgentRoutine>('POST', `/agents/${agent.id}/routines`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      toast(routine ? 'Routine saved' : 'Routine made');
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={520}
      title={routine ? routine.name : `New routine of ${agent.name}`}
      description="It works for you, with your role: its changes wait for a person, as always."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || !request.trim() || save.isPending} onClick={() => save.mutate()}>
            {routine ? 'Save' : 'Make routine'}
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Check tomorrow" maxLength={80} autoFocus />
      <Segmented
        label="Starts"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'time', label: 'At a time' },
          { value: 'event', label: 'When something happens' },
        ]}
      />
      {kind === 'time' ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <TextField label="At" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" mono />
            <TextField label="Time zone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} suggestions={zones} className="min-w-[200px] flex-1" />
          </div>
          <span className="flex flex-col gap-1.5">
            <span className="text-small text-text-2">On</span>
            <DayToggles label="Days of the week" tone="accent" weekStart={weekStart} value={weekdays} onToggle={(d) => setWeekdays(weekdays.map((on, i) => (i === d ? !on : on)))} />
          </span>
        </>
      ) : (
        <>
          <SelectField label="When" value={event} onChange={(e) => setEvent(e.target.value as RoutineEvent)}>
            {EVENTS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </SelectField>
          <span className="flex flex-col gap-1.5">
            <span className="text-small text-text-2">On channels (none ticked: every channel)</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1.5">
              {(channels.data ?? []).map((c) => (
                <Checkbox key={c.id} checked={channelIds.includes(c.id)} onChange={(on) => setChannelIds(on ? [...channelIds, c.id] : channelIds.filter((x) => x !== c.id))}>
                  {c.name}
                </Checkbox>
              ))}
            </span>
          </span>
        </>
      )}
      <TextArea label={`What ${agent.name} does each time`} value={request} onChange={(e) => setRequest(e.target.value)} rows={4} maxLength={4000} placeholder="Check tomorrow on every channel and hand what is wrong to the agent that fixes it." />
      <SelectField label="It answers in" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
        <option value="">Your chat with {agent.name}</option>
        {overview.rooms.map((r) => (
          <option key={r.id} value={r.id}>
            #{r.name}
          </option>
        ))}
      </SelectField>
      {save.error && <Notice tone="red">{errorText(save.error)}</Notice>}
    </Dialog>
  );
}
