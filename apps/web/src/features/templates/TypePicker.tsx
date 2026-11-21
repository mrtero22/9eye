// Searchable list of the block types a block can use on a weekday (Add block, Change block type).

import { useMemo, useState, type ReactElement } from 'react';
import { typeInDates, type TemplateDraft } from '@9eye/core';
import type { BlockType } from '@/lib/types';
import { Popover, PopoverTitle, SearchField, Swatch, cx } from '@/ui';
import { dayName, lengthWords, type PageCtx } from './model';

export function useTypeChoices(ctx: PageCtx, draft: TemplateDraft, weekday: number, exceptBlockId: string | null, query: string, preferId?: string) {
  return useMemo(() => {
    const playlistId = [...ctx.types.values()].find((t) => t.id === preferId)?.playlistId;
    const own = ctx.kind === 'main' ? ctx.channel.mainPlaylistId : ctx.channel.adsPlaylistId;
    const used = new Set(draft.blocks.filter((b) => b.weekday === weekday && b.id !== exceptBlockId).map((b) => b.blockTypeId));
    const q = query.trim().toLowerCase();
    return [...ctx.types.values()]
      .filter((t) => t.kind === ctx.kind && t.validWeekdays[weekday] && typeInDates(t, draft.validFrom, draft.validTo))
      .filter((t) => !q || t.name.toLowerCase().includes(q) || (ctx.groups.get(t.groupId)?.name ?? '').toLowerCase().includes(q))
      .map((t) => ({ type: t, used: used.has(t.id), own: t.playlistId === own || t.playlistId === playlistId }))
      .sort((a, b) => Number(b.own) - Number(a.own) || a.type.name.localeCompare(b.type.name, undefined, { numeric: true }));
  }, [ctx, draft.blocks, draft.validFrom, draft.validTo, weekday, exceptBlockId, query, preferId]);
}

export function TypeList({
  ctx,
  items,
  onPick,
  onDrag,
  selectedId,
  pickUsed,
  max = 200,
}: {
  ctx: PageCtx;
  items: ReturnType<typeof useTypeChoices>;
  onPick: (t: BlockType) => void;
  /** Highlighted row (the type armed for placing). */
  selectedId?: string | null;
  /** Rows used on the panel's day can still be picked (placing works on any day). */
  pickUsed?: boolean;
  /** When given, rows can be dragged onto the week grid (null when the drag ends). */
  onDrag?: (t: BlockType | null) => void;
  max?: number;
}) {
  return (
    <div className="flex max-h-[420px] flex-col overflow-y-auto">
      {items.slice(0, max).map(({ type: t, used: usedHere, own }) => {
        const used = usedHere && !pickUsed;
        return (
        <button
          key={t.id}
          type="button"
          aria-disabled={used || undefined}
          aria-pressed={selectedId !== undefined && selectedId !== null ? t.id === selectedId : undefined}
          onClick={() => !used && onPick(t)}
          draggable={!!onDrag}
          onDragStart={
            onDrag &&
            ((e) => {
              e.dataTransfer.effectAllowed = 'copyMove';
              e.dataTransfer.setData('text/plain', t.name);
              onDrag(t);
            })
          }
          onDragEnd={onDrag && (() => onDrag(null))}
          title={used ? `${t.name} is already used on this day${onDrag ? '; drag it onto another day' : ''}` : onDrag ? 'Click to add here, or drag onto a day' : undefined}
          className={cx(
            'hov flex min-h-10 items-center gap-2.5 rounded-item border-0 px-2.5 py-1 text-left',
            t.id === selectedId ? 'bg-accent-soft' : 'bg-transparent',
            used ? 'cursor-default opacity-45' : 'cursor-pointer',
            onDrag && 'active:cursor-grabbing',
          )}
        >
          <Swatch color={t.color} />
          <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
            <span className="truncate font-medium">{t.name}</span>
            <span className="truncate text-small text-text-3">
              {ctx.groups.get(t.groupId)?.name ?? '—'} · {lengthWords(ctx, t.lengthFrames)}
              {!own && ` · ${t.channelName}`}
              {usedHere && !pickUsed && ' · used on this day'}
            </span>
          </span>
        </button>
        );
      })}
      {items.length > max && <span className="px-2.5 py-1.5 text-meta text-text-3">{items.length - max} more — search to narrow the list.</span>}
      {!items.length && <span className="px-2.5 py-1.5 text-small text-text-3">No block type fits this day.</span>}
    </div>
  );
}

export function TypePicker({
  ctx,
  draft,
  weekday,
  exceptBlockId,
  trigger,
  label,
  onPick,
}: {
  ctx: PageCtx;
  draft: TemplateDraft;
  weekday: number;
  exceptBlockId: string | null;
  trigger: ReactElement;
  label: string;
  onPick: (t: BlockType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const items = useTypeChoices(ctx, draft, weekday, exceptBlockId, q);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }} label={label} width={340} align="end" trigger={trigger}>
      <PopoverTitle hint={`Block types valid on ${dayName(weekday)} in this layout's dates. Start and length stay.`}>{label}</PopoverTitle>
      <SearchField value={q} onChange={setQ} placeholder="Search block types" label="Search block types" size="sm" autoFocus />
      <TypeList
        ctx={ctx}
        items={items}
        onPick={(t) => {
          onPick(t);
          setOpen(false);
          setQ('');
        }}
      />
    </Popover>
  );
}
