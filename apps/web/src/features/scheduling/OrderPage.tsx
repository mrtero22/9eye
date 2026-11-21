// Screen 2 of Scheduling (scheduling-page.md "One order", mockup screen "order"): one order with a
// left sidebar (order details, or the clicked block) and the week of the channel — calendar, table
// or report. Every change is local until Save; Undo / Redo cover all of them.

import { useEffect, useMemo, useReducer, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addDays, isIsoDate, isRepeat, weekStartOn, weekdayOf, type OrderDraft } from '@9eye/core';
import { useStoredState } from '@/app/prefs';
import { ApiError, api, errorText } from '@/lib/api';
import type { OrderFull } from '@/lib/types';
import {
  Badge,
  Button,
  ConfirmDialog,
  DatePicker,
  EditorLayout,
  IconButton,
  Menu,
  MenuCheck,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Notice,
  PageHeader,
  SCHEDULE_ZOOM,
  ScheduleLegend,
  ScheduleWeek,
  Segmented,
  formatDateRange,
  useToast,
} from '@/ui';
import { BlockSide } from './BlockSide';
import type { OrderCtx } from './ctx';
import {
  AllFieldsDialog,
  AutoPlaceDialog,
  ChangeEndDialog,
  ClearDialog,
  CopyWeekPopover,
  DeleteOrderDialog,
  LimitsDialog,
  MoveDialog,
  RefreshDialog,
  ReplaceDialog,
  ShiftDialog,
  SplitDialog,
} from './dialogs';
import { addFirst, addRepeat, type Edit } from './edits';
import { buildColumns, parseCellId, type ShowInWeek } from './grid';
import { DuplicateDialog } from './OrderList';
import { MODE_LABEL, airingTitle, defaultWeek, editorReducer, emptyEditor, isDirty, isProgrammeMode, itemInfo, itemsById, ruleContext, shortDay, timeCtx, hourLabels, toDraft, type ItemInfo } from './model';
import { OrderDetails } from './OrderDetails';
import { orderKeys, useChannelWeek, useOrder } from './queries';
import { ReportView } from './ReportView';
import { TableView } from './TableView';
import { useAgentPage } from '@/features/agents/pageAgent';

type DialogKind = null | 'limits' | 'fields' | 'split' | 'move' | 'shift' | 'replace' | 'refresh' | 'duplicate' | 'delete' | 'clear' | 'autoplace' | 'changeEnd';

