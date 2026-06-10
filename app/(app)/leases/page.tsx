import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { LeaseStatus } from "@/lib/generated/prisma/enums";
import { terminateLease } from "./actions";
import { Button } from "@/components/ui/button";
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

const LEASE_STATUSES = ["draft", "active", "month_to_month", "ended", "eviction"] as const;

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (key: string): string => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };

  const statusRaw = first("status");
  const status = (LEASE_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as LeaseStatus)
    : undefined;
  const propertyId = first("propertyId") || undefined;

  const where: Prisma.LeaseWhereInput = {};
  if (status) where.status = status;
  if (propertyId) where.unit = { propertyId };
  const filtering = Boolean(status || propertyId);

  const properties = await prisma.property.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const leases = await prisma.lease.findMany({
    where,
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    include: { tenant: true, unit: { include: { property: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Leases</h1>
        <Button render={<Link href="/leases/new" />}>Create lease</Button>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="h-9 w-44 rounded-md border bg-transparent px-3 text-sm capitalize"
          >
            <option value="">All statuses</option>
            {LEASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="propertyId">Property</Label>
          <select
            id="propertyId"
            name="propertyId"
            defaultValue={propertyId ?? ""}
            className="h-9 w-48 rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
        {filtering && (
          <Button variant="ghost" size="sm" render={<Link href="/leases" />}>
            Clear
          </Button>
        )}
      </form>

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
