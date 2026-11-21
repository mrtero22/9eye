// One column of the Catalog page: its rows under the selected parent, search, advanced search,
// order by, show expired, ticks and the "⋯" actions (catalog-page.md "A column", "Actions").

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BULK_EDIT_MAX, SORT_FIELDS, type CatalogLevel, type SearchCondition } from '@9eye/core';
import type { CatalogColumnRow } from '@/lib/types';
import { BrowserColumn, BrowserRow, MenuItem, type RowSwatch } from '@/ui';
import { LEVELS, swatchOf } from './levels';
import { catalogKeys, useColumn } from './queries';

export interface ColumnActions {
  create: () => void;
  fromTemplate: (id: string) => void;
  remove: (ids: string[]) => void;
  bulk?: (ids: string[]) => void;
  series?: () => void;
  regenerate?: () => void;
  clone?: (id: string) => void;
  addProductions?: () => void;
  shuffle?: () => void;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CatalogColumn({
  level,
  parentId,
  parentName,
  selected,
  onSelect,
  collapsed,
  onToggleCollapse,
  conditions,
  onAdvanced,
  actions,
  createDisabledReason,
  regenerateFor,
  footerText,
  resetTicks,
  onLoaded,
  onRelations,
}: {
  level: CatalogLevel;
  parentId: string | null;
  parentName: string | null;
  selected: { id: string; name: string; swatch: RowSwatch } | null;
  onSelect: (row: CatalogColumnRow) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  conditions: SearchCondition[];
  onAdvanced: () => void;
  actions: ColumnActions;
  createDisabledReason: string | null;
  /** Segments column: the segmentation Regenerate replaces (null = none selected). */
  regenerateFor?: string | null;
  footerText?: string;
  /** Changes when the page wants ticks cleared (after a delete). */
  resetTicks: number;
  onLoaded?: (total: number, rows: CatalogColumnRow[]) => void;
  onRelations?: (row: CatalogColumnRow) => void;
}) {
  const qc = useQueryClient();
  const info = LEVELS[level];
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null);
  const [expired, setExpired] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const query = useDebounced(q, 250);
  const needsParent = info.needs !== null;
  const col = useColumn(level, { parentId, q: query, conditions, sort: sort?.field ?? null, dir: sort?.dir ?? 'asc', expired }, !needsParent || !!parentId);
  const rows = needsParent && !parentId ? [] : (col.data?.rows ?? []);
  const total = needsParent && !parentId ? 0 : (col.data?.total ?? 0);

