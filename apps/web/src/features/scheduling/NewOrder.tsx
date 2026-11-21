// Screen 3 of Scheduling (scheduling-page.md "New order", mockup screen "new"): the form in the left
// sidebar and the channel's week — empty template blocks or the confirmed programmes with the free
// blocks marked. Create draft makes the order and opens it on its first complete week.

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ORDER_MODES, addDays, firstCompleteWeek, formatTc, framesPerDay, isIsoDate, weekStartOn, type OrderMode } from '@9eye/core';
import { useStoredState } from '@/app/prefs';
import { api, errorText } from '@/lib/api';
import type { OrderFull } from '@/lib/types';
import {
  Button,
  CatalogPicker,
  CommitField,
  ContextPicker,
  DatePicker,
  EditorLayout,
  IconButton,
  Notice,
  PageHeader,
  Pill,
  RadioList,
  RowList,
  SCHEDULE_ZOOM,
  ScheduleLegend,
  ScheduleWeek,
  Segmented,
  StartEndPicker,
  SwitchRow,
  TextField,
  cx,
  type CatalogPick,
  type CatalogPickItem,
} from '@/ui';
import { LimitsEditor, type LimitsValue } from './dialogs';
import { buildColumns } from './grid';
import { limitsTextOf } from './OrderDetails';
import { MODE_LABEL, familiesFor, hourLabels, timeCtx } from './model';
import { orderKeys, useChannels, useChannelWeek, useMainTemplate } from './queries';

const NEW_HINT: Record<OrderMode, string> = {
  series: 'Episodes in list order; repeats; copy one week to all',
  programmes: 'Chosen films or shows on chosen days and blocks',
  promos: 'Trailers, idents or music clips rotated through blocks',
  jingles: 'Opening / closing elements around programmes',
  graphics: 'Logos, tickers, age ratings from Media → Graphics',
};
const PICK_TITLE: Record<OrderMode, string> = { series: 'Pick the series', programmes: 'Pick films or shows', promos: 'Pick trailers, idents or clips', jingles: 'Pick stings', graphics: 'Pick graphics' };

