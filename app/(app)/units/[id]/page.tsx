import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCurrency, fromCents } from "@/lib/money";
import { leaseSnapshot } from "@/lib/services/accounting";
import { computeVacancy } from "@/lib/units/vacancy";
import { getAppSettings } from "@/lib/services/app-settings";
import { getDisplayRole } from "@/lib/auth/session";
import { hasCapability } from "@/lib/auth/permissions";
import {
  OPEN_STATUSES,
  statusBadgeClass,
  statusLabel,
} from "@/lib/maintenance/status";
import { Badge } from "@/components/ui/badge";
import {
  updateUnit,
  deleteUnit,
  addUnitConditionAction,
  deleteUnitConditionAction,
} from "../actions";
import {
  CONDITION_PHASES,
  conditionPhaseLabel,
  listConditionLogsForUnit,
} from "@/lib/services/unit-condition";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const UNIT_TYPES = ["apartment", "house", "duplex", "storage", "commercial", "other"];
const SERVICE = ["in_service", "maintenance", "unavailable"];

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

  // Full tenancy history for this unit: every real (non-draft) lease, newest
  // first, with the primary tenant + any co-tenants. Read-only — staff-level
  // info, same sensitivity as the current-lease card above.
  const leaseHistory = await prisma.lease.findMany({
    where: { unitId: unit.id, status: { not: "draft" } },
    include: {
      tenant: { select: { id: true, firstName: true, lastName: true } },
      coTenants: {
        include: {
          tenant: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });

  const hasActiveLease = !!lease;
  const vacancy = computeVacancy(
    {
      serviceStatus: unit.serviceStatus,
      availableFromDate: unit.availableFromDate,
      activeLeaseEndDate: lease?.endDate ?? null,
      hasActiveLease,
    },
    new Date(),
  );
  const fmtAvail = (d: Date) =>
    d.toLocaleDateString("en-US", {
      timeZone: unit.property.timezone,
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  const availabilityLabel =
    vacancy.state === "occupied"
      ? "Occupied"
      : vacancy.state === "vacant"
        ? "Available now"
        : vacancy.state === "upcoming" && vacancy.availableOn
          ? `Available ${fmtAvail(vacancy.availableOn)}`
          : vacancy.state === "maintenance"
            ? vacancy.availableOn
              ? `Maintenance — until ${fmtAvail(vacancy.availableOn)}`
              : "Maintenance"
            : vacancy.state === "unavailable"
              ? vacancy.availableOn
                ? `Unavailable — until ${fmtAvail(vacancy.availableOn)}`
                : "Unavailable"
              : "—";
  // Occupancy is lease-derived; serviceability is the manual field. Showing them
  // separately means they can never contradict (the old "doubling").
  const occupancyLabel = hasActiveLease ? "Occupied" : "Vacant";
  const subtitleState =
    vacancy.state === "maintenance"
      ? "Maintenance"
      : vacancy.state === "unavailable"
        ? "Unavailable"
        : occupancyLabel;

  const app = await getAppSettings();
  const { modules } = app;
  const openJobs = modules.maintenance
    ? await prisma.maintenanceJob.findMany({
        where: { unitId: unit.id, status: { in: OPEN_STATUSES } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      })
    : [];

  // Condition photos (module "inspections"): gated on inspections.manage to
  // VIEW (matching the inspection detail page), not just the module flag — the
  // unit's full history + the unit's leases for the optional tenancy picker.
  const { actingRole } = await getDisplayRole();
  const canCondition =
    modules.inspections &&
    hasCapability(actingRole, "inspections.manage", app.rolePermissions);
  const conditionLogs = canCondition
    ? await listConditionLogsForUnit(unit.id)
    : [];
  const unitLeases = canCondition
    ? await prisma.lease.findMany({
        where: { unitId: unit.id },
        include: { tenant: { select: { firstName: true, lastName: true } } },
        orderBy: { startDate: "desc" },
      })
    : [];
  const conditionDateDefault = new Date().toLocaleDateString("en-CA", {
    timeZone: unit.property.timezone,
  });
  const fmtLeaseDate = (d: Date) =>
    d.toLocaleDateString("en-US", { timeZone: unit.property.timezone });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {unit.property.name} · {unit.unitNumber}
        </h1>
        <p className="text-muted-foreground capitalize">
          {unit.building?.name ? `${unit.building.name} · ` : ""}
          {unit.unitType} · {subtitleState} ·{" "}
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
          <CardTitle className="text-base">Lease history</CardTitle>
        </CardHeader>
        <CardContent>
          {leaseHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leases yet for this unit.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead className="text-right">Rent</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaseHistory.map((l) => {
                  const isCurrent =
                    l.status === "active" || l.status === "month_to_month";
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Link
                          href={`/tenants/${l.tenantId}`}
                          className="font-medium hover:underline"
                        >
                          {l.tenant.firstName} {l.tenant.lastName}
                        </Link>
                        {l.coTenants.length > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            +{" "}
                            {l.coTenants
                              .map(
                                (c) =>
                                  `${c.tenant.firstName} ${c.tenant.lastName}`,
                              )
                              .join(", ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {fmtLeaseDate(l.startDate)} –{" "}
                        {l.endDate ? fmtLeaseDate(l.endDate) : "present"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(l.rentAmountCents, currency)}
                      </TableCell>
                      <TableCell>
                        <span className="capitalize">
                          {l.status.replace(/_/g, " ")}
                        </span>
                        {isCurrent && (
                          <Badge
                            variant="outline"
                            className="ml-2 border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          >
                            current
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
                  <Label htmlFor="serviceStatus">Service status</Label>
                  <select
                    id="serviceStatus"
                    name="serviceStatus"
                    defaultValue={unit.serviceStatus}
                    className="h-9 w-full rounded-md border px-3 text-sm capitalize"
                  >
                    {SERVICE.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Occupancy is set automatically from the active lease.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="availableFromDate">Available from</Label>
                  <Input
                    id="availableFromDate"
                    name="availableFromDate"
                    type="date"
                    defaultValue={
                      unit.availableFromDate
                        ? unit.availableFromDate.toLocaleDateString("en-CA", {
                            timeZone: unit.property.timezone,
                          })
                        : ""
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. Overrides the active lease&apos;s end date in the
                    dashboard vacancy outlook.
                  </p>
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
            <Field label="Occupancy" value={occupancyLabel} />
            <Field
              label="Service status"
              value={<span className="capitalize">{unit.serviceStatus.replace(/_/g, " ")}</span>}
            />
            <Field label="Availability" value={availabilityLabel} />
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
                      className={`font-medium ${statusBadgeClass(j.status)}`}
                    >
                      {statusLabel(j.status)}
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

      {canCondition && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Condition photos</CardTitle>
              <p className="text-xs text-muted-foreground">
                Dated move-in / move-out / turnover photos with a note.
              </p>
            </div>
            <FormDialog
              trigger="Add condition photos"
              title="Add condition photos"
              wide
              action={addUnitConditionAction}
              submitLabel="Save photos"
            >
              <input type="hidden" name="unitId" value={unit.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="phase">Type</Label>
                  <select
                    id="phase"
                    name="phase"
                    defaultValue="move_out"
                    className="h-9 w-full rounded-md border px-3 text-sm"
                  >
                    {CONDITION_PHASES.map((p) => (
                      <option key={p} value={p}>
                        {conditionPhaseLabel(p)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conditionDate">Date</Label>
                  <Input
                    id="conditionDate"
                    name="conditionDate"
                    type="date"
                    defaultValue={conditionDateDefault}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="leaseId">Tenancy (optional)</Label>
                <select
                  id="leaseId"
                  name="leaseId"
                  defaultValue=""
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="">— no tenant (unit only) —</option>
                  {unitLeases.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.tenant.firstName} {l.tenant.lastName} ({fmtLeaseDate(l.startDate)}
                      {l.endDate ? `–${fmtLeaseDate(l.endDate)}` : "–present"})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="note">Note (optional)</Label>
                <Textarea
                  id="note"
                  name="note"
                  placeholder="e.g. Carpet stained in living room; kitchen left clean."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="condition-photos">Photos</Label>
                <input
                  id="condition-photos"
                  name="photos"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/70"
                />
                <p className="text-xs text-muted-foreground">
                  Up to 5 images (JPG/PNG/WebP, 10 MB each).
                </p>
              </div>
            </FormDialog>
          </CardHeader>
          <CardContent>
            {conditionLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No condition photos yet.</p>
            ) : (
              <div className="space-y-5">
                {conditionLogs.map((log) => (
                  <div
                    key={log.id}
                    className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-medium">
                        {conditionPhaseLabel(log.phase)}
                      </Badge>
                      <span className="text-sm font-medium">
                        {log.conditionDate.toLocaleDateString("en-US", {
                          timeZone: unit.property.timezone,
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      {log.tenantName && (
                        <span className="text-sm text-muted-foreground">
                          · {log.tenantName}
                        </span>
                      )}
                      <form action={deleteUnitConditionAction} className="ml-auto">
                        <input type="hidden" name="logId" value={log.id} />
                        <input type="hidden" name="unitId" value={unit.id} />
                        <ConfirmSubmitButton
                          variant="ghost"
                          size="xs"
                          confirmMessage="Delete this condition photo batch? This cannot be undone."
                        >
                          Delete
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                    {log.note && (
                      <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                        {log.note}
                      </p>
                    )}
                    {log.photos.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {log.photos.map((p) =>
                          p.url ? (
                            <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, not optimizable */}
                              <img
                                src={p.url}
                                alt={p.fileName ?? "Condition photo"}
                                className="aspect-square w-full rounded-md border object-cover"
                              />
                            </a>
                          ) : (
                            <div
                              key={p.id}
                              className="flex aspect-square w-full items-center justify-center rounded-md border text-center text-xs text-muted-foreground"
                            >
                              (unavailable)
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
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
              This unit has lease history and cannot be deleted. Set its service
              status to &ldquo;unavailable&rdquo; instead.
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
