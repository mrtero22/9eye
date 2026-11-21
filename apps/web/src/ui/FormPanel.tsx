// The form beside a hierarchy browser (the Catalog page, catalog-page.md "Form panel"): entity and
// name, "Unsaved", Relations; fields in collapsible groups (closed groups say "N fields"); Cancel and
// Save / Create. Plus the field kinds such forms need that the other fields do not cover.

import { useState, type ReactNode } from 'react';
import { formatTc, parseTc, type FrameRate } from '@9eye/core';
import { Badge } from './Badge';
import { Button, IconButton } from './Button';
import { DatePicker } from './DatePicker';
import { CommitField, Field } from './fields';
import { Switch } from './choices';
import { cx } from './cx';
import { Icon } from './icons';

export function FormPanel({
  entity,
  title,
  dirty,
  onRelations,
  children,
  emptyText,
  onCancel,
  onSave,
  saveLabel,
  saveDisabled,
  error,
}: {
  entity: string;
  title: string;
  dirty: boolean;
  onRelations?: () => void;
  children?: ReactNode;
  /** Shown instead of the fields when nothing is selected. */
  emptyText?: string;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  /** A server refusal, shown above the footer. */
  error?: ReactNode;
}) {
  return (
    <aside aria-label={`${entity || 'Item'} form`} className="flex h-[720px] min-w-[300px] max-w-[440px] flex-[1_1_340px] flex-col rounded-card border border-border bg-surface">
      <div className="flex min-h-[46px] items-center gap-2 border-b border-hairline py-1.5 pl-3.5 pr-2">
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-meta text-text-3">{entity}</span>
          <span className="truncate font-semibold">{title}</span>
        </span>
        {dirty && <Badge tone="amber">Unsaved</Badge>}
        {onRelations && (
          <Button size="sm" icon="link" onClick={onRelations}>
            Related items
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 pb-3.5 pt-1">
        {emptyText ? <div className="py-4 text-small text-text-3">{emptyText}</div> : children}
      </div>
      {error && <div className="border-t border-hairline px-3 pt-2.5">{error}</div>}
      <div className="flex justify-end gap-2 border-t border-hairline px-3 py-2.5">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={saveDisabled} onClick={onSave}>
          {saveLabel}
        </Button>
      </div>
    </aside>
  );
}

/** A collapsible group of fields; closed, it says how many fields it holds. */
export function FormGroup({ label, count, open, onToggle, last, children }: { label: string; count: number; open: boolean; onToggle: () => void; last?: boolean; children: ReactNode }) {
  return (
    <div className={cx('flex flex-col', !last && 'border-b border-hairline')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="hov -mx-1.5 mt-1.5 flex h-9 cursor-pointer items-center gap-1.5 rounded-ctl border-0 bg-transparent px-1.5 text-left text-small font-semibold"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} className="text-text-3" />
        <span className="flex-1">{label}</span>
        {!open && <span className="text-meta font-normal text-text-3">{count} fields</span>}
      </button>
      {open && <div className="flex flex-col gap-3 pb-3.5 pt-1">{children}</div>}
    </div>
  );
}

/** A label with the required mark. */
export const Req = ({ children, required }: { children: ReactNode; required?: boolean }) => (
  <span>
    {children}
    {required && <span className="text-red-text"> *</span>}
  </span>
);

/** An on / off field: the label on the left, the switch on the right. */
export function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="flex min-h-7 items-center justify-between gap-3 text-small">
      {label}
      <Switch checked={checked} onChange={onChange} label={label} />
    </span>
  );
}

/** A value that is shown but not edited here (grey). Optional buttons under it (disabled with a reason). */
export function ReadValue({ label, value, required, mono, hint, actions }: { label: string; value: string | null; required?: boolean; mono?: boolean; hint?: string; actions?: { label: string; disabledReason: string }[] }) {
  return (
    <div className="flex flex-col gap-1 text-meta text-text-2">
      <Req required={required}>{label}</Req>
      <span className={cx('flex min-h-[30px] items-center rounded-ctl bg-surface-2 px-2.5 py-1 text-small [overflow-wrap:anywhere]', value ? 'text-text' : 'text-text-3', mono && 'mono')}>{value || '—'}</span>
      {actions && (
        <span className="flex flex-wrap gap-1.5">
          {actions.map((a) => (
            <Button key={a.label} size="sm" disabled title={a.disabledReason}>
              {a.label}
            </Button>
          ))}
        </span>
      )}
      {hint && <span className="text-meta text-text-3">{hint}</span>}
    </div>
  );
}

