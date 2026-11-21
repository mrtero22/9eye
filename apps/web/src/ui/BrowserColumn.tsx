// A column of a hierarchy browser (the Catalog page, catalog-page.md "A column"): header with
// collapse, title, Create and "⋯"; a toolbar with search, advanced search, order by, an optional
// filter, refresh and tick-all; the rows; a footer with the count. Collapsed, it is a narrow strip
// that shows what is selected in it.

import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { Checkbox, SearchField } from './fields';
import { cx } from './cx';
import { safeColor } from './color';
import { Icon } from './icons';
import { Menu, MenuItem, MenuLabel, Popover } from './overlays';

/** Swatch colour of a row: a data colour, or one of the content-type tokens. */
export type RowSwatch = { color: string | null } | { token: 'filler' | 'jingle' | 'promo' | 'program' };

const TOKEN_BG: Record<'filler' | 'jingle' | 'promo' | 'program', string> = {
  filler: 'bg-[var(--ct-filler)]',
  jingle: 'bg-[var(--ct-jingle)]',
  promo: 'bg-[var(--ct-promo)]',
  program: 'bg-[var(--ct-program)]',
};

function SwatchOf({ swatch }: { swatch: RowSwatch }) {
  if ('token' in swatch) return <span aria-hidden="true" className={cx('size-[7px] shrink-0 rounded-[2px]', TOKEN_BG[swatch.token])} />;
  return <span aria-hidden="true" className="size-[7px] shrink-0 rounded-[2px]" style={{ background: safeColor(swatch.color) }} />;
}

export interface BrowserColumnProps {
  title: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Shown on the collapsed strip. */
  selected: { name: string; swatch: RowSwatch } | null;
  createLabel: string;
  createDisabled?: boolean;
  createHint?: string;
  onCreate: () => void;
  /** The column's "⋯" actions (MenuItem). */
  menu: ReactNode;
  search: string;
  onSearch: (v: string) => void;
  /** Advanced search: on (icon in the accent colour) and its conditions as a tooltip. */
  advanced: { on: boolean; summary: string; onOpen: () => void };
  sort: { fields: string[]; field: string | null; dir: 'asc' | 'desc'; onPick: (field: string) => void };
  /** Show expired (contents and productions only). */
  expired?: { on: boolean; onChange: (v: boolean) => void };
  onRefresh: () => void;
  allTicked: boolean;
  onTickAll: (v: boolean) => void;
  /** "275 results", "1 033 results · first 160 shown". */
  count: string;
  footer?: string;
  /** Text when there are no rows (null while loading). */
  empty: string | null;
  children: ReactNode;
}

