// Templates page — docs/design/templates-page.md, prototype the Week mockup (private).
// One channel, its templates on the left, the week grid in the middle, one panel on the right.

import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FRAME_RATES, WEEKDAYS, checkDates, formatDate, formatTcShort, removeBlock, setActiveDay, type BlockDraft } from '@9eye/core';
import { ApiError, api, errorText } from '@/lib/api';
import type { BlockType, Channel, TemplateFull, TemplateSummary } from '@/lib/types';
import { useStoredState } from '@/app/prefs';
import {
  Badge,
  Button,
  ConfirmDialog,
  ContextLink,
  ContextPicker,
  ContextText,
  DayToggles,
  EditorLayout,
  EmptyState,
  IconButton,
  ListGroup,
  ListItem,
  Menu,
  MenuCheck,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Notice,
  PageHeader,
  Popover,
  PopoverFooter,
  SidePanel,
  StatusBar,
  Swatch,
  DatePicker,
  TextField,
  ZOOM_LEVELS,
  useToast,
} from '@/ui';
import { AddBlockPanel } from './AddBlockPanel';
import { BlockPanel } from './BlockPanel';
import { BlockTypesPanel } from './BlockTypesPanel';
import { BlockDetailsDialog, BlockTypeDialog, BreakListsDialog, DeleteBlockTypeDialog, RenameDialog, TemplateFormDialog } from './dialogs';
import { editorReducer, emptyEditor, isDirty } from './editor';
import { buildCtx, groupColor, hourFloor, seriesLabel, toDraft, todayIso, usage, type DragSource, type PageCtx, type Placing } from './model';
import { RepeatDialog } from './RepeatDialog';
import { keys, useBlockGroups, useBlockTypes, useBreakLists, useChannels, useTemplateFull, useTemplates } from './queries';
import { TemplateGrid, type ShowOnBlocks } from './TemplateGrid';
import { useAgentPage } from '@/features/agents/pageAgent';

type Panel = 'block' | 'add' | 'lib' | null;
type DialogState =
  | null
  | { kind: 'new' | 'clone' | 'rename' | 'delete' | 'details' }
  | { kind: 'lists'; start: 'manage' | 'new'; preset?: number[] }
  | { kind: 'type'; editing: BlockType | null }
  | { kind: 'repeat'; weekday: number; from: number };
type PendingSelect = { blockId?: string; weekday?: number; typeId?: string };

function defaultChannel(list: Channel[]): Channel | undefined {
  return list.find((c) => c.templateCount > 0) ?? list[0];
}

function defaultTemplate(list: TemplateSummary[]): TemplateSummary | undefined {
  const today = todayIso();
  const main = list.filter((t) => t.kind === 'main');
  return main.find((t) => t.validFrom <= today && today <= t.validTo) ?? main[0] ?? list[0];
}

