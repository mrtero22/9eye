// A day playlist as a table: a row per block, its rows under it (Playlist page, Day tab —
// docs/design/day-playlist-page.md). Every time on it is a string the page made with the channel's
// timecode. The content kinds use the shared --ct-* colours; a break's colour is a data colour.
// Rows the page lets move can be dragged (a line shows where they land; a block's header takes them
// at its end) or moved with the arrow keys on their grip.

import { useState, type DragEvent, type ReactNode } from 'react';
import { safeColor } from './color';
import { cx } from './cx';
import { Icon } from './icons';

/** Content kinds with their own colour on every screen. */
export type ContentTone = 'program' | 'commercial' | 'promo' | 'filler' | 'ident' | 'jingle';

const TONE_VAR: Record<ContentTone, string> = {
  program: 'var(--ct-program)',
  commercial: 'var(--ct-commercial)',
  promo: 'var(--ct-promo)',
  filler: 'var(--ct-filler)',
  ident: 'var(--ct-ident)',
  jingle: 'var(--ct-jingle)',
};

export interface PlaylistRow {
  key: string;
  start: string;
  duration: string;
  title: string;
  /** The small colour square before the title: a content kind, or a data colour (a break). */
  mark?: { tone?: ContentTone; color?: string | null; label: string };
  /** `link`: a linked break · `note`: a note row. */
  icon?: 'link' | 'note';
  /** A spot under a linked break. */
  indent?: boolean;
  muted?: boolean;
  italic?: boolean;
  strong?: boolean;
  /** The Break column. */
  breakText?: string;
  /** The Media column: empty unless something is wrong ("Not ready"). */
  media?: string;
  selected?: boolean;
  onSelect?: () => void;
  /** A tick before the row (for cut / copy / delete of several rows); absent = the row cannot be ticked. */
  checked?: boolean;
  onCheck?: (checked: boolean) => void;
  /** The row can be dragged to another place (and moved with the arrow keys on its grip). */
  movable?: boolean;
  /** A gap holder: nothing goes below it. */
  last?: boolean;
  /** A row a preview adds (an agent's change, not saved yet): green, with "new". */
  isNew?: boolean;
}

/** Where a dragged row lands: after a row, at the start of a block, or at its end. */
export interface PlaylistDrop {
  blockKey: string;
  afterKey: string | null;
  first: boolean;
}

export interface PlaylistBlockRow {
  key: string;
  /** Planned start, short ("06:30"). */
  time: string;
  name: string;
  /** The block type's colour (a data colour). */
  color: string | null;
  /** "Gap 00:01:53:00" / "Over 00:04:07:11"; nothing when the block is exactly full. */
  status?: { text: string; tone: 'gap' | 'over' };
  /** "real / planned" length. */
  fill: string;
  open: boolean;
  onToggle: () => void;
  selected?: boolean;
  onSelect?: () => void;
  rows: PlaylistRow[];
  /** A closing line where the block is short. */
  gap?: { start: string; text: string; action?: ReactNode };
}

const COLUMNS = '124px 112px minmax(220px, 1fr) 132px 84px';

interface RowDrag {
  dragging: boolean;
  line?: 'top' | 'bottom';
  onStart: (e: DragEvent) => void;
  onOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onEnd: () => void;
  onNudge: (dir: -1 | 1) => void;
}

