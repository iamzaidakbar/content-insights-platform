import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
}

/** Lightweight CSS-only tooltip for icon buttons and dense toolbars. */
export default function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <div className={cn('group/tip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-button)] bg-[var(--text-primary)] px-2 py-1 text-xs text-[var(--bg-surface)] opacity-0 shadow-[var(--shadow-sm)] transition-opacity group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {content}
      </span>
    </div>
  );
}
