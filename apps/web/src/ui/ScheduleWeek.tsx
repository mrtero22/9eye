// A channel week of template blocks and what orders place in them (Scheduling; mockup
// the Scheduling mockup (private)): seven day columns with the day's note, an hour axis from the channel's day
// start, one cell per block. Positions come in frames; the page decides what each cell shows.

import { Fragment, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { cx } from './cx';
import { dataTint, safeColor } from './color';
import { Icon, type IconName } from './icons';

/**
 * How a cell is drawn. `first` / `repeat`: this order's first airing (strong) or repeat (light) in its
 * colour (`*All`: every order, "All programmes"); `passes`: a promo order's block; `other`: another
 * order's programme in grey; `missing`: no programme (dashed amber); `template`: a plain template
 * block; `outside`: a day outside the order (hatched).
 */
export type ScheduleCellLook = 'first' | 'repeat' | 'firstAll' | 'repeatAll' | 'passes' | 'other' | 'missing' | 'template' | 'outside';

export interface ScheduleCell {
  id: string;
  start: number;
  length: number;
  look: ScheduleCellLook;
  /** Data colour of the order (first / repeat / passes). */
  color?: string | null;
  title: string;
  titleTone?: 'text' | 'muted' | 'amber';
  /** Second line, shown when the cell is tall enough. */
  sub?: string;
  /** Small round count in the order's colour ("4×"). */
  chip?: string;
  /** Linked breaks of the block (shown when given). */
  breaks?: number;
  selected?: boolean;
  ariaLabel: string;
  /** A small icon button on the cell's right edge (quick placement: add repeats of a first airing). */
  action?: { icon: IconName; label: string; pressed: boolean };
}

export interface ScheduleColumn {
  key: string;
  day: string;
  date: string;
  note?: string;
  noteTone?: 'muted' | 'amber';
  cells: ScheduleCell[];
}

/** Pixels per hour. */
export const SCHEDULE_ZOOM = [30, 38, 50, 64];

const TINT: Record<'first' | 'repeat' | 'firstAll' | 'repeatAll' | 'passes', { fill: number; edge: number | null; border: number; weight: number }> = {
  first: { fill: 24, edge: null, border: 22, weight: 600 },
  repeat: { fill: 8, edge: 45, border: 22, weight: 500 },
  firstAll: { fill: 26, edge: null, border: 20, weight: 600 },
  repeatAll: { fill: 9, edge: 45, border: 20, weight: 500 },
  passes: { fill: 9, edge: null, border: 22, weight: 400 },
};

export function ScheduleWeek({
  columns,
  hourLabels,
  framesPerHour,
  hourHeight,
  onCellClick,
  onCellAction,
  label,
  maxHeight = 'min(1000px, calc(100vh - 240px))',
}: {
  columns: ScheduleColumn[];
  hourLabels: string[];
  framesPerHour: number;
  hourHeight: number;
  onCellClick?: (cellId: string, columnKey: string) => void;
  onCellAction?: (cellId: string, columnKey: string) => void;
  label: string;
  maxHeight?: string;
}) {
  const height = hourLabels.length * hourHeight;
  const px = (frames: number) => (frames / framesPerHour) * hourHeight;
  const tall = hourHeight >= 46;
  // zooming keeps the hour in the middle of the view
  const scroller = useRef<HTMLDivElement>(null);
  const lastHour = useRef(hourHeight);
  useLayoutEffect(() => {
    const el = scroller.current;
    const prev = lastHour.current;
    lastHour.current = hourHeight;
    if (!el || prev === hourHeight) return;
    const middle = (el.scrollTop + el.clientHeight / 2 - 48) / prev;
    el.scrollTop = Math.max(0, middle * hourHeight + 48 - el.clientHeight / 2);
  }, [hourHeight]);
  const cols = { gridTemplateColumns: `56px repeat(${columns.length}, minmax(108px, 1fr))` };
  return (
    <div ref={scroller} role="region" aria-label={label} className="print-full overflow-auto rounded-card border border-border bg-surface" style={{ maxHeight }}>
      <div className="min-w-[820px]">
        <div className="sticky top-0 z-[5] grid border-b border-border bg-surface" style={cols}>
          <div />
          {columns.map((c) => (
            <div key={c.key} className="flex min-h-12 flex-col justify-center gap-px py-1.5 pl-2.5 pr-1 leading-[1.2]">
              <span className="font-semibold">
                {c.day} <span className="mono font-normal text-text-2">{c.date}</span>
              </span>
              {c.note && <span className={cx('text-[11.5px]', c.noteTone === 'amber' ? 'text-amber-text' : 'text-text-3')}>{c.note}</span>}
            </div>
          ))}
        </div>
        <div className="grid" style={cols}>
          <div className="relative" style={{ height }}>
            {hourLabels.map((h, i) => (
              <div key={i} className="mono absolute right-2.5 pt-1 text-tiny leading-[14px] text-text-3" style={{ top: i * hourHeight }}>
                {h}
              </div>
            ))}
          </div>
          {columns.map((c) => (
            <div key={c.key} className="relative border-l border-hairline" style={{ height }}>
              {c.cells.map((b) => {
                const h = Math.max(px(b.length) - 2, 4);
                const t = b.look in TINT ? TINT[b.look as keyof typeof TINT] : null;
                const style: CSSProperties = {
                  top: px(b.start) + 1,
                  height: h,
                  outline: b.selected ? '2px solid var(--accent)' : 'none',
                  outlineOffset: 1,
                };
                if (t) {
                  // longhand only: React warns when shorthand and longhand border properties mix between renders
                  const line = dataTint(b.color, t.border);
                  style.background = dataTint(b.color, t.fill);
                  style.borderStyle = 'solid';
                  style.borderWidth = '1px 1px 1px 3px';
                  style.borderColor = `${line} ${line} ${line} ${t.edge === null ? safeColor(b.color) : dataTint(b.color, t.edge)}`;
                }
                // room for the action button (inline: the class already sets a padding)
                if (b.action) style.paddingRight = 26;
                const showSub = tall && !!b.sub && h >= 40;
                const act = Math.min(h, 20);
                return (
                  <Fragment key={b.id}>
                    <button
                      type="button"
                      aria-pressed={!!b.selected}
                      aria-label={b.ariaLabel}
                      title={b.ariaLabel}
                      onClick={() => onCellClick?.(b.id, c.key)}
                      className={cx(
                        'absolute left-[3px] right-[3px] flex flex-col justify-center overflow-hidden rounded-ctl pl-2 pr-1.5 text-left hover:brightness-[.97]',
                        onCellClick ? 'cursor-pointer' : 'cursor-default',
                        b.look === 'other' && 'border border-hairline bg-transparent',
                        b.look === 'missing' && 'border border-dashed border-amber bg-transparent',
                        b.look === 'template' && 'border border-border bg-transparent',
                        b.look === 'outside' && 'border border-hairline bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_6px,transparent_6px_12px)]',
                        b.titleTone === 'muted' || b.look === 'other' || b.look === 'template' ? 'text-text-3' : b.titleTone === 'amber' || b.look === 'missing' ? 'text-amber-text' : 'text-text',
                      )}
                      style={style}
                    >
                      <span className="flex w-full items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-meta" style={{ fontWeight: t ? (b.titleTone === 'muted' ? 400 : t.weight) : b.look === 'missing' ? 500 : 400 }}>
                          {b.title}
                        </span>
                        {b.chip && (
                          <span className="mono inline-flex h-4 shrink-0 items-center rounded-[8px] px-[5px] text-[10.5px] font-medium text-on-accent" style={{ background: safeColor(b.color) }}>
                            {b.chip}
                          </span>
                        )}
                        {b.breaks !== undefined && (
                          <span title="Linked breaks" className="inline-flex shrink-0 items-center gap-0.5 text-[10.5px] text-text-3">
                            <Icon name="link" size={9} strokeWidth={2.25} />
                            <span className="mono">{b.breaks}</span>
                          </span>
                        )}
                      </span>
                      {showSub && <span className="w-full truncate text-tiny text-text-3">{b.sub}</span>}
                    </button>
                    {b.action && (
                      // a sibling, not inside the cell: a button cannot hold another button
                      <button
                        type="button"
                        aria-pressed={b.action.pressed}
                        aria-label={b.action.label}
                        title={b.action.label}
                        onClick={() => onCellAction?.(b.id, c.key)}
                        className={cx('absolute right-[6px] inline-flex w-5 cursor-pointer items-center justify-center rounded-badge', b.action.pressed ? 'bg-accent text-on-accent' : 'text-text-2 hover:bg-surface-2')}
                        style={{ top: px(b.start) + 1 + (h - act) / 2, height: act }}
                      >
                        <Icon name={b.action.icon} size={12} strokeWidth={2} />
                      </button>
                    )}
                  </Fragment>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The legend above the grid: a small cell in each look with its meaning. */
export function ScheduleLegend({ items }: { items: { label: string; look: ScheduleCellLook; color?: string | null }[] }) {
  return (
    <span className="inline-flex flex-wrap gap-3 text-text-3">
      {items.map((it) => {
        const t = it.look in TINT ? TINT[it.look as keyof typeof TINT] : null;
        return (
          <span key={it.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cx(
                'inline-block h-2.5 w-3 rounded-[2px]',
                it.look === 'other' && 'border border-border',
                it.look === 'missing' && 'border border-dashed border-amber',
                it.look === 'template' && 'border border-border',
                it.look === 'outside' && 'border border-border bg-surface-2',
              )}
              style={t ? { background: dataTint(it.color, t.fill), border: `1px solid ${dataTint(it.color, t.border + 18)}` } : undefined}
            />
            {it.label}
          </span>
        );
      })}
    </span>
  );
}
