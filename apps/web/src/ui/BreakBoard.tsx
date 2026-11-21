// The week board of a commercial order (design/orders-page.md §3): one column per day, one row per
// hour of the broadcast day; each day shows its own blocks (quiet cards) and, in each, its ad breaks
// as plain lines. Only booked breaks and exceptions carry colour. A block longer than an hour is one
// tall card over its hours; blocks that share an hour (two half hours) sit together in it.
// Compact: one line per block (its name) standing for one chosen break of it — the order page's
// "Break" field — so a click on the block acts on that break.

import type { ReactNode } from 'react';
import { cx } from './cx';
import { safeColor } from './color';

/** Marks of an order's spot versions (V1, V2, …): token colours, so they read in both themes. */
export const SPOT_TONES = ['var(--ct-commercial)', 'var(--ct-program)', 'var(--ct-promo)', 'var(--ct-filler)', 'var(--ct-ident)', 'var(--ct-jingle)'];
const markColor = (c: string | undefined) => (c && SPOT_TONES.includes(c) ? c : safeColor(c));

export interface BoardSlot {
  key: string;
  /** Minutes from the day start (decides the hour row). */
  at: number;
  time: string;
  label: string;
  title: string;
  /** Booked: the spot mark ("V1", "V1 ×2") in the spot's colour. */
  mark?: string;
  markColor?: string;
  warn?: 'amber' | 'red';
  selected?: boolean;
  /** Compact board: this order's spots in the block's other breaks ("V2", "V1 ×2"), shown muted. */
  other?: string;
}
export interface BoardBox {
  key: string;
  /** Minutes from the day start. */
  start: number;
  length: number;
  name: string;
  color: string;
  title: string;
  slots: BoardSlot[];
}
export interface BoardDay {
  key: string;
  day: string;
  date: string;
  sub: string;
  tag?: string;
  tagTitle?: string;
  /** Outside the order's dates: shown, but not bookable. */
  off?: boolean;
  selected?: boolean;
  boxes: BoardBox[];
}

interface Piece {
  col: number;
  row: string;
  last: boolean;
  boxes: { box: BoardBox; head: boolean; first: boolean; last: boolean; slots: BoardSlot[] }[];
}

/** Cut the day's blocks into pieces per hour row (see the file comment). */
function pieces(day: BoardDay, col: number, r0: number, r1: number): Piece[] {
  const out: Piece[] = [];
  const boxes = [...day.boxes].sort((a, b) => a.start - b.start);
  let g = 0;
  while (g < boxes.length) {
    let e = g;
    let end = boxes[g].start + boxes[g].length;
    while (end % 60 !== 0 && e + 1 < boxes.length && boxes[e + 1].start < Math.ceil(end / 60) * 60) {
      e++;
      end = Math.max(end, boxes[e].start + boxes[e].length);
    }
    const group = boxes.slice(g, e + 1);
    const rs = Math.floor(group[0].start / 60);
    const re = Math.max(rs, Math.ceil(end / 60) - 1);
    if (group.length === 1) {
      const b = group[0];
      const first = Math.max(rs, r0);
      const last = Math.min(re, r1);
      for (let r = first; r <= last; r++) {
        out.push({ col, row: String(r - r0 + 1), last: r === last, boxes: [{ box: b, head: r === first, first: r === first, last: r === last, slots: b.slots.filter((s) => Math.min(Math.max(Math.floor(s.at / 60), rs), re) === r) }] });
      }
    } else if (re >= r0 && rs <= r1) {
      const a = Math.max(rs, r0);
      const z = Math.min(re, r1);
      out.push({ col, row: `${a - r0 + 1} / span ${z - a + 1}`, last: true, boxes: group.map((b) => ({ box: b, head: true, first: true, last: true, slots: b.slots })) });
    }
    g = e + 1;
  }
  return out;
}

