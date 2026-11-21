// Dialogs and panel fields of the Day tab: a note row, a linked break picked from the day's ads
// playlist, the "link to this break?" question, and fields that commit when they are left.

import { useEffect, useState } from 'react';
import { FRAME_RATES, NOTE_MAX, formatClockShort, formatLength } from '@9eye/core';
import { errorText } from '@/lib/api';
import type { Channel } from '@/lib/types';
import { ActionItem, Button, Dialog, EmptyState, Notice, SearchField, TextArea, TextField, dayText } from '@/ui';
import { useDay } from './queries';

export function NoteDialog({ open, onOpenChange, where, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; where: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  const n = text.trim().length;
  const ok = n > 0 && n <= NOTE_MAX;
  const add = () => {
    if (!ok) return;
    onAdd(text.trim());
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a note"
      description={`A line in the playlist that takes no time. ${where}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok} onClick={add}>
            Add note
          </Button>
        </>
      }
    >
      <TextField label="Note" value={text} maxLength={NOTE_MAX} autoFocus onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} hint={`${n} of ${NOTE_MAX} characters`} />
    </Dialog>
  );
}

export interface BreakChoice {
  breakTypeId: string;
  name: string;
  color: string;
}

/** The breaks of the day's ads playlist; one already linked in the block cannot be picked again. */
export function BreakDialog({
  open,
  onOpenChange,
  channel,
  date,
  used,
  where,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  channel: Channel;
  date: string;
  used: string[];
  where: string;
  onPick: (b: BreakChoice) => void;
}) {
  const ads = useDay(channel.id, 'ads', date, open);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (open) setQ('');
  }, [open]);
  const rate = FRAME_RATES[channel.frameRate as keyof typeof FRAME_RATES];
  const data = ads.data && ads.data.date === date && ads.data.kind === 'ads' ? ads.data : null;
  const needle = q.trim().toLowerCase();
  const blocks = (data?.day?.blocks ?? []).filter((b) => !needle || b.name.toLowerCase().includes(needle));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a linked break" description={`A place in the main playlist that is filled from the ads playlist. ${where}`} width={460}>
      {ads.isError ? (
        <Notice tone="red">{errorText(ads.error)}</Notice>
      ) : !data ? (
        <EmptyState>Loading…</EmptyState>
      ) : !data.day ? (
        <EmptyState>The ads playlist has no day for {dayText(date, true)} yet. Create its week first (Weeks tab, Ads playlist).</EmptyState>
      ) : (
        <>
          <SearchField value={q} onChange={setQ} placeholder={`Search ${data.day.blocks.length} breaks`} label="Search breaks" autoFocus />
          <div role="group" aria-label="Breaks of the ads playlist" className="flex max-h-[380px] flex-col gap-0.5 overflow-y-auto">
            {blocks.map((b) => (
              <ActionItem
                key={b.id}
                label={`${b.name} · ${formatLength(b.plannedLengthFrames, rate)}`}
                disabled={used.includes(b.blockTypeId)}
                hint="Already linked in this block"
                onClick={() => {
                  onPick({ breakTypeId: b.blockTypeId, name: b.name, color: b.color });
                  onOpenChange(false);
                }}
              />
            ))}
            {!blocks.length && <span className="px-3 py-2 text-small text-text-3">Nothing found.</span>}
          </div>
          <span className="text-meta text-text-3">In the order of the ads playlist; the first starts its run at {formatClockShort(0, channel.dayStartFrames, rate)}.</span>
        </>
      )}
    </Dialog>
  );
}

/** Rows going in under a linked break: as spots of it, or as plain rows after its spots. */
export function LinkDialog({ breakName, count, onAnswer, onCancel, verb = 'Insert' }: { breakName: string | null; count: number; onAnswer: (link: boolean) => void; onCancel: () => void; verb?: 'Insert' | 'Move' }) {
  return (
    <Dialog
      open={!!breakName}
      onOpenChange={(o) => !o && onCancel()}
      title={`Link to ${breakName ?? 'this break'}?`}
      description={`${count === 1 ? 'This row goes' : `These ${count} rows go`} in at a linked break. Linked, ${count === 1 ? 'it counts' : 'they count'} as its spots; not linked, ${count === 1 ? 'it goes' : 'they go'} in after the break's spots.`}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onAnswer(false)}>{verb} without linking</Button>
          <Button variant="primary" onClick={() => onAnswer(true)}>
            {verb} and link
          </Button>
        </>
      }
    />
  );
}

/** A note that is written freely and committed when the field is left (one undo step). */
export function NoteField({ value, disabled, onCommit }: { value: string; disabled?: boolean; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <TextArea label="Note" rows={2} placeholder="Add a note" value={text} disabled={disabled} maxLength={4000} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onCommit(text)} />;
}

/** The text of a note row, committed when the field is left or on Enter. */
export function NoteTextField({ value, disabled, onCommit }: { value: string; disabled?: boolean; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const t = text.trim();
    if (t && t !== value) onCommit(t);
    else setText(value);
  };
  return <TextField label="Text" value={text} disabled={disabled} maxLength={NOTE_MAX} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}
