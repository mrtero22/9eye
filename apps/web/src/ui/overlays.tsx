// Floating layers: popovers, "⋯" menus and dialogs (Radix: focus handling, Escape, outside click).

import * as RPopover from '@radix-ui/react-popover';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import * as RDialog from '@radix-ui/react-dialog';
import type { ReactElement, ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './icons';

const LAYER = 'z-40 rounded-card border border-border bg-surface shadow-pop outline-none';

export function Popover({
  open,
  onOpenChange,
  trigger,
  anchor,
  children,
  label,
  width = 320,
  align = 'start',
  side = 'bottom',
  padding = 'p-3.5',
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The button that opens it (rendered as is). */
  trigger?: ReactElement;
  /** Or: an element it is placed next to, when something else opens it. */
  anchor?: ReactElement;
  children: ReactNode;
  label: string;
  width?: number | 'trigger';
  align?: 'start' | 'center' | 'end';
  side?: 'bottom' | 'top' | 'left' | 'right';
  padding?: string;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>}
      {anchor && <RPopover.Anchor asChild>{anchor}</RPopover.Anchor>}
      <RPopover.Portal>
        <RPopover.Content
          aria-label={label}
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className={cx(LAYER, padding, 'flex max-h-[min(80vh,var(--radix-popover-content-available-height))] flex-col gap-2.5 overflow-y-auto')}
          style={{ width: width === 'trigger' ? 'var(--radix-popover-trigger-width)' : width, maxWidth: 'calc(100vw - 24px)' }}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export const PopoverClose = RPopover.Close;

export function PopoverTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-semibold">{children}</span>
      {hint && <span className="text-meta text-text-3">{hint}</span>}
    </span>
  );
}

export function PopoverFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2">{children}</div>;
}

export function Menu({ trigger, children, label, width = 240, align = 'end' }: { trigger: ReactElement; children: ReactNode; label: string; width?: number; align?: 'start' | 'end' }) {
  return (
    <RMenu.Root modal={false}>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content aria-label={label} align={align} sideOffset={6} collisionPadding={12} className={cx(LAYER, 'flex flex-col rounded-item p-1')} style={{ width }}>
          {children}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

// Layout classes stay out of ITEM_BASE: cx does not resolve conflicts, so h-ctl would beat h-auto.
const ITEM_BASE = 'flex cursor-pointer select-none rounded-[5px] px-2.5 text-left outline-none data-[highlighted]:bg-surface-2 data-[disabled]:cursor-default data-[disabled]:opacity-45';
const ITEM = cx(ITEM_BASE, 'h-ctl items-center gap-2');

export function MenuItem({ children, onSelect, danger, disabled, title, note }: { children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean; title?: string; note?: string }) {
  return (
    <RMenu.Item onSelect={onSelect} disabled={disabled} title={title} className={cx(note ? cx(ITEM_BASE, 'min-h-[var(--ctl)] flex-col items-start justify-center py-1') : ITEM, danger && 'text-red-text')}>
      {children}
      {note && <span className="text-meta text-text-3">{note}</span>}
    </RMenu.Item>
  );
}

export function MenuCheck({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <RMenu.CheckboxItem checked={checked} onCheckedChange={onChange} onSelect={(e) => e.preventDefault()} className={ITEM}>
      <span className="inline-flex w-4 text-accent-text">{checked && <Icon name="check" size={15} strokeWidth={2.25} />}</span>
      {children}
    </RMenu.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <RMenu.Label className="px-2.5 py-1 text-meta text-text-3">{children}</RMenu.Label>;
}

export function MenuSeparator() {
  return <RMenu.Separator className="my-1 h-px bg-hairline" />;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 440,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <RDialog.Content
          className={cx(LAYER, 'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto p-5')}
          style={{ width, maxWidth: 'calc(100vw - 32px)' }}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <RDialog.Title className="m-0 text-section font-semibold">{title}</RDialog.Title>
              {description ? <RDialog.Description className="m-0 text-small text-text-2">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <button type="button" aria-label="Close" title="Close" className="hov inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-ctl border-0 bg-transparent text-text-2">
                <Icon name="close" size={15} />
              </button>
            </RDialog.Close>
          </div>
          {children}
          {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Confirmation for destructive or discarding actions. Up to three choices. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  danger,
  extra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
  extra?: { label: string; onClick: () => void };
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {extra && (
            <Button variant="secondary" onClick={extra.onClick}>
              {extra.label}
            </Button>
          )}
          <Button variant={danger ? 'secondary' : 'primary'} className={danger ? 'text-red-text' : undefined} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
