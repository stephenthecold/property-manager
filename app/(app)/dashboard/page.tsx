import Link from "next/link";
import { prisma } from "@/lib/db";
import { getDashboard, getVacancyOutlook } from "@/lib/services/dashboard";
import {
  getCollectedTrend,
  getDashboardKpis,
  getTurnoverCost,
} from "@/lib/services/kpis";
import type { PeriodDelta } from "@/lib/accounting/kpis";
import { expiringLeases } from "@/lib/services/lease-expirations";
import {
  expirationBadgeClass,
  daysUntilLabel,
} from "@/lib/leases/expiration";
import { getProfitSnapshot } from "@/lib/services/financials";
import { getAppSettings } from "@/lib/services/app-settings";
import { getDisplayRole, getSessionUser } from "@/lib/auth/session";
import { hasCapability } from "@/lib/auth/permissions";
import { resolveLayout } from "@/lib/dashboard/layout";
import { billingRunIsStale, BILLING_STALE_HOURS } from "@/lib/dashboard/billing-health";
import { DateTime } from "luxon";
import {
  DashboardCustomizer,
  type DashboardBubble,
  type DashboardSection,
} from "./dashboard-customizer";
import { formatCurrency, fromCents } from "@/lib/money";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/app/data-table";
import { PageHeader } from "@/components/app/page-header";
import { RecordPaymentDialog } from "@/components/app/record-payment-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";
export const metadata = { title: "Dashboard" };

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
  hint?: React.ReactNode;
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

/** Whole-percent label for a 0..1 occupancy rate ("92%"). */
function pctLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * A "+12% vs last month" delta line: up = green, down = red, flat/no-base =
 * muted. A null deltaPct (prior was zero) shows the absolute change only. Both
 * themes carry a dark: variant on the tint.
 */
function DeltaLine({ label, delta }: { label: string; delta: PeriodDelta }) {
  const up = delta.deltaCents > 0n;
  const down = delta.deltaCents < 0n;
  const tone = up
    ? "text-emerald-600 dark:text-emerald-400"
    : down
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";
  const arrow = up ? "▲" : down ? "▼" : "■";
  const pct =
    delta.deltaPct === null
      ? formatCurrency(delta.deltaCents > 0n ? delta.deltaCents : -delta.deltaCents)
      : `${delta.deltaPct >= 0 ? "+" : "−"}${Math.abs(Math.round(delta.deltaPct * 100))}%`;
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", tone)}>
      <span aria-hidden>{arrow}</span>
      {pct} {label}
    </span>
  );
}

