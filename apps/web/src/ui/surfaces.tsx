// Building blocks of settings and admin pages (mockup the Admin mockup (private)): section navigation, cards,
// tables, pills, status dots, people and company marks.

import { createContext, forwardRef, useContext, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from './cx';
import { Icon } from './icons';

// ---------------------------------------------------------------- navigation and headings

export interface SectionNavItem {
  key: string;
  label: string;
  to: string;
  count?: number;
  /** Not built yet: shown with "later". */
  later?: boolean;
}

/** Grouped list of a module's sections on the left (Admin: Organisation, Channels, …). */
export function SectionNav({ groups, current, label }: { groups: { label: string; items: SectionNavItem[] }[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="flex min-w-[200px] max-w-full flex-[1_1_210px] flex-col gap-3.5 sm:max-w-[232px]">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-px">
          <span className="px-2.5 pb-1 text-meta font-medium text-text-3">{g.label}</span>
          {g.items.map((it) => {
            const on = it.key === current;
            return (
              <Link
                key={it.key}
                to={it.to}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'hov flex min-h-8 items-center gap-2 rounded-[7px] px-2.5 text-small no-underline',
                  on ? 'bg-accent-soft font-semibold text-accent-text' : it.later ? 'text-text-2' : 'text-text',
                )}
              >
                <span className="min-w-0 flex-1">{it.label}</span>
                {it.count !== undefined && <span className="mono text-[11.5px] text-text-3">{it.count}</span>}
                {it.later && <span className="text-tiny text-text-3">later</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Title of a section with a one-line description and its actions on the right. */
export function SectionHead({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="flex flex-col leading-[1.3]">
        <h2 className="m-0 text-[17px] font-semibold">{title}</h2>
        {description && <span className="text-small text-text-3">{description}</span>}
      </span>
      <span className="flex-1" />
      {children}
    </div>
  );
}

/** "Channels / AURORA SD" above a detail view. */
export function Breadcrumb({ parent, to, current }: { parent: string; to: string; current: string }) {
  return (
    <span className="flex items-center gap-1.5 text-small text-text-3">
      <Link to={to} className="hov -ml-1.5 rounded-[5px] px-1.5 py-0.5 text-accent-text no-underline">
        {parent}
      </Link>
      /<span>{current}</span>
    </span>
  );
}

// ---------------------------------------------------------------- cards and lists

/** A settings card: title, a short line under it, fields. Cards sit on the page, never in each other. */
export function Card({ title, subtitle, children, label, className }: { title?: string; subtitle?: string; children: ReactNode; label?: string; className?: string }) {
  return (
    <section aria-label={label ?? title} className={cx('flex flex-col gap-3 rounded-panel border border-border bg-surface p-4', className)}>
      {title && (
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{title}</span>
          {subtitle && <span className="text-[12.5px] text-text-3">{subtitle}</span>}
        </span>
      )}
      {children}
    </section>
  );
}

/** A quiet row inside a card (surface-2): title, one line, something on the right. */
export function InsetRow({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-item bg-surface-2 px-3 py-2.5">
      <span className="flex flex-1 flex-col leading-[1.3]">
        <span className="font-medium">{title}</span>
        {detail && <span className="text-meta text-text-3">{detail}</span>}
      </span>
      {children}
    </div>
  );
}

const DOT = { green: 'bg-green', amber: 'bg-amber', red: 'bg-red', neutral: 'bg-border-strong' } as const;
export type DotTone = keyof typeof DOT;

/** A rule or fact with a status dot: "Frame rate and day start — Locked: …"; `action` on the right. */
export function DotItem({ tone, title, detail, action }: { tone: DotTone; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[12.5px]">
      <span className={cx('mt-[5px] size-2 shrink-0 rounded-full', DOT[tone])} />
      <span className="flex min-w-0 flex-1 flex-col leading-[1.35]">
        <span className="font-medium text-text">{title}</span>
        <span className="text-text-3">{detail}</span>
      </span>
      {action}
    </div>
  );
}

/** A check before an operation: a green tick when it holds, an amber mark when it does not. */
export function CheckLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className="flex gap-2 text-small">
      <span className={cx('mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full', ok ? 'bg-green-soft text-green-text' : 'bg-amber-soft text-amber-text')}>
        <Icon name={ok ? 'check' : 'alert'} size={10} strokeWidth={3} />
      </span>
      <span>{children}</span>
    </span>
  );
}

export function StatusDot({ tone, children }: { tone: DotTone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-small', tone === 'neutral' ? 'text-text-3' : 'text-text-2')}>
      <span className={cx('size-[7px] shrink-0 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}

/** A round chip; `accent` for chosen values, with an optional remove button. */
export function Pill({ children, tone = 'neutral', onRemove, removeLabel }: { children: ReactNode; tone?: 'neutral' | 'accent'; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-[26px] items-center gap-1 rounded-[13px] text-[12.5px] font-medium',
        onRemove ? 'pl-2.5 pr-1' : 'px-2.5',
        tone === 'accent' ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-text',
      )}
    >
      {children}
      {onRemove && (
        <button type="button" aria-label={removeLabel} title={removeLabel} onClick={onRemove} className="hov inline-flex size-5 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-current">
          <Icon name="close" size={11} strokeWidth={2} />
        </button>
      )}
    </span>
  );
}

/** Dashed "Add" pill (can be a menu or popover trigger). */
export const AddPill = forwardRef<HTMLButtonElement, { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>>(function AddPill({ children, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className="hov h-[26px] cursor-pointer rounded-[13px] border border-dashed border-border-strong bg-transparent px-2.5 text-[12.5px] text-text-2" {...rest}>
      {children}
    </button>
  );
});

/** Initials in a circle for a person. */
export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-surface-3 text-tiny font-semibold">{initials}</span>;
}

/** A company's letter mark; `strong` for a company that is set up. */
export function Monogram({ name, strong }: { name: string; strong?: boolean }) {
  return (
    <span className={cx('inline-flex size-9 shrink-0 items-center justify-center rounded-item font-semibold', strong ? 'bg-text text-bg' : 'bg-surface-3 text-text-2')}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Two or three inline radio choices. */
export function InlineRadios<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-5">
      {options.map((o) => (
        <label key={o.value} className={cx('inline-flex items-center gap-2', disabled ? 'opacity-45' : 'cursor-pointer')}>
          <input type="radio" checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} className="m-0 accent-[var(--accent)]" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- tables

/** A table in a card. `columns` is a CSS grid template shared by the header and every row. */
export function Table({ columns, head, children, minWidth = 820 }: { columns: string; head: ReactNode[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-auto rounded-panel border border-border bg-surface">
      <div style={{ minWidth }}>
        <div className="grid h-[38px] items-center gap-x-3.5 border-b border-border pl-[18px] pr-3.5 text-[12.5px] text-text-3" style={{ gridTemplateColumns: columns }}>
          {head.map((h, i) => (
            <span key={i}>{h}</span>
          ))}
        </div>
        <TableColumns.Provider value={columns}>{children}</TableColumns.Provider>
      </div>
    </div>
  );
}

const TableColumns = createContext('1fr');

/** A table row; clickable rows (onClick or to) get a hover. */
export function TableRow({ children, onClick, to, label }: { children: ReactNode; onClick?: () => void; to?: string; label?: string }) {
  const columns = useContext(TableColumns);
  const cls = 'grid w-full min-h-11 items-center gap-x-3.5 border-0 border-t border-hairline bg-transparent py-1 pl-[18px] pr-3.5 text-left text-small text-text no-underline first:border-t-0';
  if (to) {
    return (
      <Link to={to} aria-label={label} className={cx(cls, 'hov')} style={{ gridTemplateColumns: columns }}>
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" aria-label={label} onClick={onClick} className={cx(cls, 'hov cursor-pointer')} style={{ gridTemplateColumns: columns }}>
        {children}
      </button>
    );
  }
  return (
    <div className={cls} style={{ gridTemplateColumns: columns }}>
      {children}
    </div>
  );
}
