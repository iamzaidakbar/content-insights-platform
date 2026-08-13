import { type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
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
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 motion-reduce:transition-none" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          data-testid={testId}
          className={cn(
            'fixed left-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)] outline-none',
            scrollable ? 'top-10 flex max-h-[min(90vh,880px)] flex-col' : 'top-1/2 -translate-y-1/2',
            sizeClasses[size],
            className,
          )}
          onOpenAutoFocus={(event) => {
            if (!title) {
              event.preventDefault();
              (event.currentTarget as HTMLElement).focus();
            }
          }}
        >
          {title ? (
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-[var(--text-primary)]">{title}</Dialog.Title>
                {description ? (
                  <Dialog.Description className="mt-0.5 text-sm text-[var(--text-secondary)]">
                    {description}
                  </Dialog.Description>
                ) : null}
              </div>
              <Dialog.Close asChild>
                <IconButton icon={X} label="Close" size="sm" />
              </Dialog.Close>
            </div>
          ) : (
            <>
              <Dialog.Title className="sr-only">Dialog</Dialog.Title>
              {description ? <Dialog.Description className="sr-only">{description}</Dialog.Description> : null}
            </>
          )}
          <div className={cn('px-5 py-4', scrollable && 'min-h-0 flex-1 overflow-y-auto')}>{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
