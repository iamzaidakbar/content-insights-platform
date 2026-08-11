import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import Button from './Button';
import Modal from './Modal';

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
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      {...(testId !== undefined ? { testId } : {})}
      footer={
        <>
          {showCancel ? (
            <Button variant="outline" onClick={onClose} disabled={loading}>
              {cancelLabel}
            </Button>
          ) : null}
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            loading={loading}
            onClick={onConfirm}
            {...(confirmTestId !== undefined ? { 'data-testid': confirmTestId } : {})}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
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
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          {description ? <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p> : null}
        </div>
      </div>
    </Modal>
  );
}
