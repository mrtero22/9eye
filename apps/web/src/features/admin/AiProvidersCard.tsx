// Settings › AI access › Keys for agents (decision 0024): the company's own key of Claude, ChatGPT
// and Grok. A person pastes the key here; it is stored encrypted and never shown again (only its
// last four characters).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { AiProvider } from '@/lib/types';
import { Button, Card, ConfirmDialog, Dialog, InsetRow, Notice, PasswordField, useToast } from '@/ui';

const WHERE: Record<AiProvider['provider'], string> = {
  anthropic: 'console.anthropic.com › API keys',
  openai: 'platform.openai.com › API keys',
  xai: 'console.x.ai › API keys',
};

export function AiProvidersCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const providers = useQuery({ queryKey: keys.aiProviders(), queryFn: () => api<AiProvider[]>('GET', '/admin/ai-providers') });
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [removing, setRemoving] = useState<AiProvider | null>(null);
  const [key, setKey] = useState('');
  const done = (list: AiProvider[], text: string) => {
    qc.setQueryData(keys.aiProviders(), list);
    qc.invalidateQueries({ queryKey: keys.agents() });
    toast(text);
  };
  const save = useMutation({
    mutationFn: () => api<AiProvider[]>('PUT', `/admin/ai-providers/${editing!.provider}`, { apiKey: key }),
    onSuccess: (list) => {
      done(list, `Key of ${editing!.label} saved`);
      setEditing(null);
      setKey('');
    },
  });
  const remove = useMutation({
    mutationFn: (p: AiProvider) => api<AiProvider[]>('DELETE', `/admin/ai-providers/${p.provider}`),
    onSuccess: (list, p) => done(list, `Key of ${p.label} removed`),
    onError: (e) => toast(errorText(e), 'red'),
  });

  return (
    <Card title="Keys for agents" subtitle="Agents think with the company’s own account at Claude, ChatGPT or Grok, and use its tokens. A key is stored encrypted and never shown again.">
      {providers.error && <Notice tone="red">{errorText(providers.error)}</Notice>}
      {(providers.data ?? []).map((p) => (
        <InsetRow key={p.provider} title={p.label} detail={p.set ? `Key ending ${p.last4}${p.updatedAt ? ` · added ${new Date(p.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}` : 'No key'}>
          {p.set && (
            <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
              Remove
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => (setEditing(p), setKey(''), save.reset())}>
            {p.set ? 'Replace' : 'Add key'}
          </Button>
        </InsetRow>
      ))}
      <Dialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing ? `Key of ${editing.label}` : ''}
        description={editing ? `Make one in ${WHERE[editing.provider]}, then paste it here. Agents of this company use it; nobody can read it back.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!key.trim() || save.isPending} onClick={() => save.mutate()}>
              Save key
            </Button>
          </>
        }
      >
        <PasswordField label="API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
        {save.error && <Notice tone="red">{errorText(save.error)}</Notice>}
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Remove the key of ${removing.label}?` : ''}
        description="Agents on this provider stop working until a key is added again."
        confirmLabel="Remove key"
        danger
        onConfirm={() => {
          if (removing) remove.mutate(removing);
          setRemoving(null);
        }}
      />
    </Card>
  );
}
