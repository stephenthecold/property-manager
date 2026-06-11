import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCurrency, fromCents } from "@/lib/money";
import { getAppSettings } from "@/lib/services/app-settings";
import { createBuilding, createUnit, updateProperty } from "../actions";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";

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

export default async function PropertyDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const property = await prisma.property.findUnique({
    where: { id },
    include: {
      buildings: {
        orderBy: { name: "asc" },
        include: { _count: { select: { units: true } } },
      },
      units: {
        orderBy: { unitNumber: "asc" },
        include: { building: true },
      },
    },
  });
  if (!property) notFound();
  const { billing } = await getAppSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{property.name}</h1>
        <p className="text-muted-foreground">
          {[property.addressLine1, property.city, property.state, property.zip]
            .filter(Boolean)
            .join(", ") || "No address"}{" "}
          · {property.timezone} · {property.currency}
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Property details</CardTitle>
          <FormDialog trigger="Edit property" title="Edit property" wide>
            <form action={updateProperty} className="space-y-3">
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
              </div>
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
              <Button type="submit" size="sm">
                Save property
              </Button>
            </form>
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
            <Field
              label="Status"
              value={
                property.isActive ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-200 bg-emerald-100 font-medium text-emerald-800"
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
          </div>
          {property.notes && (
            <p className="mt-3 text-sm text-muted-foreground">{property.notes}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Units</CardTitle>
          <FormDialog trigger="Add unit" triggerVariant="default" title="Add unit">
            <form action={createUnit} className="space-y-3">
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
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
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
                    className="h-9 w-full rounded-md border bg-transparent px-3 text-sm capitalize"
                  >
                    {OCC.map((t) => (
                      <option key={t} value={t}>
                        {t}
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
              <Button type="submit" size="sm">Add unit</Button>
            </form>
          </FormDialog>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No units yet."
            defaultSort={{ key: "unit", dir: "asc" }}
            columns={[
              { key: "unit", label: "Unit" },
              { key: "building", label: "Building", className: "hidden md:table-cell" },
              { key: "type", label: "Type", className: "hidden sm:table-cell" },
              { key: "occupancy", label: "Occupancy" },
              {
                key: "internet",
                label: "Internet",
                numeric: true,
                className: "hidden lg:table-cell",
              },
              { key: "rent", label: "Default rent", align: "right", numeric: true },
            ]}
            rows={property.units.map((u) => ({
              key: u.id,
              sortValues: [
                u.unitNumber,
                u.building?.name ?? null,
                u.unitType,
                u.occupancyStatus,
                u.internetEnabled ? String(u.internetFeeCents) : null,
                String(u.defaultRentAmountCents),
              ],
              cells: [
                <Link key="u" href={`/units/${u.id}`} className="font-medium hover:underline">
                  {u.unitNumber}
                </Link>,
                u.building?.name ?? "—",
                <span key="t" className="capitalize">
                  {u.unitType}
                </span>,
                <span
                  key="o"
                  className={
                    u.occupancyStatus === "occupied"
                      ? "capitalize text-emerald-700 dark:text-emerald-400"
                      : u.occupancyStatus === "vacant"
                        ? "capitalize text-amber-700 dark:text-amber-400"
                        : "capitalize text-muted-foreground"
                  }
                >
                  {u.occupancyStatus}
                </span>,
                <span key="i" className="tabular-nums">
                  {u.internetEnabled
                    ? `+${formatCurrency(u.internetFeeCents, property.currency)}`
                    : "—"}
                </span>,
                <span key="r" className="tabular-nums">
                  {formatCurrency(u.defaultRentAmountCents, property.currency)}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Buildings</CardTitle>
          <FormDialog trigger="Add building" triggerVariant="default" title="Add building">
            <form action={createBuilding} className="space-y-3">
              <input type="hidden" name="propertyId" value={property.id} />
              <div className="space-y-2">
                <Label htmlFor="bname">Name</Label>
                <Input id="bname" name="name" placeholder="Building A" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bdesc">Description</Label>
                <Input id="bdesc" name="description" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bpurchase">Purchase date</Label>
                <Input id="bpurchase" name="purchaseDate" type="date" />
              </div>
              <Button type="submit" size="sm">Add building</Button>
            </form>
          </FormDialog>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No buildings yet."
            columns={[
              { key: "name", label: "Name" },
              { key: "description", label: "Description", className: "hidden sm:table-cell" },
              { key: "purchased", label: "Purchased" },
              { key: "units", label: "Units", align: "right", numeric: true },
            ]}
            rows={property.buildings.map((b) => ({
              key: b.id,
              sortValues: [
                b.name,
                b.description,
                b.purchaseDate?.toISOString() ?? null,
                b._count.units,
              ],
              cells: [
                <Link
                  key="n"
                  href={`/buildings/${b.id}`}
                  className="font-medium hover:underline"
                >
                  {b.name}
                </Link>,
                b.description ?? "—",
                b.purchaseDate
                  ? b.purchaseDate.toLocaleDateString("en-US", {
                      timeZone: property.timezone,
                    })
                  : "—",
                <span key="u" className="tabular-nums">
                  {b._count.units}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
