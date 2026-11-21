// Orders → Clients: advertisers and agencies (spec commercials §2). A list on the left, the chosen
// client's form in a side panel; a client with contracts cannot be deleted.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { Client } from '@/lib/types';
import { Button, EmptyState, Notice, NumberField, SearchField, SelectField, SidePanel, SwitchRow, Table, TableRow, TextArea, TextField, useToast } from '@/ui';
import { CLIENT_TYPE_LABEL } from './model';

type Form = Omit<Client, 'id' | 'contracts' | 'version'>;
const EMPTY: Form = { name: '', type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null };
const formOf = (c: Client): Form => ({
  name: c.name, type: c.type, country: c.country, address: c.address, billingAddress: c.billingAddress, web: c.web, email: c.email, phone: c.phone, fax: c.fax,
  vatNumber: c.vatNumber, notes: c.notes, toleranceSeconds: c.toleranceSeconds,
});

/** `open`: a client id, "new", or null (no panel). */
export function ClientsTab({ clients, open, onOpen }: { clients: Client[]; open: string | null; onOpen: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? clients.filter((c) => c.name.toLowerCase().includes(s) || c.country.toLowerCase().includes(s)) : clients;
  }, [clients, q]);
  const current = open === 'new' ? null : (clients.find((c) => c.id === open) ?? null);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-3">
        <div className="w-[300px] max-w-full">
          <SearchField label="Find a client" placeholder="Find a client or country" value={q} onChange={setQ} />
        </div>
        {clients.length === 0 ? (
          <EmptyState action={<Button icon="plus" onClick={() => onOpen('new')}>New client</Button>}>No clients yet. A client is an advertiser or an agency that books spots.</EmptyState>
        ) : (
          <Table columns="minmax(200px, 1fr) 170px 140px 90px" head={['Client', 'Type', 'Country', 'Deals']} minWidth={600}>
            {shown.map((c) => (
              <TableRow key={c.id} label={`Open ${c.name}`} onClick={() => onOpen(c.id === open ? null : c.id)}>
                <span className={c.id === open ? 'font-semibold text-accent-text' : 'font-medium'}>{c.name}</span>
                <span className="text-text-2">{CLIENT_TYPE_LABEL[c.type]}</span>
                <span className="text-text-2">{c.country || '—'}</span>
                <span className="mono text-text-2">{c.contracts}</span>
              </TableRow>
            ))}
          </Table>
        )}
        <span className="text-small text-text-3">
          {shown.length === clients.length ? `${clients.length} ${clients.length === 1 ? 'client' : 'clients'}` : `${shown.length} of ${clients.length} clients`}
        </span>
      </div>
      {open && <ClientPanel key={open} client={current} onClose={() => onOpen(null)} onCreated={(id) => onOpen(id)} />}
    </div>
  );
}

function ClientPanel({ client, onClose, onCreated }: { client: Client | null; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<Form>(client ? formOf(client) : EMPTY);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => setForm(client ? formOf(client) : EMPTY), [client]);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(client ? formOf(client) : EMPTY);
  const fail = (e: unknown) => setError(e instanceof ApiError ? e : new ApiError(0, errorText(e), []));
  const save = useMutation({
    mutationFn: async () => {
      if (client) {
        await api('PUT', `/commercials/clients/${client.id}`, { ...form, version: client.version });
        return client.id;
      }
      return (await api<{ id: string }>('POST', '/commercials/clients', form)).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: keys.clients() });
      toast(`${form.name.trim()} saved`);
      setError(null);
      if (!client) onCreated(id);
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/commercials/clients/${client!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.clients() });
      toast(`${client!.name} deleted`);
      onClose();
    },
    onError: fail,
  });
  return (
    <SidePanel title={client ? client.name : 'New client'} onClose={onClose}>
      <div className="flex flex-col gap-3.5 p-4">
        <TextField label="Name" value={form.name} autoFocus={!client} maxLength={500} onChange={(e) => set({ name: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Type" value={form.type} onChange={(e) => set({ type: e.target.value as Form['type'] })}>
            {Object.entries(CLIENT_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </SelectField>
          <TextField label="Country" value={form.country} maxLength={100} onChange={(e) => set({ country: e.target.value })} />
        </div>
        <TextArea label="Address" rows={2} value={form.address} onChange={(e) => set({ address: e.target.value })} />
        <TextArea label="Billing address" rows={2} value={form.billingAddress} onChange={(e) => set({ billingAddress: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="E-mail" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          <TextField label="Phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          <TextField label="Web" value={form.web} onChange={(e) => set({ web: e.target.value })} />
          <TextField label="Fax" value={form.fax} onChange={(e) => set({ fax: e.target.value })} />
          <TextField label="VAT number" value={form.vatNumber} onChange={(e) => set({ vatNumber: e.target.value })} />
        </div>
        <TextArea label="Notes" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        <SwitchRow
          title="Timing margin"
          description="How far a spot may air from its booked time when the as-run is matched."
          checked={form.toleranceSeconds !== null}
          onChange={(on) => set({ toleranceSeconds: on ? 60 : null })}
        />
        {form.toleranceSeconds !== null && (
          <NumberField label="Timing margin" value={form.toleranceSeconds} max={86400} suffix="seconds" onChange={(v) => set({ toleranceSeconds: v ?? 0 })} />
        )}
        {error && <Notice tone="red">{error.message}</Notice>}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-hairline px-4 py-3">
        {client ? (
          <Button
            variant="danger"
            disabled={client.contracts > 0 || remove.isPending}
            title={client.contracts ? `${client.name} has deals; delete them first.` : undefined}
            onClick={() => remove.mutate()}
          >
            Delete client
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" disabled={!dirty || !form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {client ? 'Save' : 'Create client'}
        </Button>
      </div>
    </SidePanel>
  );
}
