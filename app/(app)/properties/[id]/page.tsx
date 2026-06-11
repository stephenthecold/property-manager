import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import { createBuilding, createUnit } from "../actions";
import { Button } from "@/components/ui/button";
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

export const runtime = "nodejs";

const UNIT_TYPES = ["apartment", "house", "duplex", "storage", "commercial", "other"];
const OCC = ["vacant", "occupied", "maintenance", "unavailable"];

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
        <CardHeader>
          <CardTitle>Units</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>Building</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Occupancy</TableHead>
                <TableHead>Internet</TableHead>
                <TableHead className="text-right">Default rent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {property.units.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link href={`/units/${u.id}`} className="font-medium hover:underline">
                      {u.unitNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{u.building?.name ?? "—"}</TableCell>
                  <TableCell className="capitalize">{u.unitType}</TableCell>
                  <TableCell className="capitalize">{u.occupancyStatus}</TableCell>
                  <TableCell className="tabular-nums">
                    {u.internetEnabled
                      ? `+${formatCurrency(u.internetFeeCents, property.currency)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(u.defaultRentAmountCents, property.currency)}
                  </TableCell>
                </TableRow>
              ))}
              {property.units.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No units yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {property.buildings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Buildings</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Purchased</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {property.buildings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link
                        href={`/buildings/${b.id}`}
                        className="font-medium hover:underline"
                      >
                        {b.name}
                      </Link>
                    </TableCell>
                    <TableCell>{b.description ?? "—"}</TableCell>
                    <TableCell>
                      {b.purchaseDate
                        ? b.purchaseDate.toLocaleDateString("en-US", {
                            timeZone: property.timezone,
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b._count.units}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add building</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add unit</CardTitle>
          </CardHeader>
          <CardContent>
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
                  defaultValue="25.00"
                />
              </div>
              <Button type="submit" size="sm">Add unit</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
