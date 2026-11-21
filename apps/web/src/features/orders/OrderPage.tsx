// One commercial order (design/orders-page.md §3): the week board. Each day shows its own blocks and
// ad breaks (from the order's main template and the channel's ads template); a click on an empty
// break books the chosen spot there, a click on a booked one opens it. Select mode acts on many
// breaks at once. Book spots… books a pattern over a date range on the server. The sidebar's Break
// field picks one break by name, without its hour ("Ad Pod :53"): the board then shows only the
// blocks, and a click on a block acts on that break of it.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FRAME_RATES, formatClockShort, type FrameRate } from '@9eye/core';
import { ApiError, api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { Booking, BreakPosition, CommercialOrder, CommercialWeek } from '@/lib/types';
import {
  Badge,
  BreakBoard,
  Button,
  CatalogPicker,
  ConfirmDialog,
  IconButton,
  Menu,
  MenuCheck,
  Notice,
  PageHeader,
  Segmented,
  SPOT_TONES,
  SelectField,
  StartEndPicker,
  TextField,
  channelWeek,
  cx,
  spanText,
  useToast,
  type BoardDay,
} from '@/ui';
import { BookSpotsDialog } from './BookSpotsDialog';
import { spotLength } from './model';
import { useAgentPage } from '@/features/agents/pageAgent';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const slotKey = (b: { date: string; blockTypeId: string; breakTypeId: string }) => `${b.date}|${b.blockTypeId}|${b.breakTypeId}`;
const splitKey = (k: string) => {
  const [date, blockTypeId, breakTypeId] = k.split('|');
  return { date, blockTypeId, breakTypeId };
};
/** "Ad Pod 13:30" → "Ad Pod": the start shown beside it is the real one. */
const shortName = (n: string) => n.replace(/\s+\d{1,2}:\d{2}$/, '') || n;
type WeekBox = CommercialWeek['days'][number]['boxes'][number];
/**
 * A break as the Break field offers it: its name without the hour, so one option is one break in
 * each block. Aurora Media names every hour's breaks alike — "Billboard 1 06:00", "Ad Pod 06:30", "Ad Pod 06:53" →
 * "Billboard 1 :00", "Ad Pod :30", "Ad Pod :53" (a 1-hour block has both Ad Pods). A name without a clock
 * stays as it is.
 */
const breakKind = (n: string) => n.replace(/\s+\d{1,2}(:\d{2})$/, ' $1');
const minuteOf = (kind: string) => Number(/:(\d{2})$/.exec(kind)?.[1] ?? 99);
/** The block's break of that kind (the earliest, should it have two). */
const breakOfKind = (b: WeekBox, kind: string) => [...b.breaks].sort((x, y) => x.startFrames - y.startFrames).find((x) => breakKind(x.name) === kind);

export function OrderPage() {
  const { orderId = '' } = useParams();
  const order = useQuery({ queryKey: keys.commercialOrder(orderId), queryFn: () => api<CommercialOrder>('GET', `/commercials/orders/${orderId}`) });
  const positions = useQuery({ queryKey: keys.breakPositions(), queryFn: () => api<BreakPosition[]>('GET', '/admin/break-positions') });
  if (order.error)
    return (
      <>
        <PageHeader back={{ label: 'Ads', to: '/orders' }} title="Campaign" />
        <div className="px-4 pt-5 sm:px-8">
          <Notice tone="red">{errorText(order.error)}</Notice>
        </div>
      </>
    );
  if (!order.data || !positions.data) return <PageHeader back={{ label: 'Ads', to: '/orders' }} title="Campaign" />;
  return <OrderBoard order={order.data} positions={positions.data} />;
}

function OrderBoard({ order, positions }: { order: CommercialOrder; positions: BreakPosition[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const ch = order.channel;
  const rate: FrameRate = FRAME_RATES[ch.frameRate as keyof typeof FRAME_RATES] ?? FRAME_RATES['25'];
  const perMinute = rate.nominal * 60;
  const clock = (f: number) => formatClockShort(f, ch.dayStartFrames, rate);
  const len = (f: number) => spotLength(f, rate);
  const today = ch.today;
  const firstWeek = channelWeek(today < order.startDate ? order.startDate : today > order.endDate ? order.endDate : today, ch.weekStart)[0];
  const [from, setFrom] = useState(firstWeek);
  useAgentPage({ name: 'Ads › Campaign', sees: `campaign "${order.name}" (id ${order.id}) on ${ch.name} (code ${ch.code}), the week from ${from}` });
  const week = useQuery({ queryKey: keys.commercialWeek(order.id, from), queryFn: () => api<CommercialWeek>('GET', `/commercials/orders/${order.id}/week?from=${from}`) });

  // the week's bookings as edited here (null = as saved); Undo / Redo steps
  const [draft, setDraft] = useState<Booking[] | null>(null);
  const [past, setPast] = useState<Booking[][]>([]);
  const [future, setFuture] = useState<Booking[][]>([]);
  const [version, setVersion] = useState(order.version);
  useEffect(() => {
    if (!draft) setVersion(order.version);
  }, [order.version, draft]);
  const saved = week.data?.bookings ?? [];
  const now = draft ?? saved;
  const dirty = draft !== null && past.length > 0;
  const change = (next: Booking[], msg?: string) => {
    setPast((p) => [...p, now]);
    setFuture([]);
    setDraft(next);
    if (msg) toast(msg);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [now, ...f]);
    setDraft(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, now]);
    setDraft(future[0]);
    setFuture((f) => f.slice(1));
  };

  const defaultPosition = positions.find((p) => p.isDefault)?.id ?? positions[0]?.id ?? null;
  const [spot, setSpot] = useState<string | null>(order.items[0]?.id ?? null);
  useEffect(() => {
    if (!order.items.some((i) => i.id === spot)) setSpot(order.items[0]?.id ?? null);
  }, [order.items, spot]);
  const [newPosition, setNewPosition] = useState<string | null>(defaultPosition);
  const [newPasses, setNewPasses] = useState(1);
  const [mode, setMode] = useState<'book' | 'select'>('book');
  // which break a click acts on: '' = the one clicked; else one break of each block ("Ad Pod :53")
  const [place, setPlace] = useState('');
  const compact = place !== '';
  const [sel, setSel] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [hours, setHours] = useState<'booked' | 'all'>('all');
  const [bookedOnly, setBookedOnly] = useState(false);
  const [booking, setBooking] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [leavePage, setLeavePage] = useState(false);

  const itemIndex = new Map(order.items.map((it, i) => [it.id, i]));
  const code = (id: string) => `V${(itemIndex.get(id) ?? 0) + 1}`;
  const tone = (id: string) => SPOT_TONES[(itemIndex.get(id) ?? 0) % SPOT_TONES.length];
  const itemOf = (id: string) => order.items.find((i) => i.id === id);
  const at = (k: string) => now.filter((b) => slotKey(b) === k);

  const days = week.data?.days ?? [];
  const breakAt = new Map<string, { name: string; startFrames: number; lengthFrames: number; othersFrames: number; box: string; boxStart: number; boxLength: number; inOrder: boolean }>();
  for (const d of days) for (const b of d.boxes) for (const x of b.breaks) breakAt.set(slotKey({ date: d.date, blockTypeId: b.blockTypeId, breakTypeId: x.breakTypeId }), { ...x, box: b.name, boxStart: b.startFrames, boxLength: b.lengthFrames, inOrder: d.inOrder });
  const fill = (k: string) => {
    const x = breakAt.get(k);
    if (!x) return null;
    const mine = at(k).reduce((n, b) => n + (itemOf(b.orderItemId)?.lengthFrames ?? 0) * b.passes, 0);
    const total = x.othersFrames + mine;
    return { total, length: x.lengthFrames, warn: total > x.lengthFrames ? ('red' as const) : total >= x.lengthFrames * 0.9 ? ('amber' as const) : undefined };
  };

  // which hours to show: the whole day (every hour with a block), or from the first to the last hour
  // with a SAVED booking this week — never the edits in progress, so booking a break never hides the
  // other blocks
  const rowOf = (f: number) => Math.floor(f / perMinute / 60);
  const allRows = days.flatMap((d) => d.boxes.flatMap((b) => [rowOf(b.startFrames), rowOf(Math.max(b.startFrames, b.startFrames + b.lengthFrames - 1))]));
  const bookedRows = saved.map((b) => breakAt.get(slotKey(b))).filter((x): x is NonNullable<typeof x> => !!x).map((x) => rowOf(x.startFrames));
  const span = hours === 'booked' && bookedRows.length ? [Math.min(...bookedRows), Math.max(...bookedRows)] : allRows.length ? [Math.min(...allRows), Math.max(...allRows)] : [0, -1];
  const hourRows = Array.from({ length: Math.max(0, span[1] - span[0] + 1) }, (_, i) => ({ index: span[0] + i, label: clock((span[0] + i) * 60 * perMinute) }));

  // the breaks of the week's blocks, one option each, in the order of the hour ("Billboard 1 :00", "Billboard 2 :10", …)
  const ownBoxes = (days.some((d) => d.inOrder) ? days.filter((d) => d.inOrder) : days).flatMap((d) => d.boxes);
  const places = [...new Set(ownBoxes.flatMap((b) => b.breaks.map((x) => breakKind(x.name))))].sort((a, b) => minuteOf(a) - minuteOf(b) || a.localeCompare(b));
  const pickPlace = (v: string) => {
    setPlace(v);
    setSel([]);
    setOpen(null);
    setNote('');
  };

  const boardDays: BoardDay[] = days.map((d) => {
    const own = d.boxes.map((b) => `${b.startFrames}/${b.lengthFrames}/${b.breaks.map((x) => x.breakTypeId).join(',')}`).join(';');
    const usual = days[0]?.boxes.map((b) => `${b.startFrames}/${b.lengthFrames}/${b.breaks.map((x) => x.breakTypeId).join(',')}`).join(';');
    const n = now.filter((b) => b.date === d.date);
    const secs = n.reduce((s, b) => s + (itemOf(b.orderItemId)?.lengthFrames ?? 0) * b.passes, 0);
    const dayKeys = d.boxes.flatMap((b) => b.breaks.map((x) => slotKey({ date: d.date, blockTypeId: b.blockTypeId, breakTypeId: x.breakTypeId })));
    return {
      key: d.date,
      day: DAY[weekdayOf(d.date)],
      date: d.date.slice(8).replace(/^0/, ''),
      sub: d.inOrder ? `${n.length} ${n.length === 1 ? 'spot' : 'spots'} · ${len(secs)}` : 'Outside the campaign',
      tag: own !== usual ? 'own layout' : undefined,
      tagTitle: own !== usual ? 'This day’s blocks and breaks differ from the first day’s.' : undefined,
      off: !d.inOrder,
      selected: dayKeys.length > 0 && dayKeys.every((k) => sel.includes(k)),
      boxes: d.boxes
        .map((b) => {
          const slotOf = (x: WeekBox['breaks'][number]) => {
            const k = slotKey({ date: d.date, blockTypeId: b.blockTypeId, breakTypeId: x.breakTypeId });
            const here = at(k);
            const f = fill(k);
            const first = here[0];
            const sold = f ? `${len(f.total)} of ${len(f.length)} sold, all campaigns` : '';
            return {
              key: k,
              at: Math.floor(x.startFrames / perMinute),
              time: clock(x.startFrames),
              label: shortName(x.name),
              title: `${x.name} · ${b.name} · ${sold}${here.length ? ` · ${here.length} booked here` : ''}`,
              mark: first ? `${code(first.orderItemId)}${here.length > 1 ? ` ×${here.length}` : ''}` : undefined,
              markColor: first ? tone(first.orderItemId) : undefined,
              warn: f?.warn,
              selected: sel.includes(k) || open === k,
              here: here.length,
              sold,
            };
          };
          const box = {
            key: b.blockTypeId,
            start: Math.floor(b.startFrames / perMinute),
            length: Math.max(1, Math.round(b.lengthFrames / perMinute)),
            name: b.name,
            color: b.color,
            title: `${b.name} · ${clock(b.startFrames)}–${clock(b.startFrames + b.lengthFrames)}`,
          };
          if (compact) {
            // one line per block, standing for its break of the chosen kind
            const x = breakOfKind(b, place);
            if (!x) return { ...box, title: `${b.name} has no ${place}`, slots: [] };
            const s = slotOf(x);
            const elsewhere = b.breaks.filter((y) => y !== x).flatMap((y) => at(slotKey({ date: d.date, blockTypeId: b.blockTypeId, breakTypeId: y.breakTypeId })));
            const other = elsewhere[0] ? `${code(elsewhere[0].orderItemId)}${elsewhere.length > 1 ? ` ×${elsewhere.length}` : ''}` : undefined;
            const slot = {
              ...s,
              at: box.start,
              title: `${b.name} · ${x.name} · ${s.sold}${s.here ? ` · ${s.here} booked here` : ''}${elsewhere.length ? ` · ${elsewhere.length} in its other breaks` : ''}`,
              other,
            };
            return { ...box, slots: !bookedOnly || slot.mark ? [slot] : [] };
          }
          return { ...box, slots: b.breaks.map(slotOf).filter((s) => !bookedOnly || s.mark) };
        })
        .filter((b) => !bookedOnly || b.slots.length > 0),
    };
  });

  const book = (k: string, n = 1) => {
    const it = spot ?? order.items[0]?.id;
    if (!it) {
      toast('Add a spot to the campaign first', 'red');
      return null;
    }
    const s = splitKey(k);
    return Array.from({ length: n }, () => ({ ...s, orderItemId: it, positionId: newPosition, passes: newPasses }));
  };
  const onSlot = (dayKey: string, k: string, shift: boolean) => {
    if (mode === 'select' || shift) {
      setOpen(null);
      setNote('');
      setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
      return;
    }
    if (at(k).length) {
      setOpen(k);
      setSel([]);
      return;
    }
    const add = book(k);
    if (add) change([...now, ...add], `Booked ${code(add[0].orderItemId)} in ${breakAt.get(k)?.name} · ${DAY[weekdayOf(dayKey)]} ${dayKey.slice(8)}`);
  };
  const toggle = (ks: string[]) => {
    const all = ks.length > 0 && ks.every((k) => sel.includes(k));
    setMode('select');
    setOpen(null);
    setNote('');
    setSel((s) => (all ? s.filter((k) => !ks.includes(k)) : [...new Set([...s, ...ks])]));
  };
  const visibleKeys = (pred: (s: { key: string; at: number }) => boolean) =>
    boardDays.flatMap((d) => (d.off ? [] : d.boxes.flatMap((b) => b.slots))).filter(pred).map((s) => s.key);

  const selBooked = sel.filter((k) => at(k).length > 0);
  const selFree = sel.filter((k) => !at(k).length && breakAt.get(k)?.inOrder);
  const sameEveryDay = () => {
    const names = [...new Set(sel.map((k) => splitKey(k).breakTypeId))];
    const add: string[] = [];
    const missing: string[] = [];
    for (const d of days.filter((x) => x.inOrder)) {
      for (const bt of names) {
        const b = d.boxes.find((x) => x.breaks.some((y) => y.breakTypeId === bt));
        if (b) add.push(slotKey({ date: d.date, blockTypeId: b.blockTypeId, breakTypeId: bt }));
        else missing.push(`${DAY[weekdayOf(d.date)]} has no ${order.breaks.find((x) => x.breakTypeId === bt)?.name ?? 'such break'}`);
      }
    }
    setSel((s) => [...new Set([...s, ...add])]);
    setNote(missing.length ? `${missing.join(' · ')}: left out.` : 'Every day of this week has these breaks.');
  };

  // saving the week
  const save = useMutation({
    mutationFn: () => api<{ version: number }>('PUT', `/commercials/orders/${order.id}/week`, { version, from, to: week.data!.to, bookings: now }),
    onSuccess: async (r) => {
      setVersion(r.version);
      await qc.invalidateQueries({ queryKey: keys.commercialOrder(order.id) });
      setDraft(null);
      setPast([]);
      setFuture([]);
      qc.invalidateQueries({ queryKey: keys.contracts() });
      toast('Week saved');
    },
    onError: (e) => toast(e instanceof ApiError && e.status === 409 ? 'Someone else changed this campaign meanwhile. Reload to see it; your changes here are lost then.' : errorText(e), 'red'),
  });
  const goWeek = (to: string) => {
    if (dirty) setLeaving(to);
    else {
      setFrom(to);
      setSel([]);
      setOpen(null);
    }
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // the order's own fields and spots (saved at once)
  const saveOrder = useMutation({
    mutationFn: (patch: Partial<Pick<CommercialOrder, 'name' | 'status' | 'startDate' | 'endDate'>> & { items?: { id: string | null; productionId: string }[] }) =>
      api<{ version: number }>('PUT', `/commercials/orders/${order.id}`, {
        version,
        name: patch.name ?? order.name,
        status: patch.status ?? order.status,
        startDate: patch.startDate ?? order.startDate,
        endDate: patch.endDate ?? order.endDate,
        items: patch.items ?? order.items.map((i) => ({ id: i.id, productionId: i.productionId })),
      }),
    onSuccess: (r) => {
      setVersion(r.version);
      qc.invalidateQueries({ queryKey: keys.commercialOrder(order.id) });
      qc.invalidateQueries({ queryKey: keys.commercialWeek(order.id, from) });
      qc.invalidateQueries({ queryKey: keys.contract(order.contract.id) });
      toast('Campaign saved');
    },
    onError: (e) => toast(errorText(e), 'red'),
  });

  const openInfo = open ? breakAt.get(open) : null;
  const weekCount = (id: string) => now.filter((b) => b.orderItemId === id).length;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [name, setName] = useState(order.name);
  const [dates, setDates] = useState({ start: order.startDate, end: order.endDate });
  useEffect(() => {
    setName(order.name);
    setDates({ start: order.startDate, end: order.endDate });
  }, [order.name, order.startDate, order.endDate]);

  return (
    <>
      <PageHeader
        back={{ label: order.contract.name === order.contract.clientName ? order.contract.name : `${order.contract.name} · ${order.contract.clientName}`, onClick: () => (dirty ? setLeavePage(true) : navigate(`/orders/contracts/${order.contract.id}`)) }}
        title={order.name}
        mark={order.color}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={order.status === 'confirmed' ? 'green' : 'neutral'}>{order.status === 'confirmed' ? 'Confirmed' : 'Draft'}</Badge>
            {dirty && <Badge tone="amber">Unsaved changes</Badge>}
            <span>
              {ch.name} · {order.template.name} · {spanText(order.startDate, order.endDate)} · {order.booked} spots booked
            </span>
          </span>
        }
        actions={
          <>
            <IconButton icon="undo" label="Undo" disabled={!past.length} onClick={undo} />
            <IconButton icon="redo" label="Redo" disabled={!future.length} onClick={redo} />
            <Button icon="plus" disabled={!order.items.length} title={order.items.length ? undefined : 'Add a spot to the campaign first'} onClick={() => setBooking(true)}>
              Book spots…
            </Button>
            <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-start gap-4 px-4 pb-8 pt-5 sm:px-8">
        <aside aria-label="Spots of this campaign" className="sticky top-3 flex w-[236px] shrink-0 flex-col rounded-card border border-border bg-surface max-[720px]:static max-[720px]:w-full">
          <div className="flex flex-col gap-2.5 p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">Spots</span>
              <span className="text-meta text-text-3">this week</span>
            </div>
            {order.items.length === 0 && <span className="text-small text-text-3">No spots yet. Add the campaign's spots from Media.</span>}
            {/* many spots scroll here, so Break, Position and Passes below stay in view */}
            <div role="radiogroup" aria-label="Spot to book" className="-mx-1 flex max-h-[min(440px,42vh)] flex-col gap-1.5 overflow-y-auto px-1 py-px">
              {order.items.map((it) => (
                <div key={it.id} className="group relative">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={spot === it.id}
                    onClick={() => setSpot(it.id)}
                    className={cx('flex w-full cursor-pointer flex-col gap-1 rounded-item border-0 bg-surface-2 px-2.5 py-2 text-left', spot === it.id && 'shadow-[inset_0_0_0_1.5px_var(--accent)]')}
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="h-3.5 w-[3px] rounded-[2px]" style={{ background: tone(it.id) }} />
                      <span className="mono text-[12.5px] font-semibold">{code(it.id)}</span>
                      <span className="mono text-meta text-text-2">{it.lengthFrames ? len(it.lengthFrames) : 'no length'}</span>
                      <span className="flex-1" />
                      <span className="mono text-meta text-text-2">{weekCount(it.id)}</span>
                    </span>
                    <span className="text-meta leading-[1.35] text-text-2 [overflow-wrap:anywhere]">{it.title}</span>
                  </button>
                  {it.booked === 0 && weekCount(it.id) === 0 && (
                    <IconButton
                      icon="close"
                      size="xs"
                      label={`Remove ${it.title} from the campaign`}
                      className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      onClick={() => saveOrder.mutate({ items: order.items.filter((x) => x.id !== it.id).map((x) => ({ id: x.id, productionId: x.productionId })) })}
                    />
                  )}
                </div>
              ))}
            </div>
            <span className="text-meta leading-[1.4] text-text-3">{compact ? `A click on a block books the chosen spot into its ${place}.` : 'A click on an empty break books the chosen spot.'}</span>
            <CatalogPicker
              pick="items"
              families={['advert']}
              frameRate={ch.frameRate}
              already={order.items.map((i) => i.productionId)}
              trigger="Add spots…"
              triggerStyle="small"
              title="Add spots to the campaign"
              onPick={(r) => saveOrder.mutate({ items: [...order.items.map((x) => ({ id: x.id, productionId: x.productionId })), ...r.items.map((x) => ({ id: null, productionId: x.productionId }))] })}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_62px] gap-2 border-t border-hairline px-3.5 pb-3.5 pt-3">
            <SelectField
              label="Break"
              className="col-span-2"
              hint={compact ? 'The board shows the blocks only.' : undefined}
              value={place}
              onChange={(e) => pickPlace(e.target.value)}
            >
              <option value="">The one I click</option>
              {places.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
              {compact && !places.includes(place) && <option value={place}>{place}</option>}
            </SelectField>
            <SelectField label="Position" value={newPosition ?? ''} onChange={(e) => setNewPosition(e.target.value || null)}>
              {positions.length === 0 && <option value="">None</option>}
              {positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
            <TextField label="Plays" mono inputMode="numeric" value={String(newPasses)} onChange={(e) => setNewPasses(Math.max(1, Math.min(99, Number(e.target.value.replace(/\D/g, '')) || 1)))} />
          </div>
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((o) => !o)}
            className="hov flex h-10 cursor-pointer items-center justify-between rounded-b-card border-0 border-t border-hairline bg-transparent px-3.5 text-small font-medium text-text"
          >
            Campaign details
            <span aria-hidden="true" className={cx('text-text-3 transition-transform', detailsOpen && 'rotate-90')}>
              ›
            </span>
          </button>
          {detailsOpen && (
            <div className="flex flex-col gap-3 px-3.5 pb-3.5">
              <TextField label="Name" value={name} maxLength={300} onChange={(e) => setName(e.target.value)} />
              <Segmented<'confirmed' | 'draft'>
                label="State"
                value={order.status}
                onChange={(v) => saveOrder.mutate({ status: v })}
                options={[
                  { value: 'confirmed', label: 'Confirmed' },
                  { value: 'draft', label: 'Draft' },
                ]}
              />
              <StartEndPicker label="Dates" weekStart={ch.weekStart} today={today} start={dates.start} end={dates.end} onChange={setDates} />
              <span className="text-meta text-text-3">
                Layout {order.template.name}. Only confirmed campaigns reach the ads playlist.
              </span>
              <Button size="sm" className="self-start" disabled={name === order.name && dates.start === order.startDate && dates.end === order.endDate} onClick={() => saveOrder.mutate({ name, startDate: dates.start, endDate: dates.end })}>
                Save details
              </Button>
            </div>
          )}
        </aside>

        <div className="flex min-w-0 flex-[1_1_640px] flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-ctl items-center rounded-ctl border border-border-strong bg-surface">
              <IconButton icon="chevronLeft" size="sm" label="Previous week" disabled={from <= order.startDate} onClick={() => goWeek(channelWeek(addDaysIso(from, -7), ch.weekStart)[0])} />
              <span className="px-1.5 text-small font-medium">{week.data ? spanText(week.data.from, week.data.to) : '…'}</span>
              <IconButton icon="chevronRight" size="sm" label="Next week" disabled={addDaysIso(from, 7) > order.endDate} onClick={() => goWeek(addDaysIso(from, 7))} />
            </div>
            <Segmented<'book' | 'select'>
              label="A click on the board"
              value={mode}
              onChange={(v) => {
                setMode(v);
                setOpen(null);
              }}
              options={[
                { value: 'book', label: 'Book', hint: 'A click books the chosen spot; a click on a booked break opens it' },
                { value: 'select', label: 'Select', hint: 'A click selects breaks; act on all of them from the bar' },
              ]}
            />
            <span className="flex-1" />
            <Menu label="Hours shown" width={220} trigger={<Button>{hours === 'booked' ? 'Booked hours' : 'Whole day'}</Button>}>
              <MenuCheck checked={hours === 'all'} onChange={() => setHours('all')}>
                Whole day
              </MenuCheck>
              <MenuCheck checked={hours === 'booked'} onChange={() => setHours('booked')}>
                Booked hours
              </MenuCheck>
            </Menu>
            <Button aria-pressed={bookedOnly} variant={bookedOnly ? 'primary' : 'secondary'} onClick={() => setBookedOnly((b) => !b)}>
              Booked only
            </Button>
          </div>

          {sel.length > 0 && (
            <div role="toolbar" aria-label="Selected breaks" className="flex flex-wrap items-center gap-1.5 rounded-item border border-border-strong bg-surface py-1.5 pl-3 pr-1.5 text-small">
              <span className="font-semibold">
                {sel.length} {sel.length === 1 ? 'break' : 'breaks'}
              </span>
              <span className="text-text-2">
                on {new Set(sel.map((k) => splitKey(k).date)).size} days · {selBooked.length} booked
              </span>
              <span className="flex-1" />
              <Button size="sm" variant="primary" disabled={!selFree.length || !order.items.length} onClick={() => change([...now, ...selFree.flatMap((k) => book(k) ?? [])], `Booked ${selFree.length} breaks`)}>
                Book {spot ? code(spot) : ''} in {selFree.length}
              </Button>
              <Button size="sm" disabled={!selBooked.length} onClick={() => change(now.filter((b) => !selBooked.includes(slotKey(b))), `Removed the spots from ${selBooked.length} breaks`)}>
                Remove from {selBooked.length}
              </Button>
              <Button size="sm" onClick={sameEveryDay}>
                Same breaks on every day
              </Button>
              <IconButton icon="close" size="sm" label="Clear the selection" onClick={() => { setSel([]); setNote(''); }} />
              {note && <span className="basis-full pb-1 text-small text-text-2">{note}</span>}
            </div>
          )}

          {week.error && <Notice tone="red">{errorText(week.error)}</Notice>}
          {week.data && hourRows.length === 0 && <Notice>The campaign's layout has no blocks with ad breaks.</Notice>}
          {week.data && hourRows.length > 0 && (
            <BreakBoard
              label={compact ? `Blocks of ${spanText(week.data.from, week.data.to)}: a click acts on each block's ${place}` : `Ad breaks of ${spanText(week.data.from, week.data.to)}, each day as its layout has them`}
              days={boardDays}
              hours={hourRows}
              compact={compact}
              onSlot={onSlot}
              onHour={(h) => toggle(visibleKeys((s) => Math.floor(s.at / 60) === h))}
              onDay={(d) => toggle(visibleKeys((s) => s.key.startsWith(`${d}|`)))}
              overlay={
                open && openInfo ? (
                  <BreakPanel
                    k={open}
                    info={openInfo}
                    booked={at(open)}
                    items={order.items}
                    positions={positions}
                    code={code}
                    tone={tone}
                    clock={clock}
                    len={len}
                    fill={fill(open)}
                    days={days}
                    allBooked={now}
                    onClose={() => setOpen(null)}
                    onChange={(next, msg) => change(next, msg)}
                    makeBooking={(k) => book(k)}
                    onOpen={setOpen}
                  />
                ) : null
              }
            />
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-text-3">
            <span>{compact ? `Each day lists its own blocks; a block without ${place} is greyed.` : 'Each day lists its own blocks and breaks; only the hours line up.'}</span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-amber" />
              nearly full
              <span aria-hidden="true" className="ml-1.5 size-1.5 rounded-full bg-red" />
              over its length, with every campaign's spots
            </span>
          </div>
        </div>
      </div>

      <BookSpotsDialog open={booking} onOpenChange={setBooking} order={order} version={version} weekFrom={from} positions={positions} defaultPosition={newPosition} dirty={dirty} onBooked={(v) => { setVersion(v); qc.invalidateQueries({ queryKey: keys.commercialOrder(order.id) }); qc.invalidateQueries({ queryKey: ['commercial-order'] }); qc.invalidateQueries({ queryKey: keys.contracts() }); }} />
      <ConfirmDialog
        open={!!leaving}
        onOpenChange={(o) => !o && setLeaving(null)}
        title="Unsaved changes"
        description="This week has changes that are not saved. Leave them?"
        confirmLabel="Discard changes"
        danger
        onConfirm={() => {
          setDraft(null);
          setPast([]);
          setFuture([]);
          setFrom(leaving!);
          setLeaving(null);
          setSel([]);
          setOpen(null);
        }}
      />
      <ConfirmDialog
        open={leavePage}
        onOpenChange={setLeavePage}
        title="Unsaved changes"
        description="This week has changes that are not saved. Leave the campaign without them?"
        confirmLabel="Leave"
        danger
        onConfirm={() => navigate(`/orders/contracts/${order.contract.id}`)}
      />
    </>
  );
}

function addDaysIso(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function BreakPanel({
  k,
  info,
  booked,
  items,
  positions,
  code,
  tone,
  clock,
  len,
  fill,
  days,
  allBooked,
  onClose,
  onChange,
  makeBooking,
  onOpen,
}: {
  k: string;
  info: { name: string; startFrames: number; lengthFrames: number; box: string; boxStart: number; boxLength: number };
  booked: Booking[];
  items: CommercialOrder['items'];
  positions: BreakPosition[];
  code: (id: string) => string;
  tone: (id: string) => string;
  clock: (f: number) => string;
  len: (f: number) => string;
  fill: { total: number; length: number; warn?: 'amber' | 'red' } | null;
  days: CommercialWeek['days'];
  allBooked: Booking[];
  onClose: () => void;
  onChange: (next: Booking[], msg: string) => void;
  makeBooking: (k: string) => Booking[] | null;
  onOpen: (k: string) => void;
}) {
  const { date, breakTypeId } = splitKey(k);
  const others = allBooked.filter((b) => slotKey(b) !== k);
  const update = (i: number, patch: Partial<Booking>) => onChange([...others, ...booked.map((b, j) => (j === i ? { ...b, ...patch } : b))], 'Spot changed');
  const dayChips = days.map((d) => {
    const box = d.boxes.find((b) => b.breaks.some((x) => x.breakTypeId === breakTypeId));
    const key = box ? slotKey({ date: d.date, blockTypeId: box.blockTypeId, breakTypeId }) : null;
    const n = key ? allBooked.filter((b) => slotKey(b) === key).length : 0;
    return { d, key, n, me: d.date === date, usable: !!key && d.inOrder };
  });
  const freeDays = dayChips.filter((c) => c.usable && !c.me && c.n === 0);
  const missing = dayChips.filter((c) => !c.key).map((c) => DAY[weekdayOf(c.d.date)]);
  const pct = fill ? Math.min(100, Math.round((fill.total / Math.max(1, fill.length)) * 100)) : 0;
  return (
    <aside aria-label={info.name} className="absolute right-3 top-[60px] z-[5] flex max-h-[960px] w-[312px] max-w-[calc(100%-24px)] flex-col overflow-auto rounded-card border border-border bg-surface shadow-[var(--shadow)]">
      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-start gap-2">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold">{info.name}</span>
            <span className="text-small text-text-2">
              {DAY[weekdayOf(date)]} {date.slice(8)} · {clock(info.startFrames)} · {info.box} ({clock(info.boxStart)}–{clock(info.boxStart + info.boxLength)})
            </span>
          </span>
          <IconButton icon="close" size="sm" label="Close" onClick={onClose} />
        </div>
        {fill && (
          <div className="flex flex-col gap-1">
            <div className="h-1 overflow-hidden rounded-[2px] bg-surface-3">
              <div className={cx('h-1', fill.warn === 'red' ? 'bg-red' : fill.warn === 'amber' ? 'bg-amber' : 'bg-accent')} style={{ width: `${pct}%` }} />
            </div>
            <span className="mono text-[11.5px] text-text-3">
              {len(fill.total)} of {len(fill.length)} sold · {fill.total > fill.length ? `over by ${len(fill.total - fill.length)}` : `${len(fill.length - fill.total)} free`} · all campaigns
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-hairline px-3.5 py-3">
        <span className="text-meta text-text-3">{booked.length === 0 ? 'Nothing of this campaign here' : `This campaign · ${booked.length} ${booked.length === 1 ? 'spot' : 'spots'}`}</span>
        {booked.map((b, i) => {
          const it = items.find((x) => x.id === b.orderItemId);
          return (
            <div key={i} className="flex flex-col gap-2 rounded-item bg-surface-2 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5 h-3.5 w-[3px] shrink-0 rounded-[2px]" style={{ background: tone(b.orderItemId) }} />
                <select aria-label="Spot" value={b.orderItemId} onChange={(e) => update(i, { orderItemId: e.target.value })} className="h-7 min-w-0 flex-1 rounded-ctl border border-border-strong bg-surface px-1 text-small">
                  {items.map((x) => (
                    <option key={x.id} value={x.id}>
                      {code(x.id)} · {x.title}
                    </option>
                  ))}
                </select>
                <IconButton icon="close" size="xs" label="Remove this spot" onClick={() => onChange([...others, ...booked.filter((_, j) => j !== i)], `Removed ${code(b.orderItemId)} from ${info.name}`)} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_56px] gap-2">
                <select aria-label="Position in the break" value={b.positionId ?? ''} onChange={(e) => update(i, { positionId: e.target.value || null })} className="h-7 min-w-0 rounded-ctl border border-border-strong bg-surface px-1 text-small">
                  <option value="">No position</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input aria-label="Plays" className="mono h-7 rounded-ctl border border-border-strong bg-surface px-1.5 text-small" inputMode="numeric" value={b.passes} onChange={(e) => update(i, { passes: Math.max(1, Math.min(99, Number(e.target.value.replace(/\D/g, '')) || 1)) })} />
              </div>
              {it && <span className="mono text-meta text-text-3">{it.lengthFrames ? len(it.lengthFrames) : 'no length'}</span>}
            </div>
          );
        })}
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            const add = makeBooking(k);
            if (add) onChange([...allBooked, ...add], `Booked ${code(add[0].orderItemId)} in ${info.name}`);
          }}
        >
          {booked.length ? 'Book once more' : 'Book here'}
        </Button>
      </div>
      <div className="flex flex-col gap-2 border-t border-hairline px-3.5 py-3">
        <span className="text-meta text-text-3">The same break on the other days</span>
        <div className="grid grid-cols-7 gap-1">
          {dayChips.map((c) => (
            <button
              key={c.d.date}
              type="button"
              disabled={!c.usable}
              title={!c.key ? `${DAY[weekdayOf(c.d.date)]} has no ${info.name}` : !c.d.inOrder ? 'Outside the campaign' : c.me ? 'This day' : c.n ? 'Booked: open it' : `Book here on ${DAY[weekdayOf(c.d.date)]}`}
              onClick={() => {
                if (!c.key || c.me) return;
                if (c.n) onOpen(c.key);
                else {
                  const add = makeBooking(c.key);
                  if (add) onChange([...allBooked, ...add], `Booked ${code(add[0].orderItemId)} in ${info.name} · ${DAY[weekdayOf(c.d.date)]}`);
                }
              }}
              className={cx(
                'flex h-10 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[6px] border bg-transparent p-0 text-[11.5px] font-medium disabled:cursor-default',
                c.me ? 'border-accent bg-accent-soft' : 'border-border',
                !c.key && 'border-dashed text-text-3',
              )}
            >
              <span>{DAY[weekdayOf(c.d.date)]}</span>
              <span className={cx('mono text-[11px]', !c.key ? 'text-text-3' : c.n ? '' : 'text-accent-text')} style={c.n ? { color: tone(allBooked.find((b) => slotKey(b) === c.key)!.orderItemId) } : undefined}>
                {!c.key ? '–' : c.n ? code(allBooked.find((b) => slotKey(b) === c.key)!.orderItemId) : '+'}
              </span>
            </button>
          ))}
        </div>
        <span className="text-meta leading-[1.4] text-text-3">{missing.length ? `Not on ${missing.join(', ')}: ${missing.length === 1 ? 'that day has' : 'those days have'} other breaks at this time.` : 'Every day of this week has this break.'}</span>
      </div>
      <div className="flex items-center gap-2 border-t border-hairline px-3.5 py-2.5">
        <Button variant="danger" size="sm" disabled={!booked.length} onClick={() => { onChange(others, `Removed every spot from ${info.name}`); onClose(); }}>
          Remove
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          disabled={!freeDays.length}
          onClick={() => onChange([...allBooked, ...freeDays.flatMap((c) => makeBooking(c.key!) ?? [])], `Booked ${info.name} on ${freeDays.length} more days`)}
        >
          {freeDays.length ? `Book on ${freeDays.length} more ${freeDays.length === 1 ? 'day' : 'days'}` : 'On every day that has it'}
        </Button>
      </div>
    </aside>
  );
}
