import Link from "next/link";
import { getDashboard } from "@/lib/services/dashboard";
import { formatCurrency } from "@/lib/money";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/app/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";

type Tone = "sky" | "emerald" | "red" | "violet" | "indigo" | "amber";

const TONE_CARD: Record<Tone, string> = {
  sky: "border-l-4 border-l-sky-500 bg-gradient-to-br from-sky-50/70 to-transparent dark:from-sky-950/30",
  emerald:
    "border-l-4 border-l-emerald-500 bg-gradient-to-br from-emerald-50/70 to-transparent dark:from-emerald-950/30",
  red: "border-l-4 border-l-red-500 bg-gradient-to-br from-red-50/70 to-transparent dark:from-red-950/30",
  violet:
    "border-l-4 border-l-violet-500 bg-gradient-to-br from-violet-50/70 to-transparent dark:from-violet-950/30",
  indigo:
    "border-l-4 border-l-indigo-500 bg-gradient-to-br from-indigo-50/70 to-transparent dark:from-indigo-950/30",
  amber:
    "border-l-4 border-l-amber-500 bg-gradient-to-br from-amber-50/70 to-transparent dark:from-amber-950/30",
};

const TONE_DOT: Record<Tone, string> = {
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  red: "bg-red-500",
  violet: "bg-violet-500",
  indigo: "bg-indigo-500",
  amber: "bg-amber-500",
};

function Stat({
  label,
  value,
  hint,
  tone,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: Tone;
  valueClassName?: string;
}) {
  return (
    <Card className={TONE_CARD[tone]}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])} />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-semibold tabular-nums", valueClassName)}>
          {value}
        </div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/** Tint a balance: red when owed, green when in credit. */
function balanceClass(cents: bigint): string {
  if (cents > 0n) return "text-red-600 dark:text-red-400";
  if (cents < 0n) return "text-emerald-600 dark:text-emerald-400";
  return "";
}

export default async function DashboardPage() {
  const d = await getDashboard(new Date());

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Expected this month"
          value={formatCurrency(d.monthExpectedCents)}
          tone="sky"
        />
        <Stat
          label="Collected this month"
          value={formatCurrency(d.monthCollectedCents)}
          tone="emerald"
        />
        <Stat
          label="Overdue balance"
          value={formatCurrency(d.overdueBalanceCents)}
          hint={`${d.overdueTenants} tenant(s) overdue`}
          tone="red"
          valueClassName={
            d.overdueBalanceCents > 0n ? "text-red-600 dark:text-red-400" : undefined
          }
        />
        <Stat
          label="Collected today"
          value={formatCurrency(d.todayCollectedCents)}
          tone="violet"
        />
        <Stat label="Occupied units" value={String(d.occupiedUnits)} tone="indigo" />
        <Stat
          label="Vacant / other units"
          value={String(d.vacantUnits)}
          tone="amber"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tenant status</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No active leases yet."
            columns={[
              { key: "tenant", label: "Tenant" },
              { key: "unit", label: "Unit" },
              { key: "property", label: "Property", className: "hidden md:table-cell" },
              { key: "status", label: "Status" },
              { key: "balance", label: "Balance", align: "right", numeric: true },
              { key: "pastDue", label: "Past due", align: "right", numeric: true },
              {
                key: "daysSincePaid",
                label: "Days since paid",
                align: "right",
                numeric: true,
                className: "hidden sm:table-cell",
              },
            ]}
            rows={d.leaseRows.map((r) => ({
              key: r.leaseId,
              sortValues: [
                r.tenantName,
                r.unitLabel,
                r.propertyName,
                r.status,
                String(r.netBalanceCents),
                String(r.pastDueCents),
                r.lastPaymentDays,
              ],
              cells: [
                <Link
                  key="t"
                  href={`/tenants/${r.tenantId}`}
                  className="font-medium hover:underline"
                >
                  {r.tenantName}
                </Link>,
                r.unitLabel,
                <span key="p" className="text-muted-foreground">
                  {r.propertyName}
                </span>,
                <StatusBadge key="s" status={r.status} />,
                <span key="b" className={cn("tabular-nums", balanceClass(r.netBalanceCents))}>
                  {formatCurrency(r.netBalanceCents)}
                </span>,
                <span key="pd" className={cn("tabular-nums", balanceClass(r.pastDueCents))}>
                  {formatCurrency(r.pastDueCents)}
                </span>,
                <span key="d" className="tabular-nums">
                  {r.lastPaymentDays ?? "—"}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent payments</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No payments recorded yet."
            columns={[
              { key: "tenant", label: "Tenant" },
              { key: "date", label: "Date" },
              { key: "method", label: "Method" },
              { key: "amount", label: "Amount", align: "right", numeric: true },
            ]}
            rows={d.recentPayments.map((p) => ({
              key: p.id,
              sortValues: [
                p.tenantName,
                p.paymentDate.toISOString(),
                p.method,
                String(p.amountCents),
              ],
              cells: [
                p.tenantName,
                p.paymentDate.toLocaleDateString(),
                <span key="m" className="capitalize">
                  {p.method.replace("_", " ")}
                </span>,
                <span key="a" className="tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(p.amountCents)}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