export function OrderPage({ orderId }: { orderId: string }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useOrder(orderId);
  const full: OrderFull | null = q.data && q.data.order.id === orderId ? q.data : null;
  const [ed, dispatch] = useReducer(editorReducer, emptyEditor);
  const dirty = isDirty(ed);
  useEffect(() => {
    if (!full) return;
    if (ed.orderId !== full.order.id || (!dirty && ed.version !== full.order.version)) dispatch({ type: 'load', orderId: full.order.id, version: full.order.version, draft: toDraft(full) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);
  const draft = full && ed.orderId === full.order.id ? ed.present : null;
  useAgentPage(full ? { name: 'Scheduling › Plan', sees: `plan "${full.order.name}" (${full.order.status}, ${full.order.startDate} → ${full.order.endDate})` } : null);

  const [picked, setPicked] = useState<Map<string, ItemInfo>>(new Map());
  const info = useMemo(() => (full ? itemInfo(full, picked) : new Map<string, ItemInfo>()), [full, picked]);
  const items = useMemo(() => (draft ? itemsById(draft, info) : new Map()), [draft, info]);
  const rules = useMemo(() => (full ? ruleContext(full.channels) : null), [full]);
  const wantedChannel = params.get('ch');
  const own = full ? (full.channels.find((c) => c.channel.id === wantedChannel) ?? full.channels[0]) : null;
  const channel = own?.channel ?? null;
  const t = useMemo(() => (channel ? timeCtx(channel) : null), [channel]);
  const weekParam = params.get('week');
  const ws = draft && channel ? (weekParam && isIsoDate(weekParam) ? weekStartOn(weekParam, channel.weekStart) : defaultWeek(draft.startDate, draft.endDate, channel.today, channel.weekStart)) : null;
  const we = ws ? addDays(ws, 6) : null;
  const week = useChannelWeek(channel?.id ?? null, ws);
  const others = useMemo(() => (week.data?.airings ?? []).filter((w) => w.orderId !== orderId), [week.data, orderId]);
  const selDate = params.get('date');
  const selBlock = params.get('block');
  const sel = selDate && selBlock ? { date: selDate, blockTypeId: selBlock } : null;
  const view = (params.get('view') as 'cal' | 'table' | 'report' | null) ?? 'cal';
  const [scope, setScope] = useState<'order' | 'all'>('order');
  const [zoom, setZoom] = useStoredState<{ z: number }>('9eye.scheduling.zoom', { z: 1 });
  const [show, setShow] = useStoredState<ShowInWeek>('9eye.scheduling.show', { others: true, breaks: false, names: false });
  const [quick, setQuick] = useState(false);
  // quick placement adds repeats of this first airing instead of new first airings
  const [repeatOf, setRepeatOf] = useState<string | null>(null);
  const repeatSource = quick && repeatOf && draft && channel ? draft.airings.find((a) => a.id === repeatOf && !isRepeat(a) && a.channelId === channel.id) : undefined;
  const repeating = !!repeatSource;
  const [dialog, setDialog] = useState<DialogKind>(params.get('do') === 'split' ? 'split' : null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [rotOpen, setRotOpen] = useState(false);
  const [showItems, setShowItems] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ message: string; problems: { message: string }[] } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [leave, setLeave] = useState<(() => void) | null>(null);

  const setParam = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    p.delete('do');
    setParams(p, { replace: true });
  };
  const stopQuick = () => {
    setQuick(false);
    setRepeatOf(null);
  };
  useEffect(() => {
    if (!quick) return;
    // one step back: repeats → first airings → off
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!repeating) setQuick(false);
      setRepeatOf(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quick, repeating]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const apply = (e: Edit | OrderDraft): boolean => {
    if ('refused' in e) {
      setRefusal(e.refused);
      return false;
    }
    setRefusal(null);
    dispatch({ type: 'change', draft: 'airings' in e ? e : e.draft });
    return true;
  };
  const guard = (go: () => void) => (dirty ? setLeave(() => go) : go());

  const save = useMutation({
    mutationFn: () => api<OrderFull>('PUT', `/orders/${orderId}`, { ...ed.present, version: ed.version }),
    onSuccess: (r) => {
      setSaveError(null);
      setConflict(false);
      qc.setQueryData(orderKeys.one(orderId), r);
      qc.invalidateQueries({ queryKey: orderKeys.all(), predicate: (x) => x.queryKey[2] !== 'one' || x.queryKey[3] !== orderId });
      dispatch({ type: 'load', orderId: r.order.id, version: r.order.version, draft: toDraft(r) });
      setPicked(new Map());
      toast('Saved');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else setSaveError({ message: errorText(e), problems: e instanceof ApiError ? e.problems : [] });
    },
  });

  if (q.error) {
    return (
      <div className="px-4 py-8 sm:px-8">
        <Notice tone="amber" action={<Button size="sm" onClick={() => navigate('/scheduling')}>All plans</Button>}>
          {errorText(q.error)}
        </Notice>
      </div>
    );
  }
  if (!full || !draft || !own || !channel || !t || !rules || !ws || !we) return <span className="block px-8 py-8 text-small text-text-3">Loading…</span>;

  const days = rules.templates.get(channel.id)!;
  const byId = new Map(draft.airings.map((a) => [a.id, a]));
  const programme = isProgrammeMode(draft.mode);
  const series = draft.mode === 'series';
  const ctx: OrderCtx = {
    full, draft, apply, dirty, channelId: channel.id, channel, template: own.template, days, rules, t, items, info,
    addInfo: (m) => setPicked(new Map([...picked, ...m])), byId, ws, we, others,
    selectBlock: (date, blockTypeId) => setParam({ date, block: blockTypeId, view: view === 'report' ? null : params.get('view') }),
    openWeek: (date) => setParam({ week: weekStartOn(date, channel.weekStart), date: null, block: null }),
    openOrder: (id, at) => guard(() => navigate(`/scheduling/${id}?week=${ws}${at ? `&date=${at.date}&block=${at.blockTypeId}` : ''}`)),
  };

  // ---------------------------------------------------------------- header facts
  const mine = draft.airings.filter((a) => a.channelId === channel.id);
  const weekFirsts = mine.filter((a) => !isRepeat(a) && a.date >= ws && a.date <= we);
  // the first airing of the selected block (or the one its repeat replays): where Shift airings starts
  const selAiring = sel ? mine.find((a) => a.date === sel.date && a.blockTypeId === sel.blockTypeId) : undefined;
  const selFirst = selAiring ? (selAiring.repeatOfId ?? selAiring.id) : null;
  const aired = new Set(mine.filter((a) => !isRepeat(a) && a.date < ws).flatMap((a) => a.items.map((x) => x.itemId))).size;
  const blocksInWeek = Array.from({ length: 7 }, (_, i) => days[weekdayOf(addDays(ws, i))].size).reduce((s, n) => s + n, 0);
  const progress = series
    ? `${aired} of ${draft.items.length} aired · ${weekFirsts.length} first airing${weekFirsts.length === 1 ? '' : 's'} this week`
    : `${draft.items.length} ${draft.items.length === 1 ? 'item' : 'items'} · ${weekFirsts.length && weekFirsts.length >= blocksInWeek ? 'in every block' : `${weekFirsts.length} blocks this week`}${draft.endDate >= ws && draft.endDate <= we ? ` until ${shortDay(draft.endDate)}` : ''}`;

  const columns = buildColumns({ mode: scope === 'all' ? 'all' : 'order', ws, template: own.template, t, channelId: channel.id, orderId, draft, items, others, show, sel, quick: quick && programme ? { repeatOf: repeatSource?.id ?? null } : null });
  const legend =
    scope === 'all'
      ? [
          { label: 'First airing', look: 'firstAll' as const, color: draft.color },
          { label: 'Repeat', look: 'repeatAll' as const, color: draft.color },
          { label: 'No programme', look: 'missing' as const },
        ]
      : programme
        ? [
            { label: 'First airing', look: 'first' as const, color: draft.color },
            { label: 'Repeat', look: 'repeat' as const, color: draft.color },
            { label: 'Other plans', look: 'other' as const },
            { label: 'No programme', look: 'missing' as const },
          ]
        : [
            { label: 'Plays in block', look: 'passes' as const, color: draft.color },
            { label: 'Outside the plan', look: 'outside' as const },
          ];

  const clickCell = (id: string) => {
    const { date, blockTypeId } = parseCellId(id);
    // a block another order holds is placed too (user, 2026-10-23): its panel and the order's issue warn
    if (quick && programme && !mine.find((a) => a.date === date && a.blockTypeId === blockTypeId)) {
      if (date < draft.startDate || date > draft.endDate) return setRefusal(`${shortDay(date)} is outside the plan's dates.`);
      apply(repeatSource ? addRepeat(draft, repeatSource.id, date, blockTypeId) : addFirst(draft, rules, channel.id, date, blockTypeId));
      return;
    }
    if (scope === 'all') {
      const prog = others.find((w) => w.date === date && w.blockTypeId === blockTypeId && isProgrammeMode(w.mode));
      if (prog && !mine.find((a) => a.date === date && a.blockTypeId === blockTypeId)) return ctx.openOrder(prog.orderId, { date, blockTypeId });
    }
    ctx.selectBlock(date, blockTypeId);
  };
  const clickAction = (id: string) => {
    const { date, blockTypeId } = parseCellId(id);
    const first = mine.find((a) => a.date === date && a.blockTypeId === blockTypeId && !isRepeat(a));
    if (first) setRepeatOf(repeatSource?.id === first.id ? null : first.id);
  };

  const fix = (action: NonNullable<NonNullable<OrderFull['issue']>['fix']>) => {
    if (action.action === 'confirm') apply({ ...draft, status: 'confirmed' });
    else if (action.action === 'end-on' && action.date) apply({ ...draft, endDate: action.date });
    else if (action.action === 'change-end') setDialog('changeEnd');
    else if (action.action === 'new-order') guard(() => navigate(`/scheduling/new?channel=${channel.id}${action.date ? `&from=${action.date}` : ''}`));
    else if (action.action === 'show-items') setShowItems((n) => n + 1);
    else if (action.action === 'open-week' && action.date) ctx.openWeek(action.date);
  };

  const needsSaved = (kind: DialogKind) => () => setDialog(kind);
  const z = Math.min(Math.max(0, zoom.z), SCHEDULE_ZOOM.length - 1);

  return (
    <>
      <PageHeader
        back={{ label: `Scheduling · ${channel.name}`, onClick: () => guard(() => navigate(`/scheduling?channel=${full.channels[0].channel.id}`)) }}
        title={draft.name}
        mark={draft.color}
        description={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-small">
            <Badge tone={draft.status === 'confirmed' ? 'green' : 'neutral'}>{draft.status === 'confirmed' ? 'Confirmed' : 'Draft'}</Badge>
            <span>{MODE_LABEL[draft.mode]}</span>
            <span aria-hidden="true" className="text-text-3">
              ·
            </span>
            <span className="mono">{formatDateRange(draft.startDate, draft.endDate)}</span>
            <span aria-hidden="true" className="text-text-3">
              ·
            </span>
            <span>{progress}</span>
          </span>
        }
        actions={
          <>
            {dirty && <Badge tone="amber">Unsaved changes</Badge>}
            <IconButton icon="undo" label="Undo" disabled={!ed.past.length} onClick={() => dispatch({ type: 'undo' })} />
            <IconButton icon="redo" label="Redo" disabled={!ed.future.length} onClick={() => dispatch({ type: 'redo' })} />
            <CopyWeekPopover ctx={ctx} open={copyOpen} onOpenChange={setCopyOpen} />
            <Menu label="Plan actions" width={270} trigger={<IconButton icon="more" label="Plan actions" />}>
              <MenuItem disabled={!programme} note="Click blocks to add first airings" onSelect={() => (quick ? stopQuick() : setQuick(true))}>
                {quick ? 'Stop quick placement' : 'Quick placement'}
              </MenuItem>
              <MenuItem note="Fill the plan from its settings" onSelect={() => setDialog('autoplace')}>
                Auto-place…
              </MenuItem>
              <MenuItem disabled={programme} note="Plays per day and share per item" onSelect={() => {
                  setParam({ date: null, block: null });
                  setRotOpen(true);
                }}>
                Rotation…
              </MenuItem>
              <MenuSeparator />
              <MenuItem note="End it at a date, continue in a new plan" onSelect={needsSaved('split')}>
                Split plan…
              </MenuItem>
              <MenuItem note="To another order of the same kind" onSelect={needsSaved('move')}>
                Move airings…
              </MenuItem>
              <MenuItem disabled={!programme} note="Episodes earlier or later along the airing days" onSelect={() => setDialog('shift')}>
                Shift airings…
              </MenuItem>
              <MenuItem note="Swap an item in a date range" onSelect={() => setDialog('replace')}>
                Replace items…
              </MenuItem>
              <MenuItem note="Read item lengths from Media again" onSelect={() => setDialog('refresh')}>
                Refresh durations
              </MenuItem>
              <MenuItem onSelect={needsSaved('duplicate')}>Duplicate plan…</MenuItem>
              <MenuItem onSelect={() => setParam({ view: 'report' })}>Report</MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={() => setDialog('clear')}>
                Clear all airings…
              </MenuItem>
              <MenuItem danger onSelect={needsSaved('delete')}>
                Delete plan…
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>Show in the week</MenuLabel>
              <MenuCheck checked={show.others} onChange={(v) => setShow({ ...show, others: v })}>
                Other plans' programmes
              </MenuCheck>
              <MenuCheck checked={show.breaks} onChange={(v) => setShow({ ...show, breaks: v })}>
                Linked breaks
              </MenuCheck>
              <MenuCheck checked={show.names} onChange={(v) => setShow({ ...show, names: v })}>
                Block names
              </MenuCheck>
            </Menu>
            <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      />
      <EditorLayout
        wide
        leftLabel={sel ? 'Block' : 'Plan details'}
        left={
          sel ? (
            <BlockSide ctx={ctx} date={sel.date} blockTypeId={sel.blockTypeId} onBack={() => setParam({ date: null, block: null })} onChangeEnd={() => setDialog('changeEnd')} />
          ) : (
            <OrderDetails ctx={ctx} onFix={fix} onLimits={() => setDialog('limits')} onAllFields={() => setDialog('fields')} onReport={() => setParam({ view: 'report' })} rotationOpen={rotOpen} onRotationOpen={setRotOpen} showItems={showItems} />
          )
        }
        main={
          <>
            {conflict && (
              <Notice tone="amber" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>
                Someone else saved this plan since you opened it. Reload it to see their changes (yours are lost).
              </Notice>
            )}
            {saveError && (
              <Notice tone="red">
                <span>{saveError.message}</span>
                {saveError.problems.slice(0, 8).map((p, i) => (
                  <span key={i}>· {p.message}</span>
                ))}
              </Notice>
            )}
            {refusal && (
              <Notice tone="amber" action={<IconButton icon="close" size="sm" label="Dismiss" onClick={() => setRefusal(null)} />}>
                {refusal}
              </Notice>
            )}
            {quick && (
              <Notice tone="accent" action={<Button size="sm" onClick={stopQuick}>Stop</Button>}>
                <span className="flex-1">
                  {repeatSource
                    ? `Quick placement: click an empty block to add a repeat of ${airingTitle(repeatSource, byId, items)} (${shortDay(repeatSource.date)}). Esc to go back to first airings.`
                    : `Quick placement: click an empty block to add a first airing of ${draft.name} (next ${series ? 'episode' : 'item'}), or the copy button on a first airing to add its repeats. Esc to stop.`}
                </span>
              </Notice>
            )}
            {view === 'report' ? (
              <ReportView ctx={ctx} onBack={() => setParam({ view: null })} />
            ) : (
              <>
                <div className="no-print flex flex-wrap items-center justify-between gap-2.5 text-small text-text-2">
                  <span className="-ml-2">
                    <DatePicker
                      mode="week"
                      variant="quiet"
                      step
                      label="Week"
                      weekStart={channel.weekStart}
                      today={channel.today}
                      value={ws}
                      min={draft.startDate}
                      max={draft.endDate}
                      limitText={`Outside the plan: ${formatDateRange(draft.startDate, draft.endDate)}.`}
                      onChange={(v) => setParam({ week: v.from, date: null, block: null })}
                    />
                  </span>
                  {full.channels.length > 1 && (
                    <Segmented label="Channel" size="sm" value={channel.id} onChange={(v) => setParam({ ch: v, date: null, block: null })} options={full.channels.map((c) => ({ value: c.channel.id, label: c.channel.name }))} />
                  )}
                  <Segmented label="Which plans to draw" size="sm" value={scope} onChange={setScope} options={[{ value: 'order', label: 'This plan' }, { value: 'all', label: 'All programmes' }]} />
                  <ScheduleLegend items={legend} />
                  <span className="flex-1" />
                  <Segmented label="View" size="sm" value={view === 'table' ? 'table' : 'cal'} onChange={(v) => setParam({ view: v === 'cal' ? null : v })} options={[{ value: 'cal', label: 'Calendar' }, { value: 'table', label: 'Table' }]} />
                  <span role="group" aria-label="Zoom" className="inline-flex items-center gap-0.5">
                    <IconButton icon="minus" size="sm" label="Zoom out" disabled={z === 0} onClick={() => setZoom({ z: z - 1 })} />
                    <IconButton icon="plus" size="sm" label="Zoom in" disabled={z === SCHEDULE_ZOOM.length - 1} onClick={() => setZoom({ z: z + 1 })} />
                  </span>
                </div>
                {view === 'table' ? (
                  <TableView ctx={ctx} />
                ) : (
                  <ScheduleWeek label="Week" columns={columns} hourLabels={hourLabels(t)} framesPerHour={t.fph} hourHeight={SCHEDULE_ZOOM[z]} onCellClick={clickCell} onCellAction={clickAction} />
                )}
              </>
            )}
          </>
        }
      />

      {dialog === 'limits' && <LimitsDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === 'fields' && <AllFieldsDialog ctx={ctx} onClose={() => setDialog(null)} onLimits={() => setDialog('limits')} />}
      {dialog === 'changeEnd' && <ChangeEndDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === 'split' && <SplitDialog ctx={ctx} onClose={() => setDialog(null)} onDone={(id) => navigate(`/scheduling/${id}`)} />}
      {dialog === 'move' && <MoveDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === 'replace' && <ReplaceDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === 'shift' && <ShiftDialog ctx={ctx} start={selFirst} onClose={() => setDialog(null)} />}
      {dialog === 'refresh' && <RefreshDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === 'autoplace' && <AutoPlaceDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === 'clear' && <ClearDialog ctx={ctx} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteOrderDialog ctx={ctx} onClose={() => setDialog(null)} onDone={() => navigate(`/scheduling?channel=${full.channels[0].channel.id}`)} />}
      {dialog === 'duplicate' &&
        (dirty ? (
          <ConfirmDialog open onOpenChange={() => setDialog(null)} title="Save first" description="Duplicate copies the saved plan. Save or undo your changes first." confirmLabel="OK" onConfirm={() => setDialog(null)} />
        ) : (
          <DuplicateDialog order={{ id: orderId, name: draft.name }} onClose={() => setDialog(null)} onDone={(id) => navigate(`/scheduling/${id}`)} />
        ))}
      <ConfirmDialog
        open={!!leave}
        onOpenChange={(o) => !o && setLeave(null)}
        title="Unsaved changes"
        description="This plan has changes that are not saved. Leave and lose them?"
        confirmLabel="Discard changes"
        danger
        extra={{
          label: 'Save and leave',
          onClick: () => {
            const go = leave;
            setLeave(null);
            save.mutate(undefined, { onSuccess: () => go?.() });
          },
        }}
        onConfirm={() => {
          const go = leave;
          setLeave(null);
          dispatch({ type: 'discard' });
          go?.();
        }}
      />
    </>
  );
}
