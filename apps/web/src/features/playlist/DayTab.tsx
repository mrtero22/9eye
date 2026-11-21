// Playlist page, Day tab — docs/design/day-playlist-page.md, parts 1 to 3. One channel playlist on
// one broadcast day: its blocks and rows at the times they really start; changing them by hand (add
// from the catalog, notes, jingles, linked breaks, move, cut / copy / paste, delete, TC range), with
// Undo / Redo and Save; filling it from what exists (program placements, break events, rotation
// lists, commercial orders) with the steps and issues of the day — a step runs at once, a short note
// says what it did, Details shows the rest. Export comes with the next part.

import { useEffect, useMemo, useReducer, useState, type MutableRefObject, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FRAME_RATES,
  FILL_STEP_LABEL,
  breakOf,
  canNudge,
  dayChecks,
  dayEnd,
  draftBlocks,
  exporterLabel,
  findRow,
  formatClock,
  formatClockShort,
  formatTc,
  insertRows,
  layoutDay,
  moveRows,
  nudgeRow,
  parseTc,
  removeRows,
  rowsToTake,
  setTcRange,
  takesTime,
  updateRow,
  type FillMode,
  type FillReport,
  type FillStep,
  type InsertAt,
  type PlaylistKindName,
} from '@9eye/core';
import { ApiError, api, errorText } from '@/lib/api';
import type { AgentDayPreview, Channel } from '@/lib/types';
import { useStoredState } from '@/app/prefs';
import { useAgentPreview } from '@/features/agents/pageAgent';
import {
  ActionItem,
  ActionList,
  Badge,
  Button,
  CatalogPicker,
  CommitField,
  ConfirmDialog,
  DatePicker,
  DetailList,
  EditorLayout,
  EmptyState,
  IconButton,
  Menu,
  MenuCheck,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Notice,
  PlaylistTable,
  SelectionBar,
  SidePanel,
  StatusBar,
  StepItem,
  SwitchRow,
  dayText,
  useToast,
  type CatalogPick,
  type ContentTone,
  type DateMark,
  type PlaylistBlockRow,
  type PlaylistDrop,
  type PlaylistRow,
  type Tone,
} from '@/ui';
import { BreakDialog, LinkDialog, NoteDialog, NoteField, NoteTextField, type BreakChoice } from './dayDialogs';
import { CreateWeeksDialog } from './dialogs';
import { IssuesDialog, ManualAdsDialog, RunDialog, RunResultDialog, type RunRequest } from './fillDialogs';
import { copyRows, dayEditorReducer, emptyDayEditor, isDayDirty, makeRow, payload, type Draft, type Row } from './editor';
import { KIND_LABEL, plural, type BookedSpotRef, type CatalogRow, type Day, type DayBlock, type DayExport, type RunResult } from './model';
import { dayKeys, useDay, useRotationLists, weekKeys } from './queries';

const NOT_BUILT = 'Not built yet';
const PICK_FIRST = 'Select a row or a block first';
const CONTENT_TONES = new Set(['program', 'commercial', 'promo', 'filler', 'ident', 'jingle']);
const STATE: Record<string, { label: string; tone: Tone; mark: DateMark }> = {
  draft: { label: 'Draft', tone: 'neutral', mark: 'warn' },
  published: { label: 'Approved', tone: 'green', mark: 'ok' },
  reconciled: { label: 'Reconciled', tone: 'accent', mark: 'info' },
};
/** Import into this day: the step an item runs, or why it is not there yet. */
const IMPORT_MAIN: { label: string; step?: FillStep; off?: string }[] = [
  { label: 'Acquisitions', off: 'Needs the acquisitions module' },
  { label: 'Program placements', step: 'programs' },
  { label: 'Stings', off: NOT_BUILT },
  { label: 'Graphics', off: NOT_BUILT },
  { label: 'Break events', step: 'breaks' },
  { label: 'Rotation lists', step: 'rotation' },
];
const IMPORT_ADS: typeof IMPORT_MAIN = [
  { label: 'Campaigns', step: 'commercials' },
  { label: 'Rotation lists', step: 'rotation' },
];
const TOOLS_MAIN = ['Search & change…', 'Clone…', 'Remove invalid placements…', 'Sync linked breaks…', 'Refresh from Media…'];
const TOOLS_ADS = ['Search & change…', 'Clone…', 'Remove invalid placements…', 'Refresh from Media…'];
/** Issues that say rows a step placed are out of date: running that step then does it all again. */
const OUT_OF_DATE = new Set(['programs-stale', 'breaks-differ', 'commercials-stale']);
/** How a run's result is told: what a report line counts, and the words for done / not done. */
const RUN_WORDS: Record<FillStep, { one: string; many: string; done: string; notDone: string }> = {
  programs: { one: 'airing', many: 'airings', done: 'placed', notDone: 'not placed' },
  breaks: { one: 'break', many: 'breaks', done: 'filled', notDone: 'not filled' },
  rotation: { one: 'block', many: 'blocks', done: 'filled', notDone: 'not filled' },
  commercials: { one: 'spot', many: 'spots', done: 'placed', notDone: 'not placed' },
};

const toDraft = (day: NonNullable<Day['day']>): Draft => ({
  blocks: day.blocks.map((b) => ({ id: b.id, rows: b.events.map((e) => ({ ...e, lengthFrames: e.kind === 'linked-break' ? 0 : e.lengthFrames })) })),
});

/** Rows going in at a linked break: link them or not. `move`: rows dragged there (moved, not inserted). */
type Ask = { rows: Row[]; at: InsertAt; breakName: string; cut: boolean; move?: string[] };
type SaveError = { message: string; problems: { message: string }[]; conflict: boolean };

