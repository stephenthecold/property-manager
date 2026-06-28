"use client";

import { useId, useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusTone = "ok" | "warn" | "error" | "muted";

const TONE_BOX: Record<StatusTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40",
  warn: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
  error: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
  muted: "border-border bg-muted/40",
};

const TONE_ICON: Record<StatusTone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground",
};

/**
 * A Settings status/announcement panel that **compresses to a single header row
 * when healthy** and expands to show detail when attention is needed. `tone="ok"`
 * starts collapsed (a chevron reveals the detail); any other tone starts open so
 * problems are visible without a click. Drives off the health signal each panel
 * already computes (readiness `ready`, inbox-health `tone`, storage `health.level`,
 * inbox `connected`). With no `children` it's simply a compact one-line status.
 */
export function StatusPanel({
  tone,
  headline,
  children,
  className,
}: {
  tone: StatusTone;
  headline: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const healthy = tone === "ok";
  // Deterministic from `tone` → no SSR/client hydration mismatch.
  const [open, setOpen] = useState(!healthy);
  const hasDetail = Boolean(children);
  const detailId = useId();

  return (
    <div className={cn("rounded-lg border p-4", TONE_BOX[tone], className)}>
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        aria-expanded={hasDetail ? open : undefined}
        aria-controls={hasDetail ? detailId : undefined}
        className={cn(
          "flex w-full items-center gap-2 text-left",
          hasDetail ? "cursor-pointer" : "cursor-default",
        )}
      >
        {healthy ? (
          <CheckIcon className={cn("size-4 shrink-0", TONE_ICON.ok)} />
        ) : (
          <TriangleAlertIcon className={cn("size-4 shrink-0", TONE_ICON[tone])} />
        )}
        <h3 className="text-sm font-semibold">{headline}</h3>
        {hasDetail && (
          <ChevronDownIcon
            className={cn(
              "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>
      {hasDetail && open ? (
        <div id={detailId} className="mt-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
