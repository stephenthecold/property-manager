import { Badge } from "@/components/ui/badge";
import type { AccountStatus } from "@/lib/accounting";
import { cn } from "@/lib/utils";

const MAP: Record<AccountStatus, { label: string; className: string }> = {
  paid: { label: "Paid", className: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800" },
  partially_paid: { label: "Partial", className: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800" },
  due_soon: { label: "Due soon", className: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800" },
  vacant: { label: "Vacant", className: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700" },
  no_active_lease: { label: "No lease", className: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700" },
};

export function StatusBadge({ status }: { status: AccountStatus }) {
  const s = MAP[status];
  return (
    <Badge variant="outline" className={cn("font-medium", s.className)}>
      {s.label}
    </Badge>
  );
}
