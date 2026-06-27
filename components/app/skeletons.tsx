import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-shaped loading skeletons used by `loading.tsx` segment files. They
 * mirror the real page scaffold (title block, stat-card grid, data table) so
 * the swap to live content doesn't shift layout — perceived speed on low-spec
 * tablets, where the first DB round-trip is the slow part.
 */

/** Page title + subtitle bar (matches the `<h1>` + muted `<p>` every page opens with). */
export function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

/**
 * Responsive grid of KPI cards. Defaults to the dashboard's
 * `grid-cols-2 sm:grid-cols-3 xl:grid-cols-6` layout.
 */
export function StatCardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * A bordered card matching `DataTable`'s shell: a tinted header row over
 * `rows` body rows, each with `columns` cells.
 */
export function TableSkeleton({
  rows = 8,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex gap-4 border-b bg-muted/60 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A single content card placeholder (header + a few lines). */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-5">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}
