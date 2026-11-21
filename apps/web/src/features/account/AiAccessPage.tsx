// Account › AI access (decision 0023; mockup docs/design/mockups/MyAiAccess.dc.html, page doc
// docs/design/ai-access-page.md): the person's own tokens, and a new one, shown once, with how to connect.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, currentCompany, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import { PRESET_WORDS, capTable } from '@/lib/aiTable';
import type { AiAction, AiCell, AiPart, AiTable, AiToken, MyAiAccess } from '@/lib/types';
import { Button, EmptyState, Icon, Notice, PageHeader, PermissionTable, RadioList, Segmented, SelectField, SidePanel, TextField, useToast } from '@/ui';
import { AiTokenTable, useRevoke } from './aiTokens';

const DAY_CHOICES = [30, 90, 180, 365];

export function AiAccessPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const data = useQuery({ queryKey: keys.myAiAccess(), queryFn: () => api<MyAiAccess>('GET', '/me/ai-access') });
  const [panel, setPanel] = useState<'new' | { token: string; row: AiToken } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.myAiAccess() });
  const revoke = useRevoke(async (t) => {
    try {
      await api('DELETE', `/me/ai-tokens/${t.id}`);
      toast(`"${t.name}" revoked`);
    } catch (e) {
      toast(errorText(e));
    }
    await refresh();
  });
  const tokens = data.data?.tokens ?? [];

  return (
    <>
      <PageHeader
        title="AI access"
        description="Connect Claude, ChatGPT or your own agent to 9eye. It works as you, with your role, in one company."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setPanel('new')}>
            New token
          </Button>
        }
      />
      <div className="flex flex-wrap items-start gap-4 px-4 pb-8 pt-5 sm:px-8">
        <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-3">
          <span className="flex flex-col leading-[1.3]">
            <span className="font-semibold">Your tokens</span>
            <span className="text-[12.5px] text-text-3">A token lets one app work as you in one company. Make one for each app, so you can revoke one alone.</span>
          </span>
          {data.error && <Notice tone="red">{errorText(data.error)}</Notice>}
          {tokens.length > 0 ? <AiTokenTable tokens={tokens} onRevoke={revoke.ask} /> : data.isSuccess && <EmptyState>No tokens yet.</EmptyState>}
          <div className="flex items-center gap-2 text-small text-text-3">
            <Icon name="lock" size={14} />
            Anyone with the token can work as you. Revoke it if it leaks. No AI app can approve, reopen or export a day.
          </div>
        </div>
        {panel === 'new' && data.data && (
          <NewToken
            data={data.data}
            onClose={() => setPanel(null)}
            onMade={(made) => {
              setPanel(made);
              void refresh();
            }}
          />
        )}
        {panel && panel !== 'new' && <MadeToken made={panel} onClose={() => setPanel(null)} />}
      </div>
      {revoke.dialog}
    </>
  );
}

