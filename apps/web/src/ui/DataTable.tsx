// A full-width list table (Scheduling's order list): sortable column heads, rows grouped under a
// quiet group row, rows that open on click or Enter, an actions cell that does not open the row,
// and a footer line. One grid template is shared by the head and every row.

import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from './cx';
import { safeColor } from './color';

export interface DataColumn {
  label: ReactNode;
  /** CSS grid track, e.g. "minmax(250px, 2fr)" or "84px". */
  width: string;
  sort?: 'ascending' | 'descending' | 'none';
  onSort?: () => void;
}

export interface DataRow {
  key: string;
  cells: ReactNode[];
  onOpen?: () => void;
  openLabel?: string;
  /** Last cell: actions (e.g. a "⋯" menu); clicks there do not open the row. */
  actions?: ReactNode;
}

export interface DataGroup {
  key: string;
  /** Empty: no group row (a table without groups). */
  label: string;
  count?: number;
  hint?: string;
  rows: DataRow[];
}

export function DataTable({
  label,
  columns,
  groups,
  footer,
  empty,
  toolbar,
  minWidth = 1180,
  rowHeight = 'min-h-14',
}: {
  label: string;
  columns: DataColumn[];
  groups: DataGroup[];
  footer?: ReactNode;
  empty?: ReactNode;
  /** A line above the column heads (count, bulk actions). */
  toolbar?: ReactNode;
  minWidth?: number;
  rowHeight?: string;
}) {
  const template = columns.map((c) => c.width).join(' ');
  const open = (r: DataRow) => (e: KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && r.onOpen) {
      e.preventDefault();
      r.onOpen();
    }
  };
  return (
    <div role="table" aria-label={label} className="print-full overflow-x-auto rounded-card border border-border bg-surface">
      <div style={{ minWidth }}>
        {toolbar && <div className="flex h-11 items-center gap-2 border-b border-hairline px-3 text-small text-text-2">{toolbar}</div>}
        <div role="row" className="grid h-10 items-center gap-x-4 border-b border-border pl-4 pr-3 text-small text-text-3" style={{ gridTemplateColumns: template }}>
          {columns.map((c, i) => (
            <span key={i} role="columnheader" aria-sort={c.onSort ? c.sort ?? 'none' : undefined}>
              {c.onSort ? (
                <button type="button" onClick={c.onSort} className="hov -ml-1.5 inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-[5px] border-0 bg-transparent px-1.5 text-small text-text-3">
                  {c.label}
                  <span aria-hidden="true">{c.sort === 'ascending' ? '↑' : c.sort === 'descending' ? '↓' : ''}</span>
                </button>
              ) : (
                c.label
              )}
            </span>
          ))}
        </div>
        {groups.map((g) => (
          <div key={g.key} role="rowgroup">
            {g.label && (
              <div role="row" className="flex h-[34px] items-center gap-2 border-b border-hairline bg-surface-2 px-4 text-[12.5px] font-medium text-text-2">
                <span role="cell">
                  {g.label}
                  {g.count !== undefined && <span className="mono ml-2 font-normal text-text-3">{g.count}</span>}
                  {g.hint && <span className="ml-2 font-normal text-text-3">· {g.hint}</span>}
                </span>
              </div>
            )}
            {g.rows.map((r) => (
              <div
                key={r.key}
                role="row"
                tabIndex={r.onOpen ? 0 : undefined}
                aria-label={r.openLabel}
                title={r.openLabel}
                onClick={r.onOpen}
                onKeyDown={open(r)}
                className={cx('hov relative grid items-center gap-x-4 border-b border-hairline py-2 pl-4 pr-3 text-small', rowHeight, r.onOpen && 'cursor-pointer')}
                style={{ gridTemplateColumns: template }}
              >
                {r.cells.map((c, i) => (
                  <span key={i} role="cell" className="min-w-0">
                    {c}
                  </span>
                ))}
                {r.actions !== undefined && (
                  <span role="cell" className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    {r.actions}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
        {!groups.length && empty && <div className="px-4 py-6 text-small text-text-3">{empty}</div>}
        {footer && <div className="flex h-10 items-center px-4 text-[12.5px] text-text-3">{footer}</div>}
      </div>
    </div>
  );
}

/** A thin two-part bar (done, this week) in a data colour. */
export function ProgressBar({ done, now, color, width = 120, label }: { done: number; now: number; color: string; width?: number | string; label?: string }) {
  return (
    <span aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} className="flex h-1 overflow-hidden rounded-[2px] bg-surface-3" style={{ width }}>
      <span className="bg-text-3" style={{ width: `${Math.max(0, Math.min(100, done))}%` }} />
      <span style={{ width: `${Math.max(0, Math.min(100 - done, now))}%`, background: safeColor(color) }} />
    </span>
  );
}
