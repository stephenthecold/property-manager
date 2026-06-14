import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCurrency, fromCents } from "@/lib/money";
import { leaseSnapshot } from "@/lib/services/accounting";
import { getAppSettings } from "@/lib/services/app-settings";
import { Badge } from "@/components/ui/badge";
import { updateUnit, deleteUnit } from "../actions";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

const UNIT_TYPES = ["apartment", "house", "duplex", "storage", "commercial", "other"];
const OCC = ["vacant", "occupied", "maintenance", "unavailable"];

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

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

  const { modules } = await getAppSettings();
  const openJobs = modules.maintenance
    ? await prisma.maintenanceJob.findMany({
        where: { unitId: unit.id, status: "pending" },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      })
    : [];

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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Unit details</CardTitle>
          <FormDialog
            trigger="Edit unit"
            title="Edit unit"
            wide
            action={updateUnit}
            submitLabel="Save changes"
          >
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
                    className="h-9 w-full rounded-md border px-3 text-sm"
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
                    className="h-9 w-full rounded-md border px-3 text-sm capitalize"
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
                    className="h-9 w-full rounded-md border px-3 text-sm capitalize"
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
          </FormDialog>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field
              label="Type"
              value={<span className="capitalize">{unit.unitType}</span>}
            />
            <Field
              label="Occupancy"
              value={<span className="capitalize">{unit.occupancyStatus}</span>}
            />
            <Field label="Building" value={unit.building?.name ?? "—"} />
            <Field
              label="Default rent"
              value={formatCurrency(unit.defaultRentAmountCents, currency)}
            />
            <Field label="Bedrooms" value={unit.bedrooms ?? "—"} />
            <Field label="Bathrooms" value={unit.bathrooms ?? "—"} />
            <Field label="Square feet" value={unit.squareFeet ?? "—"} />
            <Field
              label="Internet default"
              value={
                unit.internetEnabled
                  ? `+${formatCurrency(unit.internetFeeCents, currency)}/mo`
                  : "Off"
              }
            />
          </div>
          {unit.notes && (
            <p className="mt-3 text-sm text-muted-foreground">{unit.notes}</p>
          )}
        </CardContent>
      </Card>

      {modules.maintenance && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Open maintenance jobs</CardTitle>
            <Link href="/maintenance" className="text-sm font-medium hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {openJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open jobs for this unit.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {openJobs.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-amber-200 bg-amber-100 font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    >
                      Pending
                    </Badge>
                    <span className="font-medium">{j.title}</span>
                    {j.dueDate && (
                      <span className="text-muted-foreground">
                        — due {j.dueDate.toLocaleDateString("en-US", { timeZone: "UTC" })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

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
