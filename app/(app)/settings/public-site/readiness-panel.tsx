import Link from "next/link";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import type { PublicSiteReadinessReport } from "@/lib/services/public-site-readiness";

/**
 * Carrier (10DLC / A2P SMS) brand-verification checklist, shown above the public
 * site settings. Surfaces exactly what carriers look for before approving an SMS
 * campaign — and links straight to the setting that fixes each gap.
 */
export function PublicSiteReadiness({
  report,
}: {
  report: PublicSiteReadinessReport;
}) {
  return (
    <div
      className={
        report.ready
          ? "rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40"
          : "rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40"
      }
    >
      <div className="flex items-center gap-2">
        {report.ready ? (
          <CheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />
        )}
        <h3 className="text-sm font-semibold">
          {report.ready
            ? "SMS carrier verification ready"
            : `SMS carrier verification — ${report.missingCount} to fix`}
        </h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Carriers review this site before approving your SMS (10DLC/A2P) campaign.
        They require your business name, contact details, and a clear description
        of your services — reachable without a login.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {report.items.map((it) => (
          <li key={it.key} className="flex items-start gap-2">
            {it.ok ? (
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <span>
              <span className={it.ok ? "" : "font-medium"}>{it.label}</span>
              {!it.ok && (
                <>
                  {" — "}
                  <span className="text-muted-foreground">{it.hint} </span>
                  <Link
                    href={it.fixHref}
                    className="text-primary underline underline-offset-2"
                  >
                    Fix
                  </Link>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
