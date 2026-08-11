import type { ResultViewMode } from '@content-insights/shared';

interface ArticleCardSkeletonProps {
  viewMode: ResultViewMode;
  contentLines: number;
}

export default function ArticleCardSkeleton({ viewMode, contentLines }: ArticleCardSkeletonProps) {
  const lines = Array.from({ length: Math.max(1, Math.min(viewMode === 'list' ? 1 : 2, contentLines, 3)) }, (_, i) => i);

  if (viewMode === 'list') {
    return (
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] px-3 py-2">
        <div className="flex items-start gap-2.5">
          <div className="mt-1 h-3.5 w-3.5 shrink-0 animate-shimmer rounded" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-3/4 animate-shimmer rounded" />
            <div className="h-2.5 w-1/3 animate-shimmer rounded" />
            <div className="h-2.5 w-full animate-shimmer rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
      <div className="flex-1 space-y-2 p-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-shimmer rounded" />
          <div className="h-8 w-full animate-shimmer rounded" />
        </div>
        <div className="space-y-1.5 pl-5">
          <div className="h-2.5 w-2/5 animate-shimmer rounded" />
          {lines.map((line) => (
            <div key={line} className="h-2.5 w-full animate-shimmer rounded last:w-2/3" />
          ))}
        </div>
      </div>
      <div className="border-t border-[var(--border)] px-3 py-2">
        <div className="h-6 w-20 animate-shimmer rounded" />
      </div>
    </div>
  );
}
