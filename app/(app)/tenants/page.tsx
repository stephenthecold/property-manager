import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import { leaseSnapshot } from "@/lib/services/accounting";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";

export default async function TenantsPage() {
  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      leases: {
        where: { status: { in: ["active", "month_to_month"] } },
        include: { unit: { include: { property: true } } },
        take: 1,
      },
    },
  });

  const rows = await Promise.all(
    tenants.map(async (t) => {
      const lease = t.leases[0];
      const snap = lease
        ? await leaseSnapshot(lease, lease.unit, now, lease.unit.property.timezone)
        : null;
      return { tenant: t, lease, snap };
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <Button render={<Link href="/tenants/new" />}>Add tenant</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="text-right">Days since paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ tenant, lease, snap }) => (
            <TableRow key={tenant.id}>
              <TableCell>
                <Link href={`/tenants/${tenant.id}`} className="font-medium hover:underline">
                  {tenant.firstName} {tenant.lastName}
                </Link>
              </TableCell>
              <TableCell>
                {lease ? `${lease.unit.property.name} · ${lease.unit.unitNumber}` : "—"}
              </TableCell>
              <TableCell>
                {snap ? <StatusBadge status={snap.status} /> : <span className="text-muted-foreground">No active lease</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {snap ? formatCurrency(snap.netBalanceCents) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {snap?.daysSinceLastPayment ?? "—"}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No tenants yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
