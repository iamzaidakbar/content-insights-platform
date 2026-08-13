import Skeleton from './ui/Skeleton';

/** Route-level Suspense fallback — tokenized skeleton (not raw slate). */
export default function PageSkeleton() {
  return (
    <div className="w-full space-y-4 px-3 py-3 sm:px-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
