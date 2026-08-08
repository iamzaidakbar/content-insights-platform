// Companion loading state for ArticleCard — a CSS gradient-sweep shimmer (see
// .animate-shimmer in index.css), not Tailwind's built-in animate-pulse (a flat opacity
// fade), matching the spec's explicit "shimmer skeleton (gradient sweep)" ask.
export default function ArticleCardSkeleton() {
  return (
    <div
      className="rounded-[var(--radius-card)] border p-4"
      style={{ borderColor: 'var(--border)', borderLeftWidth: '3px', borderLeftColor: 'transparent' }}
    >
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
