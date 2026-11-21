// The Catalog page's dialogs (catalog-page.md "Dialogs"): delete, bulk edit, create series,
// create / regenerate segmentation, advanced search. Each says what will change first.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BULK_EDIT_MAX, BULK_FIELDS, SEARCH_FIELDS, SEARCH_OPS, SERIES_MAX, formatTc, frameRate, parseTc, seriesTitles, splitSegments, type CatalogLevel, type SearchCondition, type SearchOp } from '@9eye/core';
import { api, ApiError, errorText } from '@/lib/api';
import type { CatalogDeleteRow, CatalogLookups } from '@/lib/types';
import { Button, Checkbox, Dialog, IconButton, Notice, ReadValue, RowList, Segmented, SelectField, TextField, useToast } from '@/ui';
import { LEVELS, plural } from './levels';
import { refreshCatalog } from './queries';

function Problems({ error }: { error: unknown }) {
  if (!error) return null;
  const problems = error instanceof ApiError ? error.problems : [];
  return (
    <Notice tone="red">
      <span>{errorText(error)}</span>
      {problems.length > 1 && (
        <ul className="m-0 pl-4">
          {problems.map((p) => (
            <li key={p.message}>{p.message}</li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

function Foot({ text, children }: { text?: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      {text && <span className="flex-[1_1_200px] text-meta text-text-3">{text}</span>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- delete

export function DeleteDialog({ level, ids, onClose, onDeleted }: { level: CatalogLevel; ids: string[]; onClose: () => void; onDeleted: (ids: string[]) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const check = useQuery({ queryKey: ['catalog-page-delete', level, ids.join(',')], queryFn: () => api<CatalogDeleteRow[]>('POST', `/catalog/delete-check/${level}`, { ids }), gcTime: 0 });
  const rows = check.data ?? [];
  const blocked = rows.some((r) => r.usedBy);
  const del = useMutation({
    mutationFn: () => api('POST', `/catalog/delete/${level}`, { ids }),
    onSuccess: async () => {
      toast(`${plural(ids.length, LEVELS[level].one)} deleted`);
      await refreshCatalog(qc);
      onDeleted(ids);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${plural(ids.length, LEVELS[level].one)}`}
      description="Deleted items cannot be brought back. Everything under them is deleted too."
      width={560}
      footer={
        <Foot>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" className="text-red-text" disabled={check.isLoading || blocked || del.isPending} onClick={() => del.mutate()}>
            Delete
          </Button>
        </Foot>
      }
    >
      {check.isError ? (
        <Problems error={check.error} />
      ) : (
        <RowList>
          {check.isLoading && <div className="px-2.5 py-2 text-small text-text-3">Checking what uses them…</div>}
          {rows.map((r) => (
            <div key={r.id} className="flex min-h-9 items-center gap-2.5 px-2.5 py-1 text-small">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{r.name}</span>
              <span className={r.usedBy ? 'text-meta text-amber-text' : 'text-meta text-green-text'}>{r.usedBy ?? 'Can be deleted'}</span>
            </div>
          ))}
        </RowList>
      )}
      {blocked && <Notice tone="amber">Nothing is deleted while any of them is used. Remove the airings, events or list items that use them first, then delete again.</Notice>}
      <Problems error={del.error} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- bulk edit

export function BulkEditDialog({ level, ids, scope, lookups, onClose }: { level: 'content' | 'production'; ids: string[]; scope: string; lookups: CatalogLookups; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fields = [...BULK_FIELDS[level], ...(level === 'production' ? lookups.customFields.map((c) => c.label) : [])];
  const [rows, setRows] = useState<Record<string, { on: boolean; op: 'set' | 'clear'; value: string }>>({});
  const over = ids.length > BULK_EDIT_MAX;
  const chosen = fields.filter((f) => rows[f]?.on);
  const apply = useMutation({
    mutationFn: () => api('POST', `/catalog/bulk-edit/${level}`, { ids, changes: chosen.map((f) => ({ field: f, op: rows[f].op, value: rows[f].value })) }),
    onSuccess: async () => {
      toast(`Bulk edit applied to ${plural(ids.length, LEVELS[level].one)}`);
      await refreshCatalog(qc);
      onClose();
    },
  });
  const upd = (f: string, patch: Partial<{ on: boolean; op: 'set' | 'clear'; value: string }>) => {
    const cur = rows[f] ?? { on: false, op: 'set' as const, value: '' };
    setRows({ ...rows, [f]: { ...cur, ...patch } });
  };
  const placeholder = (f: string) =>
    ['Starts', 'Expires', 'Valid from', 'To'].includes(f) ? 'YYYY-MM-DD' : f === 'Channels' || f === 'Companies' ? 'Names, separated by commas' : f === 'Media status' ? 'Ready or Not ready' : f === 'Source' ? lookups.sources.map((s) => s.name).join(' or ') : 'New value';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={level === 'production' ? 'Bulk edit items' : 'Bulk edit titles'}
      description={`${ids.length} ticked · ${scope}`}
      width={640}
      footer={
        <Foot text="Applied to every ticked item, all or nothing.">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={over || !chosen.length || apply.isPending} onClick={() => apply.mutate()}>
            Apply to {ids.length}
          </Button>
        </Foot>
      }
    >
      {over && <Notice tone="red">You have ticked {ids.length} items. Bulk edit takes at most {BULK_EDIT_MAX}; tick fewer.</Notice>}
      <span className="text-meta text-text-2">Select fields to edit</span>
      <RowList>
        {fields.map((f) => {
          const r = rows[f];
          return (
            <div key={f} className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 px-2.5 py-1.5">
              <span className="w-[170px]">
                <Checkbox checked={!!r?.on} onChange={(v) => upd(f, { on: v })}>
                  {f}
                </Checkbox>
              </span>
              {r?.on && (
                <>
                  <Segmented
                    size="sm"
                    label={`Operation for ${f}`}
                    value={r.op}
                    onChange={(op) => upd(f, { op })}
                    options={[
                      { value: 'set', label: 'Set value' },
                      { value: 'clear', label: 'Clear field' },
                    ]}
                  />
                  {r.op === 'set' && (
                    <input
                      aria-label={`New value for ${f}`}
                      placeholder={placeholder(f)}
                      value={r.value}
                      onChange={(e) => upd(f, { value: e.target.value })}
                      className="h-[30px] min-w-0 flex-[1_1_160px] rounded-ctl border border-border-strong bg-surface px-2 text-small text-text outline-none"
                    />
                  )}
                </>
              )}
            </div>
          );
        })}
      </RowList>
      <Problems error={apply.error} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- create series

export function SeriesDialog({ content, lookups, onClose }: { content: { id: string; name: string }; lookups: CatalogLookups; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const rate = frameRate(lookups.frameRate);
  const next = useQuery({ queryKey: ['catalog-page', 'next-episode', content.id], queryFn: () => api<{ next: number }>('GET', `/catalog/contents/${content.id}/next-episode`), gcTime: 0 });
  const [title, setTitle] = useState(content.name);
  const [first, setFirst] = useState<string | null>(null);
  const [count, setCount] = useState('10');
  const [dur, setDur] = useState(formatTc(parseTc('00:45:00', rate) ?? 0, rate));
  const [segs, setSegs] = useState('1');
  const [sourceId, setSourceId] = useState((lookups.sources.find((s) => /server/i.test(s.name)) ?? lookups.sources[0])?.id ?? '');
  const firstN = Number(first ?? next.data?.next ?? 1) || 0;
  const n = Math.min(Math.max(Number(count) || 0, 0), SERIES_MAX);
  const titles = seriesTitles(title, firstN, n);
  const length = dur.trim() ? parseTc(dur, rate, { maxHours: 999 }) : null;
  const create = useMutation({
    mutationFn: () => api('POST', `/catalog/contents/${content.id}/series`, { title, first: firstN, count: n, lengthFrames: length, segments: Number(segs) || 1, sourceId }),
    onSuccess: async () => {
      toast(`${plural(n, 'item')} created in ${content.name}`);
      await refreshCatalog(qc);
      onClose();
    },
  });
  const shown = titles.length > 7 ? [...titles.slice(0, 5), '…', titles[titles.length - 1]] : titles;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create series"
      description={`Adds numbered items to ${content.name}. The episode number is added to the title.`}
      width={560}
      footer={
        <Foot text="Ids follow the source's pattern; each item gets one cut.">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!n || !title.trim() || !sourceId || (dur.trim() !== '' && length === null) || create.isPending} onClick={() => create.mutate()}>
            Create {plural(n, 'item')}
          </Button>
        </Foot>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <ReadValue label="Title" value={content.name} />
        </div>
        <TextField className="col-span-2" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField label="Initial episode" mono value={first ?? String(next.data?.next ?? '')} onChange={(e) => setFirst(e.target.value)} />
        <TextField label="Number of episodes" mono value={count} onChange={(e) => setCount(e.target.value)} />
        <TextField label="Duration" mono value={dur} onChange={(e) => setDur(e.target.value)} error={dur.trim() !== '' && length === null ? 'Not a valid timecode.' : undefined} />
        <TextField label="Number of parts" mono value={segs} onChange={(e) => setSegs(e.target.value)} />
        <SelectField label="Source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {lookups.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-meta text-text-2">{plural(n, 'item')}</span>
        <div className="flex flex-wrap gap-1">
          {shown.map((t, i) => (
            <span key={i} className="inline-flex h-6 items-center rounded-[12px] bg-surface-2 px-2 text-meta">
              {t}
            </span>
          ))}
        </div>
      </div>
      <Problems error={create.error} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- create / regenerate segmentation

export function SegmentationDialog({
  production,
  regenerate,
  lookups,
  defaults,
  onClose,
}: {
  production: { id: string; name: string; code: string; lengthFrames: number | null };
  /** Regenerate: the segmentation, its version and its segments now. */
  regenerate: { id: string; name: string; version: number; count: number; endFrames: number | null } | null;
  lookups: CatalogLookups;
  defaults: { nextCode: number };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const rate = frameRate(lookups.frameRate);
  const [name, setName] = useState(regenerate ? regenerate.name : `${production.code}-${defaults.nextCode}`);
  const [sourceId, setSourceId] = useState((lookups.sources.find((s) => /server/i.test(s.name)) ?? lookups.sources[0])?.id ?? '');
  const [count, setCount] = useState(String(regenerate ? Math.max(regenerate.count, 1) : 1));
  const initial = regenerate?.endFrames ?? production.lengthFrames ?? parseTc('00:45:00', rate) ?? 0;
  const [dur, setDur] = useState(formatTc(initial, rate));
  const length = parseTc(dur, rate, { maxHours: 999 });
  const n = Math.max(1, Math.min(Number(count) || 1, 50));
  const preview = length === null ? [] : splitSegments(length, n);
  const save = useMutation({
    mutationFn: () =>
      regenerate
        ? api('POST', `/catalog/segmentations/${regenerate.id}/regenerate`, { name, sourceId, segments: n, lengthFrames: length, version: regenerate.version })
        : api('POST', `/catalog/productions/${production.id}/segmentations`, { name, sourceId, segments: n, lengthFrames: length }),
    onSuccess: async () => {
      toast(regenerate ? `${name} regenerated with ${plural(n, 'part')}` : 'Cut created');
      await refreshCatalog(qc);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={regenerate ? 'Regenerate cut' : 'Create cut'}
      description={production.name}
      width={560}
      footer={
        <Foot>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || length === null || !sourceId || save.isPending} onClick={() => save.mutate()}>
            {regenerate ? 'Regenerate' : 'Create cut'}
          </Button>
        </Foot>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <TextField className="col-span-2" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {lookups.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Number of parts" mono value={count} onChange={(e) => setCount(e.target.value)} />
        <TextField label="Duration" mono value={dur} onChange={(e) => setDur(e.target.value)} error={length === null ? 'Not a valid timecode.' : undefined} />
        <div className={regenerate ? '' : 'col-span-2'}>
          <ReadValue label="Item" value={production.name} />
        </div>
        {regenerate && <ReadValue label="Cut" value={regenerate.name} />}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-meta text-text-2">{plural(n, 'part')} · TC in · TC out · duration</span>
        <RowList>
          {preview.map((s, i) => (
            <div key={i} className="mono grid min-h-[30px] grid-cols-[40px_1fr_1fr_1fr] items-center gap-2 px-2.5 text-[12.5px]">
              <span className="text-text-3">{i + 1}</span>
              <span>{formatTc(s.tcIn, rate)}</span>
              <span>{formatTc(s.tcOut, rate)}</span>
              <span className="text-text-2">{formatTc(s.length, rate)}</span>
            </div>
          ))}
        </RowList>
      </div>
      {regenerate && (
        <Notice tone="amber">
          Replaces the {plural(regenerate.count, 'part')} of {regenerate.name}
          {regenerate.endFrames !== null ? ` (now ending at ${formatTc(regenerate.endFrames, rate)})` : ''}.
        </Notice>
      )}
      <Problems error={save.error} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- advanced search

export function AdvancedSearchDialog({
  level,
  conditions,
  lookups,
  onSearch,
  onClose,
}: {
  level: CatalogLevel;
  conditions: SearchCondition[];
  lookups: CatalogLookups;
  onSearch: (c: SearchCondition[]) => void;
  onClose: () => void;
}) {
  const fields = [...SEARCH_FIELDS[level], ...(level === 'production' ? lookups.customFields.map((c) => c.label) : [])];
  const blank = (): SearchCondition => ({ field: fields[0], op: 'contains', value: '' });
  const [rows, setRows] = useState<SearchCondition[]>(conditions.length ? conditions : [blank()]);
  useEffect(() => setRows(conditions.length ? conditions : [blank()]), [conditions]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (i: number, patch: Partial<SearchCondition>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Advanced search · ${LEVELS[level].title}`}
      description="Every condition must match. The column's search icon turns blue while it is on."
      width={620}
      footer={
        <Foot>
          <Button
            variant="ghost"
            onClick={() => {
              onSearch([]);
              onClose();
            }}
          >
            Clear
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onSearch(rows);
              onClose();
            }}
          >
            Search
          </Button>
        </Foot>
      }
    >
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1.2fr)_130px_minmax(0,1.4fr)_28px] items-center gap-2">
            <select aria-label="Field" value={r.field} onChange={(e) => upd(i, { field: e.target.value })} className="h-8 rounded-ctl border border-border-strong bg-surface px-1.5 text-small text-text">
              {fields.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <select aria-label="Condition" value={r.op} onChange={(e) => upd(i, { op: e.target.value as SearchOp })} className="h-8 rounded-ctl border border-border-strong bg-surface px-1.5 text-small text-text">
              {SEARCH_OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Value"
              placeholder={r.op === 'between' ? 'From .. to' : r.op === 'empty' ? '' : 'Value'}
              disabled={r.op === 'empty'}
              value={r.value}
              onChange={(e) => upd(i, { value: e.target.value })}
              className="h-8 rounded-ctl border border-border-strong bg-surface px-2 text-small text-text outline-none disabled:bg-surface-2"
            />
            <IconButton icon="close" label="Remove condition" size="sm" tone="quiet" onClick={() => setRows(rows.filter((_, j) => j !== i))} />
          </div>
        ))}
        <button type="button" onClick={() => setRows([...rows, blank()])} className="hov h-7 cursor-pointer self-start rounded-ctl border border-dashed border-border-strong bg-transparent px-2.5 text-[12.5px] text-text-2">
          + Condition
        </button>
      </div>
    </Dialog>
  );
}
