import { PageHeaderSkeleton, TableSkeleton } from "@/components/app/skeletons";

/** Streaming fallback for the maintenance list (jobs + monthly tasks). */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={8} columns={8} />
    </div>
  );
}
