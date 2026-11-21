// The order's operations (scheduling.md §4.1 / §5): each shows what will change first and is
// all-or-nothing. Copy week, auto-place, replace, shift, refresh durations and clear change the open
// order (Undo / Save); split, move airings and delete work on the saved order.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  autoPlace,
  copyWeek,
  firstsInOrder,
  formatLength,
  isRepeat,
  offsetFromClock,
  parseTc,
  replaceItems,
  shiftAirings,
  splitOrder,
  uuidv7,
  weekdayOf,
  type AiringDraft,
  type TimeWindow,
} from '@9eye/core';
import { api, errorText } from '@/lib/api';
import type { Channel, CompactTemplate, OrderFull } from '@/lib/types';
import {
  Button,
  CatalogPicker,
  CheckLine,
  Checkbox,
  CommitField,
  ConfirmDialog,
  ContextPicker,
  DatePicker,
  DayToggles,
  Dialog,
  PanelSection,
  IconButton,
  Notice,
  NumberField,
  Popover,
  PopoverFooter,
  RowList,
  Segmented,
  SelectField,
  SwatchPicker,
  TextField,
  formatDateRange,
  spanText,
  useToast,
  type CatalogPick,
} from '@/ui';
import { useChannels } from '@/lib/queries';
import type { OrderCtx } from './ctx';
import { SWATCHES, airingTitle, familiesFor, isProgrammeMode, shortDay, toDraft, type TimeCtx } from './model';
import { orderKeys, useOccupied } from './queries';

const plural = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- Copy week to the whole order

