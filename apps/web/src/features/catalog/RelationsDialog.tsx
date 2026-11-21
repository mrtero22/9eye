// Relations of a catalog item (catalog-page.md "Relations"): tabs by level, the item's own rows
// (editable) and the ones it inherits from its parents (marked), Save for every changed tab.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { GRAPHIC_END_TYPES, GRAPHIC_LAYERS, GRAPHIC_START_TYPES, SEGMENT_RULES, formatTc, frameRate, type CatalogLevel, type RelationKind, type RelationTab } from '@9eye/core';
import { api, ApiError, errorText } from '@/lib/api';
import type { CatalogLookups, CatalogRelationRow } from '@/lib/types';
import { Button, CatalogPicker, Dialog, IconButton, Notice, TabBar, Table, TableRow, useToast } from '@/ui';
import { catalogKeys, useRelations } from './queries';

const TAB_LABEL: Record<RelationTab, string> = {
  linear: 'Bumpers',
  graphics: 'Graphics relations',
  'time-window': 'Time windows',
  'product-code': 'Product codes',
  rights: 'Linear rights',
  history: 'Broadcast history',
};

const HINT: Record<RelationTab, string> = {
  linear: "Stings placed around this item; a title's relations are inherited by its items.",
  graphics: 'Graphics shown during this item.',
  'time-window': 'Where this item may or may not be placed (used by Auto-place and rotation).',
  'product-code': 'Clash codes keep competing products apart.',
  rights: 'Read from the rights bundles of the channel.',
  history: "From 9eye's approved playlists; from as-run once reconciliation exists.",
};

const SELECT = 'h-7 w-full min-w-0 rounded-ctl border border-border-strong bg-surface px-1 text-small text-text';

type Own = Record<RelationKind, CatalogRelationRow[]>;
const KINDS: RelationKind[] = ['linear', 'graphics', 'time-window', 'product-code'];

