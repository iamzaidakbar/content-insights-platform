import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

import { cn } from '../../lib/cn';

export type AlertVariant = 'success' | 'warning' | 'error' | 'info';

const config: Record<
  AlertVariant,
  { icon: typeof Info; color: string; soft: string }
> = {
  success: { icon: CheckCircle2, color: 'var(--success)', soft: 'var(--success-soft)' },
  warning: { icon: AlertTriangle, color: 'var(--warning)', soft: 'var(--warning-soft)' },
  error: { icon: AlertCircle, color: 'var(--error)', soft: 'var(--error-soft)' },
  info: { icon: Info, color: 'var(--info)', soft: 'var(--info-soft)' },
};

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}

export default function Alert({ variant = 'info', title, children, className, action }: AlertProps) {
  const { icon: Icon, color, soft } = config[variant];

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--border)] px-4 py-3',
        className,
      )}
      style={{ backgroundColor: soft }}
    >
      <Icon size={18} strokeWidth={1.75} style={{ color }} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p> : null}
        {children ? <div className={cn('text-sm text-[var(--text-secondary)]', title && 'mt-0.5')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
