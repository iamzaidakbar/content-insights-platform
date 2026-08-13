import type { MouseEvent, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
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
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) onClose();
      }}
    >
      <AlertDialogContent data-testid={testId} size="sm">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div
              className={
                destructive
                  ? 'flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive'
                  : 'flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground'
              }
            >
              {icon ?? <AlertTriangle className="size-4" />}
            </div>
            <div>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              {description ? (
                <AlertDialogDescription>{description}</AlertDialogDescription>
              ) : (
                <AlertDialogDescription className="sr-only">{title}</AlertDialogDescription>
              )}
              {children ? <div className="mt-3">{children}</div> : null}
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {showCancel ? (
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={loading}>
                {cancelLabel}
              </Button>
            </AlertDialogCancel>
          ) : null}
          <AlertDialogAction asChild>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              loading={loading}
              onClick={handleConfirm}
              {...(confirmTestId !== undefined ? { 'data-testid': confirmTestId } : {})}
            >
              {confirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
