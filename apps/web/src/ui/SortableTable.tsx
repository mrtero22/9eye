// A table whose rows can be put in another order: drag a row by its grip, or focus the grip and use
// the arrow keys. A click on the rest of the row opens it; the open row stays highlighted.

import { useState, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';

export interface SortableRow {
  key: string;
  /** Read by screen readers: "Move <label>", "Open <label>". */
  label: string;
  cells: ReactNode[];
}

export function SortableTable({
  columns,
  head,
  rows,
  selected,
  onOpen,
  onMove,
  minWidth = 560,
}: {
  /** Grid template of the cells after the grip. */
  columns: string;
  head: ReactNode[];
  rows: SortableRow[];
  selected?: string | null;
  onOpen: (key: string) => void;
  /** Move the row at `from` so that it ends up at index `to`. */
  onMove: (from: number, to: number) => void;
  minWidth?: number;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  // the gap the dragged row would go into: 0 = before the first row … rows.length = after the last
  const [gap, setGap] = useState<number | null>(null);
  const grid = `28px ${columns}`;
  const finish = () => {
    if (drag !== null && gap !== null) {
      const to = gap > drag ? gap - 1 : gap;
      if (to !== drag) onMove(drag, to);
    }
    setDrag(null);
    setGap(null);
  };
  const line = (i: number) => {
    if (drag === null || gap === null || gap === drag || gap === drag + 1) return undefined;
    if (gap === i) return 'inset 0 2px 0 var(--accent)';
    if (i === rows.length - 1 && gap === rows.length) return 'inset 0 -2px 0 var(--accent)';
    return undefined;
  };
  return (
    <div className="overflow-auto rounded-panel border border-border bg-surface">
      <div role="table" style={{ minWidth }}>
        <div role="row" className="grid h-[38px] items-center gap-x-3.5 border-b border-border pl-2 pr-3.5 text-[12.5px] text-text-3" style={{ gridTemplateColumns: grid }}>
          <span role="columnheader" aria-label="Order" />
          {head.map((h, i) => (
            <span role="columnheader" key={i}>
              {h}
            </span>
          ))}
        </div>
        {rows.map((r, i) => (
          <div
            role="row"
            key={r.key}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', r.label);
              setDrag(i);
            }}
            onDragOver={(e) => {
              if (drag === null) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              setGap(e.clientY < box.top + box.height / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              finish();
            }}
            onDragEnd={finish}
            className={cx('grid min-h-11 items-center gap-x-3.5 pl-2 pr-3.5', i > 0 && 'border-t border-hairline', selected === r.key && 'bg-accent-soft', drag === i && 'opacity-50')}
            style={{ gridTemplateColumns: grid, boxShadow: line(i) }}
          >
            <button
              type="button"
              aria-label={`Move ${r.label}`}
              title="Drag to move, or use the arrow keys"
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' && i > 0) {
                  e.preventDefault();
                  onMove(i, i - 1);
                } else if (e.key === 'ArrowDown' && i < rows.length - 1) {
                  e.preventDefault();
                  onMove(i, i + 1);
                }
              }}
              className="hov inline-flex size-7 cursor-grab items-center justify-center rounded-ctl border-0 bg-transparent p-0 text-text-3"
            >
              <Icon name="grip" size={14} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              aria-label={`Open ${r.label}`}
              aria-pressed={selected === r.key}
              onClick={() => onOpen(r.key)}
              className="grid min-h-10 cursor-pointer items-center gap-x-3.5 border-0 bg-transparent p-0 text-left text-small text-text"
              style={{ gridColumn: '2 / -1', gridTemplateColumns: columns }}
            >
              {r.cells.map((c, j) => (
                <span key={j} className="min-w-0">
                  {c}
                </span>
              ))}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
