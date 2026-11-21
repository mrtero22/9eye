// Settings › AI access (decisions 0023, 0025; mockups AiAccess / AiPermissions, page doc
// docs/design/ai-access-page.md): AI on or off in the company, what AI may do — a table of parts ×
// actions, each Allowed / Ask first / Off, from a preset — the longest token life, every token of it,
// and the keys for agents.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { PRESET_WORDS, cellCount, presetOf, presetTable } from '@/lib/aiTable';
import { keys } from '@/lib/queries';
import type { AiPolicy, AiPreset, AiTable, AiToken } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Icon, Notice, PermissionLegend, PermissionTable, SectionHead, Segmented, SelectField, Switch, useToast } from '@/ui';
import { AiTokenTable, useRevoke } from '../account/aiTokens';
import { AiProvidersCard } from './AiProvidersCard';

export function AiAccessSection({ company }: { company: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const policy = useQuery({ queryKey: keys.aiPolicy(), queryFn: () => api<AiPolicy>('GET', '/admin/ai-access') });
  const tokens = useQuery({ queryKey: keys.aiTokens(), queryFn: () => api<AiToken[]>('GET', '/admin/ai-tokens') });
  const [on, setOn] = useState(true);
  const [table, setTable] = useState<AiTable | null>(null);
  const [maxDays, setMaxDays] = useState(90);
  const [showOld, setShowOld] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = policy.data;
  useEffect(() => {
    if (!saved) return;
    setOn(saved.on);
    setTable(saved.table);
    setMaxDays(saved.maxDays);
  }, [saved]);
  const shape = saved?.shape;
  const changes = saved && table && shape ? (on !== saved.on ? 1 : 0) + (maxDays !== saved.maxDays ? 1 : 0) + cellCount(shape, table, saved.table) : 0;
  const preset: AiPreset = shape && table ? presetOf(shape, table) : 'custom';
  const save = useMutation({
    mutationFn: () => api<AiPolicy>('PUT', '/admin/ai-access', { on, table, maxDays }),
    onSuccess: (p) => {
      qc.setQueryData(keys.aiPolicy(), p);
      qc.invalidateQueries({ queryKey: keys.aiTokens() });
      qc.invalidateQueries({ queryKey: ['agents'] });
      setError(null);
      toast('AI access saved');
    },
    onError: (e) => setError(errorText(e)),
  });
  const revoke = useRevoke(async (t) => {
    try {
      await api('DELETE', `/admin/ai-tokens/${t.id}`);
      toast(`"${t.name}" revoked`);
    } catch (e) {
      toast(errorText(e));
    }
    await qc.invalidateQueries({ queryKey: keys.aiTokens() });
  });
  const all = tokens.data ?? [];
  const working = all.filter((t) => t.state === 'ok');
  const shown = showOld ? all : working;

  return (
    <>
      <SectionHead title="AI access" description={`What Claude, ChatGPT, your own apps and 9eye's agents may do in ${company}. A person's role still decides every step.`}>
        {changes > 0 && <Badge tone="amber" round>{changes === 1 ? '1 change' : `${changes} changes`}</Badge>}
        <Button variant="ghost" disabled={!changes} onClick={() => saved && (setOn(saved.on), setTable(saved.table), setMaxDays(saved.maxDays))}>
          Discard
        </Button>
        <Button variant="primary" disabled={!changes || save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </SectionHead>
      {(policy.error || error) && <Notice tone="red">{error ?? errorText(policy.error)}</Notice>}

      {shape && table && (
        <Card label="What AI may do">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <span className="flex min-w-[260px] flex-1 flex-col gap-0.5">
              <span className="font-semibold">What AI may do in {company}</span>
              <span className="text-[12.5px] text-text-3">For every AI app's token and every agent of this company. A token or an agent can be narrower, never wider.</span>
            </span>
            <span className="flex items-center gap-2 text-small text-text-2">
              AI on
              <Switch checked={on} onChange={setOn} label={`AI on in ${company}`} />
            </span>
          </div>
          {!on && <Notice tone="amber">AI is off in {company}: no token works and no agent runs. The table is kept for when it is on again.</Notice>}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-small text-text-2">Start from</span>
            <Segmented
              label="Preset"
              value={preset}
              onChange={(v) => v !== 'custom' && setTable(presetTable(shape, v))}
              options={(['read', 'drafts', 'full', 'custom'] as const).map((v) => ({ value: v, label: PRESET_WORDS[v].label, hint: PRESET_WORDS[v].text }))}
            />
            <span className="text-[12.5px] text-text-3">{PRESET_WORDS[preset].text}</span>
          </div>
          <PermissionTable
            label={`What AI may do in ${company}`}
            parts={shape.parts}
            columns={shape.actions}
            value={table}
            disabled={!on}
            onChange={(part, action, cell) => setTable({ ...table, [part]: { ...table[part as keyof AiTable], [action]: cell } })}
          />
          <PermissionLegend />
          <div className="flex flex-col gap-1.5 rounded-item bg-surface-2 px-3 py-2.5 text-[12.5px] text-text-2">
            <span className="flex items-center gap-2">
              <Icon name="lock" size={14} className="text-text-3" />
              Never open to AI: people and roles, companies, AI access and tokens, connections and sign-in.
            </span>
            <span className="flex items-center gap-2">
              <Icon name="agents" size={14} className="text-text-3" />
              9eye's agents always ask first: for them this table decides only what is Off.
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <SelectField label="Longest token life" value={String(maxDays)} onChange={(e) => setMaxDays(Number(e.target.value))} className="w-40">
              {(saved?.dayChoices ?? [30, 90, 180, 365]).map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </SelectField>
            <span className="pb-2 text-meta text-text-3">New tokens only. Tokens made before keep their date.</span>
          </div>
        </Card>
      )}

      <AiProvidersCard />

      {saved && !saved.on && <Notice tone="amber">AI access is off: the tokens below do not work until it is on again. They are kept.</Notice>}

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex flex-col leading-[1.3]">
          <span className="font-semibold">
            Tokens in this company <span className="mono font-normal text-text-3">{working.length}</span>
          </span>
          <span className="text-[12.5px] text-text-3">Each person makes their own under AI access in the account menu, and may narrow it. Revoke one if it leaks or its person left.</span>
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-2 text-small text-text-2">
          Show expired and revoked
          <Switch checked={showOld} onChange={setShowOld} label="Show expired and revoked" />
        </span>
      </div>
      {tokens.error && <Notice tone="red">{errorText(tokens.error)}</Notice>}
      {shown.length > 0 ? (
        <AiTokenTable tokens={shown} person onRevoke={revoke.ask} />
      ) : (
        tokens.isSuccess && <EmptyState>{all.length ? 'No working tokens.' : 'Nobody has made a token yet.'}</EmptyState>
      )}
      {revoke.dialog}
    </>
  );
}
