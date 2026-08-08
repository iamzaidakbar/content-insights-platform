// Generic Suspense fallback for lazy-loaded routes — distinct from each page's own
// data-fetching skeletons (which know their real content's shape); this only covers the
// brief window while the route's own JS chunk is still downloading.
export default function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
      <div className="mt-6 space-y-3">
        <div className="h-24 animate-pulse rounded-md border border-slate-800 bg-slate-900/40" />
        <div className="h-24 animate-pulse rounded-md border border-slate-800 bg-slate-900/40" />
      </div>
    </div>
  );
}
