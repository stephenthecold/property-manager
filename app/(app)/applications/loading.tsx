import {
  CardSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/app/skeletons";

/** Streaming fallback for the rental applications list. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={8} columns={5} />
      <CardSkeleton lines={2} />
    </div>
  );
}
