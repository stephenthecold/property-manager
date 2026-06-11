import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCurrency, fromCents } from "@/lib/money";
import { leaseSnapshot } from "@/lib/services/accounting";
import { updateUnit, deleteUnit } from "../actions";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

const UNIT_TYPES = ["apartment", "house", "duplex", "storage", "commercial", "other"];
const OCC = ["vacant", "occupied", "maintenance", "unavailable"];

export default async function UnitDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const unit = await prisma.unit.findUnique({
    where: { id },
    include: {
      property: { include: { buildings: { orderBy: { name: "asc" } } } },
      building: true,
      leases: {
        where: { status: { in: ["active", "month_to_month"] } },
        include: { tenant: true },
        take: 1,
      },
      _count: { select: { leases: true } },
    },
  });
  if (!unit) notFound();

  const lease = unit.leases[0] ?? null;
  const snap = lease
    ? await leaseSnapshot(lease, unit, new Date(), unit.property.timezone)
    : null;
  const currency = unit.property.currency;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {unit.property.name} · {unit.unitNumber}
        </h1>
        <p className="text-muted-foreground capitalize">
          {unit.building?.name ? `${unit.building.name} · ` : ""}
          {unit.unitType} · {unit.occupancyStatus} ·{" "}
          {formatCurrency(unit.defaultRentAmountCents, currency)} default rent
          {unit.internetEnabled
            ? ` · internet default +${formatCurrency(unit.internetFeeCents, currency)}/mo`
            : ""}
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
                  Balance {formatCurrency(snap.netBalanceCents, currency)}
                </div>
                {lease.scheduledRentAmountCents != null &&
                  lease.scheduledRentEffectiveDate != null && (
                    <div className="text-sm text-muted-foreground">
                      Rent increases to{" "}
                      {formatCurrency(lease.scheduledRentAmountCents, currency)} on{" "}
                      {lease.scheduledRentEffectiveDate.toLocaleDateString("en-US", {
                        timeZone: unit.property.timezone,
                      })}
                    </div>
                  )}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit unit</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateUnit} className="space-y-3">
            <input type="hidden" name="unitId" value={unit.id} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="unitNumber">Unit number</Label>
                <Input
                  id="unitNumber"
                  name="unitNumber"
                  defaultValue={unit.unitNumber}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="buildingId">Building</Label>
                <select
                  id="buildingId"
                  name="buildingId"
                  defaultValue={unit.buildingId ?? ""}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                >
                  <option value="">— none —</option>
                  {unit.property.buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unitType">Type</Label>
                <select
                  id="unitType"
                  name="unitType"
                  defaultValue={unit.unitType}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm capitalize"
                >
                  {UNIT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="occupancyStatus">Occupancy</Label>
                <select
                  id="occupancyStatus"
                  name="occupancyStatus"
                  defaultValue={unit.occupancyStatus}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm capitalize"
                >
                  {OCC.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bedrooms">Bedrooms</Label>
                <Input
                  id="bedrooms"
                  name="bedrooms"
                  inputMode="numeric"
                  defaultValue={unit.bedrooms ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bathrooms">Bathrooms</Label>
                <Input
                  id="bathrooms"
                  name="bathrooms"
                  inputMode="decimal"
                  defaultValue={unit.bathrooms ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="squareFeet">Square feet</Label>
                <Input
                  id="squareFeet"
                  name="squareFeet"
                  inputMode="numeric"
                  defaultValue={unit.squareFeet ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultRent">Default rent</Label>
                <Input
                  id="defaultRent"
                  name="defaultRent"
                  inputMode="decimal"
                  defaultValue={fromCents(unit.defaultRentAmountCents)}
                  required
                />
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  id="internetEnabled"
                  name="internetEnabled"
                  type="checkbox"
                  defaultChecked={unit.internetEnabled}
                  className="size-4 accent-primary"
                />
                <Label htmlFor="internetEnabled">
                  Internet service — default for new leases on this unit
                </Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="internetFee">Monthly internet fee</Label>
                <Input
                  id="internetFee"
                  name="internetFee"
                  inputMode="decimal"
                  defaultValue={fromCents(unit.internetFeeCents)}
                  className="max-w-40"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Billing is controlled per lease (Edit lease on the tenant page);
                  this only prefills new leases for this unit.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" defaultValue={unit.notes ?? ""} />
            </div>
            <Button type="submit" size="sm">
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delete unit</CardTitle>
        </CardHeader>
        <CardContent>
          {unit._count.leases > 0 ? (
            <p className="text-sm text-muted-foreground">
              This unit has lease history and cannot be deleted. Set its occupancy to
              &ldquo;unavailable&rdquo; instead.
            </p>
          ) : (
            <form action={deleteUnit} className="flex items-center justify-between gap-4">
              <input type="hidden" name="unitId" value={unit.id} />
              <p className="text-sm text-muted-foreground">
                Permanently removes this unit. Only possible while it has no lease history.
              </p>
              <ConfirmSubmitButton
                confirmMessage={`Delete unit ${unit.unitNumber}? This cannot be undone.`}
              >
                Delete unit
              </ConfirmSubmitButton>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
