import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";

export default async function PaymentsPage() {
  const payments = await prisma.payment.findMany({
    orderBy: { paymentDate: "desc" },
    take: 100,
    include: {
      lease: { include: { tenant: true, unit: { include: { property: true } } } },
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Payments</h1>
      <p className="text-sm text-muted-foreground">
        Record payments from a tenant&apos;s page. Showing the 100 most recent.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.paymentDate.toLocaleDateString()}</TableCell>
              <TableCell>
                <Link href={`/tenants/${p.lease.tenantId}`} className="font-medium hover:underline">
                  {p.lease.tenant.firstName} {p.lease.tenant.lastName}
                </Link>
              </TableCell>
              <TableCell>{p.lease.unit.property.name} · {p.lease.unit.unitNumber}</TableCell>
              <TableCell className="capitalize">{p.method.replace("_", " ")}</TableCell>
              <TableCell className="capitalize">{p.status}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(p.amountCents, p.lease.unit.property.currency)}
              </TableCell>
            </TableRow>
          ))}
          {payments.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No payments yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
