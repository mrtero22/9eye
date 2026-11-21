import type { ReactNode } from 'react';
import { cx } from './cx';
import { safeColor } from './color';

export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'accent';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-text-2',
  green: 'bg-green-soft text-green-text',
  amber: 'bg-amber-soft text-amber-text',
  red: 'bg-red-soft text-red-text',
  accent: 'bg-accent-soft text-accent-text',
};

/** Status badge (status only — colour means status, 0003). */
export function Badge({ tone = 'neutral', round, children, className }: { tone?: Tone; round?: boolean; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center whitespace-nowrap font-medium',
        round ? 'h-6 rounded-[12px] px-[9px] text-meta' : 'h-5 rounded-badge px-[7px] text-[11.5px]',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Small round chip, e.g. a column state ("Same as Saturday", "Own layout"). */
export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex h-[18px] items-center self-start whitespace-nowrap rounded-[9px] px-1.5 text-tiny font-medium', TONE[tone])}>{children}</span>;
}

/** 8 px square in a data colour. */
export function Swatch({ color, size = 8 }: { color: string | null | undefined; size?: number }) {
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-[2px]" style={{ width: size, height: size, background: safeColor(color) }} />;
}

/** Colour choice from a few data colours (an order's block colour); the last can be kept off ("grey"). */
export function SwatchPicker({
  colors,
  value,
  onChange,
  label,
  disabled,
  offLast,
}: {
  colors: string[];
  value: string | null;
  onChange: (c: string) => void;
  label: string;
  disabled?: boolean;
  /** The last colour is shown but cannot be picked (e.g. grey, kept for blocks without airings). */
  offLast?: { reason: string };
}) {
  return (
    <span role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {colors.map((c, i) => {
        const on = value?.toLowerCase() === c.toLowerCase();
        const off = disabled || (!!offLast && i === colors.length - 1);
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={offLast && i === colors.length - 1 ? offLast.reason : `Colour ${i + 1}`}
            title={offLast && i === colors.length - 1 ? offLast.reason : undefined}
            disabled={off}
            onClick={() => onChange(c)}
            className={cx('size-6 cursor-pointer rounded-ctl border-2 p-0', on ? 'border-text' : 'border-transparent')}
            style={{ background: safeColor(c) }}
          />
        );
      })}
    </span>
  );
}
