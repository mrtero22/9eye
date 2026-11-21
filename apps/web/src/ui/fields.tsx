import { useEffect, useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { IconButton } from './Button';
import { cx } from './cx';
import { Icon } from './icons';

const CONTROL_BOX = 'w-full rounded-ctl border border-border-strong bg-surface text-text outline-none disabled:cursor-default disabled:bg-surface-2 disabled:text-text-3';
const CONTROL = `h-8 px-2 text-small ${CONTROL_BOX}`;
/** 40 px controls for a short form that stands alone (sign-in). */
const CONTROL_LARGE = `h-10 px-3 text-body ${CONTROL_BOX}`;

/** Label above a control: 12 px, secondary text. */
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1 text-meta text-text-2', className)}>
      {label}
      {children}
      {error ? <span className="text-meta text-red-text">{error}</span> : hint ? <span className="text-meta text-text-3">{hint}</span> : null}
    </label>
  );
}

export function TextField({
  label,
  hint,
  error,
  className,
  suggestions,
  mono,
  large,
  ...rest
}: { label: ReactNode; hint?: ReactNode; error?: ReactNode; suggestions?: string[]; mono?: boolean; large?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const listId = useId();
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      <input className={cx(large ? CONTROL_LARGE : CONTROL, mono && 'mono', error && 'border-red')} aria-invalid={error ? true : undefined} list={suggestions ? listId : undefined} {...rest} />
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </Field>
  );
}

/** A password with a show / hide button; warns while Caps Lock is on. */
export function PasswordField({
  label,
  error,
  className,
  large,
  onKeyDown,
  onKeyUp,
  onBlur,
  ref,
  ...rest
}: { label: ReactNode; error?: ReactNode; large?: boolean; ref?: Ref<HTMLInputElement> } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const readCaps = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState('CapsLock'));
  return (
    <Field label={label} error={error} hint={caps ? <span className="text-amber-text">Caps Lock is on.</span> : undefined} className={className}>
      <span className="relative flex">
        <input
          ref={ref}
          type={shown ? 'text' : 'password'}
          className={cx(large ? CONTROL_LARGE : CONTROL, large ? 'pr-11' : 'pr-9', error && 'border-red')}
          aria-invalid={error ? true : undefined}
          onKeyDown={(e) => {
            readCaps(e);
            onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            readCaps(e);
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCaps(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        <IconButton
          icon={shown ? 'eyeOff' : 'eye'}
          label={shown ? 'Hide password' : 'Show password'}
          size="sm"
          tone="quiet"
          onClick={() => setShown(!shown)}
          className={cx('absolute top-1/2 -translate-y-1/2', large ? 'right-1.5' : 'right-0.5')}
        />
      </span>
    </Field>
  );
}

export function TextArea({ label, className, ...rest }: { label: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} className={className}>
      <textarea className="min-h-14 w-full resize-y rounded-ctl border border-border-strong bg-surface px-2 py-1.5 text-small text-text outline-none" {...rest} />
    </Field>
  );
}

export function SelectField({ label, hint, className, children, inline, ...rest }: { label: ReactNode; hint?: ReactNode; children: ReactNode; inline?: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  if (inline) {
    // label on the left of a compact select (filter rows)
    return (
      <label className={cx('inline-flex items-center gap-2 text-small text-text-3', className)}>
        {label}
        <select className="h-[30px] rounded-ctl border border-border-strong bg-surface px-1.5 text-small text-text" {...rest}>
          {children}
        </select>
      </label>
    );
  }
  return (
    <Field label={label} hint={hint} className={className}>
      <select className={cx(CONTROL, 'px-1.5')} {...rest}>
        {children}
      </select>
    </Field>
  );
}

/** A colour from the customer's data (e.g. a block type colour). */
export function ColorField({ label, value, onChange }: { label: ReactNode; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <span className="flex h-8 items-center gap-2 rounded-ctl border border-border-strong bg-surface px-1.5">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-8 cursor-pointer rounded-[4px] border-0 bg-transparent p-0" aria-label={typeof label === 'string' ? label : undefined} />
        <span className="mono text-small text-text-2">{value}</span>
      </span>
    </Field>
  );
}

/**
 * A text input that commits on Enter or blur. `parse` turns text into a value (null = not valid);
 * the field shows the committed value again when focus leaves. Used for timecodes and dates.
 */
export function CommitField<T>({
  label,
  value,
  format,
  parse,
  onCommit,
  hint,
  error,
  mono = true,
  width,
  ariaLabel,
  placeholder,
  disabled,
}: {
  label?: ReactNode;
  value: T;
  format: (v: T) => string;
  parse: (s: string) => T | null;
  onCommit: (v: T) => string | null | void;
  hint?: ReactNode;
  error?: ReactNode;
  mono?: boolean;
  width?: number;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(format(value));
  const [own, setOwn] = useState<string | null>(null);
  useEffect(() => {
    setText(format(value));
    setOwn(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = () => {
    if (text === format(value)) {
      setOwn(null);
      return;
    }
    const v = parse(text);
    if (v === null) {
      setOwn('Not a valid value.');
      return;
    }
    const refused = onCommit(v);
    if (refused) setOwn(refused);
    else setOwn(null);
  };
  const input = (
    <input
      className={cx(CONTROL, mono && 'mono', (own || error) && 'border-red')}
      style={width ? { width } : undefined}
      value={text}
      aria-label={ariaLabel}
      aria-invalid={own || error ? true : undefined}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setText(format(value));
          setOwn(null);
        }
      }}
    />
  );
  if (!label) {
    return (
      <span className="flex flex-col gap-1">
        {input}
        {(own || error) && <span className="text-meta text-red-text">{own || error}</span>}
      </span>
    );
  }
  return (
    <Field label={label} hint={hint} error={own || error}>
      {input}
    </Field>
  );
}

export function SearchField({ value, onChange, placeholder, label, autoFocus, size = 'md' }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; autoFocus?: boolean; size?: 'md' | 'sm' }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('flex min-w-0 items-center gap-1.5 rounded-ctl border border-border-strong bg-surface px-2 text-text-3', size === 'md' ? 'h-ctl' : 'h-[30px]')}>
      <Icon name="search" size={14} className="shrink-0" />
      <span className="sr-only">{label}</span>
      <input
        id={id}
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 flex-1 border-0 bg-transparent text-small text-text outline-none"
      />
    </label>
  );
}

export function Checkbox({ checked, onChange, children, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; disabled?: boolean; label?: string }) {
  if (!children) {
    // A bare checkbox (e.g. a cell of a permission matrix): the label is read by screen readers only.
    return <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="m-0 size-4 cursor-pointer accent-[var(--accent)] disabled:cursor-default" />;
  }
  return (
    <label className={cx('flex items-center gap-2 text-small', disabled ? 'opacity-45' : 'cursor-pointer')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="m-0 size-[15px] accent-[var(--accent)]" />
      {children}
    </label>
  );
}
