import { PageHeaderSkeleton, TableSkeleton } from "@/components/app/skeletons";

/** Streaming fallback for the inbound-SMS messages list. */
export default function Loading() {
  return (
    <div className="w-full space-y-4">
      <PageHeaderSkeleton />
      <TableSkeleton rows={8} columns={5} />
    </div>
  );
}
