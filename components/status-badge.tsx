import { Badge } from "@/components/ui/badge";
import type { AccountStatus } from "@/lib/accounting";
import { cn } from "@/lib/utils";

const MAP: Record<AccountStatus, { label: string; className: string }> = {
  paid: { label: "Paid", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  partially_paid: { label: "Partial", className: "bg-amber-100 text-amber-800 border-amber-200" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-800 border-red-200" },
  due_soon: { label: "Due soon", className: "bg-sky-100 text-sky-800 border-sky-200" },
  vacant: { label: "Vacant", className: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  no_active_lease: { label: "No lease", className: "bg-zinc-100 text-zinc-700 border-zinc-200" },
};

export function StatusBadge({ status }: { status: AccountStatus }) {
  const s = MAP[status];
  return (
    <Badge variant="outline" className={cn("font-medium", s.className)}>
      {s.label}
    </Badge>
  );
}