function Row({ row, drag }: { row: PlaylistRow; drag: RowDrag | null }) {
  const body = (
    <>
      {row.icon && <Icon name={row.icon === 'link' ? 'link' : 'file'} size={13} className="shrink-0 text-text-3" />}
      {row.mark && <span title={row.mark.label} className="size-[7px] shrink-0 rounded-[2px]" style={{ background: row.mark.tone ? TONE_VAR[row.mark.tone] : safeColor(row.mark.color) }} />}
      <span className={cx('truncate', row.strong && 'font-medium', row.italic && 'italic')}>{row.title}</span>
      {row.isNew && <span className="shrink-0 rounded-badge border border-green px-1 text-tiny font-semibold leading-[15px] text-green-text">new</span>}
    </>
  );
  const titleCls = cx('flex min-h-[30px] min-w-0 items-center gap-2.5 text-left', row.indent && 'pl-4', row.muted ? 'text-text-3' : 'text-text');
  return (
    <div
      role="row"
      aria-selected={row.selected}
      draggable={!!drag && !!row.movable}
      onDragStart={drag && row.movable ? drag.onStart : undefined}
      onDragOver={drag?.onOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onEnd}
      className={cx('group relative grid min-h-[var(--row)] items-center gap-x-3 border-t border-hairline pl-[46px] pr-4', row.selected && 'bg-accent-soft', row.isNew && !row.selected && 'bg-green-soft', drag?.dragging && 'opacity-45')}
      style={{ gridTemplateColumns: COLUMNS, boxShadow: drag?.line === 'top' ? 'inset 0 2px 0 var(--accent)' : drag?.line === 'bottom' ? 'inset 0 -2px 0 var(--accent)' : undefined }}
    >
      {drag && row.movable && (
        <button
          type="button"
          aria-label="Move row"
          title="Drag to move, or use the arrow keys"
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              drag.onNudge(e.key === 'ArrowUp' ? -1 : 1);
            }
          }}
          className="absolute left-[31px] top-1/2 inline-flex size-[15px] -translate-y-1/2 cursor-grab items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-text-3 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Icon name="grip" size={12} strokeWidth={2.5} />
        </button>
      )}
      {row.onCheck && (
        <input
          type="checkbox"
          aria-label={`Tick ${row.title}`}
          checked={!!row.checked}
          onChange={(e) => row.onCheck?.(e.target.checked)}
          className="absolute left-4 top-1/2 m-0 size-[15px] -translate-y-1/2 cursor-pointer accent-[var(--accent)]"
        />
      )}
      <span role="cell" className={cx('mono', row.muted ? 'text-text-3' : 'text-text')}>
        {row.start}
      </span>
      <span role="cell" className="mono text-text-3">
        {row.duration}
      </span>
      <span role="cell" className="flex min-w-0">
        {row.onSelect ? (
          <button type="button" aria-pressed={!!row.selected} onClick={row.onSelect} className={cx(titleCls, 'w-full cursor-pointer border-0 bg-transparent p-0', row.indent && 'pl-4')}>
            {body}
          </button>
        ) : (
          <span className={titleCls}>{body}</span>
        )}
      </span>
      <span role="cell" className="truncate text-small text-text-3">
        {row.breakText}
      </span>
      <span role="cell" className="whitespace-nowrap text-right text-small font-medium text-amber-text">
        {row.media}
      </span>
    </div>
  );
}

