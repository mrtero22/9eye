// Admin → Roles (decision 0007): what each role may do, per module and per channel.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIONS, MODULES, grantApplies } from '@9eye/core';
import { api, errorText } from '@/lib/api';
import { keys, useChannels } from '@/lib/queries';
import type { Role } from '@/lib/types';
import { AddPill, Button, Checkbox, Dialog, InlineRadios, Menu, MenuItem, Notice, Pill, SectionHead, TextField, cx, useToast } from '@/ui';

const key = (m: string, a: string) => `${m}.${a}`;
const MATRIX = 'minmax(160px, 1fr) repeat(4, 80px)';

export function RolesSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: keys.roles(), queryFn: () => api<Role[]>('GET', '/admin/roles') });
  const channels = useChannels();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = roles.data ?? [];
  const role = list.find((r) => r.id === selected) ?? list.find((r) => r.name === 'Traffic operator') ?? list[0];

  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(true);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  useEffect(() => {
    if (!role) return;
    setGrants(new Set(role.grants.map((g) => key(g.module, g.action))));
    setAll(role.allChannels);
    setChannelIds(role.channelIds);
  }, [role]);
  const dirty = useMemo(() => {
    if (!role) return false;
    const base = new Set(role.grants.map((g) => key(g.module, g.action)));
    return base.size !== grants.size || [...grants].some((g) => !base.has(g)) || all !== role.allChannels || JSON.stringify([...channelIds].sort()) !== JSON.stringify([...role.channelIds].sort());
  }, [role, grants, all, channelIds]);

  const save = useMutation({
    mutationFn: () =>
      api('PUT', `/admin/roles/${role!.id}`, {
        version: role!.version,
        grants: [...grants].map((g) => {
          const [module, action] = g.split('.');
          return { module, action };
        }),
        allChannels: all,
        channelIds: all ? [] : channelIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.roles() });
      toast(`${role!.name} saved`);
    },
    onError: (e) => toast(errorText(e), 'red'),
  });

  const chName = (id: string) => channels.data?.find((c) => c.id === id)?.name ?? 'Unknown channel';
  return (
    <>
      <SectionHead title="Roles" description="What each role may do, per module and per channel">
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New role
        </Button>
      </SectionHead>
      {roles.error && <Notice tone="red">{errorText(roles.error)}</Notice>}
      {role && (
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex flex-[1_1_220px] flex-col gap-0.5">
            {list.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={r.id === role.id}
                onClick={() => setSelected(r.id)}
                className={cx('hov flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-item border-0 px-3 text-left font-medium', r.id === role.id ? 'bg-accent-soft text-text' : 'bg-transparent text-text-2')}
              >
                <span className="min-w-0 flex-1">{r.name}</span>
                <span className="mono text-small font-normal text-text-3">{r.members}</span>
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h3 className="m-0 text-section font-semibold tracking-[-0.01em]">{role.name}</h3>
                <span className="text-text-2">
                  {role.description || 'No description'} · {role.members} {role.members === 1 ? 'member' : 'members'}
                  {role.fixed ? ' · can do everything, cannot be changed' : ''}
                </span>
              </div>
              <Button disabled={role.fixed || !dirty || save.isPending} onClick={() => save.mutate()}>
                Save changes
              </Button>
            </div>
            <div className="overflow-x-auto rounded-card border border-border bg-surface">
              <div className="min-w-[480px]">
                <div className="grid h-10 items-center px-4 text-small text-text-3" style={{ gridTemplateColumns: MATRIX }}>
                  <span>Module</span>
                  {ACTIONS.map((a) => (
                    <span key={a.key} className="text-center">
                      {a.label}
                    </span>
                  ))}
                </div>
                {MODULES.map((m) => (
                  <div key={m.key} className="grid min-h-[calc(var(--row)+8px)] items-center border-t border-hairline px-4" style={{ gridTemplateColumns: MATRIX }}>
                    <span title={m.description} className="font-medium">
                      {m.label}
                    </span>
                    {ACTIONS.map((a) => (
                      <span key={a.key} className="flex justify-center">
                        {grantApplies(m.key, a.key) ? (
                          <Checkbox
                            label={`${m.label} · ${a.label}`}
                            checked={grants.has(key(m.key, a.key))}
                            disabled={role.fixed}
                            onChange={(on) => {
                              const next = new Set(grants);
                              if (on) next.add(key(m.key, a.key));
                              else next.delete(key(m.key, a.key));
                              setGrants(next);
                            }}
                          />
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="font-medium">Channels this role can work on</div>
              <InlineRadios
                label="Channel scope"
                disabled={role.fixed}
                value={all ? 'all' : 'some'}
                onChange={(v) => setAll(v === 'all')}
                options={[
                  { value: 'all', label: 'All channels' },
                  { value: 'some', label: 'Selected channels' },
                ]}
              />
              {!all && (
                <div className="flex flex-wrap gap-1.5">
                  {channelIds.map((id) => (
                    <Pill key={id} removeLabel={`Remove ${chName(id)}`} onRemove={() => setChannelIds(channelIds.filter((x) => x !== id))}>
                      {chName(id)}
                    </Pill>
                  ))}
                  <Menu label="Add a channel" align="start" width={240} trigger={<AddPill>Add channel</AddPill>}>
                    {(channels.data ?? [])
                      .filter((c) => !channelIds.includes(c.id))
                      .map((c) => (
                        <MenuItem key={c.id} onSelect={() => setChannelIds([...channelIds, c.id])}>
                          {c.name}
                        </MenuItem>
                      ))}
                  </Menu>
                </div>
              )}
              <div className="text-small text-text-3">A person can have a different role in each company.</div>
            </div>
          </div>
        </div>
      )}
      <NewRoleDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => {
          setSelected(id);
          void qc.invalidateQueries({ queryKey: keys.roles() });
        }}
      />
    </>
  );
}

function NewRoleDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('POST', '/admin/roles', { name, description }),
    onSuccess: (r) => {
      onOpenChange(false);
      setName('');
      setDescription('');
      onCreated(r.id);
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New role"
      description="It starts with no permissions; tick them in the table."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || m.isPending} onClick={() => m.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} autoFocus maxLength={60} onChange={(e) => setName(e.target.value)} />
      <TextField label="What it is for" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Overnight playlists" />
      {error && <Notice tone="amber">{error}</Notice>}
    </Dialog>
  );
}
