// A round on / off chip for filters: `accent` (a filter with a tick), `strong` (one of a set, e.g. a
// mode with its count), `amber` (a warning filter such as "Needs attention").

import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';

export function ToggleChip({
  on,
  onClick,
  children,
  count,
  tone = 'accent',
  hint,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  tone?: 'accent' | 'strong' | 'amber';
  hint?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={hint}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[14px] border px-2.5 text-[12.5px] font-medium',
        !on && 'hov border-border bg-surface text-text-2',
        on && tone === 'accent' && 'border-accent bg-accent-soft text-accent-text',
        on && tone === 'strong' && 'border-text bg-text text-bg',
        on && tone === 'amber' && 'border-amber bg-amber-soft text-amber-text',
      )}
    >
      {tone === 'accent' && (
        <span aria-hidden="true" className="inline-flex w-3">
          {on && <Icon name="check" size={12} strokeWidth={2.25} />}
        </span>
      )}
      {tone === 'amber' && <Icon name="alert" size={12} strokeWidth={2} />}
      {children}
      {count !== undefined && <span className={cx('mono text-tiny', on && tone === 'strong' ? 'text-bg' : 'text-text-3', on && tone === 'amber' && 'text-amber-text')}>{count}</span>}
    </button>
  );
}