function lengthText(frames: number, nominal: number): string {
  const s = Math.round(frames / nominal);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export function NewOrder() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const channels = useChannels();
  const list = channels.data ?? [];
  const own = list.find((c) => c.id === params.get('channel')) ?? list[0] ?? null;
  const [extra, setExtra] = useState<string[]>([]);
  const [mode, setMode] = useState<OrderMode>('series');
  const [name, setName] = useState('');
  const today = own?.today ?? '';
  const fromParam = params.get('from');
  const [dates, setDates] = useState<{ from: string; to: string } | null>(null);
  const startDefault = fromParam && isIsoDate(fromParam) && fromParam >= today ? fromParam : today;
  const from = dates?.from ?? startDefault;
  const to = dates?.to ?? (from ? addDays(from, 69) : '');
  const [items, setItems] = useState<CatalogPickItem[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [first, setFirst] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  const [limits, setLimits] = useState<LimitsValue>({ maxAirings: null, totalAirings: null, timeWindows: { allowed: [], rejected: [] } });
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [show, setShow] = useState<'empty' | 'confirmed'>('confirmed');
  const [week, setWeek] = useState<string | null>(null);
  const [zoom, setZoom] = useStoredState<{ z: number }>('9eye.scheduling.zoom', { z: 1 });
  const [error, setError] = useState<string | null>(null);
  const t = useMemo(() => (own ? timeCtx(own) : null), [own]);
  const ws = own && from ? (week ?? weekStartOn(from, own.weekStart)) : null;
  const weekData = useChannelWeek(show === 'confirmed' ? (own?.id ?? null) : null, ws);
  const tpl = useMainTemplate(own?.id ?? null, ws);
  const template = show === 'confirmed' ? (weekData.data?.template ?? null) : (tpl.data ?? null);
  const ownTemplate = useMainTemplate(own?.id ?? null, from || null);
  const series = mode === 'series';
  const chapters = items.map((i) => i.chapter).filter((c): c is number => c !== null);
  const firstEp = first ?? (chapters.length ? Math.min(...chapters) : 1);

  const create = useMutation({
    mutationFn: () => {
      const firstItem = series ? items.find((i) => i.chapter === firstEp) : undefined;
      return api<OrderFull>('POST', '/orders', {
        name, mode, channelIds: [own!.id, ...extra], startDate: from, endDate: to, productionIds: items.map((i) => i.productionId),
        firstProductionId: firstItem && firstItem !== items[0] ? firstItem.productionId : null, reuseInLoop: series && loop, ...limits,
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: orderKeys.all() });
      const w = firstCompleteWeek(r.order.startDate, r.order.endDate, own!.weekStart) ?? weekStartOn(r.order.startDate, own!.weekStart);
      navigate(`/scheduling/${r.order.id}?week=${w}`);
    },
    onError: (e) => setError(errorText(e)),
  });

  if (!own || !t || !ws) return <span className="block px-8 py-8 text-small text-text-3">Loading…</span>;
  const pick = (r: CatalogPick) => {
    setItems(r.items);
    setShowAll(false);
    setFirst(null);
  };
  const addMore = (r: CatalogPick) => {
    const have = new Set(items.map((i) => i.productionId));
    setItems([...items, ...r.items.filter((x) => !have.has(x.productionId))]);
  };
  const known = items.filter((i) => i.lengthFrames);
  const unit = series ? 'episode' : 'item';
  const shown = showAll ? items : items.slice(0, 8);
  const columns = buildColumns({ mode: show === 'empty' ? 'empty' : 'confirmed', ws, template, t, channelId: own.id, orderId: null, draft: null, items: null, others: weekData.data?.airings ?? [], show: { others: true, breaks: false, names: false }, sel: null });
  const z = Math.min(Math.max(0, zoom.z), SCHEDULE_ZOOM.length - 1);
  const submit = () => {
    if (!name.trim()) return setError('Give the plan a name.');
    setError(null);
    create.mutate();
  };
  const step = (n: number, text: string) => (
    <span className="text-small text-text-3">
      {n} · {text}
    </span>
  );

  return (
    <>
      <PageHeader
        back={{ label: `Scheduling · ${own.name}`, to: `/scheduling?channel=${own.id}` }}
        title="New plan"
        description={<span className="text-small">{own.name} · saved as a draft until you confirm it</span>}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate(`/scheduling?channel=${own.id}`)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={create.isPending} onClick={submit}>
              Create draft
            </Button>
          </>
        }
      />
      <EditorLayout
        wide
        leftLabel="New plan"
        left={
          <>
            {error && <Notice tone="red">{error}</Notice>}
            <div className="flex flex-col gap-2">
              {step(1, 'How it places items')}
              <RadioList
                label="Mode"
                value={mode}
                onChange={(m) => {
                  if (m !== mode) setItems([]);
                  setMode(m);
                }}
                options={ORDER_MODES.map((m) => ({
                  value: m,
                  label: (
                    <span className="flex flex-col gap-px py-1.5">
                      <span className="font-medium">{MODE_LABEL[m]}</span>
                      <span className="text-meta text-text-3">{NEW_HINT[m]}</span>
                    </span>
                  ),
                }))}
              />
            </div>
            <div className="flex flex-col gap-2.5">
              {step(2, 'Where and when')}
              <div className="flex flex-wrap items-center gap-1.5">
                <span title={ownTemplate.data ? `Layout: ${ownTemplate.data.name}` : 'No main layout for these dates'}>
                  <Pill>{own.name}</Pill>
                </span>
                {extra.map((id) => (
                  <Pill key={id} onRemove={() => setExtra(extra.filter((x) => x !== id))} removeLabel={`Remove ${list.find((c) => c.id === id)?.name}`}>
                    {list.find((c) => c.id === id)?.name}
                  </Pill>
                ))}
                <span className="-ml-1" title="More than one channel makes a multi-channel plan: one item list, each channel placed on its own layout">
                  <ContextPicker label="Add a channel" placeholder="+ Channel" searchLabel="channels" value="" items={list.filter((c) => c.id !== own.id && !extra.includes(c.id)).map((c) => ({ id: c.id, name: c.name }))} onPick={(id) => setExtra([...extra, id])} />
                </span>
              </div>
              <TextField label="Name" value={name} placeholder="e.g. Harbor - Lumen Plus" onChange={(e) => setName(e.target.value)} />
              <StartEndPicker
                label="Dates"
                weekStart={own.weekStart}
                today={today}
                start={from}
                end={to}
                min={today}
                onChange={(v) => {
                  setDates({ from: v.start, to: v.end });
                  setWeek(null);
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              {!items.length ? (
                <>
                  {step(3, series ? 'Episodes' : mode === 'graphics' ? 'Graphics' : 'Items')}
                  <CatalogPicker
                    pick={series ? 'series' : 'items'}
                    families={familiesFor(mode)}
                    frameRate={own.frameRate}
                    date={from}
                    title={PICK_TITLE[mode]}
                    context={`For a new plan on ${own.name}`}
                    trigger="Pick from Media…"
                    triggerStyle="dashed"
                    onPick={pick}
                  />
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-small text-text-3">
                      3 · {series ? 'Episodes' : 'Items'} <span className="mono">{items.length}</span>
                    </span>
                    <CatalogPicker
                      pick="items"
                      families={familiesFor(mode)}
                      frameRate={own.frameRate}
                      startContent={items[items.length - 1]?.contentId ?? null}
                      already={items.map((i) => i.productionId)}
                      date={from}
                      title="Add more"
                      context="To the new plan"
                      trigger="Add from Media"
                      triggerStyle="small"
                      onPick={addMore}
                    />
                  </div>
                  <span className={cx('text-meta', known.length < items.length ? 'text-amber-text' : 'text-text-3')}>
                    {items.length} {unit}
                    {items.length === 1 ? '' : 's'} · {known.length ? `${lengthText(known.reduce((s, i) => s + (i.lengthFrames ?? 0), 0), t.rate.nominal)} known` : 'no length known'}
                    {known.length < items.length ? ` · ${items.length - known.length} without a length` : ''}
                  </span>
                  <RowList
                    footer={
                      items.length > 8 ? (
                        <button type="button" onClick={() => setShowAll(!showAll)} className="hov -mx-2.5 h-[30px] w-[calc(100%+20px)] cursor-pointer border-0 bg-transparent text-meta text-text-2">
                          {showAll ? 'Show fewer' : `Show all ${items.length}`}
                        </button>
                      ) : undefined
                    }
                  >
                    {shown.map((x, i) => (
                      <div key={x.productionId} className="flex min-h-[30px] items-center gap-2 pl-2.5 pr-1 text-small">
                        <span className="mono w-[26px] text-tiny text-text-3">{series && x.chapter !== null ? x.chapter : i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{x.title}</span>
                        <span className={cx('mono text-[11.5px]', x.lengthFrames ? 'text-text-3' : 'text-amber-text')}>{x.lengthFrames ? formatTc(x.lengthFrames, t.rate) : 'no length'}</span>
                        <IconButton icon="close" size="xs" tone="quiet" label={`Remove ${x.title}`} onClick={() => setItems(items.filter((y) => y !== x))} />
                      </div>
                    ))}
                  </RowList>
                </>
              )}
            </div>
            {series && (
              <>
                <label className="flex items-center justify-between gap-3 text-small text-text-2">
                  First episode to place
                  <CommitField ariaLabel="First episode to place" width={64} value={firstEp} format={(v) => String(v)} parse={(s) => (/^\d+$/.test(s.trim()) ? Number(s) : null)} onCommit={(v) => (items.length && !items.some((i) => i.chapter === v) ? `There is no episode ${v} in the list.` : setFirst(v))} />
                </label>
                <SwitchRow title="Start again when episodes run out" description="Episode 1 follows the last one" checked={loop} onChange={setLoop} />
              </>
            )}
            <div className="flex items-center justify-between gap-3 text-small">
              <span className="flex flex-col">
                <span className="text-text-2">Limits</span>
                <span className="text-meta text-text-3">{limitsTextOf(limits)}</span>
              </span>
              <Button size="xs" onClick={() => setLimitsOpen(true)}>
                Edit
              </Button>
            </div>
          </>
        }
        main={
          <>
            <Notice>
              {show === 'empty'
                ? "The channel's layout, empty. Placing starts after the draft is created."
                : "The channel's week with every confirmed programme already placed, so you can see the free blocks. Placing starts after the draft is created."}
            </Notice>
            <div className="no-print flex flex-wrap items-center justify-between gap-2.5 text-small text-text-2">
              <span className="-ml-2">
                <DatePicker mode="week" variant="quiet" step label="Week" weekStart={own.weekStart} today={today} value={ws} onChange={(v) => setWeek(v.from)} />
              </span>
              <Segmented label="What to show" size="sm" value={show} onChange={setShow} options={[{ value: 'empty', label: 'Empty' }, { value: 'confirmed', label: 'Confirmed programmes' }]} />
              <ScheduleLegend
                items={
                  show === 'empty'
                    ? [{ label: 'Layout block', look: 'template' }]
                    : [
                        { label: 'First airing', look: 'firstAll', color: null },
                        { label: 'Repeat', look: 'repeatAll', color: null },
                        { label: 'Free block', look: 'missing' },
                      ]
                }
              />
              <span className="flex-1" />
              <span role="group" aria-label="Zoom" className="inline-flex items-center gap-0.5">
                <IconButton icon="minus" size="sm" label="Zoom out" disabled={z === 0} onClick={() => setZoom({ z: z - 1 })} />
                <IconButton icon="plus" size="sm" label="Zoom in" disabled={z === SCHEDULE_ZOOM.length - 1} onClick={() => setZoom({ z: z + 1 })} />
              </span>
            </div>
            {template ? (
              <ScheduleWeek label="Week" columns={columns} hourLabels={hourLabels(t)} framesPerHour={t.fph} hourHeight={SCHEDULE_ZOOM[z]} />
            ) : (
              <Notice tone="amber">{own.name} has no main layout for this week.</Notice>
            )}
          </>
        }
      />
      {limitsOpen && <LimitsEditor t={t} dayFrames={framesPerDay(t.rate)} series={series} value={limits} onApply={(v) => setLimits(v)} onClose={() => setLimitsOpen(false)} />}
    </>
  );
}
