// Approving, rejecting and undoing an agent's change (decision 0024). A change that puts a day on
// air is approved twice: Approve, then this dialog (the server asks for the second "yes" too).

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import type { AgentChange } from '@/lib/types';
import { ConfirmDialog, useToast } from '@/ui';

export type Decision = 'approve' | 'reject' | 'undo';

/** What an approved or undone change may have changed. */
const RELOAD = ['weeks', 'day', 'orders', 'commercial-clients', 'commercial-contracts', 'commercial-order', 'catalog-page', 'catalog-types', 'catalog-contents', 'catalog-productions', 'catalog-search'];

export function useDecide(onDone?: (c: AgentChange, action: Decision) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const [asking, setAsking] = useState<AgentChange | null>(null);
  const m = useMutation({
    mutationFn: ({ change, action, confirm }: { change: AgentChange; action: Decision; confirm?: boolean }) =>
      api<AgentChange>('POST', `/agents/changes/${change.id}/${action}`, action === 'approve' && confirm ? { confirm: true } : undefined),
    onSuccess: (c, { action }) => {
      toast(action === 'approve' ? (c.status === 'approved' ? 'Approved and applied' : 'Approved, but it could not be applied') : action === 'reject' ? 'Rejected' : 'Undone');
      qc.invalidateQueries({ queryKey: ['agents'] });
      // a change of a plan, client, deal, campaign or Media (decision 0025) shows on its page at once
      if (action !== 'reject') for (const k of RELOAD) qc.invalidateQueries({ queryKey: [k] });
      onDone?.(c, action);
    },
    onError: (e) => {
      toast(errorText(e), 'red');
      qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
  const decide = (change: AgentChange, action: Decision) => {
    if (action === 'approve' && change.toAir) setAsking(change);
    else m.mutate({ change, action });
  };
  const dialog = (
    <ConfirmDialog
      open={!!asking}
      onOpenChange={(o) => !o && setAsking(null)}
      title="Approve this day for air?"
      description={
        asking
          ? `${asking.agent.name} prepared it: ${asking.preview.split('\n')[0]}. Once approved the day is read-only and ready to export. This is your second approval.`
          : ''
      }
      confirmLabel="Approve for air"
      onConfirm={() => {
        if (asking) m.mutate({ change: asking, action: 'approve', confirm: true });
        setAsking(null);
      }}
    />
  );
  return { decide, busyId: m.isPending ? (m.variables?.change.id ?? null) : null, dialog };
}