export function TemplatesPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  const channels = useChannels();
  const channelList = channels.data ?? [];
  // A channel in the address that no longer exists (e.g. after a re-import) falls back to the default.
  const wantedChannel = params.get('channel');
  const channelId = wantedChannel && (!channels.data || channelList.some((c) => c.id === wantedChannel)) ? wantedChannel : (defaultChannel(channelList)?.id ?? null);
  const channel = channelList.find((c) => c.id === channelId) ?? null;
  const templates = useTemplates(channelId);
  const tplList = templates.data ?? [];
  const wanted = params.get('template');
  const templateId = wanted && (!templates.data || tplList.some((t) => t.id === wanted)) ? wanted : (defaultTemplate(tplList)?.id ?? null);
  const full = useTemplateFull(templateId);
  const types = useBlockTypes();
  const groups = useBlockGroups();
  const lists = useBreakLists(channelId, !!channel?.adsPlaylistId);

  const [ed, dispatch] = useReducer(editorReducer, emptyEditor);
  const dirty = isDirty(ed);
  const f = full.data && full.data.template.id === templateId ? full.data : null;
  useAgentPage(channel ? { name: 'Layouts', sees: `${channel.name} (code ${channel.code}) · ${f ? `layout "${f.template.name}"` : 'its layouts'}` } : null);
  useEffect(() => {
    if (!f) return;
    if (ed.templateId !== f.template.id || (!dirty && ed.version !== f.template.version)) {
      dispatch({ type: 'load', templateId: f.template.id, version: f.template.version, draft: toDraft(f) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  const ctx: PageCtx | null = useMemo(() => (f && types.data && groups.data ? buildCtx(f, types.data, groups.data) : null), [f, types.data, groups.data]);
  const draft = f && ed.templateId === f.template.id ? ed.present : null;

  const [sel, setSel] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [addDay, setAddDay] = useState<number | null>(null);
  const [addQuery, setAddQuery] = useState<string | undefined>();
  // Zoom per playlist kind, remembered in this browser: ads templates are read at a deeper zoom.
  const [zooms, setZooms] = useStoredState<{ main: number; ads: number }>('9eye.templates.zoom', { main: 1, ads: 1 });
  const zoomKind = f?.template.kind ?? 'main';
  const zoom = Math.min(Math.max(0, zooms[zoomKind] ?? 1), ZOOM_LEVELS.length - 1);
  const setZoom = (z: number) => setZooms({ ...zooms, [zoomKind]: z });
  const [show, setShow] = useStoredState<ShowOnBlocks>('9eye.templates.show', { headers: true, events: false, overlap: false, notes: false });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteType, setDeleteType] = useState<BlockType | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  /** A block to select once another template has opened (↗ from a break, "Linked from"). */
  const [pendingSelect, setPendingSelect] = useState<(PendingSelect & { templateId: string }) | null>(null);
  const [saveError, setSaveError] = useState<{ message: string; problems: { message: string }[] } | null>(null);
  const [conflict, setConflict] = useState(false);
  const dragSource = useRef<DragSource | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  // placing ends with Esc, or when its panel closes or another template opens
  useEffect(() => {
    if (panel !== 'add' && panel !== 'lib') setPlacing(null);
  }, [panel]);
  useEffect(() => setPlacing(null), [templateId]);
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPlacing(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing]);

  const block = draft && sel ? (draft.blocks.find((b) => b.id === sel) ?? null) : null;
  useEffect(() => {
    if (sel && draft && !block) {
      setSel(null);
      if (panel === 'block') setPanel(null);
    }
  }, [sel, draft, block, panel]);
  useEffect(() => {
    if (!pendingSelect || !draft || ed.templateId !== pendingSelect.templateId) return;
    const b = pendingSelect.blockId
      ? draft.blocks.find((x) => x.id === pendingSelect.blockId)
      : draft.blocks.find((x) => x.weekday === pendingSelect.weekday && x.blockTypeId === pendingSelect.typeId);
    setPendingSelect(null);
    if (b) {
      setSel(b.id);
      setPanel('block');
    }
  }, [pendingSelect, draft, ed.templateId]);

  const change = (d: NonNullable<typeof draft>) => dispatch({ type: 'change', draft: d });

  const save = useMutation({
    mutationFn: (a: { id: string; version: number; draft: NonNullable<typeof draft> }) => api<TemplateFull>('PUT', `/templates/${a.id}`, { version: a.version, ...a.draft }),
    onSuccess: (res) => {
      qc.setQueryData(keys.template(res.template.id), res);
      dispatch({ type: 'saved', version: res.template.version, draft: toDraft(res) });
      qc.invalidateQueries({ queryKey: keys.templates(res.template.channelId) });
      qc.invalidateQueries({ queryKey: keys.blockTypes() });
      qc.invalidateQueries({ queryKey: keys.allTemplates(), predicate: (q) => q.queryKey[2] !== res.template.id });
      setSaveError(null);
      setConflict(false);
      toast('Saved');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else setSaveError({ message: errorText(e), problems: e instanceof ApiError ? e.problems : [] });
    },
  });
  const doSave = async () => {
    if (!draft || !dirty || !ed.templateId) return true;
    try {
      await save.mutateAsync({ id: ed.templateId, version: ed.version, draft });
      return true;
    } catch {
      return false;
    }
  };

  const guard = (fn: () => void) => (dirty ? setPending(() => fn) : fn());
  const resetView = () => {
    setSel(null);
    setPanel(null);
    setSaveError(null);
    setConflict(false);
  };
  const goTemplate = (id: string, then?: PendingSelect) =>
    guard(() => {
      if (channelId) setParams({ channel: channelId, template: id });
      resetView();
      setPendingSelect(then ? { ...then, templateId: id } : null);
    });
  const goChannel = (id: string) =>
    guard(() => {
      setParams({ channel: id });
      resetView();
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void doSave();
      } else if (!typing && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'undo' });
      } else if (!typing && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  const deleteTemplate = useMutation({
    mutationFn: (id: string) => api('DELETE', `/templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.templates(channelId) });
      qc.invalidateQueries({ queryKey: keys.channels() });
      dispatch({ type: 'discard' });
      if (channelId) setParams({ channel: channelId });
      resetView();
      toast('Layout deleted');
    },
    onError: (e) => toast(errorText(e), 'red'),
  });

  // ------------------------------------------------------------ header
  const chRate = channel ? FRAME_RATES[channel.frameRate as keyof typeof FRAME_RATES] : undefined;
  const settings = channel && chRate ? `Week starts ${WEEKDAYS[channel.weekStart].long} · day starts ${formatTcShort(channel.dayStartFrames, chRate)} · ${chRate.label}` : '';
  const header = (
    <PageHeader
      title="Layouts"
      context={
        <>
          <ContextPicker
            label="Channel"
            searchLabel="channels"
            value={channelId ?? ''}
            items={channelList.map((c) => ({ id: c.id, name: c.name, meta: `${c.templateCount} ${c.templateCount === 1 ? 'layout' : 'layouts'}` }))}
            onPick={goChannel}
          />
          {settings && <ContextText>{settings}</ContextText>}
          {channel && <ContextLink to={`/admin/channels/${channel.id}`}>Change in channel settings</ContextLink>}
        </>
      }
      actions={
        <>
          {dirty && <Badge tone="amber">Unsaved changes</Badge>}
          <IconButton icon="undo" label="Undo" disabled={!ed.past.length || !draft} onClick={() => dispatch({ type: 'undo' })} />
          <IconButton icon="redo" label="Redo" disabled={!ed.future.length || !draft} onClick={() => dispatch({ type: 'redo' })} />
          <Button disabled={!draft} onClick={() => { setSel(null); setPanel('lib'); }}>
            Block types
          </Button>
          <Button icon="plus" disabled={!draft} onClick={() => { setAddQuery(undefined); setAddDay(null); setPanel('add'); }}>
            Add block
          </Button>
          <Menu label="More actions" trigger={<IconButton icon="more" label="More actions" />}>
            <MenuItem disabled={!channel} onSelect={() => guard(() => setDialog({ kind: 'new' }))}>New layout…</MenuItem>
            <MenuItem disabled={!f} onSelect={() => guard(() => setDialog({ kind: 'clone' }))}>Clone this layout…</MenuItem>
            <MenuItem disabled={!draft} onSelect={() => setDialog({ kind: 'rename' })}>Rename…</MenuItem>
            <MenuItem disabled={!channel?.adsPlaylistId || !draft} onSelect={() => setDialog({ kind: 'lists', start: 'manage' })}>
              Linked-break lists…
            </MenuItem>
            <MenuItem disabled={!draft} onSelect={() => window.print()}>Print</MenuItem>
            <MenuItem disabled title="EPG exports are not built yet">Download EPG…</MenuItem>
            <MenuSeparator />
            <MenuLabel>Show on blocks</MenuLabel>
            <MenuCheck checked={show.headers} onChange={(v) => setShow({ ...show, headers: v })}>Block headers</MenuCheck>
            <MenuCheck checked={show.events} onChange={(v) => setShow({ ...show, events: v })}>Block events</MenuCheck>
            <MenuCheck checked={show.overlap} onChange={(v) => setShow({ ...show, overlap: v })}>Overlap</MenuCheck>
            <MenuCheck checked={show.notes} onChange={(v) => setShow({ ...show, notes: v })}>Notes</MenuCheck>
            <MenuSeparator />
            <MenuItem danger disabled={!f} onSelect={() => setDialog({ kind: 'delete' })}>Delete layout…</MenuItem>
          </Menu>
          <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => void doSave()}>
            Save
          </Button>
        </>
      }
    />
  );

  // ------------------------------------------------------------ left: the channel's templates
  const left = (
    <>
      {(['main', 'ads'] as const).map((kind) => {
        const items = tplList.filter((t) => t.kind === kind);
        if (!items.length) return null;
        return (
          <ListGroup key={kind} label={kind === 'main' ? 'Main playlist' : 'Ads playlist'}>
            {items.map((t) => {
              const u = usage(t.validFrom, t.validTo);
              return (
                <ListItem
                  key={t.id}
                  title={t.id === templateId && draft ? draft.name : t.name}
                  meta={`${formatDate(t.validFrom)} – ${formatDate(t.validTo)}`}
                  badge={u}
                  selected={t.id === templateId}
                  onClick={() => t.id !== templateId && goTemplate(t.id)}
                />
              );
            })}
          </ListGroup>
        );
      })}
      {channel && !channel.adsPlaylistId && (
        <span className="px-3 text-small text-text-3">Main playlist only: this channel has no ads playlist, so its blocks have no linked breaks.</span>
      )}
      {templates.isSuccess && !tplList.length && channel && (
        <EmptyState action={<Button size="sm" icon="plus" onClick={() => setDialog({ kind: 'new' })}>New layout…</Button>}>No layouts for {channel.name} yet.</EmptyState>
      )}
    </>
  );

  // ------------------------------------------------------------ main
  const loadError = channels.error ?? templates.error ?? full.error ?? types.error ?? groups.error;
  let main: ReactNode;
  if (loadError) main = <Notice tone="red">{errorText(loadError)}</Notice>;
  else if (templates.isSuccess && !tplList.length) main = null;
  else if (!draft || !ctx || !f) main = <span className="px-1 py-8 text-small text-text-3">Loading…</span>;
  else {
    const legend = new Map<string, { name: string; color: string | null }>();
    for (const b of draft.blocks) {
      const t = ctx.types.get(b.blockTypeId);
      const g = t && ctx.groups.get(t.groupId);
      if (g && !legend.has(g.id)) legend.set(g.id, { name: g.name, color: groupColor(ctx, g, t.color) });
    }
    main = (
      <>
        {conflict && (
          <Notice
            tone="amber"
            action={
              <Button size="sm" onClick={() => { dispatch({ type: 'discard' }); setConflict(false); void full.refetch().then((r) => r.data && dispatch({ type: 'load', templateId: r.data.template.id, version: r.data.template.version, draft: toDraft(r.data) })); }}>
                Reload
              </Button>
            }
          >
            Someone else saved this layout since you opened it. Reload to see their changes; your unsaved changes will be lost.
          </Notice>
        )}
        {saveError && (
          <Notice tone="red" action={<IconButton icon="close" size="xs" label="Dismiss" onClick={() => setSaveError(null)} />}>
            <span className="font-medium">Nothing was saved. {saveError.problems.length > 1 ? saveError.message : ''}</span>
            {(saveError.problems.length ? saveError.problems : [{ message: saveError.message }]).slice(0, 6).map((p, i) => (
              <span key={i}>{p.message}</span>
            ))}
            {saveError.problems.length > 6 && <span>and {saveError.problems.length - 6} more.</span>}
          </Notice>
        )}
        <StatusBar>
          <span className="flex min-w-[200px] flex-col gap-0.5">
            <span className="text-body font-semibold">{draft.name}</span>
            <span className="text-text-2">
              Valid <span className="mono">{formatDate(draft.validFrom)} → {formatDate(draft.validTo)}</span> · each week's playlists are created from it
            </span>
          </span>
          <span className="flex-1" />
          <span className="inline-flex items-center gap-1">
            <span className="mr-1 text-text-3">Active</span>
            <DayToggles label="Active days" weekStart={ctx.channel.weekStart} value={draft.activeWeekdays} onToggle={(d) => change(setActiveDay(draft, d, !draft.activeWeekdays[d]))} />
          </span>
          <ChangeDates ctx={ctx} from={draft.validFrom} to={draft.validTo} onApply={(validFrom, validTo) => change({ ...draft, validFrom, validTo })} />
        </StatusBar>
        <div className="flex flex-wrap items-center justify-between gap-2 text-small text-text-2">
          <span className="inline-flex flex-wrap gap-3.5 text-text-3">
            {[...legend.entries()].slice(0, 12).map(([id, l]) => (
              <span key={id} className="inline-flex items-center gap-1.5">
                <Swatch color={l.color} />
                {l.name}
              </span>
            ))}
          </span>
          <span role="group" aria-label="Zoom" className="no-print ml-auto inline-flex items-center gap-0.5">
            <IconButton icon="minus" size="sm" label="Zoom out" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)} />
            <IconButton icon="plus" size="sm" label="Zoom in" disabled={zoom === ZOOM_LEVELS.length - 1} onClick={() => setZoom(zoom + 1)} />
          </span>
        </div>
        {placing && ctx.types.get(placing.typeId) && (
          <Notice action={<Button size="sm" onClick={() => setPlacing(null)}>Stop</Button>}>
            <span>
              <span className="font-medium text-text">Placing {seriesLabel(ctx, ctx.types.get(placing.typeId)!)}</span>: click a day for each block. Esc to stop.
            </span>
          </Notice>
        )}
        <TemplateGrid
          placing={placing}
          ctx={ctx}
          draft={draft}
          selectedId={sel}
          zoom={zoom}
          show={show}
          onChange={change}
          onSelect={(id) => {
            setSel(id);
            setPanel(id ? 'block' : null);
          }}
          dragSource={dragSource}
          onDropped={(id) => {
            setSel(id);
            if (panel !== 'add' && panel !== 'lib') setPanel('block');
          }}
          onRepeat={(d) => {
            // the hour of the selected block on that day, else the first block's hour, else the day start
            const pick = block && block.weekday === d ? block : draft.blocks.filter((b) => b.weekday === d).sort((a, b) => a.startFrames - b.startFrames)[0];
            setDialog({ kind: 'repeat', weekday: d, from: pick ? Math.max(0, hourFloor(ctx, pick.startFrames)) : 0 });
          }}
          onAddOnDay={(d) => {
            setSel(null);
            setAddDay(d);
            setAddQuery(undefined);
            setPanel('add');
          }}
        />
      </>
    );
  }

  // ------------------------------------------------------------ right panel
  let side: ReactNode = null;
  if (draft && ctx && f) {
    if (panel === 'block' && block) {
      side = (
        <SidePanel title="Block" onClose={() => { setSel(null); setPanel(null); }}>
          <BlockPanel
            ctx={ctx}
            full={f}
            draft={draft}
            block={block}
            lists={lists.data ?? []}
            onChange={change}
            onRemove={() => {
              change(removeBlock(draft, block.id));
              setSel(null);
              setPanel(null);
              toast('Block removed. Undo brings it back.');
            }}
            onDetails={() => setDialog({ kind: 'details' })}
            onOpenAds={(weekday, typeId) => f.ads?.template && goTemplate(f.ads.template.id, { weekday, typeId })}
            onOpenMain={(blockId) => f.main?.template && goTemplate(f.main.template.id, { blockId })}
            onNewList={() => setDialog({ kind: 'lists', start: 'new' })}
            onSaveAsList={(positions) => setDialog({ kind: 'lists', start: 'new', preset: positions })}
            onManageLists={() => setDialog({ kind: 'lists', start: 'manage' })}
          />
        </SidePanel>
      );
    } else if (panel === 'add') {
      side = (
        <SidePanel title="Add block" onClose={() => setPanel(sel ? 'block' : null)}>
          <AddBlockPanel
            ctx={ctx}
            draft={draft}
            lists={lists.data ?? []}
            after={addDay === null ? block : null}
            initialDay={addDay ?? block?.weekday ?? ctx.order[0]}
            initialQuery={addQuery}
            armedId={placing?.typeId ?? null}
            onArm={(t, breaks) => setPlacing(t ? { typeId: t.id, breaks } : null)}
            onDrag={(t, breaks) => {
              dragSource.current = t ? { kind: 'new', typeId: t.id, breaks } : null;
            }}
            onAdded={(d, b: BlockDraft) => {
              change(d);
              setSel(b.id);
              setPanel('block');
              setAddDay(null);
              toast('Block added');
            }}
          />
        </SidePanel>
      );
    } else if (panel === 'lib') {
      side = (
        <SidePanel title="Block types" onClose={() => setPanel(null)}>
          <BlockTypesPanel
            ctx={ctx}
            draft={draft}
            playlistId={f.template.playlistId}
            onNew={() => setDialog({ kind: 'type', editing: null })}
            onEdit={(t) => setDialog({ kind: 'type', editing: t })}
            onDelete={setDeleteType}
            armedId={placing?.typeId ?? null}
            onArm={(t) => setPlacing(t ? { typeId: t.id, breaks: null } : null)}
            onDragType={(t) => {
              dragSource.current = t ? { kind: 'new', typeId: t.id } : null;
            }}
            onAddToTemplate={(t) => {
              setAddQuery(t.name);
              setAddDay(null);
              setPanel('add');
            }}
          />
        </SidePanel>
      );
    }
  }

  return (
    <>
      {header}
      <EditorLayout left={left} main={main} panel={side} />

      {channel && (
        <TemplateFormDialog
          mode={dialog?.kind === 'clone' ? 'clone' : 'new'}
          open={dialog?.kind === 'new' || dialog?.kind === 'clone'}
          onOpenChange={(o) => !o && setDialog(null)}
          channel={channel}
          source={dialog?.kind === 'clone' ? f?.template : undefined}
          onDone={(res) => {
            dispatch({ type: 'discard' });
            qc.setQueryData(keys.template(res.template.id), res);
            setParams({ channel: res.template.channelId, template: res.template.id });
            resetView();
          }}
        />
      )}
      {draft && (
        <RenameDialog open={dialog?.kind === 'rename'} onOpenChange={(o) => !o && setDialog(null)} value={draft.name} onRename={(name) => change({ ...draft, name })} />
      )}
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete ${f?.template.name ?? 'template'}?`}
        description={`Its blocks and linked breaks are deleted with it.${dirty ? ' Your unsaved changes are lost.' : ''} Weeks already created from it keep their playlists.`}
        confirmLabel="Delete layout"
        danger
        onConfirm={() => {
          if (f) deleteTemplate.mutate(f.template.id);
          setDialog(null);
        }}
      />
      {ctx && draft && f && (
        <>
          <BreakListsDialog
            open={dialog?.kind === 'lists'}
            onOpenChange={(o) => !o && setDialog(null)}
            ctx={ctx}
            draft={draft}
            selected={block}
            lists={lists.data ?? []}
            startWith={dialog?.kind === 'lists' ? dialog.start : 'manage'}
            presetPositions={dialog?.kind === 'lists' ? dialog.preset : undefined}
          />
          <BlockTypeDialog
            open={dialog?.kind === 'type'}
            onOpenChange={(o) => !o && setDialog(null)}
            ctx={ctx}
            playlistId={f.template.playlistId}
            playlistLabel={`${ctx.channel.name} · ${ctx.kind === 'main' ? 'Main' : 'Ads'} playlist`}
            editing={dialog?.kind === 'type' ? dialog.editing : null}
            groups={groups.data ?? []}
            defaultFrom={draft.validFrom}
            defaultTo={draft.validTo}
          />
          <BlockDetailsDialog open={dialog?.kind === 'details'} onOpenChange={(o) => !o && setDialog(null)} ctx={ctx} block={block} />
          <RepeatDialog
            open={dialog?.kind === 'repeat'}
            onOpenChange={(o) => !o && setDialog(null)}
            ctx={ctx}
            draft={draft}
            weekday={dialog?.kind === 'repeat' ? dialog.weekday : 0}
            defaultFrom={dialog?.kind === 'repeat' ? dialog.from : 0}
            playlistId={f.template.playlistId}
            onDone={change}
          />
        </>
      )}
      <DeleteBlockTypeDialog type={deleteType} onOpenChange={(o) => !o && setDeleteType(null)} />
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title="Unsaved changes"
        description={`${draft?.name ?? 'This layout'} has changes that are not saved yet.`}
        confirmLabel="Save and continue"
        extra={{
          label: 'Discard changes',
          onClick: () => {
            const next = pending;
            dispatch({ type: 'discard' });
            setPending(null);
            next?.();
          },
        }}
        onConfirm={async () => {
          const next = pending;
          setPending(null);
          if (await doSave()) next?.();
        }}
      />
    </>
  );
}

function ChangeDates({ ctx, from, to, onApply }: { ctx: PageCtx; from: string; to: string; onApply: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setA(from);
      setB(to);
      setError(null);
    }
  }, [open, from, to]);
  const ws = ctx.channel.weekStart;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Valid dates"
      align="end"
      width={320}
      trigger={
        <Button size="sm" aria-expanded={open}>
          Change dates
        </Button>
      }
    >
      <DatePicker
        mode="range"
        wholeWeeks
        label="Valid dates"
        width={292}
        weekStart={ws}
        today={ctx.channel.today}
        from={a}
        to={b}
        onChange={(v) => {
          setA(v.from);
          setB(v.to);
          setError(null);
        }}
        help={`Starts on a ${WEEKDAYS[ws].long} and ends on a ${WEEKDAYS[(ws + 6) % 7].long}, the channel's week.`}
      />
      {error && <Notice tone="amber">{error}</Notice>}
      <PopoverFooter>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            const p = checkDates(a.trim(), b.trim(), ws);
            if (p.length) return setError(p[0].message);
            onApply(a.trim(), b.trim());
            setOpen(false);
          }}
        >
          Apply
        </Button>
      </PopoverFooter>
    </Popover>
  );
}
