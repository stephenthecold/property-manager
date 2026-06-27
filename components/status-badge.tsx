import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { AccountStatus } from "@/lib/accounting";
import { TONE_CLASS, type Tone } from "@/lib/ui/status-tone";
import { cn } from "@/lib/utils";

/**
 * The single status-pill primitive: an outline Badge tinted by {@link Tone}.
 * Every status map across the app renders through this (or reads
 * `TONE_CLASS[tone]` directly when it needs extra Badge props), so tone tweaks
 * land in one place. `className` is merged last for per-site spacing.
 */
export function ToneBadge({
  tone,
  className,
  title,
  children,
}: {
  tone: Tone;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn("font-medium", TONE_CLASS[tone], className)}
    >
      {children}
    </Badge>
  );
}

const ACCOUNT_STATUS: Record<AccountStatus, { label: string; tone: Tone }> = {
  paid: { label: "Paid", tone: "success" },
  partially_paid: { label: "Partial", tone: "warning" },
  overdue: { label: "Overdue", tone: "danger" },
  due_soon: { label: "Due soon", tone: "info" },
  vacant: { label: "Vacant", tone: "neutral" },
  no_active_lease: { label: "No lease", tone: "neutral" },
};

export function StatusBadge({ status }: { status: AccountStatus }) {
  const s = ACCOUNT_STATUS[status];
  return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>;
}