function NewToken({ data, onClose, onMade }: { data: MyAiAccess; onClose: () => void; onMade: (m: { token: string; row: AiToken }) => void }) {
  const firstCompany = data.companies.find((c) => c.slug === currentCompany()) ?? data.companies[0];
  const [company, setCompany] = useState(firstCompany?.slug ?? '');
  const [name, setName] = useState('Claude on my laptop');
  const [mode, setMode] = useState<'same' | 'read' | 'custom'>('same');
  const [custom, setCustom] = useState<AiTable | null>(null);
  const [days, setDays] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const c = data.companies.find((x) => x.slug === company);
  const dayChoices = useMemo(() => DAY_CHOICES.filter((d) => !c || d <= c.maxDays), [c]);
  // keep the choices within what the company allows; a custom table starts as the company's
  useEffect(() => {
    if (c && days > c.maxDays) setDays(dayChoices[dayChoices.length - 1] ?? c.maxDays);
  }, [c, days, dayChoices]);
  useEffect(() => {
    if (c) setCustom(capTable(data.shape, c.table, (p, a) => (c.roleCan[p]?.[a] ? 'on' : 'off')));
  }, [c, data.shape]);
  const make = useMutation({
    mutationFn: () =>
      api<{ token: string; row: AiToken }>('POST', '/me/ai-tokens', { company, name, days, limits: mode === 'custom' ? { kind: 'custom', table: custom } : { kind: mode } }),
    onSuccess: onMade,
    onError: (e) => setError(errorText(e)),
  });
  const why = !c ? null : !c.on ? `AI access is off for ${c.name}: a company admin can turn it on in Settings › AI access.` : null;
  const LOOK: Record<AiCell, string> = { on: 'Allowed', ask: 'Ask first', off: 'Off' };
  return (
    <SidePanel title="New token" onClose={onClose}>
        <div className="flex flex-col gap-3.5 p-4">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude on my laptop" hint="So you know which app it is when you revoke it." />
          <SelectField label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
            {data.companies.map((x) => (
              <option key={x.slug} value={x.slug}>
                {x.name}
              </option>
            ))}
          </SelectField>
          <div className="flex flex-col gap-1.5">
            <span className="text-meta text-text-2">What it can do</span>
            <RadioList
              label="What it can do"
              value={mode}
              onChange={(v) => setMode(v)}
              options={[
                { value: 'same', label: <Choice title={`Same as ${c?.name ?? 'the company'}`} text={c ? `${PRESET_WORDS[c.preset].label}: follows what ${c.name} allows, now and when it changes.` : ''} /> },
                { value: 'read', label: <Choice title="Read only" text="Look things up; change nothing." /> },
                { value: 'custom', label: <Choice title="Custom" text="Choose part by part, up to what the company and your role allow." /> },
              ]}
            />
            {mode === 'custom' && c && custom && (
              <>
                <PermissionTable
                  compact
                  label="What this token can do"
                  parts={data.shape.parts}
                  columns={data.shape.actions.filter((x) => x.key !== 'export')}
                  value={custom}
                  onChange={(part, action, cell) => setCustom({ ...custom, [part]: { ...custom[part as AiPart], [action]: cell } })}
                  cap={(part, action) => {
                    const max = c.table[part as AiPart]?.[action as AiAction] ?? 'off';
                    if (!c.roleCan[part as AiPart]?.[action as AiAction]) return { max: 'off', why: `Your role cannot do this in ${c.name}` };
                    return { max, why: `${c.name} allows up to ${LOOK[max]}` };
                  }}
                />
                <span className="text-meta text-text-3">Choices above what {c.name} or your role allows are greyed.</span>
              </>
            )}
            {c && (
              <span className="rounded-item bg-surface-2 px-2.5 py-2 text-meta text-text-2">
                Your role in {c.name} is <b className="font-semibold text-text">{c.role}</b>: an app can do what you can, step by step — and no more than these limits.
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-meta text-text-2">Expires in</span>
            <Segmented label="Expires in" value={String(days)} onChange={(v) => setDays(Number(v))} options={dayChoices.map((d) => ({ value: String(d), label: `${d} days` }))} />
            {c && <span className="text-meta text-text-3">{c.name} allows tokens of up to {c.maxDays} days.</span>}
          </div>
          {why && <Notice tone="amber">{why}</Notice>}
          {error && <Notice tone="red">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!c || !c.on || !name.trim() || make.isPending} onClick={() => make.mutate()}>
              Make token
            </Button>
          </div>
        </div>
    </SidePanel>
  );
}

function Choice({ title, text }: { title: string; text: string }) {
  return (
    <span className="flex flex-col py-1.5 leading-[1.4]">
      <span className="font-medium">{title}</span>
      <span className="text-meta text-text-2">{text}</span>
    </span>
  );
}

function MadeToken({ made, onClose }: { made: { token: string; row: AiToken }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'code' | 'other' | 'web'>('code');
  const address = `${window.location.origin}/api/mcp`;
  const command = `claude mcp add --transport http 9eye ${address} --header "Authorization: Bearer ${made.token}"`;
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  return (
    <SidePanel title={`Token made: ${made.row.name}`} onClose={onClose}>
        <div className="flex flex-col gap-3.5 p-4">
          <Notice tone="amber">Copy it now. It is not shown again: if you lose it, make a new one.</Notice>
          <div className="flex items-stretch gap-1.5">
            <span className="mono min-w-0 flex-1 break-all rounded-ctl bg-surface-2 px-2.5 py-2 text-meta" aria-label="The new token">
              {made.token}
            </span>
            <Button onClick={() => void copy(made.token)}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-meta font-medium text-text-2">Connect</span>
            <Segmented
              label="Connect"
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'code', label: 'Claude Code' },
                { value: 'other', label: 'Other MCP app' },
                { value: 'web', label: 'ChatGPT, claude.ai' },
              ]}
            />
            {tab === 'code' && (
              <div className="flex flex-col gap-1.5 text-[12.5px] text-text-2">
                <span>Run this once in a terminal:</span>
                <span className="mono break-all rounded-ctl bg-surface-2 px-2.5 py-2 text-meta text-text">{command}</span>
                <span className="flex items-center gap-2">
                  <Button size="sm" onClick={() => void copy(command)}>
                    Copy the line
                  </Button>
                  Then ask Claude, for example: “Check tomorrow’s playlist.”
                </span>
              </div>
            )}
            {tab === 'other' && (
              <div className="grid grid-cols-[84px_1fr] gap-x-2.5 gap-y-1.5 text-[12.5px]">
                <span className="text-text-3">Address</span>
                <span className="mono break-all text-meta">{address}</span>
                <span className="text-text-3">Transport</span>
                <span>Streamable HTTP (MCP)</span>
                <span className="text-text-3">Header</span>
                <span className="mono break-all text-meta">Authorization: Bearer &lt;the token&gt;</span>
              </div>
            )}
            {tab === 'web' && (
              <span className="rounded-item bg-surface-2 px-3 py-2 text-[12.5px] text-text-2">
                ChatGPT and claude.ai connect over the internet with “Sign in with 9eye” instead of a token. That comes when 9eye runs on its own address.
              </span>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
    </SidePanel>
  );
}
