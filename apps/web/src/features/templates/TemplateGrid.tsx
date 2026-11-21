// The week grid of the open template: seven weekday columns (no dates), blocks in their colour.

import { useMemo, useState, type MutableRefObject } from 'react';
import { WEEKDAYS, blocksOfDay, breaksAtPositions, checkBlock, copyDay, daySignature, endOf, setActiveDay, snapStart, typeInDates, uuidv7, type BlockDraft, type Problem, type TemplateDraft } from '@9eye/core';
import {
  Button,
  Checkbox,
  IconButton,
  Menu,
  MenuItem,
  Notice,
  Popover,
  PopoverFooter,
  PopoverTitle,
  WeekGrid,
  ZOOM_LEVELS,
  useToast,
  type WeekGridColumn,
  type WeekGridDrag,
  type WeekGridPlace,
} from '@/ui';
import { clock, dayName, nextOfSeries, range, seriesOf, typeColor, typeName, type DragSource, type PageCtx, type Placing } from './model';

export interface ShowOnBlocks {
  headers: boolean;
  events: boolean;
  overlap: boolean;
  notes: boolean;
}

export function TemplateGrid({
  ctx,
  draft,
  selectedId,
  zoom,
  show,
  onSelect,
  onChange,
  onAddOnDay,
  onRepeat,
  onDropped,
  dragSource,
  placing,
}: {
  ctx: PageCtx;
  draft: TemplateDraft;
  selectedId: string | null;
  zoom: number;
  show: ShowOnBlocks;
  onSelect: (id: string | null) => void;
  onChange: (d: TemplateDraft) => void;
  onAddOnDay: (weekday: number) => void;
  /** "Repeat a time range…" of a day. */
  onRepeat: (weekday: number) => void;
  /** After a drop: the new or moved block (defaults to selecting it). */
  onDropped?: (id: string) => void;
  /** Shared with the Block types panel, which starts drags of block types. */
  dragSource: MutableRefObject<DragSource | null>;
  /** A block type armed for placing by clicking (null = off). */
  placing?: Placing | null;
}) {
  const toast = useToast();
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [copyTo, setCopyTo] = useState<Record<number, boolean>>({});
  const [copyError, setCopyError] = useState<string | null>(null);

  const first = ctx.order[0];
  const overlapping = useMemo(() => {
    const ids = new Set<string>();
    if (!show.overlap) return ids;
    for (const d of ctx.order) {
      const day = blocksOfDay(draft.blocks, d);
      for (let i = 1; i < day.length; i++) {
        if (day[i].startFrames < endOf(day[i - 1])) {
          ids.add(day[i].id);
          ids.add(day[i - 1].id);
        }
      }
    }
    return ids;
  }, [draft.blocks, ctx.order, show.overlap]);

  const firstSig = daySignature(draft.blocks, first);
  const columns: WeekGridColumn[] = ctx.order.map((d) => {
    const active = !!draft.activeWeekdays[d];
    const sig = daySignature(draft.blocks, d);
    const chip = !active
      ? { label: 'Not active', tone: 'neutral' as const }
      : d === first
        ? undefined
        : sig === firstSig
          ? { label: `Same as ${WEEKDAYS[first].short}`, tone: 'neutral' as const }
          : { label: 'Own layout', tone: 'amber' as const };
    const others = ctx.order.filter((x) => x !== d);
    return {
      key: d,
      title: dayName(d),
      chip,
      inactive: !active,
      blocks: blocksOfDay(draft.blocks, d).map((b) => {
        const name = typeName(ctx, b.blockTypeId);
        const nb = ctx.allowsBreaks ? b.breaks.length : 0;
        const lines: string[] = [];
        if (show.events && ctx.allowsBreaks) {
          lines.push(...b.breaks.map((k) => typeName(ctx, k)), 'Gap holder');
        }
        if (show.notes && b.note) lines.push(b.note);
        return {
          id: b.id,
          start: b.startFrames,
          length: b.lengthFrames,
          color: typeColor(ctx, b.blockTypeId) ?? '#9b9b9b',
          title: name,
          time: range(ctx, b),
          badge: nb,
          selected: b.id === selectedId,
          warn: overlapping.has(b.id),
          lines,
          showText: show.headers,
          ghost: b.id === draggingId,
          ariaLabel: `${dayName(d)}, ${clock(ctx, b.startFrames)} to ${clock(ctx, endOf(b))}, ${name}${nb ? `, ${nb} linked breaks` : ''}${b.note ? `, note: ${b.note}` : ''}`,
        };
      }),
      action: (
        <>
          <Menu
            label={`${dayName(d)} actions`}
            width={210}
            trigger={<IconButton icon="more" label={`${dayName(d)} actions`} size="xs" tone="quiet" />}
          >
            <MenuItem
              onSelect={() => {
                setCopyTo({});
                setCopyError(null);
                setCopyFrom(d);
              }}
            >
              Copy this day to…
            </MenuItem>
            <MenuItem onSelect={() => onAddOnDay(d)}>Add a block on this day</MenuItem>
            <MenuItem onSelect={() => onRepeat(d)}>Repeat a time range…</MenuItem>
            <MenuItem onSelect={() => onChange(setActiveDay(draft, d, !active))}>{active ? 'Make this day not active' : 'Make this day active'}</MenuItem>
          </Menu>
          <Popover
            open={copyFrom === d}
            onOpenChange={(o) => !o && setCopyFrom(null)}
            label={`Copy ${dayName(d)} to`}
            width={240}
            align="end"
            anchor={<span className="pointer-events-none absolute right-1 top-[44px] h-0 w-0" />}
          >
            <PopoverTitle>Copy {dayName(d)} to</PopoverTitle>
            {others.map((o) => (
              <Checkbox key={o} checked={!!copyTo[o]} onChange={(v) => setCopyTo({ ...copyTo, [o]: v })}>
                {dayName(o)}
              </Checkbox>
            ))}
            <span className="text-meta text-text-3">The blocks of those days are replaced.</span>
            {copyError && <Notice tone="amber">{copyError}</Notice>}
            <PopoverFooter>
              <Button variant="ghost" size="sm" onClick={() => setCopyFrom(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!others.some((o) => copyTo[o])}
                onClick={() => {
                  const r = copyDay(draft, d, others.filter((o) => copyTo[o]), ctx.rule, uuidv7);
                  if (!r.ok) {
                    setCopyError(`Nothing was copied. ${r.problems[0].message}${r.problems.length > 1 ? ` (+${r.problems.length - 1} more)` : ''}`);
                    return;
                  }
                  onChange(r.draft);
                  setCopyFrom(null);
                }}
              >
                Copy
              </Button>
            </PopoverFooter>
          </Popover>
        </>
      ),
    };
  });

  // ------------------------------------------------------------ drag and drop
  // Snapping follows the zoom, in screen distance: blocks land on 1-minute steps when a minute is
  // at least 2.5 px tall (5-minute steps otherwise), and stick to a neighbour's edge or the day's
  // start / end only within a few pixels — so at a deep zoom any minute can be reached.
  // Moving keeps everything of the block (as changing its start does); Ctrl / Alt copies it.
  const hourPx = ZOOM_LEVELS[zoom];
  const pxToFrames = (px: number) => Math.round((px / hourPx) * ctx.fph);
  const step = hourPx / 60 >= 2.5 ? Math.round(ctx.fph / 60) : Math.round(ctx.fph / 12);
  const magnet = pxToFrames(6);
  const target = (weekday: number, frames: number, copy: boolean): { block: BlockDraft; problems: Problem[]; isNew: boolean; moved: boolean } | null => {
    const src = dragSource.current;
    if (!src) return null;
    if (src.kind === 'move') {
      const b = draft.blocks.find((x) => x.id === src.blockId);
      if (!b) return null;
      const start = snapStart(draft.blocks, weekday, frames - src.grab, b.lengthFrames, { step, magnet, dayFrames: ctx.dayFrames, exceptId: copy ? undefined : b.id });
      const block = { ...b, id: copy ? uuidv7() : b.id, weekday, startFrames: start, breaks: b.breaks.slice() };
      const others = copy ? draft.blocks : draft.blocks.filter((x) => x.id !== b.id);
      return { block, problems: checkBlock(block, others, ctx.rule), isNew: copy, moved: copy || weekday !== b.weekday || start !== b.startFrames };
    }
    const t = ctx.types.get(src.typeId);
    if (!t) return null;
    const start = snapStart(draft.blocks, weekday, frames, t.lengthFrames, { step, magnet, dayFrames: ctx.dayFrames });
    const block: BlockDraft = {
      id: uuidv7(), weekday, blockTypeId: t.id, startFrames: start, lengthFrames: t.lengthFrames, fillGaps: t.fillGaps, opensWithBreak: t.opensWithBreak,
      note: '', rotationListId: null, limitsPerContentType: [], breaks: [],
    };
    const problems: Problem[] = [];
    if (src.breaks && ctx.allowsBreaks) {
      const ids = breaksAtPositions(src.breaks, block, ctx.adsDays);
      if (ids) block.breaks = ids;
      else problems.push({ code: 'break-list', message: `The chosen break list does not fit ${t.name} at ${range(ctx, block)}: it has fewer ads-template breaks there.` });
    }
    if (t.kind !== ctx.kind) problems.push({ code: 'weekday', message: `${t.name} is a block type of the ${t.kind} playlist; this is the ${ctx.kind} layout.` });
    else if (!typeInDates(t, draft.validFrom, draft.validTo)) problems.push({ code: 'weekday', message: `${t.name} is not valid in this layout's dates.` });
    return { block, problems: [...problems, ...checkBlock(block, draft.blocks, ctx.rule)], isNew: true, moved: true };
  };
  const SHORT: Partial<Record<string, string>> = { 'break-list': 'Break list does not fit', overlap: 'Overlaps a block', 'type-twice': 'Already on this day', weekday: 'Not valid here', 'outside-day': 'Past the day end' };
  const drag: WeekGridDrag = {
    onBlockDragStart: (id, _col, grab) => {
      dragSource.current = { kind: 'move', blockId: id, grab };
      setTimeout(() => setDraggingId(id), 0);
    },
    onDragOver: (weekday, frames, copy) => {
      const t = target(weekday, frames, copy);
      if (!t) return null;
      const time = `${range(ctx, t.block)}${dragSource.current?.kind === 'move' && copy ? ' · copy' : ''}`;
      return { start: t.block.startFrames, length: t.block.lengthFrames, ok: !t.problems.length, label: time, reason: t.problems.length ? (SHORT[t.problems[0].code] ?? 'not allowed') : undefined };
    },
    onDrop: (weekday, frames, copy) => {
      const t = target(weekday, frames, copy);
      dragSource.current = null;
      setDraggingId(null);
      if (!t || !t.moved) return;
      if (t.problems.length) {
        toast(t.problems[0].message, 'red');
        return;
      }
      onChange({ ...draft, blocks: t.isNew ? [...draft.blocks, t.block] : draft.blocks.map((x) => (x.id === t.block.id ? t.block : x)) });
      (onDropped ?? onSelect)(t.block.id);
    },
    onDragEnd: () => {
      dragSource.current = null;
      setDraggingId(null);
    },
  };

  // ------------------------------------------------------------ placing by clicking
  // A click puts the armed block type at the clicked time (same steps; pulled to an edge within
  // 8 px); on a day that already has it, the next type of its numbered series.
  const placeMagnet = pxToFrames(8);
  const placeTarget = (weekday: number, frames: number): { block: BlockDraft | null; problems: Problem[]; label: string; name: string } | null => {
    if (!placing) return null;
    const armed = ctx.types.get(placing.typeId);
    if (!armed) return null;
    const t = nextOfSeries(ctx, draft, armed, weekday);
    if (!t) {
      const { base, types } = seriesOf(ctx, armed);
      const why = types.length > 1 ? `All ${types.length} block types of ${base} are used on ${dayName(weekday)}.` : `${armed.name} is already used on ${dayName(weekday)}.`;
      return { block: null, problems: [{ code: 'type-twice', message: why }], label: armed.name, name: armed.name };
    }
    const start = snapStart(draft.blocks, weekday, frames, t.lengthFrames, { step, magnet: placeMagnet, dayFrames: ctx.dayFrames });
    const block: BlockDraft = {
      id: uuidv7(), weekday, blockTypeId: t.id, startFrames: start, lengthFrames: t.lengthFrames, fillGaps: t.fillGaps, opensWithBreak: t.opensWithBreak,
      note: '', rotationListId: null, limitsPerContentType: [], breaks: [],
    };
    const problems: Problem[] = [];
    if (placing.breaks && ctx.allowsBreaks) {
      const ids = breaksAtPositions(placing.breaks, block, ctx.adsDays);
      if (ids) block.breaks = ids;
      else problems.push({ code: 'break-list', message: `The chosen break list does not fit ${t.name} at ${range(ctx, block)}: it has fewer ads-template breaks there.` });
    }
    problems.push(...checkBlock(block, draft.blocks, ctx.rule));
    return { block, problems, label: range(ctx, block), name: t.name };
  };
  const place: WeekGridPlace | undefined = placing
    ? {
        onHover: (weekday, frames) => {
          const t = placeTarget(weekday, frames);
          if (!t) return null;
          const length = t.block?.lengthFrames ?? ctx.types.get(placing.typeId)!.lengthFrames;
          const start = t.block?.startFrames ?? Math.min(Math.max(0, Math.round(frames / step) * step), ctx.dayFrames - length);
          return { start, length, ok: !t.problems.length, label: t.label, note: t.name, reason: t.problems.length ? (t.block ? (SHORT[t.problems[0].code] ?? 'Not allowed') : 'Series used up on this day') : undefined };
        },
        onPlace: (weekday, frames) => {
          const t = placeTarget(weekday, frames);
          if (!t) return;
          if (!t.block || t.problems.length) {
            toast(t.problems[0].message, 'red');
            return;
          }
          onChange({ ...draft, blocks: [...draft.blocks, t.block] });
          (onDropped ?? onSelect)(t.block.id);
        },
      }
    : undefined;

  const hourLabels = Array.from({ length: 24 }, (_, i) => clock(ctx, i * ctx.fph));
  return (
    <WeekGrid
      columns={columns}
      hourLabels={hourLabels}
      framesPerHour={ctx.fph}
      hourHeight={ZOOM_LEVELS[zoom]}
      onBlockClick={(id) => onSelect(id === selectedId ? null : id)}
      drag={drag}
      place={place}
    />
  );
}
