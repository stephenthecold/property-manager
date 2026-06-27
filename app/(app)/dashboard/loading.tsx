import {
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableSkeleton,
} from "@/components/app/skeletons";

/** Streaming fallback while the dashboard's many aggregate queries run. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={6} />
      <TableSkeleton rows={6} columns={5} />
      <TableSkeleton rows={6} columns={6} />
    </div>
  );
}
