import type { ComponentPropsWithoutRef } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '../../lib/cn';

export function Popover(props: ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />;
}

export function PopoverTrigger({ children, ...rest }: ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>) {
  return (
    <PopoverPrimitive.Trigger asChild {...rest}>
      {children}
    </PopoverPrimitive.Trigger>
  );
}

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...rest
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-md)] outline-none',
          className,
        )}
        {...rest}
      />
    </PopoverPrimitive.Portal>
  );
}
