import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import type { InboxHealthReport } from "@/lib/services/inbox-health";

/**
 * Inbox poll health card on Settings → Email inbox: shows whether the worker is
 * actually polling (last poll time + result) and the last error, so an operator
 * can diagnose "no email coming in" without server logs.
 */

const TONE_BOX: Record<InboxHealthReport["tone"], string> = {
  ok: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40",
  warn: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
  error: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
  muted: "border-border bg-muted/40",
};

function relTime(then: Date, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function InboxHealthPanel({
  report,
  lastPolledAt,
  fetched,
  processed,
  failed,
  now,
}: {
  report: InboxHealthReport;
  lastPolledAt: Date | null;
  fetched: number | null;
  processed: number | null;
  failed: number | null;
  now: Date;
}) {
  // Counts reflect the last SUCCESSFUL poll, so only show them when the last
  // attempt didn't error (ok/stale).
  const showCounts =
    (report.state === "ok" || report.state === "stale") &&
    lastPolledAt !== null &&
    fetched !== null;

  return (
    <div className={`rounded-lg border p-4 ${TONE_BOX[report.tone]}`}>
      <div className="flex items-center gap-2">
        {report.tone === "ok" ? (
          <CheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <TriangleAlertIcon
            className={
              report.tone === "error"
                ? "size-4 text-red-600 dark:text-red-400"
                : "size-4 text-amber-600 dark:text-amber-400"
            }
          />
        )}
        <h3 className="text-sm font-semibold">{report.headline}</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{report.detail}</p>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Last poll attempt</dt>
          <dd className="font-medium">
            {lastPolledAt ? relTime(lastPolledAt, now) : "Never"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last result</dt>
          <dd className="font-medium">
            {showCounts
              ? `${fetched} fetched · ${processed} saved · ${failed} failed`
              : "—"}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-muted-foreground">
        The background worker polls the mailbox about every 5 minutes. Refresh
        this page to update.
      </p>
    </div>
  );
}
