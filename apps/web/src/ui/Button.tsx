import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'lg' | 'md' | 'sm' | 'xs';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent border border-accent hover:not-disabled:bg-accent-hover hover:not-disabled:border-accent-hover',
  secondary: 'bg-surface text-text border border-border-strong hov',
  ghost: 'bg-transparent text-text-2 border border-transparent hov',
  danger: 'bg-transparent text-red-text border border-transparent hov',
};

const SIZE: Record<Size, string> = {
  lg: 'h-10 px-4 text-body',
  md: 'h-ctl px-3 text-body',
  sm: 'h-7 px-2.5 text-small',
  xs: 'h-[26px] px-2 text-meta',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'ctl inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl font-medium',
        VARIANT[variant],
        SIZE[size],
        variant === 'primary' && size === 'md' && 'px-4',
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'md' || size === 'lg' ? 15 : 12} strokeWidth={size === 'md' || size === 'lg' ? 1.75 : 2} />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required: read by screen readers and shown as a tooltip. */
  label: string;
  size?: Size;
  tone?: 'normal' | 'quiet';
}

const ICON_BOX: Record<Size, string> = { lg: 'size-10', md: 'size-ctl', sm: 'size-7', xs: 'size-6' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', tone = 'normal', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'ctl hov inline-flex shrink-0 cursor-pointer items-center justify-center rounded-ctl border border-transparent bg-transparent p-0',
        tone === 'quiet' ? 'text-text-3' : 'text-text-2',
        ICON_BOX[size],
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === 'md' || size === 'lg' ? 16 : size === 'sm' ? 14 : 13} strokeWidth={size === 'xs' ? 2 : 1.75} />
    </button>
  );
});
