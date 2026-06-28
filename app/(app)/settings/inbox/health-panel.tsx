import type { InboxHealthReport } from "@/lib/services/inbox-health";
import { StatusPanel } from "@/components/app/status-panel";

/**
 * Inbox poll health card on Settings → Email inbox: shows whether the worker is
 * actually polling (last poll time + result) and the last error, so an operator
 * can diagnose "no email coming in" without server logs. Collapses to the
 * headline row when polling is healthy (StatusPanel, keyed on `report.tone`).
 */

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
    <StatusPanel tone={report.tone} headline={report.headline}>
      <p className="text-sm text-muted-foreground">{report.detail}</p>

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
    </StatusPanel>
  );
}
