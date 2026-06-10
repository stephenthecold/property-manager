import Link from "next/link";
import { getDashboard } from "@/lib/services/dashboard";
import { formatCurrency } from "@/lib/money";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const d = await getDashboard(new Date());

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Expected this month" value={formatCurrency(d.monthExpectedCents)} />
        <Stat label="Collected this month" value={formatCurrency(d.monthCollectedCents)} />
        <Stat
          label="Overdue balance"
          value={formatCurrency(d.overdueBalanceCents)}
          hint={`${d.overdueTenants} tenant(s) overdue`}
        />
        <Stat label="Collected today" value={formatCurrency(d.todayCollectedCents)} />
        <Stat label="Occupied units" value={String(d.occupiedUnits)} />
        <Stat label="Vacant / other units" value={String(d.vacantUnits)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tenant status</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Past due</TableHead>
                <TableHead className="text-right">Days since paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.leaseRows.map((r) => (
                <TableRow key={r.leaseId}>
                  <TableCell>
                    <Link href={`/tenants/${r.tenantId}`} className="font-medium hover:underline">
                      {r.tenantName}
                    </Link>
                  </TableCell>
                  <TableCell>{r.unitLabel}</TableCell>
                  <TableCell className="text-muted-foreground">{r.propertyName}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(r.netBalanceCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(r.pastDueCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.lastPaymentDays ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {d.leaseRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No active leases yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent payments</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.recentPayments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.tenantName}</TableCell>
                  <TableCell>{p.paymentDate.toLocaleDateString()}</TableCell>
                  <TableCell className="capitalize">{p.method.replace("_", " ")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(p.amountCents)}
                  </TableCell>
                </TableRow>
              ))}
              {d.recentPayments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No payments recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
