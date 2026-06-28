import {
  CardSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/app/skeletons";

/** Streaming fallback for Payers (subsidy tracker + payer directory). */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <CardSkeleton lines={3} />
      <TableSkeleton rows={6} columns={6} />
    </div>
  );
}
