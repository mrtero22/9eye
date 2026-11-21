// New agent: a gallery of jobs, or start empty; then its name, the role it acts with and its model.

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import type { AgentDetail, AgentTemplate, AgentsOverview, PartKey } from '@/lib/types';
import { AgentMark, Button, Dialog, Notice, SelectField, TextField, cx, useToast } from '@/ui';

export function NewAgentDialog({ overview, onClose }: { overview: AgentsOverview; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<AgentTemplate | 'empty' | null>(null);
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState(overview.roles[0]?.id ?? '');
  const [model, setModel] = useState(overview.defaultModel.model);
  const partLabel = (k: PartKey) => overview.parts.find((p) => p.key === k)?.label ?? k;
  const create = useMutation({
    mutationFn: () => api<AgentDetail>('POST', '/agents', { template: picked === 'empty' ? 'empty' : picked!.key, name: name.trim() || undefined, roleId, provider: 'anthropic', model }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      toast(`${a.name} is on the team`);
      onClose();
      navigate(picked === 'empty' ? `/agents/${a.id}/settings` : `/agents/${a.id}`);
    },
  });

  const pick = (t: AgentTemplate | 'empty') => {
    setPicked(t);
    setName(t === 'empty' ? '' : t.name);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={picked ? 480 : 760}
      title={picked ? (picked === 'empty' ? 'An agent of your own' : picked.name) : 'New agent'}
      description={picked ? 'You can change everything later in its settings, or by chatting with it.' : 'Pick a job to start from. Every change an agent prepares waits for a person.'}
      footer={
        picked ? (
          <>
            <Button variant="ghost" onClick={() => setPicked(null)}>
              Back
            </Button>
            <Button variant="primary" disabled={!roleId || (picked === 'empty' && !name.trim()) || create.isPending} onClick={() => create.mutate()}>
              Add to the team
            </Button>
          </>
        ) : undefined
      }
    >
      {!picked ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
          {overview.templates.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => pick(t)}
              className="hov flex cursor-pointer flex-col gap-2 rounded-card border border-border bg-surface p-3 text-left"
            >
              <span className="flex items-center gap-2.5">
                <AgentMark mark={t.mark} color={t.color} />
                <span className="font-semibold">{t.name}</span>
              </span>
              <span className="text-[12.5px] leading-[1.45] text-text-2">{t.job}</span>
              <span className="flex flex-wrap gap-1">
                {Object.entries(t.parts).map(([k, v]) => (
                  <span key={k} className={cx('rounded-badge px-1.5 text-tiny font-medium', v === 'edit' ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-text-2')}>
                    {partLabel(k as PartKey)}
                    {v === 'edit' ? ' · changes' : ''}
                  </span>
                ))}
              </span>
            </button>
          ))}
          <button type="button" onClick={() => pick('empty')} className="hov flex cursor-pointer flex-col items-start justify-center gap-1 rounded-card border border-dashed border-border-strong bg-transparent p-3 text-left">
            <span className="font-semibold">Start empty</span>
            <span className="text-[12.5px] text-text-3">Write its job and skill yourself, or tell it in the chat.</span>
          </button>
        </div>
      ) : (
        <>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Night watch" autoFocus hint="People bring it into a room with @ and its name." />
          <SelectField label="Acts with the role" value={roleId} onChange={(e) => setRoleId(e.target.value)} hint="It never does more than this role, nor more than the person it works for.">
            {overview.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Model" value={model} onChange={(e) => setModel(e.target.value)} hint="ChatGPT and Grok are in its settings, once the company has their key.">
            {overview.claudeModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </SelectField>
          {create.error && <Notice tone="red">{errorText(create.error)}</Notice>}
        </>
      )}
    </Dialog>
  );
}
