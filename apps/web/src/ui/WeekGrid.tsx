// Timeline editor: seven day columns on an hour axis from the channel's day start.
// Used by Templates (and later by Weeks). Positions come in frames; the grid turns them into pixels.

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Chip, type Tone } from './Badge';
import { cx } from './cx';
import { dataTint } from './color';
import { Icon } from './icons';

export interface WeekGridBlock {
  id: string;
  start: number;
  length: number;
  color: string;
  title: string;
  time: string;
  ariaLabel: string;
  badge?: number;
  selected?: boolean;
  /** Shown with a red border (e.g. overlap). */
  warn?: boolean;
  /** Extra lines under the title when the block is tall enough (events, notes). */
  lines?: string[];
  /** false = colour only, no text (block headers switched off). */
  showText?: boolean;
  /** Faded while it is being dragged. */
  ghost?: boolean;
}

export interface WeekGridColumn {
  key: number;
  title: string;
  chip?: { label: string; tone: Tone };
  inactive?: boolean;
  blocks: WeekGridBlock[];
  /** Right side of the column header (the day's ⋯ menu). */
  action?: ReactNode;
}

/** Pixels per hour. The deepest levels make 5-minute blocks (ads breaks) readable. */
export const ZOOM_LEVELS = [24, 32, 48, 72, 120, 180, 270, 400];

/** Where a dragged block would land, as the page judges it. */
export interface DropPreview {
  start: number;
  length: number;
  ok: boolean;
  label: string;
  /** Why it cannot land there (second line, red). */
  reason?: string;
  /** What would land there (second line when it can), e.g. the block type's name. */
  note?: string;
}

/**
 * Drag and drop: blocks can be dragged within the grid, and things dragged from elsewhere (e.g. a
 * block type) can be dropped on a column. Frames are measured from the top of the column.
 */
export interface WeekGridDrag {
  onBlockDragStart: (blockId: string, columnKey: number, grabFrames: number) => void;
  onDragOver: (columnKey: number, frames: number, copy: boolean) => DropPreview | null;
  onDrop: (columnKey: number, frames: number, copy: boolean) => void;
  onDragEnd: () => void;
}

const wantsCopy = (e: DragEvent) => e.ctrlKey || e.altKey || e.metaKey;

/**
 * Placing by clicking: while it is on, hovering an empty spot of a column shows where a block
 * would go and a click puts it there. Clicks on blocks still select them.
 */
export interface WeekGridPlace {
  onHover: (columnKey: number, frames: number) => DropPreview | null;
  onPlace: (columnKey: number, frames: number) => void;
}