  useEffect(() => setTicked(new Set()), [parentId, resetTicks]);
  useEffect(() => {
    if (col.data) onLoaded?.(col.data.total, col.data.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col.data]);

  const tickedIds = [...ticked].filter((id) => rows.some((r) => r.id === id));
  const one = tickedIds.length === 1;
  const any = tickedIds.length > 0;
  const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? '';
  const filtered = !!query.trim() || conditions.some((c) => c.value.trim() || c.op === 'empty');
  const advOn = conditions.some((c) => c.value.trim() || c.op === 'empty');

  const fromTemplate = (
    <MenuItem disabled={!one} note={one ? `Copies ${nameOf(tickedIds[0])}` : 'Tick exactly one item'} onSelect={() => actions.fromTemplate(tickedIds[0])}>
      Create from layout
    </MenuItem>
  );
  const del = (
    <MenuItem danger disabled={!any} note={any ? `${tickedIds.length} ticked` : 'Tick the items to delete'} onSelect={() => actions.remove(tickedIds)}>
      Delete selected items
    </MenuItem>
  );
  const bulk = actions.bulk && (
    <MenuItem disabled={!any} note={any ? `${tickedIds.length} ticked · at most ${BULK_EDIT_MAX}` : 'Tick the items to edit'} onSelect={() => actions.bulk!(tickedIds)}>
      Bulk edit
    </MenuItem>
  );
  const platforms = (
    <MenuItem disabled note="Needs the non-linear module">
      Schedule content to platforms
    </MenuItem>
  );
  let menu = (
    <>
      {fromTemplate}
      {del}
    </>
  );
  if (level === 'content') {
    menu = (
      <>
        {fromTemplate}
        {bulk}
        {platforms}
        {del}
      </>
    );
  }
  if (level === 'production') {
    menu = (
      <>
        <MenuItem disabled={!parentId} note={parentId ? `Adds numbered episodes to ${parentName ?? ''}` : 'Select a title'} onSelect={() => actions.series?.()}>
          Create series
        </MenuItem>
        {fromTemplate}
        {bulk}
        {platforms}
        {del}
      </>
    );
  }
  if (level === 'segment') {
    menu = (
      <>
        <MenuItem disabled={!regenerateFor || !rows.length} note={regenerateFor && rows.length ? `Replaces the parts of ${regenerateFor}` : 'Select a cut'} onSelect={() => actions.regenerate?.()}>
          Regenerate
        </MenuItem>
        {fromTemplate}
        {del}
      </>
    );
  }
  if (level === 'rotation-list') {
    const src = one ? tickedIds[0] : (selected?.id ?? null);
    menu = (
      <>
        <MenuItem disabled={!src} note={src ? `Copies ${one ? nameOf(tickedIds[0]) : (selected?.name ?? '')}` : 'Select or tick a list'} onSelect={() => src && actions.clone?.(src)}>
          Clone
        </MenuItem>
        {del}
      </>
    );
  }
  if (level === 'list-item') {
    menu = (
      <>
        <MenuItem disabled={!parentId} onSelect={() => actions.addProductions?.()}>
          Add items
        </MenuItem>
        <MenuItem disabled={!rows.length} onSelect={() => actions.shuffle?.()}>
          Shuffle
        </MenuItem>
        {del}
      </>
    );
  }

  const allTicked = rows.length > 0 && rows.every((r) => ticked.has(r.id));
  return (
    <BrowserColumn
      title={info.title}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      selected={selected ? { name: selected.name, swatch: selected.swatch } : null}
      createLabel={info.createLabel}
      createDisabled={!!createDisabledReason}
      createHint={createDisabledReason ?? undefined}
      onCreate={actions.create}
      menu={menu}
      search={q}
      onSearch={setQ}
      advanced={{ on: advOn, summary: conditions.filter((c) => c.value.trim() || c.op === 'empty').map((c) => `${c.field} ${c.op === 'empty' ? 'is empty' : `${c.op} "${c.value}"`}`).join(', '), onOpen: onAdvanced }}
      sort={{ fields: SORT_FIELDS[level], field: sort?.field ?? null, dir: sort?.dir ?? 'asc', onPick: (f) => setSort(sort?.field === f ? { field: f, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { field: f, dir: 'asc' }) }}
      expired={info.expiredFilter ? { on: expired, onChange: setExpired } : undefined}
      onRefresh={() => qc.invalidateQueries({ queryKey: catalogKeys.columnLevel(level) })}
      allTicked={allTicked}
      onTickAll={(v) => setTicked(v ? new Set(rows.map((r) => r.id)) : new Set())}
      count={`${total} result${total === 1 ? '' : 's'}${total > rows.length && rows.length ? ` · first ${rows.length} shown` : ''}`}
      footer={sort ? `Ordered by ${sort.field}` : footerText}
      empty={needsParent && !parentId ? info.needs : col.isLoading ? null : col.isError ? 'This column could not be read.' : rows.length ? null : filtered ? 'Nothing matches' : info.empty}
    >
      {rows.map((r) => (
        <BrowserRow
          key={r.id}
          name={r.name}
          swatch={swatchOf(level, r.color)}
          checked={ticked.has(r.id)}
          onCheck={(v) => {
            const n = new Set(ticked);
            if (v) n.add(r.id);
            else n.delete(r.id);
            setTicked(n);
          }}
          selected={selected?.id === r.id}
          onSelect={() => onSelect(r)}
          meta={r.meta}
          metaTone={r.metaTone}
          media={r.media}
          last={r.last}
          onRelations={info.relations && onRelations ? () => onRelations(r) : undefined}
        />
      ))}
    </BrowserColumn>
  );
}
