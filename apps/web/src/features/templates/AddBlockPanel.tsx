// "Add block": 1 · where (day, start), 2 · breaks inside (a break list), 3 · block type.

import { useEffect, useState } from 'react';
import { addBlock, blocksOfDay, breaksAtPositions, endOf, uuidv7, type BlockDraft, type TemplateDraft } from '@9eye/core';
import type { BlockType, BreakList } from '@/lib/types';
import { CommitField, Field, Notice, SearchField, Segmented, SelectField } from '@/ui';
import { clockTc, dayName, parseClock, typeName, type PageCtx } from './model';
import { TypeList, useTypeChoices } from './TypePicker';

/** First free time on a day: after the selected block, else the end of the first gap from the day start. */
function firstFree(draft: TemplateDraft, weekday: number): number {
  let t = 0;
  for (const b of blocksOfDay(draft.blocks, weekday)) {
    if (b.startFrames > t) break;
    t = Math.max(t, endOf(b));
  }
  return t;
}

export function AddBlockPanel({
  ctx,
  draft,
  lists,
  after,
  initialDay,
  initialQuery,
  onAdded,
  onDrag,
  armedId,
  onArm,
}: {
  ctx: PageCtx;
  draft: TemplateDraft;
  lists: BreakList[];
  /** The selected block: the new one goes right after it. */
  after: BlockDraft | null;
  initialDay: number;
  initialQuery?: string;
  onAdded: (d: TemplateDraft, block: BlockDraft) => void;
  /** A block type is dragged from the list towards the grid, with the break list chosen here. */
  onDrag: (t: BlockType | null, breakPositions: number[] | null) => void;
  /** The block type armed for placing by clicking on the grid, if it was armed here. */
  armedId: string | null;
  onArm: (t: BlockType | null, breakPositions: number[] | null) => void;
}) {
  const [day, setDay] = useState(after?.weekday ?? initialDay);
  const [start, setStart] = useState(after ? endOf(after) : firstFree(draft, initialDay));
  const [listId, setListId] = useState('');
  const [q, setQ] = useState(initialQuery ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDay(after?.weekday ?? initialDay);
    setStart(after ? endOf(after) : firstFree(draft, initialDay));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after?.id, initialDay]);
  useEffect(() => setQ(initialQuery ?? ''), [initialQuery]);
  const items = useTypeChoices(ctx, draft, day, null, q);
  const [mode, setMode] = useState<'add' | 'place'>(armedId ? 'place' : 'add');
  const positions = ctx.allowsBreaks ? (lists.find((l) => l.id === listId)?.positions ?? null) : null;
  // the armed type follows the break list chosen here
  useEffect(() => {
    const t = armedId ? ctx.types.get(armedId) : undefined;
    if (t) onArm(t, positions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);
  const step = mode === 'place' ? (ctx.allowsBreaks ? 2 : 1) : ctx.allowsBreaks ? 3 : 2;

  const add = (t: BlockType) => {
    const base = { id: uuidv7(), weekday: day, blockTypeId: t.id, startFrames: start, lengthFrames: t.lengthFrames, fillGaps: t.fillGaps, opensWithBreak: t.opensWithBreak, note: '', rotationListId: null, limitsPerContentType: [] };
    let breaks: string[] = [];
    const list = lists.find((l) => l.id === listId);
    if (ctx.allowsBreaks && list) {
      const ids = breaksAtPositions(list.positions, base, ctx.adsDays);
      if (!ids) {
        setError(`"${list.name}" does not fit: ${t.name} at this time has fewer ads-template breaks than the list needs. Nothing was added.`);
        return;
      }
      breaks = ids;
    }
    const block: BlockDraft = { ...base, breaks };
    const r = addBlock(draft, block, ctx.rule);
    if (!r.ok) {
      setError(r.problems[0].message);
      return;
    }
    setError(null);
    onAdded(r.draft, block);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <Segmented
        label="How to add"
        size="sm"
        value={mode}
        onChange={(v) => {
          setMode(v);
          if (v === 'add') onArm(null, null);
        }}
        options={[
          { value: 'add', label: 'Add at a time' },
          { value: 'place', label: 'Place on the grid' },
        ]}
      />
      {mode === 'add' && (
      <div className="flex flex-col gap-2">
        <span className="text-small text-text-3">1 · Where</span>
        <div className="grid grid-cols-2 gap-2.5">
          <SelectField
            label="Day"
            value={day}
            onChange={(e) => {
              const d = Number(e.target.value);
              setDay(d);
              if (!after) setStart(firstFree(draft, d));
            }}
          >
            {ctx.order.map((d) => (
              <option key={d} value={d}>
                {dayName(d)}
              </option>
            ))}
          </SelectField>
          <Field label="Start">
            <CommitField value={start} format={(v) => clockTc(ctx, v)} parse={(s) => parseClock(ctx, s)} onCommit={(v) => setStart(v)} ariaLabel="Start" />
          </Field>
        </div>
        <span className="text-meta text-text-3">
          {after && after.weekday === day ? `Right after ${typeName(ctx, after.blockTypeId)}. Blocks may not overlap.` : 'Pick a block first to add right after it. Blocks may not overlap.'}
        </span>
      </div>
      )}
      {ctx.allowsBreaks && (
        <div className="flex flex-col gap-2">
          <span className="text-small text-text-3">{mode === 'place' ? '1' : '2'} · Breaks inside</span>
          <SelectField label={<span className="sr-only">Break list</span>} value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">No breaks</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.positions.length} {l.positions.length === 1 ? 'break' : 'breaks'}
              </option>
            ))}
          </SelectField>
          <span className="text-meta text-text-3">Breaks are matched by position among the ads-template breaks inside the new block's time. You can change them after adding.</span>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-small text-text-3">{step} · Block type</span>
        <SearchField value={q} onChange={setQ} placeholder="Search block types" label="Search block types" />
        {error && <Notice tone="amber">{error}</Notice>}
        <TypeList
          ctx={ctx}
          items={items}
          selectedId={mode === 'place' ? armedId : null}
          onPick={(t) => (mode === 'place' ? onArm(armedId === t.id ? null : t, positions) : add(t))}
          pickUsed={mode === 'place'}
          onDrag={(t) => onDrag(t, positions)}
        />
        <span className="text-meta text-text-3">
          {mode === 'place'
            ? 'Pick a block type, then click a day in the grid for each block. On a day that has it, the next number of its series goes in (RUN 1, RUN 2, …).'
            : 'Click a block type to add it at the time above, or drag it onto a day.'}
        </span>
      </div>
    </div>
  );
}