export function BrowserColumn(p: BrowserColumnProps) {
  if (p.collapsed) {
    return (
      <button
        type="button"
        onClick={p.onToggleCollapse}
        aria-label={`Open ${p.title}`}
        title={`Open ${p.title}`}
        className="hov flex h-[720px] flex-[0_0_44px] cursor-pointer flex-col items-center gap-3.5 rounded-card border border-border bg-surface px-0 py-3"
      >
        <Icon name="chevronRight" size={16} className="shrink-0 text-text-3" />
        <span className="rotate-180 whitespace-nowrap text-small font-semibold [writing-mode:vertical-rl]">{p.title}</span>
        <span className="flex max-h-[520px] rotate-180 items-center gap-1.5 overflow-hidden whitespace-nowrap text-small text-text-2 [writing-mode:vertical-rl]">
          {p.selected ? <SwatchOf swatch={p.selected.swatch} /> : <span aria-hidden="true" className="size-[7px] shrink-0 rounded-[2px] bg-border-strong" />}
          {p.selected?.name ?? 'Nothing selected'}
        </span>
      </button>
    );
  }
  return (
    <section aria-label={p.title} className="relative flex h-[720px] min-w-[200px] flex-[1_1_220px] flex-col rounded-card border border-border bg-surface">
      <div className="flex h-[46px] items-center gap-1 border-b border-hairline pl-1 pr-1.5">
        <IconButton icon="chevronLeft" label={`Collapse ${p.title}`} size="sm" tone="quiet" onClick={p.onToggleCollapse} />
        <span className="min-w-0 flex-1 truncate font-semibold">{p.title}</span>
        <IconButton icon="plus" label={p.createDisabled && p.createHint ? `${p.createLabel} · ${p.createHint}` : p.createLabel} size="sm" disabled={p.createDisabled} onClick={p.onCreate} />
        <Menu label={`${p.title} actions`} width={260} trigger={<IconButton icon="more" label={`${p.title} actions`} size="sm" />}>
          {p.menu}
        </Menu>
      </div>
      <div className="flex items-center gap-0.5 py-2 pl-2 pr-1.5">
        <div className="min-w-0 flex-1">
          <SearchField value={p.search} onChange={p.onSearch} placeholder="Search" label={`Search ${p.title}`} size="sm" />
        </div>
        <IconButton icon="sliders" label={p.advanced.on ? `Advanced search · ${p.advanced.summary}` : 'Advanced search'} size="sm" className={p.advanced.on ? 'text-accent' : 'text-text-3'} onClick={p.advanced.onOpen} />
        <Menu label="Order by" width={220} trigger={<IconButton icon="sort" label="Order by" size="sm" tone="quiet" />}>
          <MenuLabel>Order by</MenuLabel>
          {p.sort.fields.map((f) => (
            <MenuItem key={f} onSelect={() => p.sort.onPick(f)}>
              <span className={cx('flex w-full items-center justify-between text-small', p.sort.field === f && 'text-accent-text')}>
                {f}
                <span aria-hidden="true">{p.sort.field === f ? (p.sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
              </span>
            </MenuItem>
          ))}
        </Menu>
        {p.expired && (
          <Popover
            label="Filters"
            width={220}
            padding="p-3"
            trigger={<IconButton icon="filter" label="Filters · Show expired" size="sm" className={p.expired.on ? 'text-accent' : 'text-text-3'} />}
          >
            <label className="flex items-center justify-between gap-2.5 text-small">
              Show expired
              <input type="checkbox" checked={p.expired.on} onChange={(e) => p.expired!.onChange(e.target.checked)} className="m-0 size-[15px] accent-[var(--accent)]" />
            </label>
          </Popover>
        )}
        <IconButton icon="refresh" label="Refresh" size="sm" tone="quiet" onClick={p.onRefresh} />
        <span className="ml-1 mr-1.5 inline-flex">
          <Checkbox checked={p.allTicked} onChange={p.onTickAll} label={`Tick all ${p.title}`} />
        </span>
      </div>
      <div role="list" className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {p.children}
        {p.empty && <div className="px-2 py-4 text-small text-text-3">{p.empty}</div>}
      </div>
      <div className="flex h-9 items-center justify-between gap-2 border-t border-hairline px-3 text-meta text-text-3">
        <span>{p.count}</span>
        {p.footer && <span className="mono truncate">{p.footer}</span>}
      </div>
    </section>
  );
}

export interface BrowserRowProps {
  name: string;
  swatch: RowSwatch;
  checked: boolean;
  onCheck: (v: boolean) => void;
  selected: boolean;
  onSelect: () => void;
  meta?: string;
  metaTone?: 'amber' | null;
  /** Media is available: a small green dot. */
  media?: boolean;
  /** The last inserted item of a rotation list: a thin accent bar. */
  last?: boolean;
  /** Shown on the selected row. */
  onRelations?: () => void;
}

export function BrowserRow(p: BrowserRowProps) {
  return (
    <div role="listitem" className={cx('flex min-h-row items-center gap-1.5 rounded-ctl px-1', p.selected ? 'bg-accent-soft' : 'bg-transparent')}>
      <Checkbox checked={p.checked} onChange={p.onCheck} label={`Tick ${p.name}`} />
      <button
        type="button"
        onClick={p.onSelect}
        aria-pressed={p.selected}
        title={p.name}
        className={cx('flex min-h-row min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent px-0.5 text-left text-small text-text', p.selected && 'font-semibold')}
      >
        <SwatchOf swatch={p.swatch} />
        {p.media && <span role="img" aria-label="Media is available" title="Media is available" className="size-1.5 shrink-0 rounded-full bg-green" />}
        {p.last && <span role="img" aria-label="Last item inserted" title="Last item inserted" className="h-3.5 w-[3px] shrink-0 rounded-[1px] bg-accent" />}
        <span className="truncate">{p.name}</span>
        {p.meta && <span className={cx('mono ml-auto shrink-0 pl-1.5 text-[11.5px] font-normal', p.metaTone === 'amber' ? 'text-amber-text' : 'text-text-3')}>{p.meta}</span>}
      </button>
      {p.selected && p.onRelations && <IconButton icon="link" label="Related items" size="xs" onClick={p.onRelations} />}
    </div>
  );
}
