import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  className?: string;
}

export default function PageHeader({ title, description, actions, breadcrumbs, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-5 flex flex-col gap-3 sm:mb-6', className)}>
      {breadcrumbs}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>
          {description ? <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function PageBody({
  children,
  className,
  width = 'full',
}: {
  children: ReactNode;
  className?: string;
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  const widthClass =
    width === 'sm'
      ? 'max-w-3xl'
      : width === 'md'
        ? 'max-w-5xl'
        : width === 'lg'
          ? 'max-w-6xl'
          : width === 'xl'
            ? 'max-w-7xl'
            : 'max-w-none';

  return (
    <div className={cn('mx-auto w-full px-4 py-5 sm:px-6 sm:py-6', widthClass, className)}>{children}</div>
  );
}
