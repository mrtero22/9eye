// An agent's settings (docs/design/agents-page.md): about it, what it works on, its skill and its
// history, its memory, the agents it works with, its limits. People who can change Settings change
// them; everyone else sees them.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys, useChannels } from '@/lib/queries';
import type { AgentDetail, AgentsOverview, PartKey, PartLevel, Parts, ProviderName } from '@/lib/types';
import {
  AgentMark, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, IconButton, InlineRadios, MarkColorPicker, Notice, SectionHead, Segmented, SelectField, Switch,
  TextArea, TextField, useToast,
} from '@/ui';
import { RoutinesCard } from './RoutinesCard';
import { PROVIDER_LABEL, messageTime, tokensText } from './agentWords';

interface Form {
  name: string;
  mark: string;
  color: string;
  job: string;
  provider: ProviderName;
  model: string;
  roleId: string;
  parts: Parts;
  channelIds: string[];
  skill: string;
  worksWith: string[];
  enabled: boolean;
  maxSteps: number;
  monthlyTokens: number;
}

const formOf = (a: AgentDetail): Form => ({
  name: a.name, mark: a.mark, color: a.color, job: a.job, provider: a.provider, model: a.model, roleId: a.role.id, parts: a.parts, channelIds: a.channelIds,
  skill: a.skill, worksWith: a.worksWith, enabled: a.enabled, maxSteps: a.maxSteps, monthlyTokens: a.monthlyTokens,
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function AgentSettings({ agentId, overview }: { agentId: string; overview: AgentsOverview }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const detail = useQuery({ queryKey: keys.agent(agentId), queryFn: () => api<AgentDetail>('GET', `/agents/${agentId}`) });
  const channels = useChannels();
  const [form, setForm] = useState<Form | null>(null);
  const [deleting, setDeleting] = useState(false);
  const a = detail.data;
  // A new version (saved here or elsewhere) replaces the form; reading the memory again does not.
  useEffect(() => {
    if (a) setForm(formOf(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, a?.version]);
  const may = overview.canManage;
  const saved = a ? formOf(a) : null;
  const changes = form && saved ? (Object.keys(form) as (keyof Form)[]).filter((k) => !same(form[k], saved[k])).length : 0;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const refresh = () => qc.invalidateQueries({ queryKey: ['agents'] });
  const save = useMutation({
    mutationFn: () => api<AgentDetail>('PUT', `/agents/${agentId}`, { version: a!.version, ...form }),
    onSuccess: (d) => {
      qc.setQueryData(keys.agent(agentId), d);
      refresh();
      toast('Agent saved');
    },
  });
  const forget = useMutation({
    mutationFn: (memoryId: string) => api('DELETE', `/agents/${agentId}/memory/${memoryId}`),
    onSuccess: () => {
      refresh();
      toast('Removed from its memory');
    },
    onError: (e) => toast(errorText(e), 'red'),
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/agents/${agentId}`),
    onSuccess: () => {
      refresh();
      toast('Agent deleted');
      navigate('/agents');
    },
    onError: (e) => toast(errorText(e), 'red'),
  });

  if (detail.error) return <Notice tone="red">{errorText(detail.error)}</Notice>;
  if (!a || !form) return null;
  const others = overview.agents.filter((x) => x.id !== a.id);
  const keyOf = (p: ProviderName) => overview.providers.find((x) => x.provider === p);
  const last = a.skills[0];

  return (
    <>
      <SectionHead title="Settings" description={may ? 'What it is, what it works on, how it works.' : 'Only people who can change Settings change an agent.'}>
        {may && (
          <>
            {changes > 0 && <Badge tone="amber" round>{changes === 1 ? '1 change' : `${changes} changes`}</Badge>}
            <Button variant="ghost" disabled={!changes} onClick={() => setForm(formOf(a))}>
              Discard
            </Button>
            <Button variant="primary" disabled={!changes || save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        )}
      </SectionHead>
      {save.error && <Notice tone="red">{errorText(save.error)}</Notice>}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-3">
        <Card title="About">
          <div className="flex flex-wrap items-end gap-3">
            <TextField label="Name" value={form.name} disabled={!may} onChange={(e) => set('name', e.target.value)} maxLength={60} className="min-w-[180px] flex-1" />
            <TextField label="Mark" value={form.mark} disabled={!may} onChange={(e) => set('mark', e.target.value.toUpperCase().slice(0, 2))} className="w-16" />
          </div>
          <MarkColorPicker mark={form.mark} value={form.color} onChange={(c) => set('color', c)} disabled={!may} />
          <TextArea label="Its job" value={form.job} disabled={!may} onChange={(e) => set('job', e.target.value)} rows={3} maxLength={1000} />
          <div className="flex flex-wrap gap-3">
            <SelectField
              label="Provider"
              value={form.provider}
              disabled={!may}
              className="min-w-[180px] flex-1"
              onChange={(e) => {
                const p = e.target.value as ProviderName;
                setForm((f) => (f ? { ...f, provider: p, model: p === 'anthropic' ? overview.defaultModel.model : '' } : f));
              }}
            >
              {(['anthropic', 'openai', 'xai'] as const).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                  {keyOf(p)?.set ? '' : ' — no key yet'}
                </option>
              ))}
            </SelectField>
            {form.provider === 'anthropic' ? (
              <SelectField label="Model" value={form.model} disabled={!may} onChange={(e) => set('model', e.target.value)} className="min-w-[180px] flex-1">
                {overview.claudeModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </SelectField>
            ) : (
              <TextField label="Model" mono value={form.model} disabled={!may} onChange={(e) => set('model', e.target.value)} placeholder={form.provider === 'xai' ? 'grok-…' : 'gpt-…'} className="min-w-[180px] flex-1" hint="The model’s id at the provider." />
            )}
          </div>
          <SelectField label="Acts with the role" value={form.roleId} disabled={!may} onChange={(e) => set('roleId', e.target.value)} hint="It never does more than this role, nor more than the person it works for.">
            {overview.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
        </Card>

        <Card title="What it works on" subtitle="Read: it looks things up. Read and change: it also prepares changes, which wait for a person.">
          <div className="flex flex-col gap-2">
            {overview.parts.map((p) => {
              const level = form.parts[p.key] ?? 'none';
              const options = [
                { value: 'none', label: 'Nothing' },
                { value: 'read', label: 'Read' },
                ...(p.canChange ? [{ value: 'edit', label: 'Read and change' }] : []),
              ];
              return (
                <div key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex w-28 flex-col leading-[1.3]">
                    <span className="font-medium">{p.label}</span>
                    {!p.canChange && <span className="text-tiny text-text-3">changes come later</span>}
                  </span>
                  <span className="min-w-[220px] flex-1">
                    {may ? (
                      <Segmented
                        label={`What it does in ${p.label}`}
                        size="sm"
                        value={level}
                        options={options}
                        onChange={(v) => {
                          const parts = { ...form.parts };
                          if (v === 'none') delete parts[p.key as PartKey];
                          else parts[p.key as PartKey] = v as PartLevel;
                          set('parts', parts);
                        }}
                      />
                    ) : (
                      <span className="text-small text-text-2">{options.find((o) => o.value === level)?.label}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <InlineRadios
            label="Channels"
            disabled={!may}
            value={form.channelIds.length ? 'some' : 'all'}
            options={[
              { value: 'all', label: 'Every channel its role reaches' },
              { value: 'some', label: 'Only these channels' },
            ]}
            onChange={(v) => set('channelIds', v === 'all' ? [] : (channels.data ?? []).slice(0, 1).map((c) => c.id))}
          />
          {form.channelIds.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {(channels.data ?? []).map((c) => (
                <Checkbox
                  key={c.id}
                  disabled={!may}
                  checked={form.channelIds.includes(c.id)}
                  onChange={(on) => set('channelIds', on ? [...form.channelIds, c.id] : form.channelIds.filter((x) => x !== c.id))}
                >
                  {c.name}
                </Checkbox>
              ))}
            </div>
          )}
        </Card>

        <Card title="Skill" subtitle="How it does its job, step by step. Change it here, or ask it in the chat to work differently.">
          <TextArea label="Its skill" value={form.skill} disabled={!may} onChange={(e) => set('skill', e.target.value)} rows={9} maxLength={8000} />
          {last && (
            <span className="text-meta text-text-3">
              Last changed {last.changedBy ? `by ${last.changedBy} ` : ''}
              {last.via === 'chat' ? 'from the chat' : 'here'} · {messageTime(last.createdAt)}
            </span>
          )}
          {a.skills.length > 1 && (
            <details className="text-small">
              <summary className="cursor-pointer text-text-2">History ({a.skills.length})</summary>
              <div className="mt-2 flex flex-col gap-2">
                {a.skills.slice(1, 11).map((s) => (
                  <div key={s.id} className="flex flex-col gap-1 rounded-item bg-surface-2 px-3 py-2">
                    <span className="flex items-center gap-2 text-meta text-text-3">
                      <span className="flex-1">
                        {messageTime(s.createdAt)} · {s.changedBy ?? 'someone'} · {s.via === 'chat' ? 'from the chat' : 'in settings'}
                      </span>
                      {may && (
                        <Button size="xs" variant="ghost" onClick={() => set('skill', s.skill)}>
                          Use this one
                        </Button>
                      )}
                    </span>
                    <span className="whitespace-pre-wrap text-[12.5px] text-text-2">{s.skill || '(empty)'}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </Card>

        <Card title="Memory" subtitle="What the team told it to keep. It reads this before every conversation.">
          {a.memory.length ? (
            <div className="flex flex-col gap-1.5">
              {a.memory.map((m) => (
                <div key={m.id} className="flex items-start gap-2 rounded-item bg-surface-2 px-3 py-2">
                  <span className="flex min-w-0 flex-1 flex-col leading-[1.35]">
                    <span className="text-small">{m.text}</span>
                    <span className="text-meta text-text-3">
                      {m.source} · {messageTime(m.createdAt)}
                    </span>
                  </span>
                  {may && <IconButton icon="close" size="xs" tone="quiet" label={`Remove “${m.text}”`} onClick={() => forget.mutate(m.id)} />}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>Nothing yet. Tell it in the chat, and it remembers.</EmptyState>
          )}
        </Card>

        <Card title="Works with" subtitle="It hands work to these agents in rooms; their answer comes back to it. A chain of hand-offs ends after 3.">
          {others.length ? (
            <div className="flex flex-col gap-1.5">
              {others.map((o) => (
                <Checkbox key={o.id} disabled={!may} checked={form.worksWith.includes(o.id)} onChange={(on) => set('worksWith', on ? [...form.worksWith, o.id] : form.worksWith.filter((x) => x !== o.id))}>
                  <span className="inline-flex items-center gap-2">
                    <AgentMark mark={o.mark} color={o.color} size="sm" />
                    {o.name}
                  </span>
                </Checkbox>
              ))}
            </div>
          ) : (
            <EmptyState>It is the only agent so far.</EmptyState>
          )}
        </Card>

        <RoutinesCard agent={a} overview={overview} />

        <Card title="Limits and use">
          <label className="flex items-center justify-between gap-3">
            <span className="flex flex-col leading-[1.35]">
              <span className="font-medium">Working</span>
              <span className="text-meta text-text-3">A paused agent does not answer and does nothing.</span>
            </span>
            <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label="Working" disabled={!may} />
          </label>
          <div className="flex flex-wrap gap-3">
            <TextField label="Steps in one run, at most" type="number" min={1} max={100} value={form.maxSteps} disabled={!may} onChange={(e) => set('maxSteps', Number(e.target.value))} className="w-44" />
            <TextField label="Tokens a month, at most" type="number" min={10000} step={10000} value={form.monthlyTokens} disabled={!may} onChange={(e) => set('monthlyTokens', Number(e.target.value))} className="w-48" mono />
          </div>
          <span className="text-meta text-text-3">
            Used this month: {tokensText(a.usedTokens)} of {tokensText(a.monthlyTokens)} tokens, on the company’s own {PROVIDER_LABEL[a.provider]} key.
          </span>
          {may && (
            <div className="flex justify-end">
              <Button variant="danger" onClick={() => setDeleting(true)}>
                Delete agent
              </Button>
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${a.name}?`}
        description="It stops working and leaves the team. Its changes that wait for a person are rejected; its work done stays in the activity log."
        confirmLabel="Delete agent"
        danger
        onConfirm={() => {
          setDeleting(false);
          remove.mutate();
        }}
      />
    </>
  );
}
