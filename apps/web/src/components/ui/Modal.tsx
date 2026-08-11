import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { cn } from '../../lib/cn';
import IconButton from './IconButton';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  full: 'max-w-3xl',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  /** Taller forms that scroll internally */
  scrollable?: boolean;
  className?: string;
  /** Forwarded as data-testid on the dialog panel */
  testId?: string;
}

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  scrollable = false,
  className,
  testId,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center bg-black/50 px-4',
        scrollable ? 'items-start overflow-y-auto py-10' : 'items-center',
      )}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        data-testid={testId}
        className={cn(
          'w-full rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)] outline-none',
          sizeClasses[size],
          scrollable ? 'max-h-[min(90vh,880px)] flex flex-col' : '',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div className="min-w-0">
              {title ? (
                <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
                  {title}
                </h2>
              ) : null}
              {description ? <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{description}</p> : null}
            </div>
            <IconButton icon={X} label="Close" onClick={onClose} size="sm" />
          </div>
        )}
        <div className={cn('px-5 py-4', scrollable && 'min-h-0 flex-1 overflow-y-auto')}>{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
