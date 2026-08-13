import type { ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '../../lib/cn';

export interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
}

/** Portaled tooltip for icon buttons and dense toolbars. */
export default function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            sideOffset={6}
            className={cn(
              'z-50 rounded-[var(--radius-button)] bg-[var(--text-primary)] px-2 py-1 text-xs text-[var(--bg-surface)] shadow-[var(--shadow-sm)]',
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
