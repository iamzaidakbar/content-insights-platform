import type { MouseEvent, ReactNode } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertTriangle } from 'lucide-react';

import Button from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When false, only the confirm action is shown (e.g. informational notices). */
  showCancel?: boolean;
  destructive?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  testId?: string;
  confirmTestId?: string;
  children?: ReactNode;
}

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  showCancel = true,
  destructive = false,
  loading = false,
  icon,
  testId,
  confirmTestId,
  children,
}: ConfirmDialogProps) {
  function handleConfirm(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    onConfirm();
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) {
          onClose();
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50 motion-reduce:transition-none" />
        <AlertDialog.Content
          data-testid={testId}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)] outline-none"
        >
          <div className="px-5 py-4">
            <div className="flex items-start gap-3">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor: destructive ? 'var(--error-soft)' : 'var(--accent-soft)',
                  color: destructive ? 'var(--error)' : 'var(--amber)',
                }}
              >
                {icon ?? <AlertTriangle size={18} strokeWidth={1.75} />}
              </div>
              <div>
                <AlertDialog.Title className="text-sm font-semibold text-[var(--text-primary)]">
                  {title}
                </AlertDialog.Title>
                {description ? (
                  <AlertDialog.Description className="mt-1 text-sm text-[var(--text-secondary)]">
                    {description}
                  </AlertDialog.Description>
                ) : (
                  <AlertDialog.Description className="sr-only">{title}</AlertDialog.Description>
                )}
                {children ? <div className="mt-3">{children}</div> : null}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
            {showCancel ? (
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={loading}>
                  {cancelLabel}
                </Button>
              </AlertDialog.Cancel>
            ) : null}
            <AlertDialog.Action asChild>
              <Button
                variant={destructive ? 'destructive' : 'primary'}
                loading={loading}
                onClick={handleConfirm}
                {...(confirmTestId !== undefined ? { 'data-testid': confirmTestId } : {})}
              >
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