export function RelationsDialog({ level, itemId, itemName, entity, lookups, onClose }: { level: CatalogLevel; itemId: string; itemName: string; entity: string; lookups: CatalogLookups; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const rel = useRelations(level, itemId);
  const rate = frameRate(lookups.frameRate);
  const [tab, setTab] = useState<RelationTab | null>(null);
  const [own, setOwn] = useState<Own | null>(null);
  const [changed, setChanged] = useState<Set<RelationKind>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<{ index: number | null } | null>(null);

  useEffect(() => {
    if (!rel.data || own) return;
    const o = Object.fromEntries(KINDS.map((k) => [k, rel.data!.rows.filter((r) => r.kind === k && !r.inherited)])) as Own;
    setOwn(o);
    setNames(rel.data.names);
    setTab(rel.data.tabs[0] ?? null);
  }, [rel.data, own]);

  const save = useMutation({
    mutationFn: () => {
      const kinds = [...changed];
      return api('PUT', `/catalog/relations/${level}/${itemId}`, { kinds, rows: kinds.flatMap((k) => own![k].map((r) => ({ kind: k, channelId: r.channelId, params: r.params }))) });
    },
    onSuccess: async () => {
      toast('Related items saved');
      await qc.invalidateQueries({ queryKey: catalogKeys.relations(level, itemId) });
      onClose();
    },
  });

  const edit = (k: RelationKind, rows: CatalogRelationRow[]) => {
    setOwn({ ...own!, [k]: rows });
    setChanged(new Set([...changed, k]));
  };
  const patch = (k: RelationKind, i: number, p: Partial<CatalogRelationRow> & { params?: Record<string, unknown> }) =>
    edit(k, own![k].map((r, j) => (j === i ? { ...r, ...p, params: p.params ? { ...r.params, ...p.params } : r.params } : r)));
  const remove = (k: RelationKind, i: number) => edit(k, own![k].filter((_, j) => j !== i));
  const blank = (k: RelationKind, params: Record<string, unknown>): CatalogRelationRow => ({ id: null, kind: k, channelId: null, params, inherited: false, from: null });

  const templateParams = (id: string) => {
    const g = lookups.graphicTemplates.find((t) => t.id === id);
    return {
      graphicTemplateId: id, startType: g?.startType ?? 'from-start', startOffsetFrames: g?.startOffsetFrames ?? 0, tcInFrames: g?.startTcInFrames ?? 0,
      endType: g?.endType ?? 'automatic', durationFrames: g?.endDurationFrames ?? 0, tcOutFrames: g?.endTcOutFrames ?? 0, frequency: g?.frequency ?? 'once',
      intervalFrames: g?.repeatIntervalFrames ?? 0, repetitions: g?.repeatCount ?? 0, layer: g?.layer ?? 'auto',
    };
  };

  const inherited = (k: RelationKind) => (rel.data?.rows ?? []).filter((r) => r.kind === k && r.inherited);
  const channelName = (id: string | null) => (id ? (lookups.channels.find((c) => c.id === id)?.name ?? '—') : 'Every channel');
  const channelSelect = (k: RelationKind, i: number, r: CatalogRelationRow) => (
    <select aria-label="Channel" className={SELECT} value={r.channelId ?? ''} onChange={(e) => patch(k, i, { channelId: e.target.value || null })}>
      <option value="">Every channel</option>
      {lookups.channels.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
  const short = (f: unknown) => formatTc(Number(f) || 0, rate).slice(0, 8);
  const startText = (p: Record<string, unknown>) =>
    p.startType === 'manual' ? 'Manual order' : p.startType === 'at-tc' ? `At TC ${short(p.tcInFrames)}` : `${GRAPHIC_START_TYPES.find((s) => s.value === p.startType)?.label ?? ''} ${short(p.startOffsetFrames)}`;
  const endText = (p: Record<string, unknown>) =>
    p.endType === 'duration' ? `Duration ${short(p.durationFrames)}` : p.endType === 'manual' ? `Manual ${short(p.tcOutFrames)}` : (GRAPHIC_END_TYPES.find((s) => s.value === p.endType)?.label ?? '');
  const inh = (r: CatalogRelationRow) => (
    <span className={r.inherited ? 'text-text' : 'text-text-3'} title={r.from ?? undefined}>
      {r.inherited ? 'Yes' : 'No'}
    </span>
  );
  const del = (k: RelationKind, i: number) => <IconButton icon="close" label="Remove row" size="xs" tone="quiet" onClick={() => remove(k, i)} />;

  let body: React.ReactNode = null;
  let add: { label: string; onClick: () => void; disabled?: boolean } | null = null;
  if (own && tab) {
    if (tab === 'linear') {
      const rows = [...inherited('linear'), ...own.linear];
      add = { label: 'Add sting', onClick: () => setPicking({ index: null }) };
      body = (
        <Table columns="70px 110px 140px minmax(160px,1fr) 150px 28px" head={['Inherited', 'Type', 'Position', 'Item', 'Channel', '']} minWidth={700}>
          {rows.map((r, idx) => {
            const i = idx - inherited('linear').length;
            const p = r.params;
            const prod = names[String(p.productionId)] ?? '—';
            return (
              <TableRow key={idx}>
                {inh(r)}
                {r.inherited ? <span>{p.jingle === 'post' ? 'Post-roll' : 'Pre-roll'}</span> : (
                  <select aria-label="Type" className={SELECT} value={String(p.jingle)} onChange={(e) => patch('linear', i, { params: { jingle: e.target.value } })}>
                    <option value="pre">Pre-roll</option>
                    <option value="post">Post-roll</option>
                  </select>
                )}
                {r.inherited ? <span>{SEGMENT_RULES.find((s) => s.value === p.segments)?.label}</span> : (
                  <select aria-label="Position" className={SELECT} value={String(p.segments)} onChange={(e) => patch('linear', i, { params: { segments: e.target.value } })}>
                    {SEGMENT_RULES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                )}
                {r.inherited ? <span className="truncate">{prod}</span> : (
                  <button type="button" onClick={() => setPicking({ index: i })} className="hov h-7 cursor-pointer truncate rounded-ctl border border-border-strong bg-surface px-2 text-left text-small" title="Change the sting">
                    {prod}
                  </button>
                )}
                {r.inherited ? <span className="truncate">{channelName(r.channelId)}</span> : channelSelect('linear', i, r)}
                {r.inherited ? <span /> : del('linear', i)}
              </TableRow>
            );
          })}
        </Table>
      );
      if (!rows.length) body = null;
    }
    if (tab === 'graphics') {
      const rows = [...inherited('graphics'), ...own.graphics];
      const first = lookups.graphicTemplates[0];
      add = { label: 'Add graphic', disabled: !first, onClick: () => first && edit('graphics', [...own.graphics, blank('graphics', { ...templateParams(first.id), segments: 'all' })]) };
      body = rows.length ? (
        <Table columns="70px minmax(150px,1fr) 120px 150px 140px 90px 70px 130px 28px" head={['Inherited', 'Graphic', 'Part', 'Start', 'End', 'Frequency', 'Layer', 'Channel', '']} minWidth={960}>
          {rows.map((r, idx) => {
            const i = idx - inherited('graphics').length;
            const p = r.params;
            return (
              <TableRow key={idx}>
                {inh(r)}
                {r.inherited ? <span className="truncate">{names[String(p.graphicTemplateId)] ?? '—'}</span> : (
                  <select aria-label="Graphic" className={SELECT} value={String(p.graphicTemplateId)} onChange={(e) => patch('graphics', i, { params: templateParams(e.target.value) })}>
                    {lookups.graphicTemplates.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
                {r.inherited ? <span>{SEGMENT_RULES.find((s) => s.value === p.segments)?.label}</span> : (
                  <select aria-label="Part" className={SELECT} value={String(p.segments)} onChange={(e) => patch('graphics', i, { params: { segments: e.target.value } })}>
                    {SEGMENT_RULES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                )}
                <span className="mono truncate">{startText(p)}</span>
                <span className="mono truncate">{endText(p)}</span>
                <span>{p.frequency === 'n-times' ? `${String(p.repetitions)} times` : p.frequency === 'until-end' ? 'Until end' : 'Once'}</span>
                {r.inherited ? <span>{p.layer === 'auto' ? 'Auto' : String(p.layer)}</span> : (
                  <select aria-label="Layer" className={SELECT} value={String(p.layer)} onChange={(e) => patch('graphics', i, { params: { layer: e.target.value } })}>
                    {GRAPHIC_LAYERS.map((l) => (
                      <option key={l} value={l}>
                        {l === 'auto' ? 'Auto' : l}
                      </option>
                    ))}
                  </select>
                )}
                {r.inherited ? <span className="truncate">{channelName(r.channelId)}</span> : channelSelect('graphics', i, r)}
                {r.inherited ? <span /> : del('graphics', i)}
              </TableRow>
            );
          })}
        </Table>
      ) : null;
    }
    if (tab === 'time-window') {
      const rows = [...inherited('time-window'), ...own['time-window']];
      const used = new Set(rows.map((r) => String(r.params.timeWindowId)));
      const next = lookups.timeWindows.find((w) => !used.has(w.id));
      add = { label: 'Add time window', disabled: !next, onClick: () => next && edit('time-window', [...own['time-window'], blank('time-window', { timeWindowId: next.id, rule: 'allowed' })]) };
      body = rows.length ? (
        <Table columns="minmax(160px,1fr) 120px 90px 90px 28px" head={['Time window', 'Rule', 'Inherited', 'Length', '']} minWidth={560}>
          {rows.map((r, idx) => {
            const i = idx - inherited('time-window').length;
            const w = lookups.timeWindows.find((x) => x.id === r.params.timeWindowId);
            return (
              <TableRow key={idx}>
                {r.inherited ? <span className="truncate">{w?.name ?? names[String(r.params.timeWindowId)]}</span> : (
                  <select aria-label="Time window" className={SELECT} value={String(r.params.timeWindowId)} onChange={(e) => patch('time-window', i, { params: { timeWindowId: e.target.value } })}>
                    {lookups.timeWindows.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                )}
                {r.inherited ? <span>{r.params.rule === 'rejected' ? 'Rejected' : 'Allowed'}</span> : (
                  <select aria-label="Rule" className={SELECT} value={String(r.params.rule)} onChange={(e) => patch('time-window', i, { params: { rule: e.target.value } })}>
                    <option value="allowed">Allowed</option>
                    <option value="rejected">Rejected</option>
                  </select>
                )}
                {inh(r)}
                <span className="mono">{w ? short(w.lengthFrames) : ''}</span>
                {r.inherited ? <span /> : del('time-window', i)}
              </TableRow>
            );
          })}
        </Table>
      ) : null;
    }
    if (tab === 'product-code') {
      const rows = [...inherited('product-code'), ...own['product-code']];
      const used = new Set(rows.map((r) => String(r.params.productCodeId)));
      const next = lookups.productCodes.find((c) => !used.has(c.id));
      add = lookups.productCodes.length ? { label: 'Add product code', disabled: !next, onClick: () => next && edit('product-code', [...own['product-code'], blank('product-code', { productCodeId: next.id })]) } : null;
      body = rows.length ? (
        <Table columns="minmax(160px,1fr) 100px 28px" head={['Product code', 'Inherited', '']} minWidth={420}>
          {rows.map((r, idx) => {
            const i = idx - inherited('product-code').length;
            return (
              <TableRow key={idx}>
                {r.inherited ? <span>{names[String(r.params.productCodeId)]}</span> : (
                  <select aria-label="Product code" className={SELECT} value={String(r.params.productCodeId)} onChange={(e) => patch('product-code', i, { params: { productCodeId: e.target.value } })}>
                    {lookups.productCodes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                {inh(r)}
                {r.inherited ? <span /> : del('product-code', i)}
              </TableRow>
            );
          })}
        </Table>
      ) : null;
    }
  }
  const empty: Record<RelationTab, string> = {
    linear: 'No stings around this item.',
    graphics: lookups.graphicTemplates.length ? 'No graphics on this item.' : 'No graphics on this item. There are no graphic templates yet (Graphics).',
    'time-window': lookups.timeWindows.length ? `No time windows. Defined in Settings: ${lookups.timeWindows.map((w) => w.name).join(', ')}.` : 'No time windows defined in Settings.',
    'product-code': lookups.productCodes.length ? 'No product codes on this item.' : 'No product codes defined in Settings.',
    rights: 'No rights bundles for this item. They come with the rights module.',
    history: 'Not broadcast yet. Broadcasts are listed here from approved day playlists once the Day playlist is built.',
  };
  const fixedHead: Partial<Record<RelationTab, string[]>> = {
    rights: ['Channel', 'Rights bundle', 'Start', 'End', 'Available showings'],
    history: ['Channel', 'Date and time', 'Block', 'Airing', 'From'],
  };
  const problems = save.error instanceof ApiError ? save.error.problems : [];

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        title="Related items"
        description={`${itemName} · ${entity.toLowerCase()}`}
        width={960}
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <span className="flex-[1_1_200px] text-meta text-text-3">Tabs with unsaved changes show !</span>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!changed.size || save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        }
      >
        {rel.isError && <Notice tone="red">{errorText(rel.error)}</Notice>}
        {rel.data && tab && (
          <>
            <TabBar label="Related items" value={tab} onChange={setTab} tabs={rel.data.tabs.map((t) => ({ value: t, label: TAB_LABEL[t], changed: changed.has(t as RelationKind) }))} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-small text-text-2">{HINT[tab]}</span>
              {add && (
                <Button size="sm" disabled={add.disabled} onClick={add.onClick}>
                  {add.label}
                </Button>
              )}
            </div>
            {body ?? (
              <Table columns={fixedHead[tab] ? `repeat(${fixedHead[tab]!.length}, minmax(0,1fr))` : '1fr'} head={fixedHead[tab] ?? ['']} minWidth={560}>
                <TableRow>
                  <span className="text-text-3">{empty[tab]}</span>
                </TableRow>
              </Table>
            )}
          </>
        )}
        {save.error && (
          <Notice tone="red">
            <span>{errorText(save.error)}</span>
            {problems.length > 1 && (
              <ul className="m-0 pl-4">
                {problems.map((p) => (
                  <li key={p.message}>{p.message}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
      </Dialog>
      {picking && own && (
        <CatalogPicker
          pick="one"
          families={['filling', 'program']}
          frameRate={lookups.frameRate}
          title="Pick a sting"
          context={`Around ${itemName}`}
          triggerStyle="none"
          open
          onOpenChange={(o) => !o && setPicking(null)}
          onPick={(r) => {
            const it = r.items[0];
            if (!it) return;
            setNames({ ...names, [it.productionId]: it.title });
            if (picking.index === null) edit('linear', [...own.linear, blank('linear', { jingle: 'pre', segments: 'first', productionId: it.productionId })]);
            else patch('linear', picking.index, { params: { productionId: it.productionId } });
            setPicking(null);
          }}
        />
      )}
    </>
  );
}
