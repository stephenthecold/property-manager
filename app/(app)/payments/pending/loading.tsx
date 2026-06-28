import { PageHeaderSkeleton, CardSkeleton } from "@/components/app/skeletons";

/** Streaming fallback for the self-report confirmation queue. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i} lines={2} />
        ))}
      </div>
    </div>
  );
}
