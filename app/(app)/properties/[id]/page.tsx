import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { formatCurrency, fromCents } from "@/lib/money";
import { getAppSettings } from "@/lib/services/app-settings";
import { createBuilding, createUnit, updateProperty } from "../actions";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormDialog } from "@/components/app/form-dialog";
import { PageHeader } from "@/components/app/page-header";
import { ChangeHistory } from "@/components/app/change-history";

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

function occupancyClass(status: string): string {
  if (status === "occupied") return "capitalize text-emerald-700 dark:text-emerald-400";
  if (status === "vacant") return "capitalize text-amber-700 dark:text-amber-400";
  return "capitalize text-muted-foreground";
}

export default async function PropertyDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability("properties.manage");
  const { id } = await params;
  const property = await prisma.property.findUnique({
    where: { id },
    include: {
      buildings: { orderBy: { name: "asc" } },
      units: {
        orderBy: { unitNumber: "asc" },
        include: {
          building: true,
          leases: {
            where: { status: { in: ["active", "month_to_month"] } },
            include: { tenant: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!property) notFound();
  const { billing, modules } = await getAppSettings();

  // "$2,400.00/yr ($200.00/mo)" — /12n truncates sub-cent remainders (display only).
  const yearlyWithMonthly = (cents: bigint | null) =>
    cents != null
      ? `${formatCurrency(cents, property.currency)}/yr (${formatCurrency(
          cents / 12n,
          property.currency,
        )}/mo)`
      : "—";

  // Tier list: units grouped under their building, natural sort throughout
  // ("Apt 2" before "Apt 10"), unassigned units last.
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const sortUnits = (units: typeof property.units) =>
    [...units].sort((a, b) => collator.compare(a.unitNumber, b.unitNumber));
  const groups = [...property.buildings]
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((b) => ({
      building: b,
      units: sortUnits(property.units.filter((u) => u.buildingId === b.id)),
    }));
  const unassigned = sortUnits(property.units.filter((u) => !u.buildingId));

  const unitRow = (u: (typeof property.units)[number]) => {
    const tenant = u.leases[0]?.tenant;
    // Occupancy is lease-derived; serviceability comes from the manual field.
    const occupancyLabel =
      u.leases.length > 0
        ? "occupied"
        : u.serviceStatus === "maintenance"
          ? "maintenance"
          : u.serviceStatus === "unavailable"
            ? "unavailable"
            : "vacant";
    return (
      <TableRow key={u.id}>
        <TableCell className="pl-8">
          <Link href={`/units/${u.id}`} className="font-medium hover:underline">
            {u.unitNumber}
          </Link>
        </TableCell>
        <TableCell className="hidden capitalize sm:table-cell">{u.unitType}</TableCell>
        <TableCell>
          <span className={occupancyClass(occupancyLabel)}>{occupancyLabel}</span>
        </TableCell>
        <TableCell>
          {tenant ? (
            <Link href={`/tenants/${tenant.id}`} className="hover:underline">
              {tenant.firstName} {tenant.lastName}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="hidden tabular-nums lg:table-cell">
          {u.internetEnabled
            ? `+${formatCurrency(u.internetFeeCents, property.currency)}`
            : "—"}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(u.defaultRentAmountCents, property.currency)}
        </TableCell>
      </TableRow>
    );
  };

  const groupHeader = (
    key: string,
    title: React.ReactNode,
    description: string | null,
    meta: string,
  ) => (
    <TableRow
      key={key}
      className="border-l-2 border-l-sky-500 bg-sky-50/60 hover:bg-sky-50/60 dark:bg-sky-950/20 dark:hover:bg-sky-950/20"
    >
      <TableCell colSpan={6} className="whitespace-normal">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold">{title}</span>
          {description && (
            <span className="text-muted-foreground">{description}</span>
          )}
          <span className="text-xs text-muted-foreground">{meta}</span>
        </span>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={property.name}
        back={{ href: "/properties", label: "Properties" }}
        description={`${
          [property.addressLine1, property.city, property.state, property.zip]
            .filter(Boolean)
            .join(", ") || "No address"
        } · ${property.timezone} · ${property.currency}`}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Property details</CardTitle>
          <FormDialog
            trigger="Edit property"
            title="Edit property"
            wide
            action={updateProperty}
            submitLabel="Save property"
          >
            <input type="hidden" name="propertyId" value={property.id} />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pname">Name</Label>
                  <Input id="pname" name="name" defaultValue={property.name} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paddr1">Address line 1</Label>
                  <Input
                    id="paddr1"
                    name="addressLine1"
                    defaultValue={property.addressLine1 ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paddr2">Address line 2</Label>
                  <Input
                    id="paddr2"
                    name="addressLine2"
                    defaultValue={property.addressLine2 ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pcity">City</Label>
                  <Input id="pcity" name="city" defaultValue={property.city ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pstate">State</Label>
                  <Input id="pstate" name="state" defaultValue={property.state ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pzip">ZIP</Label>
                  <Input id="pzip" name="zip" defaultValue={property.zip ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ptz">Timezone (IANA)</Label>
                  <Input id="ptz" name="timezone" defaultValue={property.timezone} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pcurrency">Currency</Label>
                  <Input id="pcurrency" name="currency" defaultValue={property.currency} />
                </div>
                {modules.portfolio && (
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="plegalEntity">Legal entity / LLC</Label>
                    <Input
                      id="plegalEntity"
                      name="legalEntityName"
                      placeholder="Acme Holdings LLC"
                      defaultValue={property.legalEntityName ?? ""}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="pmortgage">Monthly mortgage</Label>
                  <Input
                    id="pmortgage"
                    name="monthlyMortgage"
                    inputMode="decimal"
                    placeholder="1850.00"
                    defaultValue={
                      property.monthlyMortgageCents != null
                        ? fromCents(property.monthlyMortgageCents)
                        : ""
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pmaturity">Mortgage matures</Label>
                  <Input
                    id="pmaturity"
                    name="mortgageMaturityDate"
                    type="date"
                    defaultValue={
                      property.mortgageMaturityDate
                        ? DateTime.fromJSDate(property.mortgageMaturityDate, {
                            zone: property.timezone,
                          }).toFormat("yyyy-MM-dd")
                        : ""
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pinsurance">Yearly insurance</Label>
                  <Input
                    id="pinsurance"
                    name="yearlyInsurance"
                    inputMode="decimal"
                    placeholder="2400.00"
                    defaultValue={
                      property.yearlyInsuranceCents != null
                        ? fromCents(property.yearlyInsuranceCents)
                        : ""
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ptaxes">Yearly property taxes</Label>
                  <Input
                    id="ptaxes"
                    name="yearlyPropertyTax"
                    inputMode="decimal"
                    placeholder="3600.00"
                    defaultValue={
                      property.yearlyPropertyTaxCents != null
                        ? fromCents(property.yearlyPropertyTaxCents)
                        : ""
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ppurchase">Purchase date</Label>
                  <Input
                    id="ppurchase"
                    name="purchaseDate"
                    type="date"
                    defaultValue={
                      property.purchaseDate
                        ? DateTime.fromJSDate(property.purchaseDate, {
                            zone: property.timezone,
                          }).toFormat("yyyy-MM-dd")
                        : ""
                    }
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Mortgage, insurance, and property-tax figures feed the Financials
                module (monthly net income and payoff projection). Leave blank when
                paid off / none.
              </p>
              <div className="space-y-2">
                <Label htmlFor="pnotes">Notes</Label>
                <Textarea id="pnotes" name="notes" defaultValue={property.notes ?? ""} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="pactive"
                  name="isActive"
                  type="checkbox"
                  defaultChecked={property.isActive}
                  className="size-4 accent-primary"
                />
                <Label htmlFor="pactive">Active property</Label>
              </div>
            <p className="text-xs text-muted-foreground">
              Changing the timezone affects how future due dates and periods are
              computed; already-billed periods are unchanged.
            </p>
          </FormDialog>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Field
              label="Address"
              value={
                [property.addressLine1, property.addressLine2]
                  .filter(Boolean)
                  .join(", ") || "—"
              }
            />
            <Field
              label="City / State / ZIP"
              value={
                [property.city, property.state, property.zip]
                  .filter(Boolean)
                  .join(", ") || "—"
              }
            />
            <Field label="Timezone" value={property.timezone} />
            <Field label="Currency" value={property.currency} />
            {modules.portfolio && (
              <Field label="Legal entity" value={property.legalEntityName || "—"} />
            )}
            <Field
              label="Status"
              value={
                property.isActive ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-200 bg-emerald-100 font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                  >
                    Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Archived
                  </Badge>
                )
              }
            />
            <Field
              label="Size"
              value={`${property.buildings.length} building(s) · ${property.units.length} unit(s)`}
            />
            <Field
              label="Mortgage"
              value={
                property.monthlyMortgageCents != null && property.monthlyMortgageCents > 0n
                  ? `${formatCurrency(property.monthlyMortgageCents, property.currency)}/mo${
                      property.mortgageMaturityDate
                        ? ` · matures ${DateTime.fromJSDate(property.mortgageMaturityDate, { zone: property.timezone }).toFormat("MMM yyyy")}`
                        : ""
                    }`
                  : "None"
              }
            />
            <Field
              label="Insurance"
              value={yearlyWithMonthly(property.yearlyInsuranceCents)}
            />
            <Field
              label="Property taxes"
              value={yearlyWithMonthly(property.yearlyPropertyTaxCents)}
            />
            <Field
              label="Purchased"
              value={
                property.purchaseDate
                  ? DateTime.fromJSDate(property.purchaseDate, {
                      zone: property.timezone,
                    }).toFormat("MMM d, yyyy")
                  : "—"
              }
            />
          </div>
          {property.notes && (
            <p className="mt-3 text-sm text-muted-foreground">{property.notes}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Units by building</CardTitle>
          <div className="flex gap-2">
            <FormDialog
              trigger="Add building"
              title="Add building"
              action={createBuilding}
              submitLabel="Add building"
            >
              <input type="hidden" name="propertyId" value={property.id} />
              <div className="space-y-2">
                <Label htmlFor="bname">Name</Label>
                <Input id="bname" name="name" placeholder="Building A" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bdesc">Description</Label>
                <Input id="bdesc" name="description" />
              </div>
            </FormDialog>
            <FormDialog
              trigger="Add unit"
              triggerVariant="default"
              title="Add unit"
              action={createUnit}
              submitLabel="Add unit"
            >
              <input type="hidden" name="propertyId" value={property.id} />
                <div className="space-y-2">
                  <Label htmlFor="unitNumber">Unit number</Label>
                  <Input id="unitNumber" name="unitNumber" placeholder="Apt 101" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="buildingId">Building</Label>
                  <select
                    id="buildingId"
                    name="buildingId"
                    className="h-9 w-full rounded-md border px-3 text-sm"
                  >
                    <option value="">— none —</option>
                    {property.buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="unitType">Type</Label>
                    <select
                      id="unitType"
                      name="unitType"
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
                      className="h-9 w-full rounded-md border px-3 text-sm capitalize"
                    >
                      {SERVICE.map((t) => (
                        <option key={t} value={t}>
                          {t.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="defaultRent">Default rent (e.g. 1200.00)</Label>
                  <Input id="defaultRent" name="defaultRent" inputMode="decimal" />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="newUnitInternet"
                    name="internetEnabled"
                    type="checkbox"
                    className="size-4 accent-primary"
                  />
                  <Label htmlFor="newUnitInternet">Internet service</Label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="internetFee">Monthly internet fee</Label>
                  <Input
                    id="internetFee"
                    name="internetFee"
                    inputMode="decimal"
                    defaultValue={fromCents(billing.internetFeeCents)}
                  />
                </div>
            </FormDialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="pl-8">Unit</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead>Occupancy</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="hidden lg:table-cell">Internet</TableHead>
                  <TableHead className="text-right">Default rent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(({ building: b, units }) => (
                  <Fragment key={b.id}>
                    {groupHeader(
                      `h-${b.id}`,
                      <Link href={`/buildings/${b.id}`} className="hover:underline">
                        {b.name}
                      </Link>,
                      b.description,
                      `${units.length} unit${units.length === 1 ? "" : "s"}`,
                    )}
                    {units.map(unitRow)}
                    {units.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="pl-8 text-muted-foreground">
                          No units in this building yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
                {unassigned.length > 0 && (
                  <Fragment>
                    {groupHeader(
                      "h-unassigned",
                      "No building",
                      null,
                      `${unassigned.length} unit${unassigned.length === 1 ? "" : "s"}`,
                    )}
                    {unassigned.map(unitRow)}
                  </Fragment>
                )}
                {property.units.length === 0 && property.buildings.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      No buildings or units yet. Add a building, then add units to it.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ChangeHistory refs={[{ entityType: "Property", entityId: property.id }]} />
    </div>
  );
}
