// New room, or its name and description.

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import type { AgentRoom } from '@/lib/types';
import { Button, Dialog, Notice, TextField, useToast } from '@/ui';

export function RoomDialog({ room, onClose }: { room?: AgentRoom; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(room?.name ?? '');
  const [description, setDescription] = useState(room?.description ?? '');
  const save = useMutation({
    mutationFn: () => (room ? api<AgentRoom>('PUT', `/agents/rooms/${room.id}`, { name, description }) : api<AgentRoom>('POST', '/agents/rooms', { name, description })),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      toast(room ? 'Room saved' : `#${r.name} made`);
      onClose();
      if (!room) navigate(`/agents/rooms/${r.id}`);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={room ? `#${room.name}` : 'New room'}
      description="A room is a conversation of people and agents, for one kind of work."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            {room ? 'Save' : 'Make room'}
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="playlist-checks" autoFocus maxLength={60} />
      <TextField label="What it is for" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the checks find, and who fixes it" maxLength={500} />
      {save.error && <Notice tone="red">{errorText(save.error)}</Notice>}
    </Dialog>
  );
}
