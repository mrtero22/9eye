// A month as a table of channel weeks: one row per week, seven day cells with their state.
// (Playlist page, Weeks tab — docs/design/weeks-page.md.) Colour here means status only.

import type { ReactNode } from 'react';
import { cx } from './cx';

/** `none`: the week does not exist yet · `off`: the weekday is not active in this week. */
export type WeekDayTone = 'draft' | 'published' | 'reconciled' | 'off' | 'none';

export interface WeekTableDay {
  key: string;
  /** "7 Nov" */
  date: string;
  /** "Draft", "Published", … — empty for a week that does not exist. */
  label?: string;
  /** A quiet third line, e.g. "25 blocks". */
  meta?: string;
  tone: WeekDayTone;
  today?: boolean;
  /** Read by screen readers: the whole day in words. */
  ariaLabel: string;
  onClick?: () => void;
}

export interface WeekTableRow {
  key: string;
  /** "Week 46" */
  title: string;
  subtitle?: string;
  /** Opens the week; without it the title is plain text. */
  onOpen?: () => void;
  /** Shown under the title of a week that does not exist yet (a Create button). */
  action?: ReactNode;
  days: WeekTableDay[];
  /** The row's "⋯" menu. */
  menu?: ReactNode;
}

const TONE: Record<WeekDayTone, string> = {
  draft: 'border-transparent bg-surface-2 text-text-2',
  published: 'border-transparent bg-accent-soft text-accent-text',
  reconciled: 'border-transparent bg-green-soft text-green-text',
  off: 'border-dashed border-border bg-transparent text-text-3',
  none: 'border-dashed border-border bg-transparent text-text-3',
};

const COLUMNS = 'minmax(170px, 1.5fr) repeat(7, minmax(88px, 1fr)) 36px';

function DayCell({ day }: { day: WeekTableDay }) {
  const cls = cx(
    'flex min-h-[58px] w-full min-w-0 flex-col items-start gap-0.5 rounded-item border px-2.5 py-1.5 text-left',
    TONE[day.tone],
    day.today && 'shadow-[inset_0_0_0_2px_var(--text)]',
  );
  const body = (
    <>
      <span className="mono text-small font-medium text-text">{day.date}</span>
      {day.label && <span className="text-meta">{day.label}</span>}
      {day.meta && <span className="text-tiny text-text-3">{day.meta}</span>}
    </>
  );
  return day.onClick ? (
    <button type="button" aria-label={day.ariaLabel} aria-current={day.today ? 'date' : undefined} onClick={day.onClick} className={cx(cls, 'cursor-pointer hover:border-border-strong')}>
      {body}
    </button>
  ) : (
    <div aria-label={day.ariaLabel} aria-current={day.today ? 'date' : undefined} role="img" className={cls}>
      {body}
    </div>
  );
}

export function WeekTable({ heads, rows, label, empty }: { heads: string[]; rows: WeekTableRow[]; label: string; empty?: ReactNode }) {
  return (
    <div aria-label={label} role="region" className="overflow-x-auto rounded-card border border-border bg-surface">
      <div className="min-w-[900px]">
        <div className="grid items-center gap-x-1.5 border-b border-hairline px-3 py-2 text-meta text-text-3" style={{ gridTemplateColumns: COLUMNS }}>
          <span className="px-2">Week</span>
          {heads.map((h) => (
            <span key={h} className="px-2.5">
              {h}
            </span>
          ))}
          <span />
        </div>
        {rows.map((r) => (
          <div key={r.key} role="group" aria-label={r.title} className="grid items-center gap-x-1.5 border-t border-hairline px-3 py-2 first:border-t-0" style={{ gridTemplateColumns: COLUMNS }}>
            <div className="flex min-w-0 flex-col items-start gap-1 px-2">
              {r.onOpen ? (
                <button type="button" onClick={r.onOpen} className="hov -mx-2 flex max-w-full cursor-pointer flex-col items-start rounded-item border-0 bg-transparent px-2 py-1 text-left">
                  <span className="font-semibold">{r.title}</span>
                  {r.subtitle && <span className="max-w-full truncate text-small text-text-2">{r.subtitle}</span>}
                </button>
              ) : (
                <>
                  <span className={cx('font-semibold', r.action && 'text-text-2')}>{r.title}</span>
                  {r.subtitle && (
                    <span className="max-w-full truncate text-small text-text-2" title={r.subtitle}>
                      {r.subtitle}
                    </span>
                  )}
                </>
              )}
              {r.action}
            </div>
            {r.days.map((d) => (
              <DayCell key={d.key} day={d} />
            ))}
            <span className="flex justify-end">{r.menu}</span>
          </div>
        ))}
        {!rows.length && empty && <div className="px-5 py-6 text-small text-text-3">{empty}</div>}
      </div>
    </div>
  );
}

const LEGEND: { tone: WeekDayTone; label: string }[] = [
  { tone: 'draft', label: 'Draft' },
  { tone: 'published', label: 'Approved' },
  { tone: 'reconciled', label: 'Reconciled' },
  { tone: 'none', label: 'Not created or not active' },
];

/** What the day colours of a `WeekTable` mean. */
export function WeekLegend() {
  return (
    <div aria-label="Day states" role="group" className="flex flex-col gap-1.5 text-small text-text-2">
      {LEGEND.map((l) => (
        <span key={l.tone} className="flex items-center gap-2">
          <span aria-hidden="true" className={cx('size-3.5 shrink-0 rounded-[4px] border', TONE[l.tone], l.tone !== 'none' && 'border-border-strong')} />
          {l.label}
        </span>
      ))}
    </div>
  );
}
