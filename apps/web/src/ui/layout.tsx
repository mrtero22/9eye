// Page building blocks of the calm layout: header, context pickers, left list, side panel, notices.

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, type Tone } from './Badge';
import { cx } from './cx';
import { safeColor } from './color';
import { SearchField } from './fields';
import { Icon } from './icons';
import { IconButton } from './Button';
import { Popover } from './overlays';

/**
 * Something the app shows at the end of every page header's actions (the Agent button of decision
 * 0024, phase B): set by the app shell, read by PageHeader.
 */
export const HeaderExtra = createContext<ReactNode>(null);

export function PageHeader({
  title,
  description,
  context,
  actions,
  back,
  mark,
}: {
  title: string;
  description?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  /** A quiet link back to the page this one was opened from ("‹ Scheduling · LUMEN PLUS HD"). */
  back?: { label: string; to?: string; onClick?: () => void };
  /** A data colour shown as a small square before the title (an order's colour). */
  mark?: string | null;
}) {
  return (
    <header className="flex flex-wrap items-end gap-x-4 gap-y-3 px-4 pt-6 sm:px-8 sm:pt-7">
      <div className="relative flex min-w-0 flex-col gap-1.5">
        {back &&
          (back.onClick ? (
            <button type="button" onClick={back.onClick} className="hov -ml-1.5 inline-flex h-[26px] cursor-pointer items-center gap-1 self-start rounded-ctl border-0 bg-transparent px-1.5 text-small text-text-3">
              <Icon name="chevronLeft" size={14} />
              {back.label}
            </button>
          ) : (
            <Link to={back.to ?? '/'} className="hov -ml-1.5 inline-flex h-[26px] items-center gap-1 self-start rounded-ctl px-1.5 text-small text-text-3 no-underline">
              <Icon name="chevronLeft" size={14} />
              {back.label}
            </Link>
          ))}
        <h1 className="m-0 flex items-center gap-2.5 text-title font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">
          {mark !== undefined && <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: safeColor(mark) }} />}
          {title}
        </h1>
        {description && <span className="text-text-2">{description}</span>}
        {context && <div className="-ml-2 flex flex-wrap items-center gap-1">{context}</div>}
      </div>
      <span className="flex-1" />
      <HeaderActions actions={actions} />
    </header>
  );
}

function HeaderActions({ actions }: { actions?: ReactNode }) {
  const extra = useContext(HeaderExtra);
  if (!actions && !extra) return null;
  return (
    <div className="no-print relative flex flex-wrap items-center gap-2">
      {actions}
      {extra}
    </div>
  );
}

export function ContextText({ children }: { children: ReactNode }) {
  return (
    <>
      <span aria-hidden="true" className="text-text-3">
        ·
      </span>
      <span className="px-1.5 text-text-2">{children}</span>
    </>
  );
}

/** A quiet link in the context row, e.g. "Change in channel settings". */
export function ContextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="no-print rounded-ctl px-1.5 text-small font-medium text-accent-text no-underline hover:underline">
      {children}
    </Link>
  );
}

export interface PickerItem {
  id: string;
  name: string;
  meta?: string;
}

/** Quiet text-button picker with a searchable list (channel, playlist, date). */
export function ContextPicker({ value, items, onPick, label, searchLabel, placeholder }: { value: string; items: PickerItem[]; onPick: (id: string) => void; label: string; searchLabel: string; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? items.filter((i) => i.name.toLowerCase().includes(n)) : items;
  }, [items, q]);
  const current = items.find((i) => i.id === value);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
      label={label}
      width={280}
      padding="p-2"
      trigger={
        <button type="button" aria-label={`${label}: ${current?.name ?? 'none'}`} className="ctl hov inline-flex h-ctl cursor-pointer items-center gap-1.5 rounded-ctl border-0 bg-transparent px-2 font-medium text-text-2">
          {current?.name ?? placeholder ?? `Pick a ${label.toLowerCase()}`}
          <Icon name="chevronDown" size={14} />
        </button>
      }
    >
      <SearchField value={q} onChange={setQ} placeholder={`Search ${items.length} ${searchLabel}`} label={`Search ${searchLabel}`} size="sm" autoFocus />
      <div className="flex max-h-[360px] flex-col overflow-y-auto">
        {shown.map((i) => (
          <button
            key={i.id}
            type="button"
            aria-current={i.id === value}
            onClick={() => {
              onPick(i.id);
              setOpen(false);
              setQ('');
            }}
            className={cx('hov flex min-h-8 cursor-pointer items-center justify-between gap-2 rounded-ctl border-0 px-2 text-left text-small', i.id === value ? 'bg-accent-soft font-semibold' : 'bg-transparent')}
          >
            <span>{i.name}</span>
            {i.meta && <span className="text-meta font-normal text-text-3">{i.meta}</span>}
          </button>
        ))}
        {!shown.length && <span className="px-2 py-2 text-small text-text-3">Nothing found.</span>}
      </div>
    </Popover>
  );
}

