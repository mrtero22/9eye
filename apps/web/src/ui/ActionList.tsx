// A plain list of things that can be done from a sidebar (Playlist → Day: "Add to playlist"), each
// with the reason under it while it cannot be used; steps of a sequence with their state and a run
// button ("Steps for this day"); and a label / value list for a details panel.

import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';

export function ActionList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-0.5">
      <span className="px-3 pb-1 text-small text-text-3">{label}</span>
      {children}
    </div>
  );
}

/** One action. While `disabled`, `hint` says why ("Select a block first"). */
export function ActionItem({ label, hint, disabled, onClick }: { label: string; hint?: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx('flex min-h-[34px] w-full flex-col items-start justify-center rounded-item border-0 bg-transparent px-3 py-1.5 text-left leading-snug', disabled ? 'cursor-default' : 'hov cursor-pointer')}
    >
      <span className={cx('font-medium', disabled && 'text-text-3')}>{label}</span>
      {disabled && hint && <span className="text-tiny text-text-3">{hint}</span>}
    </button>
  );
}

export type StepTone = 'none' | 'todo' | 'partial' | 'done';
const STEP_DOT: Record<StepTone, string> = { none: 'bg-border-strong', todo: 'bg-amber', partial: 'bg-amber', done: 'bg-green' };

/**
 * One step of a sequence: its state as a dot and a short line ("8 of 12 placed"), and a button that
 * runs it. While `disabled`, `hint` says why.
 */
export function StepItem({ label, tone, text, runLabel, onRun, disabled, hint }: { label: string; tone: StepTone; text: string; runLabel: string; onRun: () => void; disabled?: boolean; hint?: string | null }) {
  return (
    <div role="group" aria-label={label} className="flex items-start gap-2.5 px-3 py-1.5">
      <span aria-hidden className={cx('mt-[7px] size-2 shrink-0 rounded-full', STEP_DOT[tone])} />
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        <span className="font-medium">{label}</span>
        <span className="text-tiny text-text-3">{text}</span>
        {disabled && hint && <span className="text-tiny text-text-3">{hint}</span>}
      </span>
      <Button size="xs" disabled={disabled} title={disabled && hint ? hint : undefined} aria-label={`${runLabel}: ${label}`} onClick={onRun}>
        {runLabel}
      </Button>
    </div>
  );
}

/** A bar that stays at the bottom while rows are ticked: how many, a total, what can be done with them. */
export function SelectionBar({ count, detail, children, onClear }: { count: string; detail?: ReactNode; children: ReactNode; onClear: () => void }) {
  return (
    <div role="region" aria-label="Selection" className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2.5 rounded-card border border-border bg-surface py-2 pl-4 pr-2.5 shadow-pop">
      <span className="font-medium">{count}</span>
      {detail && <span className="mono text-text-2">{detail}</span>}
      <span className="flex-1" />
      {children}
      <button type="button" onClick={onClear} className="hov h-ctl cursor-pointer rounded-ctl border-0 bg-transparent px-2.5 text-text-2">
        Clear
      </button>
    </div>
  );
}

export interface DetailItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
  tone?: 'amber' | 'red' | 'accent';
}

/** Facts of the selected thing, label on the left. Items without a value are left out. */
export function DetailList({ items }: { items: (DetailItem | null | false)[] }) {
  const shown = items.filter((i): i is DetailItem => !!i && i.value !== null && i.value !== undefined && i.value !== '');
  return (
    <dl className="m-0 grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2.5 text-small">
      {shown.map((i) => (
        <div key={i.label} className="contents">
          <dt className="text-text-3">{i.label}</dt>
          <dd className={cx('m-0 [overflow-wrap:anywhere]', i.mono && 'mono', i.tone === 'amber' && 'text-amber-text', i.tone === 'red' && 'text-red-text', i.tone === 'accent' && 'text-accent-text')}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
