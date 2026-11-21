// Admin → Plugins and MAM: connections to MAM, playout exports, as-run sources and other systems
// (decisions 0005, 0008). Nothing is tested against the other system yet, so a connection is
// "set up", never claimed to be connected.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONNECTION_KINDS } from '@9eye/core';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { Connection } from '@/lib/types';
import { Button, ConfirmDialog, Dialog, EmptyState, Icon, Notice, SectionHead, SelectField, StatusDot, TextField, useToast } from '@/ui';

export function ConnectionsSection() {
  const connections = useQuery({ queryKey: keys.connections(), queryFn: () => api<Connection[]>('GET', '/admin/connections') });
  const [editing, setEditing] = useState<Connection | 'new' | null>(null);
  const list = connections.data ?? [];
  return (
    <>
      <SectionHead title="Plugins and MAM" description="Connections to MAM, playout exports, as-run sources and other systems">
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          Add connection
        </Button>
      </SectionHead>
      {connections.error && <Notice tone="red">{errorText(connections.error)}</Notice>}
      <div className="flex flex-col gap-3">
        {list.length > 0 ? (
          <div className="overflow-hidden rounded-card border border-border bg-surface">
            {list.map((c) => {
              const detail = [c.detail, c.kind === 'playout' && c.channelCount ? `${c.channelCount} ${c.channelCount === 1 ? 'channel' : 'channels'}` : ''].filter(Boolean).join(' · ');
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3.5 border-b border-hairline p-4 last:border-b-0">
                  <span className="flex min-w-0 flex-[1_1_260px] flex-col leading-[1.4]">
                    <span className="font-semibold">{c.label}</span>
                    <span className="text-small text-text-2">{detail || 'No details yet'}</span>
                  </span>
                  <span className="min-w-[140px]">
                    {c.status === 'set-up' ? <StatusDot tone="amber">Set up, not checked</StatusDot> : <StatusDot tone="neutral">Not connected</StatusDot>}
                  </span>
                  <Button onClick={() => setEditing(c)}>{c.status === 'set-up' ? 'Configure' : 'Connect'}</Button>
                </div>
              );
            })}
          </div>
        ) : (
          connections.isSuccess && <EmptyState>No connections yet.</EmptyState>
        )}
        <div className="flex items-center gap-2 text-small text-text-3">
          <Icon name="lock" size={14} />
          Credentials are encrypted and never shown again after saving.
        </div>
      </div>
      <ConnectionDialog value={editing} onOpenChange={(o) => !o && setEditing(null)} />
    </>
  );
}

function ConnectionDialog({ value, onOpenChange }: { value: Connection | 'new' | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const existing = value && value !== 'new' ? value : null;
  const [kind, setKind] = useState('mam');
  const [adapter, setAdapter] = useState('compact-mam');
  const [detail, setDetail] = useState('');
  const [address, setAddress] = useState('');
  const [userName, setUserName] = useState('');
  const [credentials, setCredentials] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!value) return;
    setKind(existing?.kind ?? 'mam');
    setAdapter(existing?.adapter ?? 'compact-mam');
    setDetail(existing?.detail ?? '');
    setAddress(existing?.address ?? '');
    setUserName(existing?.userName ?? '');
    setCredentials('');
    setError(null);
  }, [value, existing]);
  const adapters = CONNECTION_KINDS.find((k) => k.key === kind)?.adapters ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: keys.connections() });
  const save = useMutation({
    mutationFn: () =>
      api(existing ? 'PUT' : 'POST', existing ? `/admin/connections/${existing.id}` : '/admin/connections', {
        kind,
        adapter,
        detail,
        address,
        userName,
        ...(credentials ? { credentials } : {}),
      }),
    onSuccess: () => {
      void refresh();
      toast('Connection saved');
      onOpenChange(false);
    },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/admin/connections/${existing!.id}`),
    onSuccess: () => {
      void refresh();
      toast('Connection removed');
      setConfirmDelete(false);
      onOpenChange(false);
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <>
      <Dialog
        open={!!value && !confirmDelete}
        onOpenChange={onOpenChange}
        title={existing ? existing.label : 'Add connection'}
        description="9eye does not test the connection yet; it keeps the settings for when the plugin runs."
        footer={
          <>
            {existing && (
              <Button variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                Remove
              </Button>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setAdapter(CONNECTION_KINDS.find((k) => k.key === e.target.value)?.adapters[0]?.code ?? '');
            }}
          >
            {CONNECTION_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="System" value={adapter} onChange={(e) => setAdapter(e.target.value)}>
            {adapters.map((a) => (
              <option key={a.code} value={a.code}>
                {a.label}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label="What it is for" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. Files, durations, part trims" />
        <TextField label="Address" mono value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://… or ftp://…" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="User name" value={userName} onChange={(e) => setUserName(e.target.value)} autoComplete="off" />
          <TextField
            label="Password or key"
            type="password"
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            autoComplete="new-password"
            placeholder={existing?.hasCredentials ? 'Saved — type to replace' : ''}
          />
        </div>
        {error && <Notice tone="amber">{error}</Notice>}
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Remove ${existing?.label ?? 'this connection'}?`}
        description="Its settings and stored credentials are deleted."
        confirmLabel="Remove"
        danger
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