export function DayTab({
  channel,
  kind,
  date,
  patch,
  header,
  tabs,
  guardRef,
}: {
  channel: Channel;
  kind: PlaylistKindName;
  date: string;
  patch: (changes: Record<string, string | null>) => void;
  /** The page header with these actions added after the playlist switch. */
  header: (actions: ReactNode) => ReactNode;
  tabs: ReactNode;
  /** While the day has unsaved changes: asks before the page goes elsewhere. */
  guardRef: MutableRefObject<((go: () => void) => void) | null>;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const q = useDay(channel.id, kind, date);
  // while another day loads, the one before stays on screen: only use data of this very day
  const data: Day | null = q.data && q.data.date === date && q.data.kind === kind && q.data.channel.id === channel.id ? q.data : null;
  const day = data?.day ?? null;
  const rate = FRAME_RATES[channel.frameRate as keyof typeof FRAME_RATES];
  const isMain = kind === 'main';

  const [ed, dispatch] = useReducer(dayEditorReducer, emptyDayEditor);
  const dirty = isDayDirty(ed);
  useEffect(() => {
    if (!day) return;
    if (ed.dayId !== day.id || (!dirty && ed.version !== day.version)) dispatch({ type: 'load', dayId: day.id, version: day.version, draft: toDraft(day) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);
  const draft = day && ed.dayId === day.id ? ed.present : null;
  const change = (next: Draft) => dispatch({ type: 'change', draft: next });

  const [view, setView] = useStoredState('9eye.playlist.view', { gaps: true, sidebar: true });
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [selId, setSelId] = useState<string | null>(null);
  const [ticks, setTicks] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<{ rows: Row[]; cut: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [catalog, setCatalog] = useState<'content' | 'jingle' | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [breakOpen, setBreakOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [runReq, setRunReq] = useState<RunRequest | null>(null);
  const [running, setRunning] = useState<FillStep | null>(null);
  const [lastRun, setLastRun] = useState<{ step: FillStep; blockName?: string; report: FillReport } | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const rotationLists = useRotationLists(runReq?.step === 'rotation');
  useEffect(() => {
    setSelId(null);
    setTicks([]);
    setClosed({});
    setSaveError(null);
  }, [channel.id, kind, date]);

  // leaving with unsaved changes asks first (the page's own links, and the browser's)
  useEffect(() => {
    guardRef.current = dirty ? (go) => setLeaving(() => go) : null;
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => {
      guardRef.current = null;
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty, guardRef]);

  // ------------------------------------------------------------ an agent's change of this day, previewed (decision 0024, phase B)
  const [agentChange, setAgentChange] = useAgentPreview();
  const t = agentChange?.target;
  const previewing =
    agentChange && (agentChange.tool === 'fill_day' || agentChange.tool === 'edit_day') && t?.kind === 'day' && t.channelId === channel.id && t.date === date && t.playlist === kind && agentChange.status === 'waiting'
      ? agentChange
      : null;
  const [preview, setPreview] = useState<{ changeId: string; draft: Draft; changed: Set<string>; removed: number; problems: string[] } | null>(null);
  useEffect(() => {
    if (!previewing || !day || previewing.target?.kind !== 'day') {
      setPreview(null);
      return;
    }
    let live = true;
    api<AgentDayPreview>('GET', `/agents/changes/${previewing.id}/day`)
      .then((r) => {
        if (!live) return;
        const rows = (b: AgentDayPreview['blocks'][number]) => b.events.map((e) => ({ ...(e as unknown as Row), lengthFrames: e.kind === 'linked-break' ? 0 : (e.lengthFrames as number) }));
        const next: Draft = { blocks: r.blocks.map((b) => ({ id: b.id, rows: rows(b) })) };
        setPreview({ changeId: previewing.id, draft: next, changed: new Set(r.changed), removed: r.removed, problems: r.problems });
      })
      .catch((e) => {
        if (!live) return;
        toast(errorText(e), 'red');
        setAgentChange(null);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing?.id, day?.id, day?.version]);
  const savedIds = useMemo(() => new Set(day ? day.blocks.flatMap((b) => b.events.map((e) => e.id)) : []), [day]);
  const shown = preview ? preview.draft : draft;
  const newRows = preview ? preview.changed.size : 0;
  const decideAgent = useMutation({
    mutationFn: (action: 'approve' | 'reject') => api<{ status: string; result: string | null }>('POST', `/agents/changes/${previewing!.id}/${action}`),
    onSuccess: (c, action) => {
      setAgentChange(null);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['agents'] });
      qc.invalidateQueries({ queryKey: dayKeys.all() });
      toast(action === 'reject' ? 'The agent’s change is rejected' : c.status === 'approved' ? 'Approved and saved' : 'Approved, but it could not be saved');
    },
    onError: (e) => toast(errorText(e), 'red'),
  });

  const state = day ? STATE[day.state] : null;
  const canEdit = !!draft && day?.state === 'draft' && !preview;
  const whyNot = day?.state === 'published' ? 'Reopen the day first' : day?.state === 'reconciled' ? 'The day is reconciled' : null;

  const blockInfo = useMemo(() => new Map((day?.blocks ?? []).map((b) => [b.id, b])), [day]);
  const laid = useMemo(
    () => (shown && day ? layoutDay(draftBlocks(shown, day.blocks.map((b) => ({ id: b.id, startFrames: b.plannedStartFrames, lengthFrames: b.plannedLengthFrames })))) : null),
    [shown, day],
  );

  // what is still to do on this day: the state of each step and the issues
  const notReady = draft ? draft.blocks.reduce((n, b) => n + b.rows.filter((r) => r.media === 'not-ready').length, 0) : 0;
  const checks = useMemo(() => {
    if (!draft || !day || !laid) return null;
    return dayChecks(draft, {
      isMain,
      hasAds: !!channel.adsPlaylistId,
      placements: day.checks.placements,
      adsBreaks: day.checks.adsBreaks,
      fillBlocks: day.blocks.filter((b) => b.fillGaps).map((b) => ({ id: b.id, listId: b.rotationListId, gapFrames: Math.max(0, -(laid.blocks.find((x) => x.id === b.id)?.gapFrames ?? 0)) })),
      second: rate.nominal,
      notReady,
      booked: day.checks.booked ? day.checks.booked.map((b) => ({ id: b.id, passes: b.passes })) : undefined,
    });
  }, [draft, day, laid, isMain, channel.adsPlaylistId, rate.nominal, notReady]);
  const stepOf = (st: FillStep) => checks?.steps.find((x) => x.step === st) ?? null;
  const applyRun = (r: RunResult) => {
    change({ blocks: r.blocks.map((b) => ({ id: b.id, rows: b.events.map((e) => ({ ...e, lengthFrames: e.kind === 'linked-break' ? 0 : e.lengthFrames })) })) });
    setSelId(null);
    setTicks([]);
  };
  /**
   * Runs a step at once on the draft and puts what it placed into the day (one Undo step; Save keeps
   * it). Only what is missing — unless an issue says what it placed before is out of date: then all
   * again. Rotation lists: each block's own list, else the channel's default list.
   */
  const run = async (step: FillStep, block?: DayBlock, asked?: FillMode) => {
    if (!day || !draft || running) return;
    const mode: FillMode = asked ?? (checks?.issues.some((i) => i.step === step && OUT_OF_DATE.has(i.key)) ? 'all' : 'missing');
    setRunning(step);
    try {
      const r = await api<RunResult>('POST', `/days/${day.id}/run`, { step, mode, version: ed.version, blocks: payload(draft), listId: null, blockIds: block ? [block.id] : null });
      const rep = r.report;
      const changed = rep.placed.length > 0 || rep.removed > 0;
      if (changed) applyRun(r);
      setLastRun({ step, blockName: block?.name, report: rep });
      const w = RUN_WORDS[step];
      const count = (k: number) => `${k} ${k === 1 ? w.one : w.many}`;
      // rotation lists: the items put in tell more than the blocks filled
      const items = (rs: { rotationListId?: string | null }[]) => rs.filter((x) => x.rotationListId).length;
      const before = draft.blocks.reduce((n, b) => n + items(b.rows), 0) - rep.removed;
      const after = r.blocks.reduce((n, b) => n + items(b.events), 0);
      const done = step === 'rotation' ? `${plural(Math.max(0, after - before), 'item')} put in` : `${count(rep.placed.length)} ${w.done}`;
      const parts = [rep.removed ? `${plural(rep.removed, 'row')} taken out` : null, changed ? done : null, rep.notPlaced.length ? `${count(rep.notPlaced.length)} ${w.notDone}` : null].filter(Boolean);
      const label = block ? `Gap of ${block.name}` : FILL_STEP_LABEL[step];
      const text = changed
        ? `${label}: ${parts.join(', ')}. Save to keep it.`
        : rep.notPlaced.length
          ? `${label}: nothing put in, ${count(rep.notPlaced.length)} ${w.notDone}.`
          : rep.kept
            ? `${label}: nothing new, it is all in the day already.`
            : `${label}: nothing to put in.${rep.notes[0] ? ` ${rep.notes[0]}` : ''}`;
      toast(text, 'neutral', rep.notPlaced.length || (changed && rep.notes.length) ? { label: 'Details', onClick: () => setLastOpen(true) } : undefined);
    } catch (e) {
      toast(errorText(e), 'red');
    } finally {
      setRunning(null);
    }
  };

  const selBlock: DayBlock | null = selId ? (blockInfo.get(selId) ?? null) : null;
  const selHit = draft && selId && !selBlock ? findRow(draft, selId) : null;
  useEffect(() => {
    if (selId && draft && !selBlock && !selHit) setSelId(null);
  }, [selId, draft, selBlock, selHit]);
  const pick = (id: string) => setSelId((cur) => (cur === id ? null : id));

  /** Where new rows go: after the selected row, or at the end of the selected block. */
  const target: InsertAt | null = selBlock ? { blockId: selBlock.id, afterId: null } : selHit ? { blockId: selHit.block.id, afterId: selHit.row.id } : null;
  const owner = draft && target?.afterId ? breakOf(draft, target.afterId) : null;
  const where = selBlock ? `It goes at the end of ${selBlock.name}.` : selHit ? `It goes after "${selHit.row.kind === 'gap-compensator' ? 'Gap holder' : selHit.row.title}".` : '';

  const put = (rows: Row[], at: InsertAt, link: boolean, cut: boolean) => {
    if (!draft) return;
    change(insertRows(draft, at, rows, link));
    setSelId(rows[rows.length - 1].id);
    if (cut) setClipboard(null);
  };
  const place = (rows: Row[], cut = false) => {
    if (!draft || !target || !rows.length) return;
    if (owner && rows.some((r) => r.kind !== 'note' && r.kind !== 'linked-break')) setAsk({ rows, at: target, breakName: owner.title, cut });
    else put(rows, target, false, cut);
  };

  /**
   * A row dragged to another place: the ticked rows when it is one of them, a linked break with its
   * spots. At a linked break it asks to link, as Paste does — unless the spots only change places
   * inside their own break. One Undo step.
   */
  const moveTo = (key: string, to: PlaylistDrop) => {
    if (!draft || !canEdit) return;
    const ids = ticks.includes(key) && ticks.length > 1 ? ticks : [key];
    const rows = rowsToTake(draft, ids);
    if (!rows.length) return;
    const at: InsertAt = { blockId: to.blockKey, afterId: to.afterKey, first: to.first };
    const own = at.afterId ? breakOf(draft, at.afterId) : null;
    const content = rows.filter((r) => r.kind !== 'note' && r.kind !== 'linked-break');
    if (own && content.length && !rows.some((r) => r.id === own.id)) {
      if (content.every((r) => r.relatedEventId === own.id)) change(moveRows(draft, ids, at, true));
      else setAsk({ rows, at, breakName: own.title, cut: false, move: ids });
    } else change(moveRows(draft, ids, at, false));
    setSelId(key);
  };

  const addFromCatalog = async (picked: CatalogPick, as: 'content' | 'jingle') => {
    try {
      const info = await api<CatalogRow[]>('POST', '/days/catalog-rows', { productionIds: picked.items.map((i) => i.productionId) });
      place(
        info.map((c) =>
          makeRow({ kind: as === 'jingle' ? 'jingle' : c.kind, title: c.title, productionId: c.productionId, lengthFrames: c.lengthFrames ?? 0, tcOutFrames: c.lengthFrames ?? 0, media: c.media, contentType: c.contentType, color: c.color, episode: c.episode }),
        ),
      );
      const noLength = info.filter((c) => !c.lengthFrames).length;
      if (noLength) toast(`${plural(noLength, 'item has', 'items have')} no length in Media: set TC out by hand`, 'red');
    } catch (e) {
      toast(errorText(e), 'red');
    }
  };
  const addBreak = (b: BreakChoice) => place([makeRow({ kind: 'linked-break', title: b.name, breakTypeId: b.breakTypeId, color: b.color })]);
  /** Manual ads: booked spots put in by hand at the selected place, one row per spot, still linked to their booking. */
  const addBooked = async (spots: BookedSpotRef[]) => {
    try {
      const info = await api<CatalogRow[]>('POST', '/days/catalog-rows', { productionIds: [...new Set(spots.map((s) => s.productionId))] });
      const of = new Map(info.map((c) => [c.productionId, c]));
      place(
        spots.map((s) => {
          const c = of.get(s.productionId);
          return makeRow({ kind: c?.kind ?? 'commercial', title: c?.title ?? s.title, productionId: s.productionId, lengthFrames: c?.lengthFrames ?? 0, tcOutFrames: c?.lengthFrames ?? 0, media: c?.media ?? null, contentType: c?.contentType ?? null, color: c?.color ?? null, orderId: s.orderId, airingItemId: s.id });
        }),
      );
      setManualOpen(false);
    } catch (e) {
      toast(errorText(e), 'red');
    }
  };

  const save = useMutation({
    mutationFn: () => api<Day>('PUT', `/days/${ed.dayId}`, { version: ed.version, blocks: payload(ed.present!) }),
    onSuccess: (r) => {
      setSaveError(null);
      qc.setQueryData(dayKeys.one(channel.id, kind, date), r);
      if (r.day) dispatch({ type: 'load', dayId: r.day.id, version: r.day.version, draft: toDraft(r.day) });
      qc.invalidateQueries({ queryKey: weekKeys.all() });
      toast('Day saved');
    },
    onError: (e) => setSaveError({ message: errorText(e), problems: e instanceof ApiError ? e.problems : [], conflict: e instanceof ApiError && e.status === 409 }),
  });
  const doSave = () => {
    if (dirty && canEdit && !save.isPending) save.mutate();
  };
  const reload = () => {
    dispatch({ type: 'discard' });
    setSaveError(null);
    qc.invalidateQueries({ queryKey: dayKeys.all() });
  };

  // the playout file of the day: made on the server from the SAVED main playlist, then downloaded
  const exporter = channel.defaultExport;
  const exportWhy = !exporter
    ? 'No playout export is set for this channel (Settings → Channels)'
    : exporter !== 'playout-xml'
      ? `The ${exporterLabel(exporter)} export is not built yet`
      : !day
        ? 'There is no day to export'
        : dirty
          ? 'Save the day first: the file is made from the saved day'
          : null;
  const exportDay = async () => {
    try {
      const r = await api<DayExport>('GET', `/channels/${channel.id}/days/${date}/export?format=${exporter}`);
      if (!r.items) {
        toast('Nothing to export: no row of the saved main playlist plays yet');
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.content], { type: 'application/xml' }));
      a.download = r.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      if (r.noFile.length)
        toast(`${r.fileName}: ${plural(r.items, 'item')}. ${plural(r.noFile.length, 'item has', 'items have')} no playout file: ${r.noFile.slice(0, 3).join(', ')}${r.noFile.length > 3 ? ', …' : ''}`, 'red');
      else toast(`${r.fileName}: ${plural(r.items, 'item')}${r.draft ? '. The day is not approved yet' : ''}`);
    } catch (e) {
      toast(errorText(e), 'red');
    }
  };

  const publish = useMutation({
    mutationFn: (on: boolean) => api<{ state: string }>('POST', `/days/${day!.id}/${on ? 'publish' : 'unpublish'}`, { version: day!.version }),
    onSuccess: (_r, on) => {
      toast(on ? 'Day approved' : 'Day reopened');
      qc.invalidateQueries({ queryKey: dayKeys.all() });
      qc.invalidateQueries({ queryKey: weekKeys.all() });
    },
    onError: (e) => {
      toast(errorText(e), 'red');
      qc.invalidateQueries({ queryKey: dayKeys.all() });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        doSave();
      } else if (!typing && k === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (!typing && k === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tc = (frames: number) => formatTc(frames, rate);
  const clock = (offset: number) => formatClock(offset, channel.dayStartFrames, rate);

  // ------------------------------------------------------------ header
  const actions = (
    <>
      {state && <Badge tone={state.tone}>{state.label}</Badge>}
      {dirty && <Badge tone="amber">Unsaved changes</Badge>}
      <IconButton icon="undo" label="Undo" disabled={!ed.past.length || !draft} onClick={() => dispatch({ type: 'undo' })} />
      <IconButton icon="redo" label="Redo" disabled={!ed.future.length || !draft} onClick={() => dispatch({ type: 'redo' })} />
      <Button icon="plus" aria-pressed={view.sidebar} title={view.sidebar ? 'Hide the Add to playlist sidebar' : 'Show the Add to playlist sidebar'} onClick={() => setView({ ...view, sidebar: !view.sidebar })}>
        Add
      </Button>
      <Menu label="More actions" trigger={<IconButton icon="more" label="More actions" />}>
        <MenuLabel>View</MenuLabel>
        <MenuCheck checked={view.gaps} onChange={(v) => setView({ ...view, gaps: v })}>
          Show gaps
        </MenuCheck>
        <MenuItem disabled={!day} onSelect={() => day && setClosed(Object.fromEntries(day.blocks.map((b) => [b.id, true])))}>
          Collapse all blocks
        </MenuItem>
        <MenuItem disabled={!day} onSelect={() => setClosed({})}>
          Expand all blocks
        </MenuItem>
        <MenuItem disabled title={NOT_BUILT}>
          Columns & checks…
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Tools</MenuLabel>
        <MenuItem disabled={!canEdit || !!running} title={whyNot ?? undefined} onSelect={() => run('rotation')}>
          Fill gaps automatically
        </MenuItem>
        {!isMain && (
          <MenuItem disabled={!draft} onSelect={() => setRunReq({ step: 'commercials', report: true })}>
            Unplaced ads report
          </MenuItem>
        )}
        {(isMain ? TOOLS_MAIN : TOOLS_ADS).map((t) => (
          <MenuItem key={t} disabled title={NOT_BUILT}>
            {t}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuLabel>Export</MenuLabel>
        <MenuItem disabled={!!exportWhy} title={exportWhy ?? (isMain ? 'The saved main playlist, with its ads' : 'The file holds the main playlist of this day, with its ads')} onSelect={exportDay}>
          {exporter ? `Export to ${exporterLabel(exporter)}` : 'Export to the playout'}
        </MenuItem>
        <MenuItem disabled title={NOT_BUILT}>
          Download EPG…
        </MenuItem>
      </Menu>
      {day && day.state === 'published' ? (
        <Button disabled={publish.isPending} onClick={() => publish.mutate(false)}>
          Reopen
        </Button>
      ) : (
        <Button disabled={!day || day.state !== 'draft' || publish.isPending || dirty} title={dirty ? 'Save the day first' : undefined} onClick={() => publish.mutate(true)}>
          Approve
        </Button>
      )}
      <Button variant="primary" disabled={!dirty || !canEdit || save.isPending} onClick={doSave}>
        Save
      </Button>
    </>
  );

  // ------------------------------------------------------------ left: what can be added
  const addOff = !canEdit || !target;
  const addHint = whyNot ?? (canEdit ? PICK_FIRST : 'There is no day to add to');
  const sidebar = view.sidebar ? (
    <>
      <ActionList label={target ? (selBlock ? 'Add at the end of the block' : 'Add after the selected row') : 'Add to playlist'}>
        {clipboard && <ActionItem label={`Paste ${plural(clipboard.rows.length, 'row')}`} disabled={addOff} hint={addHint} onClick={() => place(clipboard.cut ? clipboard.rows : copyRows(clipboard.rows), clipboard.cut)} />}
        {!isMain && <ActionItem label="Auto-place ads" disabled={!canEdit || !draft || !!running} hint={running ? 'Running…' : (whyNot ?? 'There is no day to fill')} onClick={() => run('commercials')} />}
        {!isMain && <ActionItem label="Auto-place trailers" disabled hint={whyNot ?? NOT_BUILT} />}
        <ActionItem label="Item" disabled={addOff} hint={addHint} onClick={() => setCatalog('content')} />
        <ActionItem label="Rotation list" disabled hint={whyNot ?? NOT_BUILT} />
        <ActionItem label="Note" disabled={addOff} hint={addHint} onClick={() => setNoteOpen(true)} />
        <ActionItem label="Graphic" disabled hint={whyNot ?? NOT_BUILT} />
        <ActionItem label="Stings" disabled={addOff} hint={addHint} onClick={() => setCatalog('jingle')} />
        {isMain && <ActionItem label="Linked break" disabled={addOff || !channel.adsPlaylistId} hint={!channel.adsPlaylistId ? 'This channel has no ads playlist' : addHint} onClick={() => setBreakOpen(true)} />}
        {!isMain && <ActionItem label="Manual ads" disabled={addOff || !(day?.checks.booked?.length)} hint={day?.checks.booked?.length ? addHint : 'No confirmed campaigns book this day'} onClick={() => setManualOpen(true)} />}
      </ActionList>
      <div className="border-t border-border pt-3.5">
        <ActionList label="Pull into this day">
          {(isMain ? IMPORT_MAIN : IMPORT_ADS).map((a) => {
            if (a.step === 'breaks' && !channel.adsPlaylistId) return <ActionItem key={a.label} label={a.label} disabled hint="This channel has no ads playlist" />;
            const st = a.step ? stepOf(a.step) : null;
            const why = a.off ?? (!draft ? 'There is no day to fill' : (whyNot ?? st?.why ?? (running ? 'Running…' : null)));
            return <ActionItem key={a.label} label={a.label} disabled={!!why} hint={why ?? undefined} onClick={() => a.step && run(a.step)} />;
          })}
        </ActionList>
      </div>
      {checks && (
        <div className="border-t border-border pt-3.5">
          <ActionList label="Steps for this day">
            {checks.steps.map((st) => (
              <StepItem
                key={st.step}
                label={st.label}
                tone={st.tone}
                text={st.text}
                runLabel={st.ran ? 'Run again' : 'Run'}
                disabled={!canEdit || !!st.why || !!running}
                hint={whyNot ?? st.why ?? (running ? 'Running…' : null)}
                onRun={() => run(st.step)}
              />
            ))}
          </ActionList>
        </div>
      )}
    </>
  ) : null;

  // ------------------------------------------------------------ middle: the day
  const marks: Record<string, DateMark> = Object.fromEntries((data?.marks ?? []).map((m) => [m.date, STATE[m.state].mark]));
  const totalFrames = laid?.totalFrames ?? 0;
  const end = laid ? dayEnd(totalFrames, channel.dayStartFrames, rate) : null;
  const total = !laid
    ? ''
    : !isMain
      ? `Spots placed ${tc(totalFrames)} in ${plural(laid.blocks.length, 'break')}`
      : totalFrames === 0
        ? 'Nothing is placed yet'
        : `Day runs ${tc(totalFrames)} · ends ${tc(end!.endClockFrames)}${end!.nextDay ? ' next day' : ''}${end!.pastDayFrames ? ` · ${tc(end!.pastDayFrames)} past 24 hours` : ''}`;
  const breakNames = useMemo(() => new Map((draft?.blocks ?? []).flatMap((b) => b.rows.filter((r) => r.kind === 'linked-break').map((r) => [r.id, r.title] as const))), [draft]);
  const ticked = useMemo(() => new Set(ticks), [ticks]);
  const tick = (id: string, on: boolean) => setTicks((cur) => (on ? [...cur.filter((x) => x !== id), id] : cur.filter((x) => x !== id)));

  const blocks: PlaylistBlockRow[] = (laid?.blocks ?? []).map((lb) => {
    const b = blockInfo.get(lb.id)!;
    const rows: PlaylistRow[] = lb.events.map((e) => {
      const base = { key: e.id, start: clock(e.startFrames), selected: selId === e.id, onSelect: () => pick(e.id), movable: canEdit && e.kind !== 'gap-compensator', isNew: !!preview && preview.changed.has(e.id) };
      if (e.kind === 'gap-compensator') return { ...base, duration: tc(0), title: 'Gap holder', muted: true, italic: true, last: true, mark: { tone: 'filler' as const, label: 'Gap holder' } };
      const ticking = { checked: ticked.has(e.id), onCheck: (on: boolean) => tick(e.id, on) };
      if (e.kind === 'linked-break') {
        return { ...base, ...ticking, duration: tc(e.shownFrames), title: e.title, icon: 'link' as const, mark: { color: e.color, label: 'Linked break' }, muted: true, breakText: e.shownFrames > 0 ? 'linked break' : 'empty' };
      }
      if (e.kind === 'note') return { ...base, ...ticking, duration: '', title: e.title, icon: 'note' as const, muted: true };
      const under = e.relatedEventId ? (breakNames.get(e.relatedEventId) ?? null) : null;
      return {
        ...base,
        ...ticking,
        duration: tc(e.lengthFrames),
        title: e.title,
        mark: CONTENT_TONES.has(e.kind) ? { tone: e.kind as ContentTone, label: KIND_LABEL[e.kind] } : { color: e.color, label: KIND_LABEL[e.kind] ?? e.kind },
        indent: !!under,
        strong: e.kind === 'program',
        breakText: under ?? '',
        media: e.media === 'not-ready' ? 'Not ready' : '',
      };
    });
    return {
      key: b.id,
      time: formatClockShort(lb.plannedStartFrames, channel.dayStartFrames, rate),
      name: b.name,
      color: b.color,
      status: lb.gapFrames < 0 ? { text: `Gap ${tc(-lb.gapFrames)}`, tone: 'gap' as const } : lb.gapFrames > 0 ? { text: `Over ${tc(lb.gapFrames)}`, tone: 'over' as const } : undefined,
      fill: `${tc(lb.realLengthFrames)} / ${tc(lb.plannedLengthFrames)}`,
      open: !closed[b.id],
      onToggle: () => setClosed({ ...closed, [b.id]: !closed[b.id] }),
      selected: selId === b.id,
      onSelect: () => pick(b.id),
      rows,
      gap:
        view.gaps && lb.gapFrames < 0 && lb.realLengthFrames > 0
          ? {
              start: clock(lb.realStartFrames + lb.realLengthFrames),
              text: `Gap of ${tc(-lb.gapFrames)}`,
              action:
                canEdit && b.fillGaps ? (
                  <Button size="xs" variant="ghost" disabled={!!running} onClick={() => run('rotation', b)}>
                    Fill gaps automatically
                  </Button>
                ) : undefined,
            }
          : undefined,
    };
  });

  const taken = draft && ticks.length ? rowsToTake(draft, ticks) : [];
  const takenIds = taken.map((r) => r.id);
  const takenFrames = taken.reduce((n, r) => n + (takesTime(r.kind) ? r.lengthFrames : 0), 0);

  const main = (
    <>
      <StatusBar>
        <DatePicker
          mode="day"
          variant="quiet"
          step
          label="Day"
          weekStart={channel.weekStart}
          today={channel.today}
          value={date}
          marks={marks}
          legend={[
            { tone: 'ok', label: 'Approved' },
            { tone: 'warn', label: 'Draft' },
            { tone: 'info', label: 'Reconciled' },
          ]}
          onChange={(v) => patch({ date: v.value })}
        />
        {data?.week && (
          <span className="text-text-2">
            Week {data.week.number} · {data.week.name}
          </span>
        )}
        <span className="flex-1" />
        <span className="mono text-text-2">{total}</span>
      </StatusBar>
      {previewing && (
        <Notice
          tone="accent"
          action={
            <span className="flex shrink-0 gap-1.5">
              <Button size="xs" variant="ghost" disabled={decideAgent.isPending} onClick={() => decideAgent.mutate('reject')}>
                Reject
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setAgentChange(null)}>
                Hide
              </Button>
              <Button
                size="xs"
                variant="primary"
                disabled={!preview || dirty || !previewing.canDecide || decideAgent.isPending}
                title={dirty ? 'Save or discard your own changes first' : !previewing.canDecide ? 'Your role does not let you change this day' : undefined}
                onClick={() => decideAgent.mutate('approve')}
              >
                Approve and save
              </Button>
            </span>
          }
        >
          <span className="font-medium">{previewing.agent.name}’s change, not saved yet: {previewing.title}</span>
          <span>
            {!preview
              ? 'Working out the preview…'
              : `${newRows === 1 ? '1 new or changed row' : `${newRows} new or changed rows`} (green)${preview.removed ? `, ${preview.removed} taken out` : ''}${preview.problems.length ? `, ${preview.problems.length} not placed or wrong` : ''}.`}
            {dirty ? ' Your own unsaved changes are not in it.' : ''}
          </span>
        </Notice>
      )}
      {day?.state === 'published' && (
        <Notice
          tone="green"
          action={
            <Button size="xs" disabled={publish.isPending} onClick={() => publish.mutate(false)}>
              Reopen
            </Button>
          }
        >
          This day is approved, so it is read-only. Reopen it to change it.
        </Notice>
      )}
      {day?.state === 'reconciled' && <Notice tone="accent">This day is reconciled with what was aired: it is read-only.</Notice>}
      {saveError && (
        <Notice
          tone="red"
          action={
            saveError.conflict ? (
              <Button size="xs" onClick={reload}>
                Reload the day
              </Button>
            ) : undefined
          }
        >
          <span className="font-medium">{saveError.message}</span>
          {saveError.problems.length > 1 && saveError.problems.slice(0, 8).map((p, i) => <span key={i}>{p.message}</span>)}
          {saveError.conflict && <span>Reloading drops the changes you made here.</span>}
        </Notice>
      )}
      {day && !isMain && <Notice>Times in the ads playlist run on from the start of the day. Real air times are in the main playlist, where these breaks are linked.</Notice>}
      {notReady > 0 && <Notice tone="amber">{notReady === 1 ? '1 row has media that is not ready.' : `${notReady} rows have media that is not ready.`}</Notice>}
      {checks && checks.issues.length > 0 && (
        <Notice
          tone="amber"
          action={
            <Button size="xs" onClick={() => setIssuesOpen(true)}>
              Show issues
            </Button>
          }
        >
          {checks.issues.length === 1 ? `1 issue: ${checks.issues[0].text}.` : `${checks.issues.length} issues: ${checks.issues[0].text}, and more.`}
        </Notice>
      )}
      {q.isError ? (
        <Notice tone="red">{errorText(q.error)}</Notice>
      ) : !data ? (
        <EmptyState>Loading…</EmptyState>
      ) : day ? (
        <PlaylistTable
          label={`${isMain ? 'Main' : 'Ads'} playlist of ${dayText(date, true)}`}
          blocks={blocks}
          onMove={canEdit ? moveTo : undefined}
          onNudge={canEdit && draft ? (key, dir) => change(nudgeRow(draft, key, dir)) : undefined}
        />
      ) : data.missing === 'not-active' ? (
        <EmptyState action={<Button onClick={() => patch({ tab: null, month: data.weekFirstDate.slice(0, 7) })}>Open the week</Button>}>
          {dayText(date, true)} is not an active day in week {data.week?.number} of this playlist, so it has no playlist.
        </EmptyState>
      ) : (
        <EmptyState action={<Button onClick={() => setCreating(true)}>Create this week</Button>}>
          No week has been created for {dayText(date, true)} in this playlist, so the day has no blocks yet.
        </EmptyState>
      )}
      {draft && taken.length > 0 && (
        <SelectionBar count={`${plural(taken.length, 'row')} ticked`} detail={tc(takenFrames)} onClear={() => setTicks([])}>
          <Button
            disabled={!canEdit}
            title={whyNot ?? undefined}
            onClick={() => {
              setClipboard({ rows: taken, cut: true });
              change(removeRows(draft, takenIds));
              setTicks([]);
              toast(`${plural(taken.length, 'row')} cut: select where ${taken.length === 1 ? 'it goes' : 'they go'}, then Paste`);
            }}
          >
            Cut
          </Button>
          <Button
            onClick={() => {
              setClipboard({ rows: taken, cut: false });
              setTicks([]);
              toast(`${plural(taken.length, 'row')} copied: select where ${taken.length === 1 ? 'it goes' : 'they go'}, then Paste`);
            }}
          >
            Copy
          </Button>
          <Button
            variant="danger"
            disabled={!canEdit}
            title={whyNot ?? undefined}
            onClick={() => {
              change(removeRows(draft, takenIds));
              setTicks([]);
            }}
          >
            Delete
          </Button>
        </SelectionBar>
      )}
    </>
  );

  // ------------------------------------------------------------ right: the selected row
  let panel: ReactNode = null;
  if (selBlock && laid) {
    const lb = laid.blocks.find((x) => x.id === selBlock.id)!;
    panel = (
      <SidePanel title="Block" onClose={() => setSelId(null)}>
        <div className="flex flex-col gap-5 p-4">
          <span className="text-section font-semibold [overflow-wrap:anywhere]">{selBlock.name}</span>
          <DetailList
            items={[
              { label: 'Planned start', value: clock(lb.plannedStartFrames), mono: true },
              { label: 'Planned length', value: tc(lb.plannedLengthFrames), mono: true },
              { label: 'Real start', value: clock(lb.realStartFrames), mono: true },
              { label: 'Real length', value: tc(lb.realLengthFrames), mono: true },
              { label: 'Gap / overlap', value: lb.gapFrames === 0 ? 'None' : `${lb.gapFrames < 0 ? 'Gap' : 'Over'} ${tc(Math.abs(lb.gapFrames))}`, mono: true, tone: lb.gapFrames > 0 ? 'red' : lb.gapFrames < 0 ? 'amber' : undefined },
              { label: 'Rows', value: String(lb.events.length) },
              { label: 'Note', value: selBlock.note },
            ]}
          />
          <span className="text-small text-text-2">What you add from the sidebar goes at the end of this block.</span>
          <span className="flex flex-wrap gap-2">
            <Button disabled={!canEdit} title={whyNot ?? undefined} onClick={() => setCatalog('jingle')}>
              Add stings…
            </Button>
            <Button variant="ghost" onClick={() => navigate(`/templates?channel=${channel.id}`)}>
              Open layouts
            </Button>
          </span>
        </div>
      </SidePanel>
    );
  } else if (selHit && draft && laid) {
    const r = selHit.row;
    const laidRow = laid.blocks.flatMap((b) => b.events).find((e) => e.id === r.id)!;
    const blockName = blockInfo.get(selHit.block.id)?.name ?? '';
    const isBreak = r.kind === 'linked-break';
    const isGap = r.kind === 'gap-compensator';
    const isContent = CONTENT_TONES.has(r.kind);
    const move = (dir: -1 | 1) => change(nudgeRow(draft, r.id, dir));
    const moves = !isGap && (
      <span className="flex flex-wrap gap-2">
        <Button disabled={!canEdit || !canNudge(draft, r.id, -1)} onClick={() => move(-1)}>
          Move up
        </Button>
        <Button disabled={!canEdit || !canNudge(draft, r.id, 1)} onClick={() => move(1)}>
          Move down
        </Button>
        <Button variant="danger" disabled={!canEdit} title={whyNot ?? undefined} onClick={() => change(removeRows(draft, [r.id]))}>
          {isBreak ? 'Remove break' : 'Remove'}
        </Button>
      </span>
    );
    panel = (
      <SidePanel title={KIND_LABEL[r.kind] ?? r.kind} onClose={() => setSelId(null)}>
        <div className="flex flex-col gap-5 p-4">
          <span className="text-section font-semibold [overflow-wrap:anywhere]">{isGap ? 'Gap holder' : r.title}</span>
          {isBreak ? (
            <>
              <DetailList
                items={[
                  { label: 'Starts', value: clock(laidRow.startFrames), mono: true },
                  { label: 'Filled length', value: tc(laidRow.shownFrames), mono: true },
                  { label: 'Filled from', value: 'Ads playlist · same break' },
                  { label: 'Block', value: blockName },
                ]}
              />
              <span className="text-small text-text-2">Its spots are placed in the ads playlist; they come here when the break events are imported. Removing the break leaves its spots as plain rows.</span>
              <span className="flex flex-wrap gap-2">
                <Button onClick={() => patch({ playlist: 'ads' })}>Open the ads playlist</Button>
              </span>
              {moves}
            </>
          ) : (
            <>
              {r.kind === 'note' && <NoteTextField value={r.title} disabled={!canEdit} onCommit={(v) => change(updateRow(draft, r.id, { title: v }))} />}
              <DetailList
                items={[
                  { label: 'Start', value: clock(laidRow.startFrames), mono: true },
                  r.kind !== 'note' && { label: 'Duration', value: tc(r.lengthFrames), mono: true },
                  { label: 'Block', value: blockName },
                  { label: 'Break', value: r.relatedEventId ? breakNames.get(r.relatedEventId) : null },
                  { label: 'Category', value: r.contentType },
                  { label: 'Episode', value: r.episode === null ? null : String(r.episode) },
                  { label: 'Media', value: r.media === 'ready' ? 'Ready' : r.media === 'not-ready' ? 'Not ready' : null, tone: r.media === 'not-ready' ? 'amber' : undefined },
                ]}
              />
              {isContent && (
                <div className="flex flex-wrap gap-3">
                  <CommitField<number>
                    label="TC in"
                    width={132}
                    disabled={!canEdit}
                    value={r.tcInFrames}
                    format={tc}
                    parse={(s) => parseTc(s, rate)}
                    onCommit={(v) => {
                      const next = setTcRange(draft, r.id, v, r.tcOutFrames);
                      if (!next) return 'TC in must be before TC out.';
                      change(next);
                    }}
                  />
                  <CommitField<number>
                    label="TC out"
                    width={132}
                    disabled={!canEdit}
                    value={r.tcOutFrames}
                    format={tc}
                    parse={(s) => parseTc(s, rate)}
                    onCommit={(v) => {
                      const next = setTcRange(draft, r.id, r.tcInFrames, v);
                      if (!next) return 'TC out must be after TC in.';
                      change(next);
                    }}
                  />
                </div>
              )}
              {isContent && (
                <div className={canEdit ? 'flex flex-col gap-3' : 'pointer-events-none flex flex-col gap-3 opacity-60'}>
                  <SwitchRow title="Fixed start" description="The row keeps its start time." checked={r.fixed} onChange={(v) => change(updateRow(draft, r.id, { fixed: v }))} />
                  <SwitchRow title="Hold" description="The playout waits on this row." checked={r.hold} onChange={(v) => change(updateRow(draft, r.id, { hold: v }))} />
                </div>
              )}
              {!isGap && r.kind !== 'note' && <NoteField value={r.note} disabled={!canEdit} onCommit={(v) => change(updateRow(draft, r.id, { note: v }))} />}
              {isGap && <span className="text-small text-text-2">Every block of the main playlist ends with one. It stays last and cannot be removed.</span>}
              {moves}
            </>
          )}
        </div>
      </SidePanel>
    );
  }

  const targetBlock = draft && target ? draft.blocks.find((b) => b.id === target.blockId) : null;
  return (
    <>
      {header(actions)}
      {tabs}
      <EditorLayout leftLabel="Add to playlist" left={sidebar} main={main} panel={panel} />
      <CatalogPicker
        pick="items"
        families={catalog === 'jingle' ? ['filling'] : ['program', 'filling', 'advert']}
        frameRate={channel.frameRate}
        date={date}
        title={catalog === 'jingle' ? 'Add stings' : 'Add item'}
        context={`${where} ${channel.name}, ${dayText(date, true)}`}
        triggerStyle="none"
        open={catalog !== null}
        onOpenChange={(o) => !o && setCatalog(null)}
        onPick={(p) => {
          const as = catalog ?? 'content';
          setCatalog(null);
          void addFromCatalog(p, as);
        }}
      />
      <NoteDialog open={noteOpen} onOpenChange={setNoteOpen} where={where} onAdd={(text) => place([makeRow({ kind: 'note', title: text })])} />
      <BreakDialog
        open={breakOpen}
        onOpenChange={setBreakOpen}
        channel={channel}
        date={date}
        where={where}
        used={(targetBlock?.rows ?? []).flatMap((r) => (r.kind === 'linked-break' && r.breakTypeId ? [r.breakTypeId] : []))}
        onPick={addBreak}
      />
      <LinkDialog
        breakName={ask?.breakName ?? null}
        count={ask?.rows.length ?? 0}
        verb={ask?.move ? 'Move' : 'Insert'}
        onCancel={() => setAsk(null)}
        onAnswer={(link) => {
          if (ask?.move && draft) change(moveRows(draft, ask.move, ask.at, link));
          else if (ask) put(ask.rows, ask.at, link, ask.cut);
          setAsk(null);
        }}
      />
      <ConfirmDialog
        open={!!leaving}
        onOpenChange={(o) => !o && setLeaving(null)}
        title="Leave without saving?"
        description="This day has changes that are not saved. Leaving drops them."
        confirmLabel="Drop the changes"
        danger
        onConfirm={() => {
          const go = leaving;
          setLeaving(null);
          dispatch({ type: 'discard' });
          go?.();
        }}
      />
      {day && draft && (
        <RunDialog
          request={runReq}
          onClose={() => setRunReq(null)}
          dayId={day.id}
          version={ed.version}
          blocks={() => payload(draft)}
          ran={false}
          lists={rotationLists.data ?? []}
          ownLists={day.blocks.some((b) => (runReq?.blockId ? b.id === runReq.blockId : b.fillGaps) && !!b.rotationListId)}
          defaultListId={day.checks.defaultListId}
          rate={rate}
          onApply={(r, step) => {
            applyRun(r);
            toast(`${FILL_STEP_LABEL[step]}: what can go in is in the day. Save to keep it.`);
          }}
        />
      )}
      <RunResultDialog run={lastOpen ? lastRun : null} onClose={() => setLastOpen(false)} rate={rate} />
      {day && !isMain && draft && (
        <ManualAdsDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          booked={day.checks.booked ?? []}
          inDay={draft.blocks.flatMap((b) => b.rows.flatMap((r) => (r.airingItemId ? [r.airingItemId] : [])))}
          where={where}
          onPut={addBooked}
        />
      )}
      <IssuesDialog
        open={issuesOpen}
        onOpenChange={setIssuesOpen}
        issues={checks?.issues ?? []}
        canRun={canEdit}
        whyNot={whyNot}
        onRun={(step) => {
          setIssuesOpen(false);
          run(step);
        }}
      />
      <CreateWeeksDialog
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
          if (!o) qc.invalidateQueries({ queryKey: dayKeys.all() });
        }}
        channel={channel}
        initialWeek={data?.weekFirstDate ?? date}
      />
    </>
  );
}
