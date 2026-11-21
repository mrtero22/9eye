// New contract: the client, a name (Aurora Media names a contract after its client), dates, channels and
// currency. Opens the contract after it is made.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { Channel, Client } from '@/lib/types';
import { Button, ChipsField, Dialog, Notice, SelectField, StartEndPicker, TextField } from '@/ui';
import { CURRENCIES } from './model';

export function NewContractDialog({ open, onOpenChange, clients, channels }: { open: boolean; onOpenChange: (o: boolean) => void; clients: Client[]; channels: Channel[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = channels[0]?.today ?? new Date().toISOString().slice(0, 10);
  const weekStart = channels[0]?.weekStart ?? 6;
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);
  const [dates, setDates] = useState({ start: today, end: today });
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    if (!open) return;
    setClientId('');
    setName('');
    setNamed(false);
    setDates({ start: today, end: today });
    setChannelIds([]);
    setCurrency('USD');
    setError(null);
  }, [open, today]);
  const client = clients.find((c) => c.id === clientId);
  const shownName = named ? name : (client?.name ?? '');
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('POST', '/commercials/contracts', { clientId, name: shownName, startDate: dates.start, endDate: dates.end, currency, totalAgreed: 0, notes: '', channelIds }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: keys.contracts() });
      qc.invalidateQueries({ queryKey: keys.clients() });
      onOpenChange(false);
      navigate(`/orders/contracts/${id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e : new ApiError(0, errorText(e), [])),
  });
  const ready = !!clientId && !!shownName.trim() && channelIds.length > 0 && !create.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New deal"
      description="One campaign of a client: its channels, dates and currency. Its campaigns, one per channel, come next."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} onClick={() => create.mutate()}>
            Create deal
          </Button>
        </>
      }
    >
      <SelectField label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} hint={clients.length ? undefined : 'Add the client first, on the Clients tab.'}>
        <option value="">Choose…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Name"
        value={shownName}
        hint="Usually the client's name."
        onChange={(e) => {
          setNamed(true);
          setName(e.target.value);
        }}
      />
      <StartEndPicker label="Dates" weekStart={weekStart} today={today} start={dates.start} end={dates.end} onChange={setDates} />
      <ChipsField label="Channels" values={channelIds} options={channels.map((c) => ({ value: c.id, label: c.name }))} onChange={setChannelIds} />
      <SelectField label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
        {CURRENCIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </SelectField>
      {error && (
        <Notice tone="red">
          <span className="font-medium">{error.message}</span>
          {error.problems.length > 1 && (
            <ul className="m-0 flex flex-col gap-1 pl-4">
              {error.problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
    </Dialog>
  );
}
