import Link from "next/link";
import type { ActivityEvent, ActivityKind } from "@/lib/activity/merge";
import { cn } from "@/lib/utils";

/**
 * Read-only vertical timeline for the per-tenant unified activity feed. A server
 * component: it renders a pre-merged `ActivityEvent[]` (newest first) as a
 * left-railed list with a coloured dot per kind, a title, muted detail, and the
 * event date. Both themes are covered — every tint carries a `dark:` variant.
 */

// Dot tint per kind. Each light tint pairs with an explicit dark variant so the
// timeline reads correctly in both "Slate & Sky" and "Navy Night".
const DOT: Record<ActivityKind, string> = {
  payment: "bg-emerald-500 dark:bg-emerald-400",
  charge: "bg-amber-500 dark:bg-amber-400",
  reminder: "bg-sky-500 dark:bg-sky-400",
  notice: "bg-red-500 dark:bg-red-400",
  request: "bg-violet-500 dark:bg-violet-400",
  maintenance: "bg-orange-500 dark:bg-orange-400",
  audit: "bg-slate-400 dark:bg-slate-500",
  message: "bg-teal-500 dark:bg-teal-400",
};

function formatAt(at: Date): string {
  return at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <ol className="relative space-y-4 border-l border-border pl-6">
      {events.map((e) => {
        const body = (
          <>
            <p className="text-sm font-medium">{e.title}</p>
            {e.detail && (
              <p className="truncate text-sm text-muted-foreground">{e.detail}</p>
            )}
          </>
        );
        return (
          <li key={e.id} className="relative">
            <span
              aria-hidden
              className={cn(
                "absolute -left-[1.6875rem] top-1.5 size-3 rounded-full ring-2 ring-card",
                DOT[e.kind],
              )}
            />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {e.href ? (
                  <Link href={e.href} className="block hover:underline">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </div>
              <time className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {formatAt(e.at)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
