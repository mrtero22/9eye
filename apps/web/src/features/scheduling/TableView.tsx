// Table view of an order (scheduling-page.md "Table view"): the order's airings of the shown week,
// selectable, with Bulk edit… and Delete; a row opens its block in the calendar.

import { useEffect, useState } from 'react';
import { isRepeat, weekdayOf, type AiringDraft } from '@9eye/core';
import { Button, Checkbox, DataTable, DatePicker, Dialog, Notice, SelectField } from '@/ui';
import type { OrderCtx } from './ctx';
import { removeAirings } from './edits';
import { airingTitle, dayBlocks, isProgrammeMode, repeatText, shortDay, timeWithDay } from './model';
import { weekAirings } from './grid';
import { useSearchParams } from 'react-router';

export function TableView({ ctx }: { ctx: OrderCtx }) {
  const { draft: d, t, items, byId } = ctx;
  const [, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  useEffect(() => setSelected(new Set()), [ctx.ws]);
  const start = (a: AiringDraft) => ctx.days[weekdayOf(a.date)]?.get(a.blockTypeId)?.startFrames ?? 0;
  const rows = weekAirings(d, ctx.channelId, ctx.ws, ctx.we).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : start(a) - start(b)));
  const programme = isProgrammeMode(d.mode);
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string, on: boolean) => {
    const s = new Set(selected);
    if (on) s.add(id);
    else s.delete(id);
    setSelected(s);
  };
  const blockName = (a: AiringDraft) => ctx.template.blockTypes[a.blockTypeId]?.name ?? 'Block';
  return (
    <>
      <DataTable
        label="Airings this week"
        minWidth={760}
        rowHeight="min-h-[var(--row)]"
        toolbar={
          <>
            <span className="flex-1">
              {rows.length} {programme ? 'airings' : 'blocks with plays'} this week{selected.size ? ` · ${selected.size} selected` : ''}
            </span>
            <Button size="sm" disabled={!selected.size} onClick={() => setBulk(true)}>
              Bulk edit…
            </Button>
            <Button size="sm" variant="danger" disabled={!selected.size} onClick={() => ctx.apply(removeAirings(d, [...selected])) && setSelected(new Set())}>
              Delete
            </Button>
          </>
        }
        columns={[
          { label: <Checkbox label="Select all" checked={allOn} onChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} />, width: '28px' },
          { label: 'Day', width: '110px' },
          { label: 'Time', width: '110px' },
          { label: 'Block', width: 'minmax(180px, 1fr)' },
          { label: programme ? 'Episode' : 'Items', width: 'minmax(180px, 1.2fr)' },
          { label: programme ? 'Kind' : 'Plays', width: 'minmax(150px, 1fr)' },
        ]}
        groups={[
          {
            key: 'rows',
            label: '',
            rows: rows.map((a) => ({
              key: a.id,
              onOpen: () => setParams((p) => {
                const n = new URLSearchParams(p);
                n.delete('view');
                n.set('date', a.date);
                n.set('block', a.blockTypeId);
                return n;
              }),
              openLabel: `Open ${shortDay(a.date)} ${t.clock(start(a))} in the calendar`,
              cells: [
                <span key="c" onClick={(e) => e.stopPropagation()}>
                  <Checkbox label={`Select ${shortDay(a.date)} ${t.clock(start(a))}`} checked={selected.has(a.id)} onChange={(v) => toggle(a.id, v)} />
                </span>,
                <span key="d" className="whitespace-nowrap">
                  {shortDay(a.date)}
                </span>,
                <span key="t" className="mono">
                  {timeWithDay(t, a.date, start(a))}
                </span>,
                <span key="b" className="block truncate text-text-2">
                  {blockName(a)}
                </span>,
                <span key="i" className="block truncate font-medium">
                  {airingTitle(a, byId, items)}
                </span>,
                <span key="k" className="text-text-2">
                  {programme ? (isRepeat(a) ? repeatText(a, byId.get(a.repeatOfId!), ctx.ws) : 'First airing') : String(a.passes)}
                </span>,
              ],
            })),
          },
        ]}
        empty="No airings of this plan in this week."
      />
      {bulk && <BulkEditDialog ctx={ctx} ids={[...selected]} onClose={() => setBulk(false)} onDone={() => setSelected(new Set())} />}
    </>
  );
}

