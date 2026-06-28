import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { sendBulkOverdueRemindersAction } from "@/app/(app)/reminders/actions";
import {
  getBackRent,
  getIncomeSummary,
  getLeaseExpirations,
  getOverdue,
  getPaymentMethodSummary,
  getRentRoll,
} from "@/lib/services/reports";
import { DataTable } from "@/components/app/data-table";
import { ReportExportButtons } from "@/components/app/report-export-buttons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { hasCapability } from "@/lib/auth/permissions";
import { getDisplayRole } from "@/lib/auth/session";

export const runtime = "nodejs";
export const metadata = { title: "Reports" };

function money(v: string) {
  return `$${v}`;
}

/** Pre-formatted decimal string owes money (positive and nonzero). */
function owed(v: string): boolean {
  return !v.startsWith("-") && /[1-9]/.test(v);
}

function amountClass(v: string): string {
  if (v.startsWith("-")) return "text-emerald-600 dark:text-emerald-400";
  if (owed(v)) return "text-red-600 dark:text-red-400";
  return "";
}

/** Parse an optional "yyyy-MM-dd" filter; invalid input -> undefined (ignored). */
function parseDay(v: string, endOfDay = false): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Build a CSV export URL, including only set params (URL-encoded). */
function reportHref(type: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `/api/reports/${type}?${s}` : `/api/reports/${type}`;
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border px-3 text-sm";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("reports.view");
  const app = await getAppSettings();
  // Show the "Scheduled delivery" link only to roles that can manage schedules.
  const { actingRole } = await getDisplayRole();
  const canSchedule = hasCapability(actingRole, "reports.schedule", app.rolePermissions);
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";

  const fromRaw = first(sp.from).trim();
  const toRaw = first(sp.to).trim();
  const propertyId = first(sp.propertyId).trim();
  const windowRaw = first(sp.windowDays).trim();

  const from = parseDay(fromRaw);
  const to = parseDay(toRaw, true);
  const windowDays = /^\d+$/.test(windowRaw) ? Number(windowRaw) : 90;

  const now = new Date();
  const [rentRoll, overdue, backRent, income, expirations, methods, properties, tenants, units] =
    await Promise.all([
      getRentRoll(now),
      getOverdue(now),
      getBackRent(now),
      getIncomeSummary({ from, to, propertyId: propertyId || undefined }, now),
      getLeaseExpirations({ windowDays }, now),
      getPaymentMethodSummary({ from, to }),
      prisma.property.findMany({ orderBy: { name: "asc" } }),
      prisma.tenant.findMany({
        where: { isActive: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      prisma.unit.findMany({
        include: { property: true },
        orderBy: [{ property: { name: "asc" } }, { unitNumber: "asc" }],
      }),
    ]);

  const incomeHref = reportHref("income", {
    from: from ? fromRaw : undefined,
    to: to ? toRaw : undefined,
    propertyId: propertyId || undefined,
  });
  const expirationsHref = reportHref("lease-expirations", {
    windowDays: String(windowDays),
  });
  const methodsHref = reportHref("payment-methods", {
    from: from ? fromRaw : undefined,
    to: to ? toRaw : undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Reports</h1>
        {canSchedule && (
          <Button
            render={<Link href="/settings/report-schedules" />}
            variant="outline"
            size="sm"
          >
            Scheduled delivery
          </Button>
        )}
      </div>
      {app.reportHeaderText && (
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {app.reportHeaderText}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            method="GET"
            action="/reports"
            className="grid grid-cols-2 gap-3 md:grid-cols-5 md:items-end"
          >
            <div className="space-y-2">
              <Label htmlFor="propertyId">Property</Label>
              <select
                id="propertyId"
                name="propertyId"
                defaultValue={propertyId}
                className={SELECT_CLASS}
              >
                <option value="">All properties</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={fromRaw} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={toRaw} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="windowDays">Expiration window (days)</Label>
              <Input
                id="windowDays"
                name="windowDays"
                type="number"
                min={0}
                defaultValue={windowRaw || "90"}
              />
            </div>
            <div>
              <Button type="submit">Apply</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-t-4 border-t-sky-500">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Rent roll</CardTitle>
          <ReportExportButtons href="/api/reports/rent-roll" />
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No active leases."
            columns={[
              { key: "property", label: "Property", className: "hidden md:table-cell" },
              { key: "unit", label: "Unit" },
              { key: "tenant", label: "Tenant" },
              { key: "status", label: "Status" },
              { key: "rent", label: "Rent", align: "right", numeric: true },
              { key: "balance", label: "Balance", align: "right", numeric: true },
              { key: "pastDue", label: "Past due", align: "right", numeric: true },
            ]}
            rows={rentRoll.map((r, i) => ({
              key: String(i),
              sortValues: [
                r.property,
                r.unit,
                r.tenant,
                r.status,
                r.rent,
                r.balance,
                r.pastDue,
              ],
              cells: [
                r.property,
                r.unit,
                r.tenant,
                <span key="s" className="capitalize">
                  {r.status.replace("_", " ")}
                </span>,
                <span key="r" className="tabular-nums">
                  {money(r.rent)}
                </span>,
                <span key="b" className={cn("tabular-nums", amountClass(r.balance))}>
                  {money(r.balance)}
                </span>,
                <span key="p" className={cn("tabular-nums", amountClass(r.pastDue))}>
                  {money(r.pastDue)}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card className="border-t-4 border-t-red-500">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Overdue tenants</CardTitle>
          <div className="flex items-center gap-2">
            <form action={sendBulkOverdueRemindersAction}>
              <Button type="submit" variant="outline" size="sm">
                SMS all overdue
              </Button>
            </form>
            <ReportExportButtons href="/api/reports/overdue" />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No overdue tenants."
            columns={[
              { key: "tenant", label: "Tenant" },
              { key: "unit", label: "Unit" },
              { key: "balance", label: "Balance", align: "right", numeric: true },
              { key: "pastDue", label: "Past due", align: "right", numeric: true },
              {
                key: "lastPaidDays",
                label: "Days since paid",
                align: "right",
                numeric: true,
                className: "hidden sm:table-cell",
              },
            ]}
            rows={overdue.map((r, i) => ({
              key: String(i),
              sortValues: [
                r.tenant,
                `${r.property} · ${r.unit}`,
                r.balance,
                r.pastDue,
                r.lastPaidDays || null,
              ],
              cells: [
                r.tenant,
                `${r.property} · ${r.unit}`,
                <span key="b" className={cn("tabular-nums", amountClass(r.balance))}>
                  {money(r.balance)}
                </span>,
                <span key="p" className={cn("tabular-nums", amountClass(r.pastDue))}>
                  {money(r.pastDue)}
                </span>,
                <span key="d" className="tabular-nums">
                  {r.lastPaidDays || "—"}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card className="border-t-4 border-t-orange-500">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Back rent (terminated leases)</CardTitle>
          <ReportExportButtons href="/api/reports/back-rent" />
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No terminated leases owe a balance."
            columns={[
              { key: "tenant", label: "Tenant" },
              { key: "unit", label: "Unit" },
              { key: "status", label: "Status", className: "hidden sm:table-cell" },
              { key: "endDate", label: "Ended", className: "hidden md:table-cell" },
              { key: "owed", label: "Owed", align: "right", numeric: true },
              {
                key: "pastDue90",
                label: "90+ days",
                align: "right",
                numeric: true,
                className: "hidden lg:table-cell",
              },
            ]}
            rows={backRent.map((r, i) => ({
              key: String(i),
              sortValues: [
                r.tenant,
                `${r.property} · ${r.unit}`,
                r.status,
                r.endDate || null,
                r.owed,
                r.pastDue90,
              ],
              cells: [
                r.tenant,
                `${r.property} · ${r.unit}`,
                <span key="s" className="capitalize">
                  {r.status.replace(/_/g, " ")}
                </span>,
                r.endDate || "—",
                <span key="o" className={cn("tabular-nums", amountClass(r.owed))}>
                  {money(r.owed)}
                </span>,
                <span key="p" className={cn("tabular-nums", amountClass(r.pastDue90))}>
                  {money(r.pastDue90)}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card className="border-t-4 border-t-emerald-500">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Income summary</CardTitle>
          <ReportExportButtons href={incomeHref} />
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No income in this range."
            columns={[
              { key: "month", label: "Month" },
              { key: "property", label: "Property" },
              { key: "cash", label: "Cash received", align: "right", numeric: true },
              { key: "payments", label: "Payments", align: "right", numeric: true },
              {
                key: "charges",
                label: "Charges billed",
                align: "right",
                numeric: true,
                className: "hidden sm:table-cell",
              },
              {
                key: "lateFees",
                label: "Late fees billed",
                align: "right",
                numeric: true,
                className: "hidden md:table-cell",
              },
            ]}
            rows={income.map((r, i) => ({
              key: String(i),
              sortValues: [
                r.month,
                r.property,
                r.cashReceived,
                r.paymentCount,
                r.chargesBilled,
                r.lateFeesBilled,
              ],
              cells: [
                r.month,
                r.property,
                <span key="c" className="tabular-nums text-emerald-700 dark:text-emerald-400">
                  {money(r.cashReceived)}
                </span>,
                <span key="n" className="tabular-nums">
                  {r.paymentCount}
                </span>,
                <span key="ch" className="tabular-nums">
                  {money(r.chargesBilled)}
                </span>,
                <span key="lf" className="tabular-nums">
                  {money(r.lateFeesBilled)}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card className="border-t-4 border-t-amber-500">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Lease expirations (next {windowDays} days)</CardTitle>
          <ReportExportButtons href={expirationsHref} />
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No leases expiring in this window."
            columns={[
              { key: "property", label: "Property", className: "hidden md:table-cell" },
              { key: "unit", label: "Unit" },
              { key: "tenant", label: "Tenant" },
              { key: "endDate", label: "End date" },
              { key: "daysLeft", label: "Days left", align: "right", numeric: true },
              {
                key: "rent",
                label: "Rent",
                align: "right",
                numeric: true,
                className: "hidden sm:table-cell",
              },
              { key: "status", label: "Status", className: "hidden lg:table-cell" },
            ]}
            rows={expirations.map((r, i) => ({
              key: String(i),
              sortValues: [
                r.property,
                r.unit,
                r.tenant,
                r.endDate || null,
                r.daysLeft || null,
                r.rent,
                r.status,
              ],
              cells: [
                r.property,
                r.unit,
                r.tenant,
                r.endDate || "—",
                <span key="d" className="tabular-nums">
                  {r.daysLeft || "—"}
                </span>,
                <span key="r" className="tabular-nums">
                  {money(r.rent)}
                </span>,
                <span key="s" className="capitalize">
                  {r.status.replace(/_/g, " ")}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card className="border-t-4 border-t-violet-500">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Payments by method</CardTitle>
          <ReportExportButtons href={methodsHref} />
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No payments in this range."
            columns={[
              { key: "method", label: "Method" },
              { key: "count", label: "Count", align: "right", numeric: true },
              { key: "total", label: "Total", align: "right", numeric: true },
            ]}
            rows={methods.map((r, i) => ({
              key: String(i),
              sortValues: [r.method, r.count, r.total],
              cells: [
                <span key="m" className="capitalize">
                  {r.method.replace(/_/g, " ")}
                </span>,
                <span key="c" className="tabular-nums">
                  {r.count}
                </span>,
                <span key="t" className="tabular-nums">
                  {money(r.total)}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger exports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download a full ledger CSV (charges, payments, reversals, running balance) for a
            tenant or a unit.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <form method="GET" action="/api/reports/tenant-ledger" className="space-y-2">
              <Label htmlFor="ledger-tenantId">Tenant ledger</Label>
              <div className="flex gap-2">
                <select
                  id="ledger-tenantId"
                  name="tenantId"
                  required
                  className={SELECT_CLASS}
                >
                  <option value="">Select tenant…</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.lastName}, {t.firstName}
                    </option>
                  ))}
                </select>
                <select
                  name="format"
                  defaultValue="csv"
                  aria-label="Tenant ledger format"
                  className="h-9 rounded-md border px-2 text-sm"
                >
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                  <option value="xlsx">Excel</option>
                </select>
                <Button type="submit" variant="outline">
                  Download
                </Button>
              </div>
            </form>
            <form method="GET" action="/api/reports/unit-ledger" className="space-y-2">
              <Label htmlFor="ledger-unitId">Unit ledger</Label>
              <div className="flex gap-2">
                <select id="ledger-unitId" name="unitId" required className={SELECT_CLASS}>
                  <option value="">Select unit…</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.property.name} · {u.unitNumber}
                    </option>
                  ))}
                </select>
                <select
                  name="format"
                  defaultValue="csv"
                  aria-label="Unit ledger format"
                  className="h-9 rounded-md border px-2 text-sm"
                >
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                  <option value="xlsx">Excel</option>
                </select>
                <Button type="submit" variant="outline">
                  Download
                </Button>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
