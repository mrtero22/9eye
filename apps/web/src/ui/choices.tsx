import * as RSwitch from '@radix-ui/react-switch';
import type { ReactNode } from 'react';
import { WEEKDAYS, weekOrder } from '@9eye/core';
import { cx } from './cx';

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      disabled={disabled}
      className={cx('flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-[10px] border-0 p-0.5', checked ? 'justify-end bg-accent' : 'justify-start bg-border-strong')}
    >
      <RSwitch.Thumb className="block size-4 rounded-full bg-white shadow-knob" />
    </RSwitch.Root>
  );
}

/** An option with a title, a one-line description and a switch. */
export function SwitchRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{title}</span>
        <span className="text-small text-text-2">{description}</span>
      </span>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

/** Two to four mutually exclusive options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'md' | 'sm';
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-[7px] bg-surface-2 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex-1 cursor-pointer whitespace-nowrap rounded-[5px] border-0 px-1.5 font-medium',
              size === 'md' ? 'h-7 text-[13px]' : 'h-[26px] text-meta',
              on ? 'bg-surface text-text shadow-seg' : 'bg-transparent text-text-2',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Larger exclusive choices, each a short sentence. */
export function RadioList<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex min-h-[30px] cursor-pointer items-center gap-2 rounded-ctl border px-2 text-left text-small',
              on ? 'border-[color-mix(in_srgb,var(--accent)_45%,var(--surface))] bg-accent-soft' : 'border-border bg-surface',
            )}
          >
            <span className={cx('size-3 shrink-0 rounded-full border-2', on ? 'border-accent bg-accent' : 'border-border-strong bg-transparent')} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Seven weekday toggles in the channel's week order. `plain`: active days of a template;
 * `accent`: choosing days for an action.
 */
export function DayToggles({
  value,
  onToggle,
  weekStart,
  label,
  tone = 'plain',
  size = 'md',
}: {
  value: boolean[];
  onToggle: (weekday: number) => void;
  weekStart: number;
  label: string;
  tone?: 'plain' | 'accent';
  size?: 'md' | 'sm';
}) {
  return (
    <span role="group" aria-label={label} className="inline-flex items-center gap-1">
      {weekOrder(weekStart).map((d) => {
        const on = !!value[d];
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            aria-label={`${WEEKDAYS[d].long}${tone === 'plain' ? (on ? ', active' : ', not active') : ''}`}
            onClick={() => onToggle(d)}
            className={cx(
              'h-[26px] cursor-pointer rounded-ctl border-0 text-[11.5px] font-medium',
              size === 'md' ? 'w-[26px]' : 'w-[30px]',
              tone === 'plain' && (on ? 'bg-surface text-text' : 'bg-transparent text-text-3'),
              tone === 'accent' && (on ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-text-3'),
            )}
          >
            {WEEKDAYS[d].mini}
          </button>
        );
      })}
    </span>
  );
}

/** Tabs of a dialog or panel; a tab with unsaved changes shows a red "!". */
export function TabBar<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: { value: T; label: string; changed?: boolean }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-0.5 self-start rounded-[7px] bg-surface-2 p-0.5">
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cx('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[5px] border-0 px-2.5 text-[12.5px] font-medium', on ? 'bg-surface text-text shadow-seg' : 'bg-transparent text-text-2')}
          >
            {t.label}
            {t.changed && (
              <span title="Unsaved changes" className="text-red">
                !
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
