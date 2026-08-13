import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

import { cn } from '../../lib/cn';

export function DropdownMenu(props: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root {...props} />;
}

export function DropdownMenuTrigger({
  children,
  ...rest
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger asChild {...rest}>
      {children}
    </DropdownMenuPrimitive.Trigger>
  );
}

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 6,
  ...rest
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-44 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-1 shadow-[var(--shadow-md)] outline-none',
          className,
        )}
        {...rest}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  selected = false,
  ...rest
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { selected?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-[var(--radius-button)] px-2 py-1.5 text-xs outline-none',
        selected
          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'text-[var(--text-secondary)] data-[highlighted]:bg-[var(--bg-hover)] data-[highlighted]:text-[var(--text-primary)]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-60',
        className,
      )}
      {...rest}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...rest
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-[var(--border)]', className)} {...rest} />
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Label className="px-2 py-1.5 text-xs font-medium text-[var(--text-muted)]">
      {children}
    </DropdownMenuPrimitive.Label>
  );
}