export function WeekGrid({
  columns,
  hourLabels,
  framesPerHour,
  hourHeight,
  onBlockClick,
  drag,
  place,
  maxHeight = 'min(820px, calc(100vh - 220px))',
}: {
  columns: WeekGridColumn[];
  hourLabels: string[];
  framesPerHour: number;
  hourHeight: number;
  onBlockClick: (blockId: string, columnKey: number) => void;
  drag?: WeekGridDrag;
  place?: WeekGridPlace;
  maxHeight?: string;
}) {
  const height = hourLabels.length * hourHeight;
  const px = (frames: number) => (frames / framesPerHour) * hourHeight;
  // Zooming keeps the hour in the middle of the view where it was.
  const scroller = useRef<HTMLDivElement>(null);
  const lastHour = useRef(hourHeight);
  useLayoutEffect(() => {
    const el = scroller.current;
    const prev = lastHour.current;
    lastHour.current = hourHeight;
    if (!el || prev === hourHeight) return;
    const head = (el.firstElementChild?.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
    const middle = (el.scrollTop + el.clientHeight / 2 - head) / prev;
    el.scrollTop = Math.max(0, middle * hourHeight + head - el.clientHeight / 2);
  }, [hourHeight]);
  const [preview, setPreview] = useState<(DropPreview & { col: number }) | null>(null);
  useEffect(() => {
    if (!drag) return;
    const end = () => {
      setPreview(null);
      drag.onDragEnd();
    };
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  }, [drag]);
  const framesAt = (e: { clientY: number }, el: HTMLElement) => ((e.clientY - el.getBoundingClientRect().top) / hourHeight) * framesPerHour;
  const showPreview = (col: number, p: DropPreview | null) =>
    setPreview((old) =>
      !p ? (old?.col === col ? null : old) : old && old.col === col && old.start === p.start && old.ok === p.ok && old.label === p.label && old.reason === p.reason && old.note === p.note ? old : { ...p, col },
    );
  const onBlock = (t: EventTarget) => !!(t as HTMLElement).closest('button');
  useEffect(() => {
    if (!place) setPreview(null);
  }, [place]);
  const cols = { gridTemplateColumns: `56px repeat(${columns.length}, minmax(96px, 1fr))` };
  return (
    <div ref={scroller} className="print-full overflow-auto rounded-card border border-border bg-surface" style={{ maxHeight }}>
      <div className="min-w-[760px]">
        <div className="sticky top-0 z-[5] grid border-b border-border bg-surface" style={cols}>
          <div />
          {columns.map((c) => (
            <div key={c.key} className="relative flex min-h-[52px] items-center gap-1 py-1.5 pl-2.5 pr-1">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-[1.2]">
                <span className={cx('font-semibold', c.inactive ? 'text-text-3' : 'text-text')}>{c.title}</span>
                {c.chip && <Chip tone={c.chip.tone}>{c.chip.label}</Chip>}
              </span>
              {c.action}
            </div>
          ))}
        </div>
        <div className="grid" style={cols}>
          <div className="relative" style={{ height }}>
            {hourLabels.map((h, i) => (
              <div key={i} className="mono absolute right-3 pt-1 text-tiny leading-[14px] text-text-3" style={{ top: i * hourHeight }}>
                {h}
              </div>
            ))}
          </div>
          {columns.map((c) => (
            <div
              key={c.key}
              className={cx('relative border-l border-hairline', c.inactive && 'bg-surface-2', place && 'cursor-crosshair')}
              style={{ height }}
              onMouseMove={
                place &&
                ((e) => {
                  if (onBlock(e.target)) showPreview(c.key, null);
                  else showPreview(c.key, place.onHover(c.key, framesAt(e, e.currentTarget)));
                })
              }
              onMouseLeave={place && (() => showPreview(c.key, null))}
              onClick={
                place &&
                ((e) => {
                  if (onBlock(e.target)) return;
                  place.onPlace(c.key, framesAt(e, e.currentTarget));
                  showPreview(c.key, null);
                })
              }
              onDragOver={
                drag &&
                ((e) => {
                  const p = drag.onDragOver(c.key, framesAt(e, e.currentTarget), wantsCopy(e));
                  if (!p) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = wantsCopy(e) ? 'copy' : 'move';
                  setPreview((old) => (old && old.col === c.key && old.start === p.start && old.ok === p.ok && old.label === p.label && old.reason === p.reason && old.note === p.note ? old : { ...p, col: c.key }));
                })
              }
              onDragLeave={
                drag &&
                ((e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPreview((old) => (old?.col === c.key ? null : old));
                })
              }
              onDrop={
                drag &&
                ((e) => {
                  e.preventDefault();
                  drag.onDrop(c.key, framesAt(e, e.currentTarget), wantsCopy(e));
                  setPreview(null);
                })
              }
            >
              {/* A line at every hour, so a block's start and end read against the hour axis. */}
              {hourLabels.map((_, i) =>
                i === 0 ? null : <div key={`h${i}`} aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-px bg-border opacity-60" style={{ top: i * hourHeight }} />,
              )}
              {c.blocks.map((b) => {
                const h = Math.max(px(b.length) - 4, 3);
                const showText = b.showText !== false;
                const hasBadge = !!b.badge && h >= 16 && showText;
                const showName = h >= 16 && showText;
                const tall = h >= 44 && showText;
                const room = Math.max(0, Math.floor((h - 44) / 14));
                const lines = tall ? (b.lines ?? []).slice(0, room) : [];
                return (
                  <button
                    key={b.id}
                    type="button"
                    draggable={!!drag}
                    onDragStart={
                      drag &&
                      ((e) => {
                        e.dataTransfer.effectAllowed = 'copyMove';
                        e.dataTransfer.setData('text/plain', b.title);
                        drag.onBlockDragStart(b.id, c.key, framesAt(e, e.currentTarget.parentElement!) - b.start);
                      })
                    }
                    onClick={() => onBlockClick(b.id, c.key)}
                    aria-pressed={!!b.selected}
                    aria-label={b.ariaLabel}
                    title={b.ariaLabel}
                    className="absolute left-[3px] right-[3px] flex cursor-pointer flex-col justify-center gap-px overflow-hidden rounded-ctl border text-left text-text"
                    style={{
                      top: px(b.start) + 2,
                      height: h,
                      padding: `0 ${hasBadge ? 30 : 8}px 0 8px`,
                      background: dataTint(b.color, 16),
                      borderColor: b.warn ? 'var(--red)' : dataTint(b.color, 50),
                      outline: b.selected ? '2px solid var(--accent)' : 'none',
                      outlineOffset: 1,
                      opacity: b.ghost ? 0.35 : c.inactive ? 0.45 : 1,
                    }}
                  >
                    {hasBadge && (
                      <span title="Linked breaks" className="absolute right-[5px] inline-flex items-center gap-0.5 text-[10.5px] leading-[14px] text-text-3" style={{ top: h >= 44 ? 4 : Math.max(0, (h - 14) / 2) }}>
                        <Icon name="link" size={9} strokeWidth={2.25} />
                        <span className="mono">{b.badge}</span>
                      </span>
                    )}
                    {showName && <span className="w-full truncate text-meta font-medium">{b.title}</span>}
                    {tall && <span className="mono text-tiny text-text-3">{b.time}</span>}
                    {lines.map((l, i) => (
                      <span key={i} className="w-full truncate text-tiny text-text-3">
                        {l}
                      </span>
                    ))}
                  </button>
                );
              })}
              {preview && preview.col === c.key && (
                <div
                  aria-hidden="true"
                  className={cx(
                    'pointer-events-none absolute left-[3px] right-[3px] z-[4] flex flex-col justify-start gap-px overflow-hidden rounded-ctl border-2 border-dashed px-1.5 py-0.5',
                    preview.ok ? 'border-accent bg-accent-soft' : 'border-red bg-red-soft',
                  )}
                  style={{ top: px(preview.start) + 2, height: Math.max(px(preview.length) - 4, 14) }}
                >
                  <span className={cx('mono truncate text-tiny font-medium leading-3', preview.ok ? 'text-accent-text' : 'text-red-text')}>{preview.label}</span>
                  {preview.reason ? (
                    <span className="truncate text-tiny leading-3 text-red-text">{preview.reason}</span>
                  ) : (
                    preview.note && <span className="truncate text-tiny leading-3 text-accent-text">{preview.note}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
