import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import { leaseSnapshot } from "@/lib/services/accounting";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

export default async function UnitDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const unit = await prisma.unit.findUnique({
    where: { id },
    include: {
      property: true,
      building: true,
      leases: {
        where: { status: { in: ["active", "month_to_month"] } },
        include: { tenant: true },
        take: 1,
      },
    },
  });
  if (!unit) notFound();

  const lease = unit.leases[0] ?? null;
  const snap = lease
    ? await leaseSnapshot(lease, unit, new Date(), unit.property.timezone)
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {unit.property.name} · {unit.unitNumber}
        </h1>
        <p className="text-muted-foreground capitalize">
          {unit.building?.name ? `${unit.building.name} · ` : ""}
          {unit.unitType} · {unit.occupancyStatus} ·{" "}
          {formatCurrency(unit.defaultRentAmountCents, unit.property.currency)} default rent
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current lease</CardTitle>
        </CardHeader>
        <CardContent>
          {lease && snap ? (
            <div className="flex items-center justify-between">
              <div>
                <Link href={`/tenants/${lease.tenantId}`} className="font-medium hover:underline">
                  {lease.tenant.firstName} {lease.tenant.lastName}
                </Link>
                <div className="text-sm text-muted-foreground">
                  Balance {formatCurrency(snap.netBalanceCents, unit.property.currency)}
                </div>
              </div>
              <StatusBadge status={snap.status} />
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground">No active lease.</p>
              <Button render={<Link href="/leases/new" />}>Create lease</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