export function PlaylistTable({
  blocks,
  label,
  maxHeight = 860,
  onMove,
  onNudge,
}: {
  blocks: PlaylistBlockRow[];
  label: string;
  maxHeight?: number;
  /** A movable row was dropped: where it lands. Absent = nothing can be dragged. */
  onMove?: (key: string, to: PlaylistDrop) => void;
  /** One place up or down (the arrow keys on a row's grip). */
  onNudge?: (key: string, dir: -1 | 1) => void;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  // where the dragged row would land: a row's top or bottom edge, or a block's header (its end)
  const [over, setOver] = useState<{ key: string; edge: 'top' | 'bottom' } | { block: string } | null>(null);
  const reset = () => {
    setDragKey(null);
    setOver(null);
  };
  const drop = () => {
    if (dragKey && over && onMove) {
      if ('block' in over) onMove(dragKey, { blockKey: over.block, afterKey: null, first: false });
      else {
        const b = blocks.find((x) => x.rows.some((r) => r.key === over.key))!;
        const i = b.rows.findIndex((r) => r.key === over.key);
        const edge = b.rows[i].last ? 'top' : over.edge;
        if (edge === 'bottom') onMove(dragKey, { blockKey: b.key, afterKey: over.key, first: false });
        else if (i === 0) onMove(dragKey, { blockKey: b.key, afterKey: null, first: true });
        else onMove(dragKey, { blockKey: b.key, afterKey: b.rows[i - 1].key, first: false });
      }
    }
    reset();
  };
  const rowDrag = (r: PlaylistRow): RowDrag | null =>
    onMove
      ? {
          dragging: dragKey === r.key,
          line: over && 'key' in over && over.key === r.key && dragKey !== r.key ? (r.last ? 'top' : over.edge) : undefined,
          onStart: (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', r.title);
            setDragKey(r.key);
          },
          onOver: (e) => {
            if (!dragKey) return;
            e.preventDefault();
            const box = e.currentTarget.getBoundingClientRect();
            const edge = e.clientY < box.top + box.height / 2 ? 'top' : 'bottom';
            if (!over || !('key' in over) || over.key !== r.key || over.edge !== edge) setOver({ key: r.key, edge });
          },
          onDrop: (e) => {
            e.preventDefault();
            drop();
          },
          onEnd: reset,
          onNudge: (dir) => onNudge?.(r.key, dir),
        }
      : null;
  return (
    <div role="table" aria-label={label} className="overflow-auto rounded-card border border-border bg-surface" style={{ maxHeight }}>
      <div className="min-w-[780px]">
        <div role="row" className="sticky top-0 z-[5] grid h-10 items-center gap-x-3 border-b border-border bg-surface pl-[46px] pr-4 text-small text-text-3" style={{ gridTemplateColumns: COLUMNS }}>
          <span role="columnheader">Start</span>
          <span role="columnheader">Duration</span>
          <span role="columnheader">Title</span>
          <span role="columnheader">Break</span>
          <span role="columnheader" className="text-right">
            Media
          </span>
        </div>
        {blocks.map((b, i) => (
          <div key={b.key} role="rowgroup" aria-label={`${b.time} ${b.name}`}>
            <div
              onDragOver={(e) => {
                if (!dragKey) return;
                e.preventDefault();
                if (!over || !('block' in over) || over.block !== b.key) setOver({ block: b.key });
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop();
              }}
              className={cx('flex min-h-11 items-center gap-2.5 pl-2.5 pr-4', i > 0 && 'border-t border-border', (b.selected || (over && 'block' in over && over.block === b.key)) && 'bg-accent-soft')}
            >
              <button
                type="button"
                aria-expanded={b.open}
                aria-label={`${b.open ? 'Collapse' : 'Expand'} the ${b.time} block`}
                onClick={b.onToggle}
                className="ctl hov inline-flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-ctl border-0 bg-transparent p-0 text-text-3"
              >
                <Icon name={b.open ? 'chevronDown' : 'chevronRight'} size={14} />
              </button>
              <button type="button" aria-pressed={!!b.selected} onClick={b.onSelect} className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left">
                <span className="mono w-12 shrink-0 text-text-2">{b.time}</span>
                <span aria-hidden="true" className="size-2 shrink-0 rounded-[2px]" style={{ background: safeColor(b.color) }} />
                <span className="truncate font-semibold">{b.name}</span>
              </button>
              {b.status && <span className={cx('mono whitespace-nowrap text-small', b.status.tone === 'over' ? 'text-red-text' : 'text-amber-text')}>{b.status.text}</span>}
              <span className="mono w-[196px] whitespace-nowrap text-right text-small text-text-3" title="Real length / planned length">
                {b.fill}
              </span>
            </div>
            {b.open && b.rows.map((r) => <Row key={r.key} row={r} drag={rowDrag(r)} />)}
            {b.open && b.gap && (
              <div className="flex min-h-10 flex-wrap items-center gap-2.5 border-t border-hairline pl-[46px] pr-4 text-amber-text">
                <span className="mono w-[124px]">{b.gap.start}</span>
                <span>{b.gap.text}</span>
                <span className="flex-1" />
                {b.gap.action}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
