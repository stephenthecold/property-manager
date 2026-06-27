import {
  CardSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/app/skeletons";

/** Streaming fallback for Reports (rollups across leases/properties). */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <CardSkeleton lines={2} />
      <TableSkeleton rows={8} columns={5} />
    </div>
  );
}