/** Change date, block or item of the chosen airings; fields depend on each other (date → block → item). */
function BulkEditDialog({ ctx, ids, onClose, onDone }: { ctx: OrderCtx; ids: string[]; onClose: () => void; onDone: () => void }) {
  const { draft: d, items, t } = ctx;
  const chosen = d.airings.filter((a) => ids.includes(a.id));
  const [date, setDate] = useState<string | null>(null);
  const [block, setBlock] = useState('');
  const [item, setItem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const firsts = chosen.filter((a) => !isRepeat(a));
  const blocks = date ? dayBlocks(ctx.template, date) : [];
  const run = () => {
    const keys = new Set(d.airings.filter((a) => !ids.includes(a.id)).map((a) => `${a.channelId}|${a.date}|${a.blockTypeId}`));
    const out: AiringDraft[] = [];
    for (const a of d.airings) {
      if (!ids.includes(a.id)) {
        out.push(a);
        continue;
      }
      const n: AiringDraft = { ...a, date: date ?? a.date, blockTypeId: block || a.blockTypeId, items: item && !isRepeat(a) ? [{ itemId: item, passes: a.items[0]?.passes ?? 0, jingle: a.items[0]?.jingle ?? null }, ...a.items.slice(1)] : a.items };
      if (!ctx.days[weekdayOf(n.date)].has(n.blockTypeId)) return setError(`The layout has no such block on ${shortDay(n.date)}. Nothing was changed.`);
      const k = `${n.channelId}|${n.date}|${n.blockTypeId}`;
      if (keys.has(k)) return setError(`Two airings of this plan would share a block on ${shortDay(n.date)}. Nothing was changed.`);
      keys.add(k);
      out.push(n);
    }
    if (ctx.apply({ ...d, airings: out })) {
      onDone();
      onClose();
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Bulk edit ${ids.length} airing${ids.length === 1 ? '' : 's'}`}
      description="Only the fields you set change. If any airing cannot move, nothing changes."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!date && !block && !item} onClick={run}>
            Apply
          </Button>
        </>
      }
    >
      <DatePicker
        mode="day"
        label="Date"
        weekStart={ctx.channel.weekStart}
        today={ctx.channel.today}
        value={date ?? chosen[0]?.date ?? d.startDate}
        min={d.startDate}
        max={d.endDate}
        limitText={`Inside the plan: ${shortDay(d.startDate)} → ${shortDay(d.endDate)}.`}
        onChange={(v) => {
          setDate(v.value);
          setBlock('');
        }}
        help={date ? undefined : 'Keep each airing’s day'}
      />
      <SelectField label="Block" value={block} disabled={!date} onChange={(e) => setBlock(e.target.value)} hint={date ? undefined : 'Pick a date first'}>
        <option value="">Keep each airing’s block</option>
        {blocks.map((b) => (
          <option key={b.blockTypeId} value={b.blockTypeId}>
            {t.clock(b.startFrames)} · {b.name}
          </option>
        ))}
      </SelectField>
      {isProgrammeMode(d.mode) && firsts.length > 0 && (
        <SelectField label="Episode / item (first airings)" value={item} onChange={(e) => setItem(e.target.value)}>
          <option value="">Keep each airing’s item</option>
          {d.items.map((i) => (
            <option key={i.id} value={i.id}>
              {items.get(i.id)?.info?.title ?? 'Item'}
            </option>
          ))}
        </SelectField>
      )}
      {error && <Notice tone="amber">{error}</Notice>}
    </Dialog>
  );
}
