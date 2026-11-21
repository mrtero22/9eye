// Book spots… (design/orders-page.md §3): choose breaks by name, the weekdays, a date range, the spots
// and how they are spread; each day books the breaks its template has and skips the rest, a break the
// order booked already keeps its spot. The server counts first, then books on "Book".

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FRAME_RATES, formatClockShort } from '@9eye/core';
import { api, errorText } from '@/lib/api';
import type { BreakPosition, CommercialOrder } from '@/lib/types';
import { spotLength } from './model';
import { Button, Checkbox, Dialog, Notice, Segmented, SelectField, StartEndPicker, TextField, ToggleChip, cx, useToast } from '@/ui';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortName = (n: string) => n.replace(/\s+\d{1,2}:\d{2}$/, '') || n;

interface Result {
  added: number;
  addedFrames: number;
  kept: number;
  skipped: { weekday: number; breakTypeIds: string[] }[];
  version: number;
}

export function BookSpotsDialog({
  open,
  onOpenChange,
  order,
  version,
  weekFrom,
  positions,
  defaultPosition,
  dirty,
  onBooked,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  order: CommercialOrder;
  version: number;
  weekFrom: string;
  positions: BreakPosition[];
  defaultPosition: string | null;
  dirty: boolean;
  onBooked: (version: number) => void;
}) {
  const toast = useToast();
  const ch = order.channel;
  const rate = FRAME_RATES[ch.frameRate as keyof typeof FRAME_RATES] ?? FRAME_RATES['25'];
  const order7 = Array.from({ length: 7 }, (_, i) => (ch.weekStart + i) % 7);
  const [picks, setPicks] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<boolean[]>(Array(7).fill(true));
  const [dates, setDates] = useState({ start: order.startDate, end: order.endDate });
  const [items, setItems] = useState<string[]>([]);
  const [spread, setSpread] = useState<'rotate' | 'same'>('rotate');
  const [positionId, setPositionId] = useState<string | null>(defaultPosition);
  const [passes, setPasses] = useState(1);
  useEffect(() => {
    if (!open) return;
    setPicks([]);
    setWeekdays(Array(7).fill(true));
    setDates({ start: weekFrom > order.startDate ? (weekFrom > order.endDate ? order.endDate : weekFrom) : order.startDate, end: order.endDate });
    setItems(order.items.map((i) => i.id));
    setSpread('rotate');
    setPositionId(defaultPosition);
    setPasses(1);
  }, [open, order, weekFrom, defaultPosition]);

  // quick picks: every break of one kind ("Ad Pod", "Billboard 1"), the kinds most breaks share first
  const kinds = useMemo(() => {
    const n = new Map<string, number>();
    for (const b of order.breaks) n.set(shortName(b.name), (n.get(shortName(b.name)) ?? 0) + 1);
    return [...n].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  }, [order.breaks]);

  const body = { version, from: dates.start, to: dates.end, breakTypeIds: picks, weekdays, itemIds: items, spread, positionId, passes };
  const ready = open && picks.length > 0 && items.length > 0 && weekdays.some(Boolean);
  const preview = useQuery({
    queryKey: ['book-preview', order.id, JSON.stringify(body)],
    queryFn: () => api<Result>('POST', `/commercials/orders/${order.id}/book`, { ...body, apply: false }),
    enabled: ready,
  });
  const apply = useMutation({
    mutationFn: () => api<Result>('POST', `/commercials/orders/${order.id}/book`, { ...body, apply: true }),
    onSuccess: (r) => {
      onBooked(r.version);
      toast(`Booked ${r.added} spots`);
      onOpenChange(false);
    },
    onError: (e) => toast(errorText(e), 'red'),
  });
  const r = ready ? preview.data : undefined;
  const nameOf = (id: string) => order.breaks.find((b) => b.breakTypeId === id)?.name ?? 'a break';
  const hms = (f: number) => spotLength(f, rate);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Book spots"
      description="Choose breaks by name. Each day books the ones its layout has and skips the rest. Breaks booked already keep their spots."
      width={820}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!r || !r.added || dirty || apply.isPending} title={dirty ? 'Save or discard this week’s changes first' : undefined} onClick={() => apply.mutate()}>
            {r?.added ? `Book ${r.added} spots` : 'Book spots'}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex-1 text-small text-text-2">
          Breaks · {picks.length} chosen
        </span>
        {kinds.map((k) => (
          <Button key={k} size="xs" onClick={() => setPicks(order.breaks.filter((b) => shortName(b.name) === k).map((b) => b.breakTypeId))}>
            All {k}
          </Button>
        ))}
        <Button size="xs" variant="ghost" onClick={() => setPicks([])}>
          None
        </Button>
      </div>
      <div className="max-h-[300px] shrink-0 overflow-auto rounded-item border border-border">
        <div role="table" aria-label="Breaks by day of the week" className="min-w-[560px]">
          <div role="row" className="sticky top-0 z-[1] grid h-8 grid-cols-[minmax(170px,1.4fr)_repeat(7,minmax(40px,1fr))] items-center border-b border-border bg-surface text-meta text-text-3">
            <span role="columnheader" className="px-2.5">
              Break
            </span>
            {order7.map((wd) => (
              <span key={wd} role="columnheader" className="flex justify-center">
                <ToggleChip on={weekdays[wd]} hint={weekdays[wd] ? `Leave ${DAY[wd]} out` : `Book on ${DAY[wd]} too`} onClick={() => setWeekdays((w) => w.map((x, i) => (i === wd ? !x : x)))}>
                  {DAY[wd]}
                </ToggleChip>
              </span>
            ))}
          </div>
          {order.breaks.map((b) => {
            const on = picks.includes(b.breakTypeId);
            return (
              <div key={b.breakTypeId} role="row" className={cx('grid min-h-7 grid-cols-[minmax(170px,1.4fr)_repeat(7,minmax(40px,1fr))] items-center border-t border-hairline', on && 'bg-accent-soft')}>
                <span role="rowheader" className="flex items-center gap-2 px-2.5">
                  <Checkbox checked={on} onChange={(v) => setPicks((p) => (v ? [...p, b.breakTypeId] : p.filter((x) => x !== b.breakTypeId)))}>
                    <span className="mono text-text-3">{formatClockShort(b.startFrames, ch.dayStartFrames, rate)}</span> {shortName(b.name)}
                  </Checkbox>
                </span>
                {order7.map((wd) => (
                  <span key={wd} role="cell" title={b.weekdays[wd] ? undefined : `${DAY[wd]} has no ${b.name}`} className={cx('flex justify-center text-small font-semibold', b.weekdays[wd] ? 'text-accent-text' : 'text-text-3')}>
                    {!b.weekdays[wd] ? '–' : on && weekdays[wd] ? '+' : ''}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <span className="text-meta text-text-3">+ books a spot · – the day has no such break. Days off in the header are left out.</span>

      <div className="flex flex-wrap items-end gap-3">
        <StartEndPicker label="From – to" weekStart={ch.weekStart} today={ch.today} start={dates.start} end={dates.end} onChange={setDates} />
        <SelectField label="Position" value={positionId ?? ''} onChange={(e) => setPositionId(e.target.value || null)}>
          <option value="">No position</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Plays" mono className="w-[72px]" inputMode="numeric" value={String(passes)} onChange={(e) => setPasses(Math.max(1, Math.min(99, Number(e.target.value.replace(/\D/g, '')) || 1)))} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-meta text-text-2">Spots to use</span>
        <div className="flex flex-wrap gap-1.5">
          {order.items.map((it, i) => (
            <ToggleChip key={it.id} on={items.includes(it.id)} onClick={() => setItems((x) => (x.includes(it.id) ? x.filter((y) => y !== it.id) : order.items.filter((y) => y.id === it.id || x.includes(y.id)).map((y) => y.id)))}>
              V{i + 1} · {it.title}
            </ToggleChip>
          ))}
        </div>
        <Segmented<'rotate' | 'same'>
          label="Which spot goes where"
          value={spread}
          onChange={setSpread}
          options={[
            { value: 'rotate', label: 'Rotate over the breaks', hint: 'Break 1 gets the first spot, break 2 the next; it starts again each day' },
            { value: 'same', label: 'The same spot everywhere', hint: 'Uses the first spot chosen' },
          ]}
        />
      </div>

      <div role="status" className="flex flex-col gap-0.5 rounded-item bg-surface-2 px-3 py-2.5 text-small">
        {!ready ? (
          <span className="text-text-2">Choose breaks and spots to see what is booked.</span>
        ) : preview.error ? (
          <span className="text-red-text">{errorText(preview.error)}</span>
        ) : !r ? (
          <span className="text-text-2">Counting…</span>
        ) : (
          <>
            <span className="font-medium">{r.added ? `Books ${r.added} new spots · ${hms(r.addedFrames)}` : 'Nothing new to book'}</span>
            {r.kept > 0 && <span className="text-text-2">{r.kept} of the chosen breaks are booked already and keep their spots.</span>}
            {r.skipped.length > 0 && (
              <span className="text-text-2">
                Skipped: {r.skipped.map((s) => `${DAY[s.weekday]} has no ${s.breakTypeIds.map(nameOf).join(', ')}`).join(' · ')}.
              </span>
            )}
          </>
        )}
      </div>
      {dirty && <Notice tone="amber">This week has changes that are not saved. Save or discard them first; Book spots saves at once.</Notice>}
    </Dialog>
  );
}
