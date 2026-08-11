import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { ComponentType } from 'react';

import { cn } from '../../lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'md', active = false, className, disabled, ...rest },
  ref,
) {
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  const iconSize = size === 'sm' ? 15 : 16;

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-button)] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        dim,
        active
          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
        className,
      )}
      {...rest}
    >
      <Icon size={iconSize} strokeWidth={1.75} />
    </button>
  );
});

export default IconButton;
