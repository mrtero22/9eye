// Dialog of "Repeat a time range…" (column ⋯ menu): fields, a live preview, all-or-nothing.

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WEEKDAYS, formatTcShort, type TemplateDraft } from '@9eye/core';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { BlockType } from '@/lib/types';
import { Button, DayToggles, Dialog, Field, Notice, RadioList, TextField, useToast } from '@/ui';
import { clock, dayRun, parseClock, parseLength, seriesOf, type PageCtx } from './model';
import { planRepeat, type RepeatNaming } from './repeat';

export function RepeatDialog({
  open,
  onOpenChange,
  ctx,
  draft,
  weekday,
  defaultFrom,
  playlistId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ctx: PageCtx;
  draft: TemplateDraft;
  weekday: number;
  defaultFrom: number;
  playlistId: string;
  onDone: (d: TemplateDraft) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [every, setEvery] = useState('01:00');
  const [until, setUntil] = useState('');
  const [days, setDays] = useState<boolean[]>([]);
  const [naming, setNaming] = useState<RepeatNaming>('number');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setFrom(clock(ctx, defaultFrom));
    setTo(clock(ctx, Math.min(defaultFrom + ctx.fph, ctx.dayFrames)));
    setEvery('01:00');
    setUntil(clock(ctx, 0));
    setDays(draft.activeWeekdays.map((on, d) => on || d === weekday));
    setNaming('number');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const f = parseClock(ctx, from);
  const t0 = parseClock(ctx, to);
  const t = t0 === 0 ? ctx.dayFrames : t0;
  const e = parseLength(ctx, every);
  const u = parseClock(ctx, until);
  const plan = useMemo(
    () => (open && f !== null && t !== null && e !== null && u !== null ? planRepeat(ctx, draft, { weekday, from: f, to: t, every: e, until: u, days, naming }) : null),
    [open, ctx, draft, weekday, f, t, e, u, days, naming],
  );
  const ok = !!plan && !plan.problems.length && plan.blocks.length > 0;
  const placedDays = [...new Set(plan?.blocks.map((b) => b.weekday) ?? [])];

  const repeat = async () => {
    if (!plan || !ok) return;
    setBusy(true);
    setError(null);
    try {
      let created: BlockType[] = [];
      if (plan.newTypes.length) {
        created = await api<BlockType[]>('POST', '/block-types/bulk', {
          playlistId,
          items: plan.newTypes.map((n) => ({
            groupId: n.source.groupId,
            name: n.name,
            color: n.source.color,
            textColor: n.source.textColor,
            lengthFrames: n.source.lengthFrames,
            validFrom: n.source.validFrom,
            validTo: n.source.validTo,
            validWeekdays: n.source.validWeekdays,
            fillGaps: n.source.fillGaps,
            opensWithBreak: n.source.opensWithBreak,
            note: n.source.note,
          })),
        });
        qc.setQueryData<BlockType[]>(keys.blockTypes(), (old) => [...(old ?? []), ...created]);
        void qc.invalidateQueries({ queryKey: keys.blockTypes() });
      }
      const real = new Map(plan.newTypes.map((n, i) => [n.tempId, created[i].id]));
      const blocks = plan.blocks.map((b) => (real.has(b.blockTypeId) ? { ...b, blockTypeId: real.get(b.blockTypeId)! } : b));
      onDone({ ...draft, blocks: [...draft.blocks, ...blocks] });
      toast(`Repeated: ${blocks.length} blocks${created.length ? `, ${created.length} new block types` : ''}`);
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const names = (list: string[]) => (list.length <= 3 ? list.join(', ') : `${list[0]}, ${list[1]} … ${list[list.length - 1]}`);
  // "sp 7 … sp 96 (90), drama addbox 3 … drama addbox 48 (46)": the new block types, series by series
  const newBySeries = (() => {
    const groups = new Map<string, string[]>();
    for (const n of plan?.newTypes ?? []) {
      const key = naming === 'number' ? seriesOf(ctx, n.source).base : n.source.name.replace(/\s*\d{1,2}:\d{2}$/, '');
      groups.set(key, [...(groups.get(key) ?? []), n.name]);
    }
    return [...groups.values()].map((l) => (l.length === 1 ? l[0] : `${l[0]} … ${l[l.length - 1]} (${l.length})`)).join(', ');
  })();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={500}
      title={`Repeat a time range of ${WEEKDAYS[weekday].long}`}
      description="The blocks of the range are repeated until the end; each copy gets its own block types (a block type is used once per day)."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok || busy} onClick={() => void repeat()}>
            Repeat
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <TextField label="From" mono value={from} onChange={(x) => setFrom(x.target.value)} error={f === null ? 'A time of day' : undefined} />
        <TextField label="To" mono value={to} onChange={(x) => setTo(x.target.value)} error={t === null ? 'A time of day' : undefined} />
        <TextField label="Every" mono value={every} onChange={(x) => setEvery(x.target.value)} error={e === null ? 'A length, e.g. 01:00' : undefined} />
        <TextField
          label="Until"
          mono
          value={until}
          onChange={(x) => setUntil(x.target.value)}
          error={u === null ? 'A time of day' : undefined}
          hint={u === 0 ? 'The end of the broadcast day' : undefined}
        />
      </div>
      <Field label="On days">
        <DayToggles label="On days" tone="accent" size="sm" weekStart={ctx.channel.weekStart} value={days} onToggle={(d) => setDays(days.map((v, i) => (i === d ? !v : v)))} />
      </Field>
      <Field label="Names of the new block types">
        <RadioList
          label="Names of the new block types"
          value={naming}
          onChange={setNaming}
          options={[
            { value: 'number', label: 'The next number of each series (sp 5, sp 6 …)' },
            { value: 'time', label: "The name with the copy's time (sp 1 09:00 …)" },
          ]}
        />
      </Field>
      {plan && ok && (
        <Notice>
          <span>
            {plan.sourceBlocks.length} {plan.sourceBlocks.length === 1 ? 'block' : 'blocks'} of {clock(ctx, f!)}–{clock(ctx, t!)}, repeated {plan.copies}{' '}
            {plan.copies === 1 ? 'time' : 'times'} every {formatTcShort(e!, ctx.rate)}, until {u === 0 ? 'the end of the day' : clock(ctx, u!)}.
          </span>
          {plan.newTypes.length > 0 && (
            <span>
              Creates {plan.newTypes.length} block types: {newBySeries}.
            </span>
          )}
          {plan.reused.length > 0 && <span>Uses {plan.reused.length} unused ones: {names(plan.reused.map((r) => r.name))}.</span>}
          <span>
            Places {plan.blocks.length} blocks on {dayRun(ctx, placedDays)}
            {plan.skipped ? ` (${plan.skipped} are already there)` : ''}. One undo takes them back; new block types stay in the library.
          </span>
        </Notice>
      )}
      {plan && !ok && (
        <Notice tone="amber">
          <span className="font-medium">Nothing will be repeated{plan.problems.length ? ':' : '.'}</span>
          {plan.problems.slice(0, 6).map((p) => (
            <span key={p}>{p}</span>
          ))}
          {plan.problems.length > 6 && <span>and {plan.problems.length - 6} more.</span>}
          {!plan.problems.length && <span>All copies are already there.</span>}
        </Notice>
      )}
      {error && <Notice tone="red">{error}</Notice>}
    </Dialog>
  );
}
