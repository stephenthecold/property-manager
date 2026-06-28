import { PageHeaderSkeleton, TableSkeleton } from "@/components/app/skeletons";

/** Streaming fallback for the tenant-requests queue. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={10} columns={8} />
    </div>
  );
}
