// A room (docs/design/agents-page.md): people and agents in one conversation; an @mentioned agent
// answers, hands work to the agents it works with, and everyone sees each step.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { AgentRoom, AgentThread, AgentsOverview } from '@/lib/types';
import { ConfirmDialog, IconButton, Menu, MenuItem, Notice, useToast } from '@/ui';
import { Conversation, pollWhileRunning, useThreadUpdate } from './Conversation';
import { RoomDialog } from './RoomDialog';

export function RoomView({ roomId, overview }: { roomId: string; overview: AgentsOverview }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const update = useThreadUpdate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const key = keys.agentRoom(roomId);
  const room = useQuery({
    queryKey: key,
    queryFn: () => api<AgentThread & { room: AgentRoom }>('GET', `/agents/rooms/${roomId}`),
    refetchInterval: pollWhileRunning,
  });
  useOverviewWhenDone(room.data?.running.length ?? 0);
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/agents/rooms/${roomId}`),
    onSuccess: () => {
      toast('Room deleted');
      qc.invalidateQueries({ queryKey: keys.agents() });
      navigate('/agents');
    },
    onError: (e) => toast(errorText(e), 'red'),
  });
  const r = room.data?.room ?? overview.rooms.find((x) => x.id === roomId);
  const agents = overview.agents.filter((a) => a.enabled);

  return (
    <>
      <div className="flex items-start gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-section font-semibold"># {r?.name ?? '…'}</span>
          <span className="text-[12.5px] text-text-3">{r?.description || 'Type @ and an agent’s name to bring it in.'}</span>
        </span>
        {overview.canManage && r && (
          <Menu label="Room" trigger={<IconButton icon="more" label="More for this room" />}>
            <MenuItem onSelect={() => setEditing(true)}>Rename or describe</MenuItem>
            <MenuItem danger onSelect={() => setDeleting(true)}>
              Delete room
            </MenuItem>
          </Menu>
        )}
      </div>
      {room.error && <Notice tone="red">{errorText(room.error)}</Notice>}
      <Conversation
        thread={room.data}
        names={overview.agents.map((a) => a.name)}
        canManage={overview.canManage}
        empty="Nothing here yet. Write to the team, and @mention an agent to give it work."
        box={{
          label: `Message #${r?.name ?? 'room'}`,
          placeholder: `Message #${r?.name ?? 'room'} — type @ to bring in an agent`,
          hint: 'Agents hand work to each other here and everyone sees each step. Every change waits for a person.',
          suggest: agents,
          onSend: async (text) => update(key, await api<AgentThread>('POST', `/agents/rooms/${roomId}/messages`, { text })),
        }}
      />
      {editing && r && <RoomDialog room={r} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete #${r?.name ?? ''}?`}
        description="Its messages are deleted with it. Changes the agents prepared here stay in Waiting for you and Work done."
        confirmLabel="Delete room"
        danger
        onConfirm={() => {
          setDeleting(false);
          remove.mutate();
        }}
      />
    </>
  );
}

/** When the last run of a conversation ends, the side list (states, counts) is read again. */
export function useOverviewWhenDone(running: number) {
  const qc = useQueryClient();
  const before = useRef(running);
  useEffect(() => {
    if (before.current > 0 && running === 0) qc.invalidateQueries({ queryKey: keys.agents(), exact: true });
    before.current = running;
  }, [running, qc]);
}
