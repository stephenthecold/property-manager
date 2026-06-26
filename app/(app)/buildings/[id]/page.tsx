import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import { updateBuilding } from "../../properties/actions";
import { ActionForm } from "@/components/app/action-form";
import { BackLink } from "@/components/app/back-link";
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

function occupancyClass(status: string): string {
  if (status === "occupied") return "capitalize text-emerald-700 dark:text-emerald-400";
  if (status === "vacant") return "capitalize text-amber-700 dark:text-amber-400";
  return "capitalize text-muted-foreground";
}

export default async function BuildingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const building = await prisma.building.findUnique({
    where: { id },
    include: {
      property: true,
      units: {
        orderBy: { unitNumber: "asc" },
        include: {
          leases: {
            where: { status: { in: ["active", "month_to_month"] } },
            include: { tenant: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!building) notFound();

  const currency = building.property.currency;
  const unitCount = building.units.length;

  return (
    <div className="space-y-6">
      <div>
        <BackLink href={`/properties/${building.propertyId}`} label="Property" />
        <h1 className="text-2xl font-semibold">{building.name}</h1>
        <p className="text-muted-foreground">
          <Link
            href={`/properties/${building.propertyId}`}
            className="hover:underline"
          >
            {building.property.name}
          </Link>{" "}
          · {unitCount} unit{unitCount === 1 ? "" : "s"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit building</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={updateBuilding}
            submitLabel="Save changes"
            successMessage="Building saved."
            className="space-y-3 max-w-lg"
          >
            <input type="hidden" name="buildingId" value={building.id} />
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={building.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                defaultValue={building.description ?? ""}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Purchase date and mortgage terms live on the property (Edit
              property on the property&apos;s page) — they describe the whole
              parcel, not one building.
            </p>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" defaultValue={building.notes ?? ""} />
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Units in this building</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead>Unit</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead>Occupancy</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="hidden lg:table-cell">Internet</TableHead>
                  <TableHead className="text-right">Default rent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {building.units.map((u) => {
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
                      <TableCell>
                        <Link href={`/units/${u.id}`} className="font-medium hover:underline">
                          {u.unitNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden capitalize sm:table-cell">
                        {u.unitType}
                      </TableCell>
                      <TableCell>
                        <span className={occupancyClass(occupancyLabel)}>{occupancyLabel}</span>
                      </TableCell>
                      <TableCell>
                        {tenant ? (
                          <Link href={`/tenants/${tenant.id}`} className="hover:underline">
                            {tenant.firstName} {tenant.lastName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Vacant</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden tabular-nums lg:table-cell">
                        {u.internetEnabled
                          ? `+${formatCurrency(u.internetFeeCents, currency)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(u.defaultRentAmountCents, currency)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {unitCount === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      No units in this building yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