export function CopyWeekPopover({ ctx, open, onOpenChange }: { ctx: OrderCtx; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { draft: d, ws, we, items } = ctx;
  const toast = useToast();
  const occupied = useOccupied(ctx.full.order.id, open && isProgrammeMode(d.mode));
  const r = useMemo(() => (open ? copyWeek(d, ctx.rules, ctx.channelId, ws) : null), [open, d, ctx.rules, ctx.channelId, ws]);
  const series = d.mode === 'series';
  const mine = d.airings.filter((a) => a.channelId === ctx.channelId && a.date >= ws && a.date <= we);
  const weekFirsts = mine.filter((a) => !isRepeat(a)).length;
  const weekRepeats = mine.filter(isRepeat).length;
  const spillRepeats = mine.filter((a) => a.repeatOfId && (ctx.byId.get(a.repeatOfId)?.date ?? ws) < ws);
  const taken = useMemo(() => {
    if (!r?.ok || !occupied.data) return 0;
    const cells = new Set(occupied.data.filter((c) => c.channelId === ctx.channelId).map((c) => `${c.date}|${c.blockTypeId}`));
    return r.airings.filter((a) => a.channelId === ctx.channelId && cells.has(`${a.date}|${a.blockTypeId}`)).length;
  }, [r, occupied.data, ctx.channelId]);
  const num = (id: string | null) => (id ? (items.get(id)?.info?.chapter ?? (items.get(id)?.position ?? 0) + 1) : null);
  const complete = ws >= d.startDate && we <= d.endDate;
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      label="Copy week to the whole plan"
      width={390}
      align="end"
      padding="p-4"
      trigger={
        <Button icon="copy" aria-expanded={open}>
          Copy week to the whole plan
        </Button>
      }
    >
      {r && (
        <>
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">Copy this week to the whole plan</span>
            <span className="text-small text-text-2">
              Copies {spanText(ws, we)} to the other {plural(r.otherWeeks || Math.max(0, Math.round((Date.parse(d.endDate) - Date.parse(d.startDate)) / 6048e5)), 'week')} of the plan ({formatDateRange(d.startDate, d.endDate)}).
            </span>
          </span>
          <div className="flex flex-col gap-1.5">
            <CheckLine ok={complete}>
              {complete ? `Complete week: ${shortDay(ws)} → ${shortDay(we)}, every day inside the plan` : `Not a complete week of the plan (${formatDateRange(d.startDate, d.endDate)}). Pick a week with all seven days inside.`}
            </CheckLine>
            {series || d.mode === 'programmes' ? (
              <CheckLine ok={weekFirsts > 0}>
                {weekFirsts ? `${plural(weekFirsts, 'first airing')}${weekRepeats ? ` and ${plural(weekRepeats, 'repeat')}` : ', no repeats'} in this week` : 'This week has no airings: copying it empties every other week of the plan'}
              </CheckLine>
            ) : (
              <CheckLine ok={weekFirsts > 0}>{weekFirsts ? 'Plays of every block in this week' : 'This week has no plays: copying it empties every other week of the plan'}</CheckLine>
            )}
            {spillRepeats.length > 0 ? (
              <CheckLine ok>
                {spillRepeats.length === 1 ? '1 repeat replays an airing of last week' : `${spillRepeats.length} repeats replay airings of last week`} ({spillRepeats.map((a) => `${shortDay(a.date).slice(0, 3)} ${ctx.t.clock(ctx.days[new Date(`${a.date}T00:00:00Z`).getUTCDay()]?.get(a.blockTypeId)?.startFrames ?? 0)}`).join(', ')}); carried into every week
              </CheckLine>
            ) : (
              <CheckLine ok>No repeat crosses into another week</CheckLine>
            )}
          </div>
          <div className="flex flex-col gap-0.5 rounded-item bg-surface-2 px-3 py-2.5 text-small">
            {!r.ok ? (
              <span className="text-amber-text">{r.reason}</span>
            ) : series || d.mode === 'programmes' ? (
              <>
                <span className="font-medium">
                  {r.firsts ? `After copying: ${plural(r.firsts, 'first airing')}${r.repeats ? ` and ${plural(r.repeats, 'repeat')}` : ', no repeats'}` : 'After copying: no airings left in the plan'}
                </span>
                <span className="text-text-2">
                  {[
                    series && r.firsts ? `Episodes ${num(r.firstItemId)}–${num(r.lastItemId)}, the last on ${r.lastFirstDate ? shortDay(r.lastFirstDate) : '—'}` : '',
                    r.ranOut ? `${r.ranOut} first airings left empty: the list runs out` : '',
                    r.notPlaced ? `${plural(r.notPlaced, 'episode')} not placed` : '',
                    r.withoutFirst ? `${plural(r.withoutFirst, 'repeat')} without a first airing left out` : '',
                    occupied.data ? `${plural(taken, 'block')} taken by other plans` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </>
            ) : (
              <>
                <span className="font-medium">After copying: the same plays in every block of {plural(r.otherWeeks + 1, 'week')}</span>
                <span className="text-text-2">{plural(r.passes, 'play')} in all{r.outside ? ` · ${r.outside} outside the plan's dates left out` : ''}</span>
              </>
            )}
          </div>
          <span className="text-meta text-text-3">The other weeks are filled from this one; in series mode each new first airing takes the next episode. If any airing cannot be placed, nothing changes.</span>
          <PopoverFooter>
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!r.ok}
              onClick={() => {
                if (ctx.apply({ ...d, airings: r.airings })) {
                  onOpenChange(false);
                  toast(`Week copied to ${plural(r.otherWeeks, 'week')}`);
                }
              }}
            >
              {r.ok ? `Copy to ${plural(r.otherWeeks, 'week')}` : 'Copy'}
            </Button>
          </PopoverFooter>
        </>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------- limits

export interface LimitsValue {
  maxAirings: number | null;
  totalAirings: number | null;
  timeWindows: { allowed: TimeWindow[]; rejected: TimeWindow[] };
}

function WindowRows({ t, dayFrames, list, onChange, kind }: { t: TimeCtx; dayFrames: number; list: TimeWindow[]; onChange: (l: TimeWindow[]) => void; kind: 'allowed' | 'rejected' }) {
  const parse = (s: string) => {
    const f = parseTc(s, t.rate, { maxHours: 24 });
    return f === null ? null : offsetFromClock(f, t.channel.dayStartFrames, t.rate);
  };
  return (
    <div className="flex flex-col gap-2">
      {list.map((w, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <DayToggles label={`${kind === 'allowed' ? 'Allowed' : 'Rejected'} window ${i + 1} days`} tone="accent" size="sm" weekStart={t.channel.weekStart} value={w.weekdays} onToggle={(day) => onChange(list.map((x, j) => (j === i ? { ...x, weekdays: x.weekdays.map((v, k) => (k === day ? !v : v)) } : x)))} />
          <CommitField ariaLabel="From" width={72} value={w.fromFrames} format={(v) => t.clock(v)} parse={parse} onCommit={(v) => onChange(list.map((x, j) => (j === i ? { ...x, fromFrames: v } : x)))} />
          <span className="text-text-3">–</span>
          <CommitField
            ariaLabel="To"
            width={72}
            value={w.toFrames}
            format={(v) => t.clock(v)}
            parse={(s) => {
              const v = parse(s);
              return v === 0 ? dayFrames : v;
            }}
            onCommit={(v) => onChange(list.map((x, j) => (j === i ? { ...x, toFrames: v } : x)))}
          />
          <IconButton icon="close" size="sm" tone="quiet" label="Remove this window" onClick={() => onChange(list.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button size="xs" icon="plus" className="self-start" onClick={() => onChange([...list, { weekdays: [true, true, true, true, true, true, true], fromFrames: 0, toFrames: t.fph * 6 }])}>
        Add {kind} window
      </Button>
    </div>
  );
}

/** Airing limits and time windows (maximum / total showings, allowed / rejected time windows). */
export function LimitsEditor({ t, dayFrames, series, value, onApply, onClose }: { t: TimeCtx; dayFrames: number; series: boolean; value: LimitsValue; onApply: (v: LimitsValue) => boolean | void; onClose: () => void }) {
  const [max, setMax] = useState(value.maxAirings ? String(value.maxAirings) : '');
  const [total, setTotal] = useState(value.totalAirings ? String(value.totalAirings) : '');
  const [allowed, setAllowed] = useState(value.timeWindows.allowed);
  const [rejected, setRejected] = useState(value.timeWindows.rejected);
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => (s.trim() === '' ? null : /^\d+$/.test(s.trim()) && Number(s) > 0 ? Number(s) : NaN);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Limits"
      description="Airing limits and the time windows auto-place and rotation keep to."
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const m = num(max);
              const tt = num(total);
              if (Number.isNaN(m) || Number.isNaN(tt)) return setError('Airing limits are whole numbers from 1, or empty.');
              if ([...allowed, ...rejected].some((w) => !w.weekdays.some(Boolean) || w.fromFrames === w.toFrames)) return setError('Each time window needs a day and a start before its end.');
              if (onApply({ maxAirings: m, totalAirings: tt, timeWindows: { allowed, rejected } }) !== false) onClose();
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <TextField label="Maximum airings" mono value={max} placeholder="No limit" onChange={(e) => setMax(e.target.value)} hint={series ? 'First airings' : 'Plays'} />
        <TextField label="Total airings expected" mono value={total} placeholder="—" onChange={(e) => setTotal(e.target.value)} />
      </div>
      <PanelSection title="Allowed time windows (none: anywhere)">
        <WindowRows t={t} dayFrames={dayFrames} list={allowed} onChange={setAllowed} kind="allowed" />
      </PanelSection>
      <PanelSection title="Rejected time windows">
        <WindowRows t={t} dayFrames={dayFrames} list={rejected} onChange={setRejected} kind="rejected" />
      </PanelSection>
      {error && <Notice tone="amber">{error}</Notice>}
    </Dialog>
  );
}

export function LimitsDialog({ ctx, onClose }: { ctx: OrderCtx; onClose: () => void }) {
  const d = ctx.draft;
  return <LimitsEditor t={ctx.t} dayFrames={ctx.rules.dayFrames} series={d.mode === 'series'} value={d} onApply={(v) => ctx.apply({ ...d, ...v })} onClose={onClose} />;
}

// ---------------------------------------------------------------- all fields

export function AllFieldsDialog({ ctx, onClose, onLimits }: { ctx: OrderCtx; onClose: () => void; onLimits: () => void }) {
  const d = ctx.draft;
  const channels = useChannels();
  const [name, setName] = useState(d.name);
  const [color, setColor] = useState(d.color);
  const [chans, setChans] = useState(d.channels);
  const [templates, setTemplates] = useState<Record<string, string>>(Object.fromEntries(ctx.full.channels.map((c) => [c.channel.id, c.template.name])));
  const [error, setError] = useState<string | null>(null);
  const others = (channels.data ?? []).filter((c) => !chans.some((x) => x.channelId === c.id) && c.mainPlaylistId);
  const addChannel = async (c: Channel) => {
    try {
      const t = await api<CompactTemplate | null>('GET', `/channels/${c.id}/main-template?from=${d.startDate}&to=${d.endDate}`);
      if (!t) return setError(`${c.name} has no main layout for these dates.`);
      setChans([...chans, { channelId: c.id, templateId: t.id }]);
      setTemplates({ ...templates, [c.id]: t.name });
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const chName = (id: string) => (channels.data ?? []).find((c) => c.id === id)?.name ?? ctx.full.channels.find((c) => c.channel.id === id)?.channel.name ?? 'Channel';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="All fields"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!name.trim()) return setError('The name is required.');
              const gone = d.channels.filter((c) => !chans.some((x) => x.channelId === c.channelId)).map((c) => c.channelId);
              if (d.airings.some((a) => gone.includes(a.channelId))) return setError('A channel with airings cannot leave the plan. Delete its airings first.');
              if (ctx.apply({ ...d, name: name.trim(), color, channels: chans })) onClose();
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <PanelSection title="Colour">
        <SwatchPicker label="Plan colour" colors={SWATCHES.slice(0, -1).includes(color) ? SWATCHES.slice(0, -1) : [color, ...SWATCHES.slice(0, -1)]} value={color} onChange={setColor} />
      </PanelSection>
      <div className="grid grid-cols-2 gap-2.5 text-small">
        <span className="flex flex-col gap-0.5">
          <span className="text-meta text-text-2">Mode</span>
          {d.mode[0].toUpperCase() + d.mode.slice(1)}
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-meta text-text-2">Dates</span>
          <span className="mono">{formatDateRange(d.startDate, d.endDate)}</span>
        </span>
      </div>
      <PanelSection title="Channels (more than one makes a multi-channel plan: one item list, each channel placed on its own layout)">
        <RowList>
          {chans.map((c, i) => (
            <div key={c.channelId} className="flex min-h-9 items-center gap-2 px-2.5 text-small">
              <span className="flex-1 font-medium">{chName(c.channelId)}</span>
              <span className="text-meta text-text-3">{templates[c.channelId] ?? ''}</span>
              {i > 0 && <IconButton icon="close" size="xs" tone="quiet" label={`Remove ${chName(c.channelId)}`} onClick={() => setChans(chans.filter((x) => x.channelId !== c.channelId))} />}
            </div>
          ))}
        </RowList>
      </PanelSection>
      {others.length > 0 && (
        <span className="-ml-2">
          <ContextPicker label="Add a channel" searchLabel="channels" value="" items={others.map((c) => ({ id: c.id, name: c.name }))} onPick={(id) => addChannel(others.find((c) => c.id === id)!)} />
        </span>
      )}
      <div className="flex items-center justify-between gap-3 text-small">
        <span className="text-text-2">
          {d.maxAirings ? `At most ${d.maxAirings} airings` : 'No airing limit'}
          {d.totalAirings ? ` · ${d.totalAirings} expected` : ''}
        </span>
        <Button size="xs" onClick={onLimits}>
          Edit limits…
        </Button>
      </div>
      <span className="text-meta text-text-3">Rights bundle, pricing, clash codes and custom fields come with their modules.</span>
      {error && <Notice tone="amber">{error}</Notice>}
    </Dialog>
  );
}

export function ChangeEndDialog({ ctx, onClose }: { ctx: OrderCtx; onClose: () => void }) {
  const d = ctx.draft;
  const [end, setEnd] = useState(d.endDate);
  const after = d.airings.filter((a) => a.date > end).length;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Change end date"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={after > 0} onClick={() => ctx.apply({ ...d, endDate: end }) && onClose()}>
            Apply
          </Button>
        </>
      }
    >
      <DatePicker mode="day" label="Last day" weekStart={ctx.channel.weekStart} today={ctx.channel.today} value={end} min={d.startDate} limitText={`On or after the start, ${shortDay(d.startDate)}.`} onChange={(v) => setEnd(v.value)} />
      {after > 0 && <Notice tone="amber">{plural(after, 'airing')} after {shortDay(end)} would fall outside the plan. Delete them first, or pick a later day.</Notice>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- split, move (saved order)

function SaveFirst({ ctx }: { ctx: OrderCtx }) {
  return ctx.dirty ? <Notice tone="amber">This works on the saved plan. Save or undo your changes first.</Notice> : null;
}

export function SplitDialog({ ctx, onClose, onDone }: { ctx: OrderCtx; onClose: () => void; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const saved = useMemo(() => toDraft(ctx.full), [ctx.full]);
  const [date, setDate] = useState(() => {
    const t = addDays(ctx.channel.today, 1);
    return t > saved.startDate && t <= saved.endDate ? t : addDays(saved.startDate, 1);
  });
  const [name, setName] = useState(`${saved.name} (2)`);
  const s = useMemo(() => splitOrder(saved, date, name), [saved, date, name]);
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('POST', `/orders/${ctx.full.order.id}/split`, { version: ctx.full.order.version, date, name }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: orderKeys.all() });
      toast('Plan split');
      onClose();
      onDone(r.id);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Split plan"
      description="Ends this plan at a date; the rest continues in a new plan with the same settings and items."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={ctx.dirty || !s.ok || m.isPending} onClick={() => m.mutate()}>
            Split
          </Button>
        </>
      }
    >
      <SaveFirst ctx={ctx} />
      <DatePicker
        mode="day"
        label="New plan starts"
        weekStart={ctx.channel.weekStart}
        today={ctx.channel.today}
        value={date}
        min={addDays(saved.startDate, 1)}
        max={saved.endDate}
        limitText={`Inside the plan, after its first day: ${shortDay(addDays(saved.startDate, 1))} → ${shortDay(saved.endDate)}.`}
        onChange={(v) => setDate(v.value)}
      />
      <TextField label="Name of the new plan" value={name} onChange={(e) => setName(e.target.value)} />
      {s.ok ? (
        <div className="flex flex-col gap-1 rounded-item bg-surface-2 px-3 py-2.5 text-small">
          <span>
            <span className="font-medium">{saved.name}</span> ends {shortDay(addDays(date, -1))} with {plural(s.keep.airings.length, 'airing')}.
          </span>
          <span>
            <span className="font-medium">{name.trim() || 'The new plan'}</span> runs {formatDateRange(date, saved.endDate)} with {plural(s.moved, 'airing')}.
          </span>
          {s.droppedRepeats > 0 && <span className="text-amber-text">{plural(s.droppedRepeats, 'repeat')} of airings before {shortDay(date)} are removed.</span>}
        </div>
      ) : (
        <Notice tone="amber">{s.reason}</Notice>
      )}
      {m.error && <Notice tone="red">{errorText(m.error)}</Notice>}
    </Dialog>
  );
}

export function MoveDialog({ ctx, onClose }: { ctx: OrderCtx; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const id = ctx.full.order.id;
  const targets = useQuery({ queryKey: orderKeys.targets(id), queryFn: () => api<{ id: string; name: string; status: string }[]>('GET', `/orders/${id}/move-targets`) });
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const tgt = useQuery({ queryKey: orderKeys.one(target || null), queryFn: () => api<OrderFull>('GET', `/orders/${target}`), enabled: !!target });
  const saved = useMemo(() => toDraft(ctx.full), [ctx.full]);
  const count = (itemId: string) => saved.airings.filter((a) => !isRepeat(a) && a.items.some((x) => x.itemId === itemId)).length;
  const moving = saved.airings.filter((a) => !isRepeat(a) && a.items.length && a.items.every((x) => chosen.has(x.itemId)));
  const withRepeats = moving.length + saved.airings.filter((a) => a.repeatOfId && moving.some((m) => m.id === a.repeatOfId)).length;
  const m = useMutation({
    mutationFn: () => api<{ moved: number }>('POST', `/orders/${id}/move`, { version: ctx.full.order.version, itemIds: [...chosen], targetId: target, targetVersion: tgt.data!.order.version }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: orderKeys.all() });
      toast(`${plural(r.moved, 'airing')} moved`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Move airings"
      description="The chosen items' airings, with their repeats, move to another plan with the same dates, channels and mode."
      width={500}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={ctx.dirty || !chosen.size || !target || !tgt.data || !moving.length || m.isPending} onClick={() => m.mutate()}>
            Move {withRepeats ? plural(withRepeats, 'airing') : ''}
          </Button>
        </>
      }
    >
      <SaveFirst ctx={ctx} />
      <PanelSection title="Items">
        <div className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto rounded-item border border-border p-2.5">
          {ctx.full.items.map((i) => (
            <Checkbox key={i.id} checked={chosen.has(i.id)} onChange={(v) => setChosen((s) => (v ? new Set([...s, i.id]) : new Set([...s].filter((x) => x !== i.id))))}>
              <span className="flex-1">{i.title}</span>
              <span className="mono text-meta text-text-3">{count(i.id)}</span>
            </Checkbox>
          ))}
        </div>
      </PanelSection>
      <SelectField label="To the plan" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">{targets.data && !targets.data.length ? 'No plan with the same dates, channels and mode' : 'Pick a plan'}</option>
        {(targets.data ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.status === 'draft' ? ' (draft)' : ''}
          </option>
        ))}
      </SelectField>
      {chosen.size > 0 && <span className="text-small text-text-2">{moving.length ? `Moves ${plural(withRepeats, 'airing')} (${plural(moving.length, 'first airing')} and their repeats).` : 'The chosen items share their blocks with other items: nothing of their own to move.'}</span>}
      {m.error && <Notice tone="red">{errorText(m.error)}</Notice>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- shift airings

/** The episodes move along the order's airing days; days, blocks and repeats stay (user, 2026-10-23). */
export function ShiftDialog({ ctx, start, onClose }: { ctx: OrderCtx; start: string | null; onClose: () => void }) {
  const d = ctx.draft;
  const toast = useToast();
  const occupied = useOccupied(ctx.full.order.id, true);
  const firsts = useMemo(() => firstsInOrder(d, ctx.rules, ctx.channelId), [d, ctx.rules, ctx.channelId]);
  const [from, setFrom] = useState(() => (start && firsts.some((a) => a.id === start) ? start : (firsts.find((a) => a.date >= ctx.channel.today) ?? firsts[0])?.id ?? ''));
  const [days, setDays] = useState<number | null>(1);
  const [dir, setDir] = useState<'later' | 'earlier'>('later');
  const n = days ?? 0;
  const r = useMemo(() => (from && n > 0 ? shiftAirings(d, ctx.rules, ctx.channelId, from, dir === 'later' ? n : -n) : null), [d, ctx.rules, ctx.channelId, from, n, dir]);
  const clock = (a: AiringDraft) => ctx.t.clock(ctx.days[weekdayOf(a.date)]?.get(a.blockTypeId)?.startFrames ?? 0);
  const when = (a: AiringDraft) => `${shortDay(a.date)} ${clock(a)}`;
  const title = (a: AiringDraft) => airingTitle(a, ctx.byId, ctx.items);
  const daysText = (list: { airing: AiringDraft; repeats: number }[]) =>
    `${list.slice(0, 3).map((x) => `${when(x.airing)}${x.repeats ? ` with ${plural(x.repeats, 'repeat')}` : ''}`).join(', ')}${list.length > 3 ? `, and ${list.length - 3} more` : ''}`;
  // new airings on blocks other programme orders hold (saved): a warning only
  const shared = useMemo(() => {
    if (!r?.ok || !occupied.data) return [];
    const cells = new Map(occupied.data.filter((c) => c.channelId === ctx.channelId).map((c) => [`${c.date}|${c.blockTypeId}`, c.orderName]));
    const before = new Set(d.airings.map((a) => a.id));
    return r.airings.filter((a) => !before.has(a.id) && cells.has(`${a.date}|${a.blockTypeId}`)).map((a) => `${cells.get(`${a.date}|${a.blockTypeId}`)} (${when(a)})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, occupied.data, ctx.channelId, d.airings]);
  const fromAiring = ctx.byId.get(from);
  const ways = `${plural(n, 'airing day')} ${dir}`;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Shift airings"
      description="The chosen episode and the ones after it (later) or before it (earlier) move along the plan's airing days. The days, blocks and repeats stay where they are."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!r?.ok}
            onClick={() => {
              if (r?.ok && ctx.apply({ ...d, airings: r.airings })) {
                toast(`${plural(r.moved, 'episode')} shifted ${ways}`);
                onClose();
              }
            }}
          >
            Shift {r?.ok ? plural(r.moved, 'episode') : 'episodes'}
          </Button>
        </>
      }
    >
      <SelectField label="From this first airing" value={from} disabled={!firsts.length} onChange={(e) => setFrom(e.target.value)}>
        {!firsts.length && <option value="">No first airings on {ctx.channel.name}</option>}
        {firsts.map((a) => (
          <option key={a.id} value={a.id}>
            {title(a)} · {shortDay(a.date)} · {clock(a)}
          </option>
        ))}
      </SelectField>
      <div className="flex items-end gap-3">
        <div className="w-28">
          <NumberField label="Airing days" value={days} min={1} onChange={setDays} />
        </div>
        <Segmented label="Direction" value={dir} onChange={setDir} options={[{ value: 'later', label: 'Later' }, { value: 'earlier', label: 'Earlier' }]} />
      </div>
      {r &&
        (r.ok ? (
          <div className="flex flex-col gap-1.5 rounded-item bg-surface-2 px-3 py-2.5 text-small">
            <span className="font-medium">
              {plural(r.moved, 'episode')} {dir === 'later' ? 'from' : 'up to'} {fromAiring ? title(fromAiring) : 'it'}
              {dir === 'later' ? ' on' : ''} move {ways}.
            </span>
            {r.emptied.length > 0 && <span className="text-text-2">Left empty: {daysText(r.emptied)}.</span>}
            {r.added.length > 0 && (
              <span className="text-text-2">
                {dir === 'later' ? 'New at the end' : 'New at the start'}, from the weekly pattern: {daysText(r.added)}.
              </span>
            )}
            {r.outside > 0 && <span className="text-text-2">{plural(r.outside, 'repeat')} outside the plan's dates left out.</span>}
            {shared.length > 0 && (
              <CheckLine ok={false}>
                {plural(shared.length, 'new airing')} also {shared.length === 1 ? 'shares its block' : 'share their blocks'} with another plan's programme: {shared.slice(0, 3).join(', ')}
                {shared.length > 3 ? `, and ${shared.length - 3} more` : ''}.
              </CheckLine>
            )}
          </div>
        ) : (
          r.reason && <Notice tone="amber">{r.reason}</Notice>
        ))}
    </Dialog>
  );
}

// ---------------------------------------------------------------- replace, refresh, auto-place, clear, delete

export function ReplaceDialog({ ctx, onClose }: { ctx: OrderCtx; onClose: () => void }) {
  const d = ctx.draft;
  const toast = useToast();
  const tomorrow = addDays(ctx.channel.today, 1);
  const [olds, setOlds] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<CatalogPick | null>(null);
  const [from, setFrom] = useState(tomorrow > d.startDate ? tomorrow : d.startDate);
  const [to, setTo] = useState(d.endDate < from ? from : d.endDate);
  const [bts, setBts] = useState<Set<string>>(new Set());
  const newItem = pick?.items[0];
  const existing = newItem ? d.items.find((i) => i.productionId === newItem.productionId) : undefined;
  const newId = useMemo(() => existing?.id ?? uuidv7(), [existing?.id, newItem?.productionId]);
  const r = useMemo(() => (olds.size && newItem ? replaceItems(d, { oldItemIds: [...olds], newItemId: newId, from, to, blockTypeIds: [...bts] }) : null), [d, olds, newItem, newId, from, to, bts]);
  const blockTypes = Object.entries(ctx.template.blockTypes).sort((a, b) => a[1].name.localeCompare(b[1].name));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Replace items"
      description="Puts another item in place of the chosen ones, from a day on."
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!r || !r.found}
            onClick={() => {
              if (!r || !newItem) return;
              if (!existing) ctx.addInfo(new Map([[newItem.productionId, { title: newItem.title, chapter: newItem.chapter, code: newItem.houseId, contentId: newItem.contentId, contentTitle: newItem.content, catalogLengthFrames: newItem.lengthFrames }]]));
              const items = existing ? d.items : [...d.items, { id: newId, productionId: newItem.productionId, lengthFrames: newItem.lengthFrames }];
              if (ctx.apply({ ...d, items, airings: r.airings })) {
                toast(`${plural(r.found, 'airing')} changed`);
                onClose();
              }
            }}
          >
            Replace in {r ? plural(r.found, 'airing') : 'airings'}
          </Button>
        </>
      }
    >
      <PanelSection title="Items to replace">
        <div className="flex max-h-[160px] flex-col gap-1.5 overflow-y-auto rounded-item border border-border p-2.5">
          {d.items.map((i) => (
            <Checkbox key={i.id} checked={olds.has(i.id)} onChange={(v) => setOlds((s) => (v ? new Set([...s, i.id]) : new Set([...s].filter((x) => x !== i.id))))}>
              {ctx.items.get(i.id)?.info?.title ?? 'Item'}
            </Checkbox>
          ))}
        </div>
      </PanelSection>
      <PanelSection title="New item">
        <CatalogPicker
          pick="one"
          families={familiesFor(d.mode)}
          frameRate={ctx.channel.frameRate}
          startContent={ctx.full.items[0]?.contentId ?? null}
          already={[...olds].map((id) => d.items.find((i) => i.id === id)?.productionId ?? '')}
          date={from}
          title="Pick the new item"
          context={`For ${d.name}`}
          trigger="Pick the new item…"
          triggerStyle="button"
          showResult
          onPick={setPick}
        />
      </PanelSection>
      <DatePicker mode="range" label="From – to" width={320} weekStart={ctx.channel.weekStart} today={ctx.channel.today} from={from} to={to} min={tomorrow} limitText="From tomorrow on." onChange={(v) => { setFrom(v.from); setTo(v.to); }} />
      <PanelSection title="Only in these block types (none: all)">
        <div className="flex max-h-[140px] flex-col gap-1.5 overflow-y-auto rounded-item border border-border p-2.5">
          {blockTypes.map(([id, b]) => (
            <Checkbox key={id} checked={bts.has(id)} onChange={(v) => setBts((s) => (v ? new Set([...s, id]) : new Set([...s].filter((x) => x !== id))))}>
              {b.name}
            </Checkbox>
          ))}
        </div>
      </PanelSection>
      {r && (
        <div className="flex flex-col gap-0.5 rounded-item bg-surface-2 px-3 py-2.5 text-small">
          <span className="font-medium">{plural(r.found, 'airing')} found</span>
          {r.ignored.map((x) => (
            <span key={x.reason} className="text-text-2">
              {plural(x.count, 'airing')} {x.reason}: left as they are
            </span>
          ))}
        </div>
      )}
    </Dialog>
  );
}

export function RefreshDialog({ ctx, onClose }: { ctx: OrderCtx; onClose: () => void }) {
  const d = ctx.draft;
  const toast = useToast();
  const changes = d.items
    .map((i) => ({ i, info: ctx.info.get(i.productionId) }))
    .filter((x) => x.info && (x.info.catalogLengthFrames ?? null) !== (x.i.lengthFrames ?? null));
  const len = (f: number | null | undefined) => (f ? formatLength(f, ctx.t.rate) : 'no length');
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Refresh durations"
      description="Reads each item's length from Media again."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {changes.length ? 'Cancel' : 'Close'}
          </Button>
          {changes.length > 0 && (
            <Button
              variant="primary"
              onClick={() => {
                const next = new Map(changes.map((c) => [c.i.id, c.info!.catalogLengthFrames ?? null]));
                if (ctx.apply({ ...d, items: d.items.map((i) => (next.has(i.id) ? { ...i, lengthFrames: next.get(i.id)! } : i)) })) {
                  toast(`${plural(changes.length, 'length')} refreshed`);
                  onClose();
                }
              }}
            >
              Refresh {plural(changes.length, 'length')}
            </Button>
          )}
        </>
      }
    >
      {changes.length ? (
        <RowList>
          {changes.slice(0, 50).map((c) => (
            <div key={c.i.id} className="flex min-h-8 items-center gap-2 px-2.5 text-small">
              <span className="min-w-0 flex-1 truncate">{c.info!.title}</span>
              <span className="mono text-meta text-text-3">
                {len(c.i.lengthFrames)} → {len(c.info!.catalogLengthFrames)}
              </span>
            </div>
          ))}
        </RowList>
      ) : (
        <span className="text-small text-text-2">Every length matches Media.</span>
      )}
    </Dialog>
  );
}

export function AutoPlaceDialog({ ctx, onClose }: { ctx: OrderCtx; onClose: () => void }) {
  const d = ctx.draft;
  const toast = useToast();
  const programme = isProgrammeMode(d.mode);
  const occupied = useOccupied(ctx.full.order.id, programme);
  const [perBlock, setPerBlock] = useState('1');
  const taken = useMemo(() => new Set((occupied.data ?? []).filter((c) => c.channelId === ctx.channelId).map((c) => `${c.date}|${c.blockTypeId}`)), [occupied.data, ctx.channelId]);
  const r = useMemo(() => autoPlace(d, ctx.rules, ctx.channelId, { passesPerBlock: Math.max(1, Number(perBlock) || 1), taken }), [d, ctx.rules, ctx.channelId, perBlock, taken]);
  const current = d.airings.filter((a) => a.channelId === ctx.channelId).length;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Auto-place"
      description="Fills the whole plan from its settings: items, time windows and limits."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!r.ok || !r.placed}
            onClick={() => {
              if (ctx.apply({ ...d, airings: r.airings })) {
                toast(`${plural(r.placed, programme ? 'airing' : 'play')} placed`);
                onClose();
              }
            }}
          >
            Place
          </Button>
        </>
      }
    >
      {!programme && <TextField label="Plays per block" mono value={perBlock} onChange={(e) => setPerBlock(e.target.value)} />}
      {r.ok ? (
        <div className="flex flex-col gap-0.5 rounded-item bg-surface-2 px-3 py-2.5 text-small">
          <span className="font-medium">{plural(r.placed, programme ? 'item' : 'play')} will be placed.</span>
          {current > 0 && <span className="text-amber-text">The plan's {plural(current, 'airing')} on {ctx.channel.name} are replaced.</span>}
          {programme && <span className="text-text-2">Blocks other programme plans hold are skipped.</span>}
        </div>
      ) : (
        <Notice tone="amber">{r.reason}</Notice>
      )}
    </Dialog>
  );
}

export function ClearDialog({ ctx, onClose }: { ctx: OrderCtx; onClose: () => void }) {
  const n = ctx.draft.airings.length;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Clear all airings?"
      description={`Removes all ${plural(n, 'airing')} of this plan${ctx.full.channels.length > 1 ? ' on every channel' : ''}. Undo brings them back until you save.`}
      confirmLabel="Clear all airings"
      danger
      onConfirm={() => {
        ctx.apply({ ...ctx.draft, airings: [] });
        onClose();
      }}
    />
  );
}

export function DeleteOrderDialog({ ctx, onClose, onDone }: { ctx: OrderCtx; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), []);
  const m = useMutation({
    mutationFn: () => api('DELETE', `/orders/${ctx.full.order.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orderKeys.all() });
      toast('Plan deleted');
      onClose();
      onDone();
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${ctx.draft.name}?`}
      description={error ?? `The plan and all its ${plural(ctx.full.airings.length, 'airing')} are deleted${ctx.dirty ? ', with your unsaved changes' : ''}. The playlist keeps what it already placed.`}
      confirmLabel="Delete plan"
      danger
      onConfirm={() => m.mutate()}
    />
  );
}
