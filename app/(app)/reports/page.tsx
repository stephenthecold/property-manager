import Link from "next/link";
import { prisma } from "@/lib/db";
import { sendBulkOverdueRemindersAction } from "@/app/(app)/reminders/actions";
import {
  getIncomeSummary,
  getLeaseExpirations,
  getOverdue,
  getPaymentMethodSummary,
  getRentRoll,
} from "@/lib/services/reports";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";

function money(v: string) {
  return `$${v}`;
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
  "h-9 w-full rounded-md border bg-transparent px-3 text-sm";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
  const [rentRoll, overdue, income, expirations, methods, properties, tenants, units] =
    await Promise.all([
      getRentRoll(now),
      getOverdue(now),
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
      <h1 className="text-2xl font-semibold">Reports</h1>

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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Rent roll</CardTitle>
          <Button render={<Link href="/api/reports/rent-roll" />} variant="outline" size="sm">
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rent</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Past due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rentRoll.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.property}</TableCell>
                  <TableCell>{r.unit}</TableCell>
                  <TableCell>{r.tenant}</TableCell>
                  <TableCell className="capitalize">{r.status.replace("_", " ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.rent)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.balance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.pastDue)}</TableCell>
                </TableRow>
              ))}
              {rentRoll.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No active leases.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Overdue tenants</CardTitle>
          <div className="flex items-center gap-2">
            <form action={sendBulkOverdueRemindersAction}>
              <Button type="submit" variant="outline" size="sm">
                SMS all overdue
              </Button>
            </form>
            <Button render={<Link href="/api/reports/overdue" />} variant="outline" size="sm">
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Past due</TableHead>
                <TableHead className="text-right">Days since paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overdue.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.tenant}</TableCell>
                  <TableCell>
                    {r.property} · {r.unit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.balance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.pastDue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.lastPaidDays || "—"}</TableCell>
                </TableRow>
              ))}
              {overdue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No overdue tenants.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Income summary</CardTitle>
          <Button render={<Link href={incomeHref} />} variant="outline" size="sm">
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Property</TableHead>
                <TableHead className="text-right">Cash received</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Charges billed</TableHead>
                <TableHead className="text-right">Late fees billed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {income.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.month}</TableCell>
                  <TableCell>{r.property}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.cashReceived)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.paymentCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.chargesBilled)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.lateFeesBilled)}
                  </TableCell>
                </TableRow>
              ))}
              {income.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No income in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Lease expirations (next {windowDays} days)</CardTitle>
          <Button render={<Link href={expirationsHref} />} variant="outline" size="sm">
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>End date</TableHead>
                <TableHead className="text-right">Days left</TableHead>
                <TableHead className="text-right">Rent</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expirations.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.property}</TableCell>
                  <TableCell>{r.unit}</TableCell>
                  <TableCell>{r.tenant}</TableCell>
                  <TableCell>{r.endDate || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.daysLeft || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.rent)}</TableCell>
                  <TableCell className="capitalize">{r.status.replace(/_/g, " ")}</TableCell>
                </TableRow>
              ))}
              {expirations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No leases expiring in this window.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Payments by method</CardTitle>
          <Button render={<Link href={methodsHref} />} variant="outline" size="sm">
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {methods.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="capitalize">{r.method.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.total)}</TableCell>
                </TableRow>
              ))}
              {methods.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No payments in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
                <Button type="submit" variant="outline">
                  Download CSV
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
                <Button type="submit" variant="outline">
                  Download CSV
                </Button>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
