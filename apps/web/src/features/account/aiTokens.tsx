// AI tokens (decision 0023, docs/design/ai-access-page.md): the table both the account page and
// Settings › AI access show, its words, and the revoke confirmation.

import { useState } from 'react';
import { formatDate } from '@9eye/core';
import type { AiToken } from '@/lib/types';
import { Avatar, Badge, Button, ConfirmDialog, Table, TableRow } from '@/ui';

const day = (iso: string) => formatDate(iso.slice(0, 10));

/** "Just now", "5 minutes ago", "3 hours ago", "Yesterday", else the date. */
export function ago(iso: string | null): string {
  if (!iso) return 'Never';
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  if (hours < 48) return 'Yesterday';
  return day(iso);
}

export const accessLabel = (access: 'read' | 'edit') => (access === 'edit' ? 'Read and change' : 'Read');

/** A token's limits in one word (decision 0025). */
export const LIMIT_WORD: Record<AiToken['limits'], string> = { same: 'Same as the company', read: 'Read only', custom: 'Custom' };

function untilText(t: AiToken): string {
  if (t.state === 'revoked') return `Revoked ${day(t.revokedAt ?? t.expiresAt)}`;
  if (t.state === 'expired') return `Expired ${day(t.expiresAt)}`;
  if (t.state === 'left') return 'Left the company';
  return day(t.expiresAt);
}

/**
 * Tokens in a table. `person`: the person column (Settings); else the company column (the account
 * page). "Can" shows each token's limits: the same as the company, read only, or its own.
 */
export function AiTokenTable({ tokens, person, onRevoke }: { tokens: AiToken[]; person?: boolean; onRevoke: (t: AiToken) => void }) {
  const columns = `${person ? 'minmax(200px, 1.3fr) ' : ''}minmax(150px, 1fr) ${person ? '' : 'minmax(120px, 1fr) '}minmax(190px, 1.2fr) 104px 112px 156px 84px`;
  const head = [person ? 'Person' : null, 'Token', person ? null : 'Company', 'Can', 'Made', 'Last used', 'Expires', ''].filter((h): h is string => h !== null);
  return (
    <Table columns={columns} head={head} minWidth={person ? 880 : 760}>
      {tokens.map((t) => {
        const working = t.state === 'ok';
        return (
          <TableRow key={t.id}>
            {person && (
              <span className={`flex min-w-0 items-center gap-2.5 ${working ? '' : 'opacity-60'}`}>
                <Avatar name={t.person.name} />
                <span className="flex min-w-0 flex-col leading-[1.3]">
                  <span className="font-medium">{t.person.name}</span>
                  <span className="truncate text-meta text-text-3">{t.person.email}</span>
                </span>
              </span>
            )}
            <span className={`truncate font-medium ${working ? '' : 'opacity-60'}`}>{t.name}</span>
            {!person && <span className={`text-text-2 ${working ? '' : 'opacity-60'}`}>{t.company.name}</span>}
            <span className={`flex flex-col items-start gap-0.5 ${working ? '' : 'opacity-60'}`}>
              <Badge tone={t.limits === 'same' ? 'accent' : t.limits === 'custom' ? 'amber' : 'neutral'}>{LIMIT_WORD[t.limits]}</Badge>
              <span className="text-meta text-text-3">{t.limitsText}</span>
            </span>
            <span className={`text-text-2 ${working ? '' : 'opacity-60'}`}>{day(t.createdAt)}</span>
            <span className={`text-text-2 ${working ? '' : 'opacity-60'}`}>{ago(t.lastUsedAt)}</span>
            <span className={working ? 'text-text-2' : 'text-text-3'}>{untilText(t)}</span>
            <span className="flex justify-end">
              {working && (
                <Button size="sm" variant="danger" onClick={() => onRevoke(t)}>
                  Revoke
                </Button>
              )}
            </span>
          </TableRow>
        );
      })}
    </Table>
  );
}

/** Asks once before a token stops working. */
export function useRevoke(revoke: (t: AiToken) => Promise<unknown>) {
  const [token, setToken] = useState<AiToken | null>(null);
  const dialog = (
    <ConfirmDialog
      open={!!token}
      onOpenChange={(o) => !o && setToken(null)}
      title={`Revoke "${token?.name ?? ''}"?`}
      description="The app that uses it stops working at once. This cannot be undone: make a new token if it is needed again."
      confirmLabel="Revoke"
      danger
      onConfirm={() => {
        if (token) void revoke(token).finally(() => setToken(null));
      }}
    />
  );
  return { ask: setToken, dialog };
}
