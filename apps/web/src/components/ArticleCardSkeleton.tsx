import type { SearchLayout } from '@content-insights/shared';

import { CARD_HEIGHT } from '../lib/article-layout';

interface ArticleCardSkeletonProps {
  layout: SearchLayout;
}

// Companion loading state for ArticleCard — a CSS gradient-sweep shimmer (see
// .animate-shimmer in index.css), not Tailwind's built-in animate-pulse (a flat opacity
// fade). Mirrors each layout mode's real structure (and CARD_HEIGHT) so the loading state
// doesn't visibly jump when real cards swap in.
export default function ArticleCardSkeleton({ layout }: ArticleCardSkeletonProps) {
  const style = {
    height: CARD_HEIGHT[layout],
    borderColor: 'var(--border)',
    borderLeftWidth: '3px',
    borderLeftColor: 'transparent',
  };

  if (layout === 'dense') {
    return (
      <div className="overflow-hidden rounded-[var(--radius-card)] border" style={style}>
        <div className="flex h-full items-center gap-3 px-3">
          <div className="h-4 w-4 shrink-0 animate-shimmer rounded" />
          <div className="h-3.5 w-1/3 animate-shimmer rounded" />
          <div className="ml-auto h-3.5 w-24 shrink-0 animate-shimmer rounded" />
        </div>
      </div>
    );
  }

  if (layout === '1col') {
    return (
      <div className="overflow-hidden rounded-[var(--radius-card)] border" style={style}>
        <div className="flex h-full gap-4 p-3">
          <div className="h-full w-28 shrink-0 animate-shimmer rounded-[var(--radius-button)]" />
          <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
            <div className="space-y-2">
              <div className="h-4 w-2/3 animate-shimmer rounded" />
              <div className="h-3.5 w-1/3 animate-shimmer rounded" />
            </div>
            <div className="h-3.5 w-full animate-shimmer rounded" />
            <div className="h-5 w-24 animate-shimmer rounded-[var(--radius-tag)]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border p-4" style={style}>
      <div className="flex items-start justify-between gap-3">
        <div className="h-4 w-3/4 animate-shimmer rounded" />
        <div className="h-4 w-4 shrink-0 animate-shimmer rounded" />
      </div>
      <div className="mt-3 flex items-center gap-4">
        <div className="h-3.5 w-24 animate-shimmer rounded" />
        <div className="h-3.5 w-20 animate-shimmer rounded" />
      </div>
      <div className="mt-4 flex items-center gap-1">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-7 w-7 animate-shimmer rounded-[6px]" />
        ))}
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3.5 w-full animate-shimmer rounded" />
        <div className="h-3.5 w-full animate-shimmer rounded" />
        <div className="h-3.5 w-2/3 animate-shimmer rounded" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="h-5 w-14 animate-shimmer rounded-[var(--radius-tag)]" />
        <div className="h-5 w-16 animate-shimmer rounded-[var(--radius-tag)]" />
        <div className="h-5 w-12 animate-shimmer rounded-[var(--radius-tag)]" />
      </div>
    </div>
  );
}