export default async function DashboardPage() {
  const now = new Date();
  const [{ actingRole }, settings] = await Promise.all([
    getDisplayRole(),
    getAppSettings(),
  ]);
  // Financial totals are confidential (finance+ by default; adjustable in
  // Settings → Permissions). Overdue + occupancy stay operational.
  const canFinance = hasCapability(actingRole, "financials.view", settings.rolePermissions);
  const canCollect = hasCapability(actingRole, "payments.manage", settings.rolePermissions);
  const showProfit = canFinance && settings.modules.financials;
  // Worker liveness: warn billing-responsible staff (managers/finance) when the
  // billing worker hasn't completed a run recently — a stuck worker or a cron
  // that isn't firing means rent charges silently stop posting.
  const showBillingWarning =
    (canCollect || canFinance) &&
    billingRunIsStale(settings.lastBillingRunAt, now);
  // Format the last-run time in the org timezone, DEFENSIVELY: defaultTimezone is
  // free-text (Settings → Organization) and unvalidated, and Intl.toLocaleString
  // throws on a bad zone — Luxon degrades to an invalid DateTime instead, so a
  // typo'd timezone can never 500 the dashboard. Fall back to ISO (UTC) then.
  const lastBillingRunLabel = settings.lastBillingRunAt
    ? (() => {
        const dt = DateTime.fromJSDate(settings.lastBillingRunAt, {
          zone: settings.defaultTimezone,
        });
        return dt.isValid
          ? dt.toFormat("MMM d, yyyy, h:mm a ZZZZ")
          : settings.lastBillingRunAt.toISOString();
      })()
    : null;

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [d, profit, vacancies, expirations, kpis, trend] = await Promise.all([
    getDashboard(now),
    showProfit ? getProfitSnapshot(now) : Promise.resolve(null),
    getVacancyOutlook(now),
    expiringLeases({ now, withinDays: settings.leaseExpirationAlertDays }),
    // Occupancy + vacancy-loss are operational (always shown). Turnover cost is
    // month-to-date so the dashboard card is comparable to the other "this
    // month" tiles; /reports can range it.
    Promise.all([
      getDashboardKpis(now),
      canFinance
        ? getTurnoverCost({ from: monthStart, to: now }).catch(() => null)
        : Promise.resolve(null),
    ]).then(([k, turnover]) => ({ ...k, turnover })),
    // Period-over-period collected is a financial figure → finance-gated.
    canFinance
      ? getCollectedTrend(now, settings.defaultTimezone)
      : Promise.resolve(null),
  ]);
  // Fixed monthly costs = mortgage + insurance + taxes (yearly figures /12).
  const fixedCostsMonthlyCents = profit
    ? profit.mortgageMonthlyCents +
      profit.insuranceMonthlyCents +
      profit.taxesMonthlyCents
    : 0n;
  const netMonthCents = profit
    ? d.monthCollectedCents - fixedCostsMonthlyCents - profit.expensesMonthCents
    : 0n;

  const sessionUser = await getSessionUser();
  const savedLayout = sessionUser?.id
    ? ((
        await prisma.user.findUnique({
          where: { id: sessionUser.id },
          select: { dashboardLayout: true },
        })
      )?.dashboardLayout ?? null)
    : null;
  const layout = resolveLayout(savedLayout);

  const bubbles: DashboardBubble[] = [
    ...(canFinance
      ? [
          {
            id: "expected_month",
            label: "Expected this month",
            node: (
              <Stat
                label="Expected this month"
                value={formatCurrency(d.monthExpectedCents)}
                tone="sky"
              />
            ),
          },
          {
            id: "collected_month",
            label: "Collected this month",
            node: (
              <Stat
                label="Collected this month"
                value={formatCurrency(d.monthCollectedCents)}
                tone="emerald"
                hint={
                  trend ? (
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                      <DeltaLine label="vs last month" delta={trend.monthOverMonth} />
                      <DeltaLine label="vs last year" delta={trend.yearOverYear} />
                    </span>
                  ) : undefined
                }
              />
            ),
          },
        ]
      : []),
    {
      id: "overdue",
      label: "Overdue balance",
      node: (
        <Stat
          label="Overdue balance"
          value={formatCurrency(d.overdueBalanceCents)}
          hint={`${d.overdueTenants} tenant(s) overdue`}
          tone="red"
          valueClassName={
            d.overdueBalanceCents > 0n ? "text-red-600 dark:text-red-400" : undefined
          }
        />
      ),
    },
    ...(canFinance
      ? [
          {
            id: "collected_today",
            label: "Collected today",
            node: (
              <Stat
                label="Collected today"
                value={formatCurrency(d.todayCollectedCents)}
                tone="violet"
              />
            ),
          },
        ]
      : []),
    {
      id: "occupied_units",
      label: "Occupied units",
      node: <Stat label="Occupied units" value={String(d.occupiedUnits)} tone="indigo" />,
    },
    {
      id: "vacant_units",
      label: "Vacant / other units",
      node: (
        <Stat label="Vacant / other units" value={String(d.vacantUnits)} tone="amber" />
      ),
    },
    {
      id: "occupancy_rate",
      label: "Occupancy rate",
      node: (
        <Stat
          label="Occupancy rate"
          value={pctLabel(kpis.occupancy.rate)}
          hint={`${kpis.occupancy.occupiedUnits} of ${kpis.occupancy.rentableUnits} rentable`}
          tone="indigo"
        />
      ),
    },
    ...(canFinance
      ? [
          {
            id: "vacancy_loss",
            label: "Vacancy loss (MTD est.)",
            node: (
              <Stat
                label="Vacancy loss (est.)"
                value={formatCurrency(kpis.vacancyLoss.totalLostRentCents)}
                hint={`${kpis.vacancyLoss.totalDaysVacant} vacant-day(s) · ${kpis.vacancyLoss.vacantUnits} unit(s)`}
                tone="amber"
                valueClassName={
                  kpis.vacancyLoss.totalLostRentCents > 0n
                    ? "text-red-600 dark:text-red-400"
                    : undefined
                }
              />
            ),
          },
          ...(kpis.turnover
            ? [
                {
                  id: "turnover_cost",
                  label: "Turnover cost (this month)",
                  node: (
                    <Stat
                      label="Turnover cost (mo.)"
                      value={formatCurrency(kpis.turnover.totalCents)}
                      hint={`damages ${formatCurrency(kpis.turnover.moveOutDamagesCents)} · work ${formatCurrency(kpis.turnover.turnoverExpensesCents)}`}
                      tone="violet"
                    />
                  ),
                },
              ]
            : []),
        ]
      : []),
    ...(profit
      ? [
          {
            id: "expenses_month",
            label: "Expenses this month",
            node: (
              <Stat
                label="Expenses this month"
                value={formatCurrency(profit.expensesMonthCents)}
                tone="amber"
              />
            ),
          },
          {
            id: "fixed_costs",
            label: "Fixed costs / month",
            node: (
              <Stat
                label="Fixed costs / month"
                value={formatCurrency(fixedCostsMonthlyCents)}
                hint={`mortgage ${formatCurrency(profit.mortgageMonthlyCents)} · insurance ${formatCurrency(profit.insuranceMonthlyCents)} · taxes ${formatCurrency(profit.taxesMonthlyCents)}`}
                tone="indigo"
              />
            ),
          },
          {
            id: "net_month",
            label: "Net this month",
            node: (
              <Stat
                label="Net this month"
                value={formatCurrency(netMonthCents)}
                hint="collected − fixed costs − expenses"
                tone="emerald"
                valueClassName={
                  netMonthCents < 0n
                    ? "text-red-600 dark:text-red-400"
                    : "text-emerald-700 dark:text-emerald-400"
                }
              />
            ),
          },
        ]
      : []),
  ];

  const sections: DashboardSection[] = [
    {
      id: "vacancy",
      label: "Vacancy outlook",
      title: (
        <span className="flex items-center gap-2">
          Vacancy outlook
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {vacancies.length}
          </span>
        </span>
      ),
      content: (
        <DataTable
          emptyMessage="No vacant or upcoming-vacant units."
            columns={[
              { key: "unit", label: "Unit" },
              { key: "property", label: "Property", className: "hidden md:table-cell" },
              { key: "available", label: "Available" },
              {
                key: "tenant",
                label: "Current tenant",
                className: "hidden sm:table-cell",
              },
              { key: "rent", label: "Rent", align: "right", numeric: true },
            ]}
            rows={vacancies.map((r) => {
              const dateLabel = r.availableNow
                ? "Now"
                : r.availableOn
                  ? r.availableOn.toLocaleDateString("en-US", {
                      timeZone: r.timezone,
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })
                  : "—";
              return {
                key: r.unitId,
                sortValues: [
                  r.unitLabel,
                  r.propertyName,
                  // available-now sorts first; then by date
                  r.availableNow ? 0 : (r.availableOn?.getTime() ?? 0),
                  r.currentTenantName ?? "",
                  String(r.rentCents),
                ],
                cells: [
                  <Link
                    key="u"
                    href={`/units/${r.unitId}`}
                    className="font-medium hover:underline"
                  >
                    {r.unitLabel}
                    {r.buildingName ? (
                      <span className="text-muted-foreground"> · {r.buildingName}</span>
                    ) : null}
                  </Link>,
                  <span key="p" className="text-muted-foreground">
                    {r.propertyName}
                  </span>,
                  r.state === "maintenance" ? (
                    <span key="a" className="inline-flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                      >
                        Maintenance
                      </Badge>
                      {r.availableOn && (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {dateLabel}
                        </span>
                      )}
                    </span>
                  ) : r.availableNow ? (
                    <Badge key="a">Now</Badge>
                  ) : (
                    <span key="a" className="tabular-nums">
                      {dateLabel}
                    </span>
                  ),
                  <span key="t" className="text-muted-foreground">
                    {r.currentTenantName ?? "—"}
                  </span>,
                  <span key="r" className="tabular-nums">
                    {formatCurrency(r.rentCents)}
                  </span>,
                ],
              };
            })}
        />
      ),
    },
    {
      id: "lease_expirations",
      label: "Lease expirations",
      title: (
        <span className="flex items-center gap-2">
          Lease expirations
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {expirations.length}
          </span>
        </span>
      ),
      content: (
        <DataTable
          emptyMessage={`No leases expiring in the next ${settings.leaseExpirationAlertDays} days.`}
          columns={[
            { key: "tenant", label: "Tenant" },
            { key: "unit", label: "Unit" },
            { key: "property", label: "Property", className: "hidden md:table-cell" },
            { key: "endDate", label: "End date" },
            { key: "daysLeft", label: "Days left", align: "right", numeric: true },
            { key: "renew", label: "", align: "right", sortable: false },
          ]}
          rows={expirations.map((r) => ({
            key: r.leaseId,
            sortValues: [
              r.tenantName,
              r.unitLabel,
              r.propertyName,
              r.endDate.getTime(),
              r.daysUntilExpiry,
              null,
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
              <span key="e" className="tabular-nums">
                {r.endDate.toLocaleDateString("en-US", {
                  timeZone: r.timezone,
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>,
              <span key="d" className="flex justify-end">
                <Badge variant="outline" className={expirationBadgeClass(r.state)}>
                  {daysUntilLabel(r.daysUntilExpiry)}
                </Badge>
              </span>,
              <span key="renew" className="flex justify-end">
                <Button
                  variant="outline"
                  size="xs"
                  render={<Link href={`/leases/${r.leaseId}/agreement`} />}
                >
                  Renew
                </Button>
              </span>,
            ],
          }))}
        />
      ),
    },
    {
      id: "tenants",
      label: "Tenant status",
      title: "Tenant status",
      content: (
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
              ...(canCollect
                ? [{ key: "collect", label: "", align: "right" as const, sortable: false }]
                : []),
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
                ...(canCollect ? [null] : []),
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
                ...(canCollect
                  ? [
                      <RecordPaymentDialog
                        key="collect"
                        leaseId={r.leaseId}
                        defaultAmount={fromCents(
                          r.netBalanceCents > 0n ? r.netBalanceCents : r.monthlyChargeCents,
                        )}
                        trigger="Collect"
                        compact
                      />,
                    ]
                  : []),
              ],
            }))}
        />
      ),
    },
    {
      id: "payments",
      label: "Recent payments",
      title: "Recent payments",
      content: (
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
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" />
      {showBillingWarning && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <p className="font-semibold">Automated billing may not be running</p>
          <p className="mt-1">
            {lastBillingRunLabel
              ? `The billing worker last completed a run on ${lastBillingRunLabel} — over ${BILLING_STALE_HOURS} hours ago.`
              : "The billing worker has not completed a run yet."}{" "}
            New rent charges and late fees won’t post until it runs. Check that the
            billing worker process is up.
          </p>
        </div>
      )}
      <DashboardCustomizer bubbles={bubbles} sections={sections} initial={layout} />
    </div>
  );
}
