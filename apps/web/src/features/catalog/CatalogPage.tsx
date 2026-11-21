// The Catalog page (catalog-page.md, mockup the Catalog mockup (private); decisions 0014, 0015): modes Catalog /
// Graphics / Rotation lists, collapsible columns of the catalog's levels and the form on the right.
// This page keeps the arrangement the user asked for (columns + form), unlike the other pages.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PARENT_LEVEL, frameRate, type CatalogLevel, type SearchCondition } from '@9eye/core';
import { api, errorText } from '@/lib/api';
import type { CatalogColumnRow } from '@/lib/types';
import { CatalogPicker, ContextText, Notice, PageHeader, Segmented, useToast, type RowSwatch } from '@/ui';
import { CatalogColumn } from './CatalogColumn';
import { AdvancedSearchDialog, BulkEditDialog, DeleteDialog, SegmentationDialog, SeriesDialog } from './dialogs';
import { ItemForm, type Edits } from './ItemForm';
import { LEVELS, MODE_FOCUS, MODE_LEVELS, MODES, swatchOf, type Mode } from './levels';
import { refreshCatalog, useItem, useLookups } from './queries';
import { RelationsDialog } from './RelationsDialog';
import { useAgentPage } from '@/features/agents/pageAgent';

interface Sel {
  id: string;
  name: string;
  swatch: RowSwatch;
}

type ListResult = { name?: string; items?: number; added?: number };

type DialogState =
  | { kind: 'delete'; level: CatalogLevel; ids: string[] }
  | { kind: 'bulk'; level: 'content' | 'production'; ids: string[] }
  | { kind: 'series' }
  | { kind: 'segmentation'; regenerate: boolean }
  | { kind: 'advanced'; level: CatalogLevel }
  | { kind: 'relations'; level: CatalogLevel; id: string; name: string };

/** The levels under a level (cleared when its selection changes). */
const BELOW: Partial<Record<CatalogLevel, CatalogLevel[]>> = {
  'content-type': ['content', 'production', 'segmentation', 'segment'],
  content: ['production', 'segmentation', 'segment'],
  production: ['segmentation', 'segment'],
  segmentation: ['segment'],
  'rotation-list': ['list-item'],
  'graphic-source': ['graphic-template', 'graphic-object'],
};