/** Many values as chips, with "+ Add" to pick another. */
export function ChipsField({
  label,
  values,
  options,
  onChange,
  hint,
}: {
  label: string;
  values: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
  hint?: string;
}) {
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const free = options.filter((o) => !values.includes(o.value));
  return (
    <div className="flex flex-col gap-1 text-meta text-text-2">
      {label}
      <span className="flex min-h-ctl flex-wrap items-center gap-1 rounded-ctl border border-border-strong bg-surface px-1 py-[3px]">
        {values.map((v) => (
          <span key={v} className="inline-flex h-[22px] items-center gap-1 rounded-[11px] bg-surface-2 pl-2 pr-1 text-meta text-text">
            {labelOf(v)}
            <button
              type="button"
              aria-label={`Remove ${labelOf(v)}`}
              title={`Remove ${labelOf(v)}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="hov inline-flex size-4 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-text-3"
            >
              <Icon name="close" size={10} strokeWidth={2} />
            </button>
          </span>
        ))}
        <select
          aria-label={`Add to ${label}`}
          value=""
          onChange={(e) => e.target.value && onChange([...values, e.target.value])}
          className="h-6 border-0 bg-transparent text-meta text-text-3"
        >
          <option value="">+ Add</option>
          {free.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      {hint && <span className="text-text-3">{hint}</span>}
    </div>
  );
}

/** A calendar day that may be empty: "No date · Set date", else the shared date picker with Clear. */
export function OptionalDateField({ label, value, onChange, weekStart, today }: { label: string; value: string | null; onChange: (v: string | null) => void; weekStart: number; today: string }) {
  if (!value) {
    return (
      <div className="flex flex-col gap-1 text-meta text-text-2">
        {label}
        <span className="flex h-ctl items-center justify-between gap-2 rounded-ctl border border-dashed border-border-strong pl-2.5 pr-1 text-small text-text-3">
          No date
          <Button size="xs" onClick={() => onChange(today)} aria-label={`Set ${label}`}>
            Set date
          </Button>
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-1">
      <div className="min-w-0 flex-1">
        <DatePicker mode="day" variant="field" label={label} value={value} onChange={(v) => onChange(v.value)} weekStart={weekStart} today={today} />
      </div>
      <IconButton icon="close" label={`Clear ${label}`} tone="quiet" onClick={() => onChange(null)} />
    </div>
  );
}

/** A timecode in the catalog's frame rate; empty = no value (when `nullable`). */
export function TimecodeField({ label, value, onChange, rate, required, nullable = true, hint, hintTone }: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  rate: FrameRate;
  required?: boolean;
  nullable?: boolean;
  hint?: string;
  hintTone?: 'amber';
}) {
  return (
    <CommitField<number | null>
      label={<Req required={required}>{label}</Req>}
      value={value}
      format={(v) => (v === null ? '' : formatTc(v, rate))}
      parse={(s) => (s.trim() === '' ? (nullable ? null : 0) : parseTc(s, rate, { maxHours: 999 }))}
      onCommit={(v) => onChange(v)}
      placeholder={formatTc(0, rate)}
      ariaLabel={label}
      hint={hint ? <span className={hintTone === 'amber' ? 'text-amber-text' : undefined}>{hint}</span> : undefined}
    />
  );
}

/**
 * A number; whole unless `decimals` allows more. Empty = no value (when `nullable`), else `min` (or 0
 * when 0 is allowed). An optional `suffix` ("%") sits inside the box.
 */
export function NumberField({
  label,
  value,
  onChange,
  required,
  nullable,
  min = 0,
  max,
  decimals = 0,
  suffix,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  required?: boolean;
  nullable?: boolean;
  min?: number;
  max?: number;
  decimals?: number;
  suffix?: string;
  hint?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const pattern = decimals > 0 ? new RegExp(`^-?\\d+([.,]\\d{0,${decimals}})?$`) : /^-?\d+$/;
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, n));
  return (
    <Field label={<Req required={required}>{label}</Req>} hint={hint}>
      <span className="flex h-8 w-full items-center rounded-ctl border border-border-strong bg-surface px-2">
        <input
          inputMode={decimals > 0 ? 'decimal' : 'numeric'}
          aria-label={label}
          value={text ?? (value === null ? '' : String(value))}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (t.trim() === '') onChange(nullable ? null : clamp(0));
            else if (pattern.test(t.trim())) onChange(clamp(Number(t.trim().replace(',', '.'))));
          }}
          onBlur={() => setText(null)}
          className="mono h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-small text-text outline-none"
        />
        {suffix && <span className="mono text-small text-text-3">{suffix}</span>}
      </span>
    </Field>
  );
}
