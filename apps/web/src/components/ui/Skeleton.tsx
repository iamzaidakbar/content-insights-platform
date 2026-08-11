import type { HTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Use shimmer sweep instead of pulse */
  shimmer?: boolean;
}

export default function Skeleton({ className, shimmer = true, ...rest }: SkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-button)] bg-[var(--bg-hover)]',
        shimmer ? 'animate-shimmer' : 'animate-pulse',
        className,
      )}
      {...rest}
    />
  );
}

export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