export function BreakBoard({
  label,
  days,
  hours,
  onSlot,
  onHour,
  onDay,
  maxHeight = 1040,
  overlay,
  compact = false,
}: {
  label: string;
  days: BoardDay[];
  /** Consecutive hour rows: `index` = hours from the day start. */
  hours: { index: number; label: string }[];
  onSlot: (dayKey: string, slotKey: string, shift: boolean) => void;
  onHour?: (index: number) => void;
  onDay?: (dayKey: string) => void;
  maxHeight?: number;
  /** Floats over the board's right side (the open break). */
  overlay?: ReactNode;
  /** One line per block: each box has at most one slot (its chosen break); none = not usable. */
  compact?: boolean;
}) {
  const r0 = hours[0]?.index ?? 0;
  const r1 = hours[hours.length - 1]?.index ?? -1;
  const cols = `44px repeat(${days.length}, minmax(132px, 1fr))`;
  return (
    <div className="relative">
      <div className="overflow-auto rounded-panel border border-border bg-surface" style={{ maxHeight }}>
        <div role="table" aria-label={label} style={{ minWidth: 44 + days.length * 148 }}>
          <div role="row" className="sticky top-0 z-[3] grid gap-x-1.5 border-b border-border bg-surface px-2" style={{ gridTemplateColumns: cols }}>
            <span role="columnheader" aria-label="Time" />
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                role="columnheader"
                title={d.tagTitle ?? (onDay ? 'Select every break of this day' : undefined)}
                onClick={() => onDay?.(d.key)}
                className={cx('hov flex min-w-0 cursor-pointer flex-col items-start gap-px border-0 px-1.5 pb-2 pt-2.5 text-left', d.selected ? 'bg-accent-soft' : 'bg-transparent', d.off && 'opacity-55')}
              >
                <span className="flex items-center gap-1.5 text-[13px]">
                  <span className="font-semibold">{d.day}</span>
                  <span className="mono text-text-2">{d.date}</span>
                  {d.tag && <span className="inline-flex h-4 items-center whitespace-nowrap rounded-badge bg-surface-2 px-[5px] text-[10.5px] font-medium text-text-2">{d.tag}</span>}
                </span>
                <span className="mono text-[11.5px] text-text-3">{d.sub}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-x-1.5 px-2 pb-0.5 pt-2" style={{ gridTemplateColumns: cols }}>
            {hours.map((h, i) => (
              <button
                key={h.index}
                type="button"
                title="Select every break of this hour"
                onClick={() => onHour?.(h.index)}
                className="mono hov mt-[3px] h-6 cursor-pointer self-start rounded-[5px] border-0 bg-transparent p-0 text-[11.5px] text-text-3"
                style={{ gridColumn: 1, gridRow: i + 1 }}
              >
                {h.label}
              </button>
            ))}
            {days.flatMap((d, ci) =>
              pieces(d, ci + 2, r0, r1).map((p, pi) => (
                <div key={`${d.key}-${pi}`} className={cx('flex min-w-0 flex-col gap-1.5', p.last && 'mb-1.5', d.off && 'opacity-55')} style={{ gridColumn: p.col, gridRow: p.row }}>
                  {p.boxes.map(({ box, head, first, last, slots }) => (
                    <div
                      key={box.key}
                      className={cx(
                        'flex min-w-0 flex-1 flex-col gap-px bg-surface-2 px-1',
                        first || compact ? 'pt-1' : 'pt-[35px]',
                        last ? 'pb-1' : 'pb-px',
                        compact && !first && 'min-h-[30px]',
                        first && last ? 'rounded-item' : first ? 'rounded-t-item' : last ? 'rounded-b-item' : '',
                      )}
                    >
                      {compact && head && <CompactBlock box={box} off={!!d.off} onClick={(k, shift) => onSlot(d.key, k, shift)} />}
                      {!compact && head && (
                        <div title={box.title} className="flex h-[30px] items-start gap-1.5 pl-[5px] pr-1 pt-0.5 text-[11px] leading-[13px]">
                          <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: safeColor(box.color) }} />
                          <span className="line-clamp-2 min-w-0 flex-1 font-medium text-text-2">{box.name}</span>
                        </div>
                      )}
                      {!compact && slots.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          aria-label={s.title}
                          aria-pressed={!!s.selected}
                          title={s.title}
                          disabled={d.off}
                          onClick={(e) => onSlot(d.key, s.key, e.shiftKey)}
                          className={cx(
                            'group flex h-6 min-w-0 cursor-pointer items-center gap-1.5 rounded-[5px] border-0 py-0 pl-1 pr-1.5 text-left disabled:cursor-default',
                            s.selected
                              ? 'bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]'
                              : s.mark
                                ? 'bg-surface shadow-[inset_0_0_0_1px_var(--border)]'
                                : 'bg-transparent enabled:hover:bg-surface enabled:hover:shadow-[inset_0_0_0_1px_var(--border)]',
                          )}
                        >
                          <span aria-hidden="true" className="h-3.5 w-[3px] shrink-0 rounded-[2px]" style={{ background: s.mark ? markColor(s.markColor) : 'transparent' }} />
                          <span className={cx('mono shrink-0 text-[11.5px]', s.mark ? 'text-text-2' : 'text-text-3')}>{s.time}</span>
                          <span className={cx('min-w-0 flex-1 truncate text-[12.5px]', s.mark ? 'font-medium text-text' : 'text-text-2')}>{s.label}</span>
                          {s.warn && <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', s.warn === 'red' ? 'bg-red' : 'bg-amber')} />}
                          {s.mark ? (
                            <span className="mono shrink-0 text-[11px] font-semibold" style={{ color: markColor(s.markColor) }}>
                              {s.mark}
                            </span>
                          ) : (
                            <span aria-hidden="true" className="shrink-0 text-[14px] leading-none text-accent-text opacity-0 group-enabled:group-hover:opacity-100">
                              +
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )),
            )}
          </div>
        </div>
      </div>
      {overlay}
    </div>
  );
}

/** A block on the compact board: its name stands for its chosen break (the box's one slot). */
function CompactBlock({ box, off, onClick }: { box: BoardBox; off: boolean; onClick: (slotKey: string, shift: boolean) => void }) {
  const s = box.slots[0];
  const dot = <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: safeColor(box.color) }} />;
  if (!s)
    return (
      <div title={box.title} className="flex min-h-[30px] min-w-0 items-center gap-1.5 rounded-[5px] py-1 pl-[5px] pr-1.5 text-[12px] leading-[14px] text-text-3 opacity-60">
        {dot}
        <span className="line-clamp-2 min-w-0 flex-1">{box.name}</span>
      </div>
    );
  return (
    <button
      type="button"
      aria-label={s.title}
      aria-pressed={!!s.selected}
      title={s.title}
      disabled={off}
      onClick={(e) => onClick(s.key, e.shiftKey)}
      className={cx(
        'group flex min-h-[30px] min-w-0 cursor-pointer items-center gap-1.5 rounded-[5px] border-0 py-1 pl-[5px] pr-1.5 text-left disabled:cursor-default',
        s.selected
          ? 'bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]'
          : s.mark
            ? 'bg-surface shadow-[inset_0_0_0_1px_var(--border)]'
            : 'bg-transparent enabled:hover:bg-surface enabled:hover:shadow-[inset_0_0_0_1px_var(--border)]',
      )}
    >
      {dot}
      <span className={cx('line-clamp-2 min-w-0 flex-1 text-[12px] leading-[14px]', s.mark ? 'font-medium text-text' : 'text-text-2')}>{box.name}</span>
      {s.warn && <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', s.warn === 'red' ? 'bg-red' : 'bg-amber')} />}
      {s.mark ? (
        <span className="mono shrink-0 text-[11px] font-semibold" style={{ color: markColor(s.markColor) }}>
          {s.mark}
        </span>
      ) : s.other ? (
        <span className="mono shrink-0 text-[11px] text-text-3">{s.other}</span>
      ) : (
        <span aria-hidden="true" className="shrink-0 text-[14px] leading-none text-accent-text opacity-0 group-enabled:group-hover:opacity-100">
          +
        </span>
      )}
    </button>
  );
}