/**
 * The calm three-part body: list on the left, main area, optional details panel on the right.
 * `wide`: a 280–310 px sidebar and no right panel (pages that show a schedule, e.g. Scheduling).
 * `left={null}`: the left column is hidden and the main area takes its room.
 */
export function EditorLayout({ left, main, panel, wide, leftLabel }: { left: ReactNode; main: ReactNode; panel?: ReactNode; wide?: boolean; leftLabel?: string }) {
  return (
    <div className={cx('flex flex-wrap items-start px-4 pb-8 sm:px-8', wide ? 'gap-7 pt-5' : 'gap-6 pt-6')}>
      {left != null && (
        <div aria-label={leftLabel} role={leftLabel ? 'complementary' : undefined} className={cx('no-print flex min-w-0 flex-col', wide ? 'flex-[1_1_280px] gap-5 sm:max-w-[310px]' : 'flex-[1_1_220px] gap-3.5 sm:max-w-[260px]')}>
          {left}
        </div>
      )}
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">{main}</div>
      {panel}
    </div>
  );
}

export function ListGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-3 pb-1 text-small text-text-3">{label}</span>
      {children}
    </div>
  );
}

export function ListItem({ title, meta, badge, selected, onClick }: { title: string; meta?: ReactNode; badge?: { label: string; tone: Tone }; selected?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx('hov flex w-full cursor-pointer flex-col gap-0.5 rounded-item border-0 px-3 py-2.5 text-left', selected ? 'bg-accent-soft' : 'bg-transparent')}
    >
      <span className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{title}</span>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </span>
      {meta && <span className="text-small text-text-3">{meta}</span>}
    </button>
  );
}

export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside aria-label={title} className="no-print flex min-w-[280px] max-w-full flex-[1_1_340px] flex-col rounded-card border border-border bg-surface sm:max-w-[360px]">
      <div className="flex h-12 items-center justify-between border-b border-hairline pl-4 pr-2">
        <span className="font-semibold">{title}</span>
        <IconButton icon="close" label="Close panel" onClick={onClose} />
      </div>
      {children}
    </aside>
  );
}

export function PanelSection({ title, aside, children }: { title?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex flex-col gap-2">
      {(title || aside) && (
        <div className="flex items-baseline justify-between gap-2">
          {title && <span className="font-medium">{title}</span>}
          {aside && <span className="text-meta text-text-3">{aside}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Bordered list of compact rows with an optional muted footer row. */
export function RowList({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-item border border-border [&>*+*]:border-t [&>*+*]:border-hairline">
      {children}
      {footer && <div className="flex min-h-8 items-center bg-surface-2 px-2.5 text-meta text-text-3">{footer}</div>}
    </div>
  );
}

/**
 * The screen before sign-in: the product mark (and a quiet corner action) on top, the form in the
 * middle, one quiet line at the bottom; from 1024 px a picture of the product on the right.
 */
export function SignInLayout({ brand, corner, footer, aside, children }: { brand: ReactNode; corner?: ReactNode; footer?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-surface text-text lg:grid-cols-[minmax(480px,5fr)_7fr]">
      <div className="flex min-h-screen min-w-0 flex-col px-4 py-5 sm:px-10 sm:py-8">
        <header className="flex items-center justify-between gap-4">
          {brand}
          {corner}
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[360px]">{children}</div>
        </main>
        {footer && <footer className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-text-3">{footer}</footer>}
      </div>
      {aside && <aside className="hidden min-w-0 items-center justify-center border-l border-border bg-surface-2 p-12 lg:flex">{aside}</aside>}
    </div>
  );
}

export function Notice({ tone = 'neutral', children, action }: { tone?: 'neutral' | 'amber' | 'red' | 'accent' | 'green'; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role={tone === 'neutral' || tone === 'accent' || tone === 'green' ? 'status' : 'alert'}
      className={cx(
        'flex items-start gap-2 rounded-item px-3 py-2 text-small',
        tone === 'neutral' && 'bg-surface-2 text-text-2',
        tone === 'accent' && 'items-center bg-accent-soft text-accent-text',
        tone === 'green' && 'bg-green-soft text-green-text',
        tone === 'amber' && 'bg-amber-soft text-amber-text',
        tone === 'red' && 'bg-red-soft text-red-text',
      )}
    >
      {(tone === 'amber' || tone === 'red') && <Icon name="alert" size={15} className="mt-0.5 shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-item border border-dashed border-border-strong p-3 text-small text-text-3">
      <span>{children}</span>
      {action}
    </div>
  );
}

/** Status strip above a grid or table. */
export function StatusBar({ children }: { children: ReactNode }) {
  return <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-item bg-surface-2 px-3.5 py-2.5 text-small">{children}</div>;
}
