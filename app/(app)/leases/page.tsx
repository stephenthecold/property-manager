import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import { terminateLease } from "./actions";
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

export default async function LeasesPage() {
  const leases = await prisma.lease.findMany({
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    include: { tenant: true, unit: { include: { property: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Leases</h1>
        <Button render={<Link href="/leases/new" />}>Create lease</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tenant</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Rent</TableHead>
            <TableHead>Due day</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leases.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                <Link href={`/tenants/${l.tenantId}`} className="font-medium hover:underline">
                  {l.tenant.firstName} {l.tenant.lastName}
                </Link>
              </TableCell>
              <TableCell>
                {l.unit.property.name} · {l.unit.unitNumber}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(l.rentAmountCents, l.unit.property.currency)}
              </TableCell>
              <TableCell>{l.dueDay}</TableCell>
              <TableCell className="capitalize">{l.status.replace("_", " ")}</TableCell>
              <TableCell className="text-right">
                {(l.status === "active" || l.status === "month_to_month") && (
                  <form action={terminateLease}>
                    <input type="hidden" name="leaseId" value={l.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Terminate
                    </Button>
                  </form>
                )}
              </TableCell>
            </TableRow>
          ))}
          {leases.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No leases yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
