import type { ResultViewMode } from '@content-insights/shared';

interface ArticleCardSkeletonProps {
  viewMode: ResultViewMode;
  /** Mirrors the real card's configured content-line count so the shimmer's summary block is roughly the right height. */
  contentLines: number;
}

// Companion loading state for ArticleCard — a CSS gradient-sweep shimmer (see
// .animate-shimmer in index.css), not Tailwind's built-in animate-pulse. No fixed card
// height here (unlike the old dense/1col/2col/3col system) — cards size to their content
// now, so the skeleton just approximates the same block structure at a reasonable height.
export default function ArticleCardSkeleton({ viewMode, contentLines }: ArticleCardSkeletonProps) {
  const lines = Array.from({ length: Math.max(1, Math.min(contentLines, 6)) }, (_, index) => index);

  if (viewMode === 'list') {
    return (
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] p-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-4 w-4 shrink-0 animate-shimmer rounded" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-shimmer rounded" />
            <div className="h-3.5 w-1/3 animate-shimmer rounded" />
            <div className="h-3.5 w-full animate-shimmer rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="h-4 w-3/4 animate-shimmer rounded" />
        <div className="h-4 w-4 shrink-0 animate-shimmer rounded" />
      </div>
      <div className="mt-3 flex items-center gap-4">
        <div className="h-3.5 w-24 animate-shimmer rounded" />
        <div className="h-3.5 w-20 animate-shimmer rounded" />
      </div>
      <div className="mt-3 space-y-2">
        {lines.map((line) => (
          <div key={line} className="h-3.5 w-full animate-shimmer rounded last:w-2/3" />
        ))}
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="h-5 w-14 animate-shimmer rounded-[var(--radius-tag)]" />
        <div className="h-5 w-16 animate-shimmer rounded-[var(--radius-tag)]" />
        <div className="h-5 w-12 animate-shimmer rounded-[var(--radius-tag)]" />
      </div>
    </div>
  );
}
