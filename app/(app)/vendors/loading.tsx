import { PageHeaderSkeleton, TableSkeleton } from "@/components/app/skeletons";

/** Streaming fallback for the vendor directory. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={10} columns={5} />
    </div>
  );
}