export function CatalogPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useLookups();
  const [mode, setMode] = useState<Mode>('catalog');
  const [sel, setSel] = useState<Partial<Record<CatalogLevel, Sel>>>({});
  const [focus, setFocus] = useState<CatalogLevel>('production');
  const [creating, setCreating] = useState<{ level: CatalogLevel; fromId: string | null } | null>(null);
  const [collapsed, setCollapsed] = useState<Partial<Record<CatalogLevel, boolean>>>({});
  const [conditions, setConditions] = useState<Partial<Record<CatalogLevel, SearchCondition[]>>>({});
  const [edits, setEdits] = useState<Edits>({});
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [resetTicks, setResetTicks] = useState(0);
  const [picker, setPicker] = useState(false);
  const [totals, setTotals] = useState<Partial<Record<CatalogLevel, number>>>({});
  const chosen = Object.values(sel).flatMap((s) => (s ? [s.name] : [])).join(' › ');
  useAgentPage({ name: 'Media', sees: chosen ? `${mode} · ${chosen}` : `${mode}, nothing picked` });

  const parentOf = (level: CatalogLevel) => {
    const p = PARENT_LEVEL[level];
    return p ? (sel[p] ?? null) : null;
  };
  const production = useItem(sel.production ? 'production' : null, sel.production?.id ?? null);
  const segmentation = useItem(sel.segmentation ? 'segmentation' : null, sel.segmentation?.id ?? null);
  const list = useItem(sel['rotation-list'] ? 'rotation-list' : null, sel['rotation-list']?.id ?? null);
  const formLevel = creating?.level ?? focus;
  const nextEpisode = useQuery({
    queryKey: ['catalog-page', 'next-episode', sel.content?.id],
    queryFn: () => api<{ next: number }>('GET', `/catalog/contents/${sel.content!.id}/next-episode`),
    enabled: creating?.level === 'production' && !creating.fromId && !!sel.content,
  });

  const listOp = useMutation({
    mutationFn: (op: { kind: 'clone'; id: string } | { kind: 'shuffle' } | { kind: 'add'; productionIds: string[] }) =>
      op.kind === 'clone'
        ? api<ListResult>('POST', `/catalog/rotation-lists/${op.id}/clone`, {})
        : op.kind === 'shuffle'
          ? api<ListResult>('POST', `/catalog/rotation-lists/${sel['rotation-list']!.id}/shuffle`, {})
          : api<ListResult>('POST', `/catalog/rotation-lists/${sel['rotation-list']!.id}/items`, { productionIds: op.productionIds }),
    onSuccess: async (r, op) => {
      if (op.kind === 'clone') toast(`Created ${r.name}`);
      if (op.kind === 'shuffle') toast(`Shuffled ${sel['rotation-list']?.name} (${r.items} items)`);
      if (op.kind === 'add') toast(`${r.added} added to ${sel['rotation-list']?.name}`);
      await refreshCatalog(qc);
    },
    onError: (e) => toast(errorText(e), 'red'),
  });

  if (lookups.isError) {
    return (
      <div className="px-4 pt-6 sm:px-8">
        <Notice tone="red">{errorText(lookups.error)}</Notice>
      </div>
    );
  }
  const lk = lookups.data;

  const select = (level: CatalogLevel, row: CatalogColumnRow) => {
    const next = { ...sel, [level]: { id: row.id, name: row.name, swatch: swatchOf(level, row.color) } };
    for (const l of BELOW[level] ?? []) delete next[l];
    setSel(next);
    setFocus(level);
    setCreating(null);
  };
  const setEdit = (key: string, patch: Record<string, unknown> | null) => {
    const n = { ...edits };
    if (patch && Object.keys(patch).length) n[key] = patch;
    else delete n[key];
    setEdits(n);
  };
  const create = (level: CatalogLevel) => {
    if (level === 'segmentation') return setDialog({ kind: 'segmentation', regenerate: false });
    if (level === 'list-item') return setPicker(true);
    setCreating({ level, fromId: null });
    setFocus(level);
  };

  const levels = MODE_LEVELS[mode];
  return (
    <>
      <PageHeader
        title="Media"
        context={
          <>
            <span className="ml-2">
              <Segmented
                label="Media mode"
                value={mode}
                options={MODES}
                onChange={(m) => {
                  setMode(m);
                  setCreating(null);
                  setFocus(MODE_FOCUS[m]);
                }}
              />
            </span>
            {lk && <ContextText>{`${lk.companyName} · timecodes at ${frameRate(lk.frameRate).label}`}</ContextText>}
          </>
        }
      />
      <div className="flex flex-wrap items-stretch gap-2 px-4 pb-8 pt-4 sm:px-8">
        {lk &&
          levels.map((level) => {
            const parent = parentOf(level);
            const info = LEVELS[level];
            const createDisabledReason = info.needs && !parent ? info.needs : null;
            return (
              <CatalogColumn
                key={level}
                level={level}
                parentId={parent?.id ?? null}
                parentName={parent?.name ?? null}
                selected={sel[level] ?? null}
                onSelect={(r) => select(level, r)}
                collapsed={!!collapsed[level]}
                onToggleCollapse={() => setCollapsed({ ...collapsed, [level]: !collapsed[level] })}
                conditions={conditions[level] ?? []}
                onAdvanced={() => setDialog({ kind: 'advanced', level })}
                createDisabledReason={createDisabledReason}
                regenerateFor={level === 'segment' ? (sel.segmentation?.name ?? null) : undefined}
                footerText={level === 'list-item' && list.data?.lastItemPosition != null ? `Last inserted #${String(list.data.lastItemPosition)}` : undefined}
                resetTicks={resetTicks}
                onLoaded={(total, rows) => {
                  if (totals[level] !== total) setTotals((t) => ({ ...t, [level]: total }));
                  const s = sel[level];
                  const row = s ? rows.find((r) => r.id === s.id) : undefined;
                  if (s && row && (row.name !== s.name || ('color' in s.swatch && s.swatch.color !== row.color))) setSel((x) => ({ ...x, [level]: { ...s, name: row.name, swatch: swatchOf(level, row.color) } }));
                }}
                onRelations={(r) => setDialog({ kind: 'relations', level, id: r.id, name: r.name })}
                actions={{
                  create: () => create(level),
                  fromTemplate: (id) => {
                    setCreating({ level, fromId: id });
                    setFocus(level);
                  },
                  remove: (ids) => setDialog({ kind: 'delete', level, ids }),
                  bulk: level === 'content' || level === 'production' ? (ids) => setDialog({ kind: 'bulk', level, ids }) : undefined,
                  series: () => setDialog({ kind: 'series' }),
                  regenerate: () => setDialog({ kind: 'segmentation', regenerate: true }),
                  clone: (id) => listOp.mutate({ kind: 'clone', id }),
                  addProductions: () => setPicker(true),
                  shuffle: () => listOp.mutate({ kind: 'shuffle' }),
                }}
              />
            );
          })}
        {lk && (
          <ItemForm
            level={levels.includes(formLevel) ? formLevel : null}
            itemId={creating ? null : (sel[formLevel]?.id ?? null)}
            creating={creating ? { fromId: creating.fromId } : null}
            parentId={parentOf(formLevel)?.id ?? null}
            parentName={parentOf(formLevel)?.name ?? null}
            lookups={lk}
            edits={edits}
            setEdit={setEdit}
            nextChapter={nextEpisode.data?.next ?? 1}
            nextCode={(totals[formLevel] ?? 0) + 1}
            onSaved={(level, id, created) => {
              if (!created) return;
              const next = { ...sel, [level]: { id, name: '', swatch: swatchOf(level, null) } };
              for (const l of BELOW[level] ?? []) delete next[l];
              setSel(next);
              setCreating(null);
              setFocus(level);
            }}
            onCancelCreate={() => setCreating(null)}
            onRelations={() => {
              const s = sel[formLevel];
              if (s) setDialog({ kind: 'relations', level: formLevel, id: s.id, name: s.name });
            }}
          />
        )}
        {!lk && <div className="px-2 py-4 text-small text-text-3">Loading media…</div>}
      </div>

      {lk && dialog?.kind === 'delete' && (
        <DeleteDialog
          level={dialog.level}
          ids={dialog.ids}
          onClose={() => setDialog(null)}
          onDeleted={(ids) => {
            const s = sel[dialog.level];
            if (s && ids.includes(s.id)) {
              const next = { ...sel };
              delete next[dialog.level];
              for (const l of BELOW[dialog.level] ?? []) delete next[l];
              setSel(next);
            }
            setResetTicks((n) => n + 1);
            setDialog(null);
          }}
        />
      )}
      {lk && dialog?.kind === 'bulk' && (
        <BulkEditDialog level={dialog.level} ids={dialog.ids} scope={(dialog.level === 'production' ? sel.content?.name : sel['content-type']?.name) ?? ''} lookups={lk} onClose={() => setDialog(null)} />
      )}
      {lk && dialog?.kind === 'series' && sel.content && <SeriesDialog content={sel.content} lookups={lk} onClose={() => setDialog(null)} />}
      {lk && dialog?.kind === 'segmentation' && production.data && (!dialog.regenerate || segmentation.data) && (
        <SegmentationDialog
          production={{ id: production.data.id, name: String(production.data.title), code: String(production.data.code ?? ''), lengthFrames: (production.data.lengthFrames as number | null) ?? null }}
          regenerate={
            dialog.regenerate && segmentation.data
              ? {
                  id: segmentation.data.id,
                  name: String(segmentation.data.name),
                  version: segmentation.data.version,
                  count: Number(segmentation.data.segmentCount ?? 0),
                  endFrames: (segmentation.data.segmentsEndFrames as number | null) ?? null,
                }
              : null
          }
          lookups={lk}
          defaults={{ nextCode: (totals.segmentation ?? 0) + 1 }}
          onClose={() => setDialog(null)}
        />
      )}
      {lk && dialog?.kind === 'advanced' && (
        <AdvancedSearchDialog level={dialog.level} conditions={conditions[dialog.level] ?? []} lookups={lk} onSearch={(c) => setConditions({ ...conditions, [dialog.level]: c })} onClose={() => setDialog(null)} />
      )}
      {lk && dialog?.kind === 'relations' && <RelationsDialog level={dialog.level} itemId={dialog.id} itemName={dialog.name} entity={LEVELS[dialog.level].entity} lookups={lk} onClose={() => setDialog(null)} />}
      {lk && picker && sel['rotation-list'] && (
        <CatalogPicker
          pick="items"
          families={['program', 'filling', 'advert']}
          frameRate={lk.frameRate}
          title="Add items"
          context={`To the rotation list ${sel['rotation-list'].name}`}
          already={(list.data?.productionIds as string[] | undefined) ?? []}
          triggerStyle="none"
          open
          onOpenChange={(o) => !o && setPicker(false)}
          onPick={(r) => {
            setPicker(false);
            if (r.items.length) listOp.mutate({ kind: 'add', productionIds: r.items.map((i) => i.productionId) });
          }}
        />
      )}
    </>
  );
}
