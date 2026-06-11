import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { updateBuilding } from "../../properties/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

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
      _count: { select: { units: true } },
    },
  });
  if (!building) notFound();

  // Render the stored instant as a date-input value in the property tz.
  const purchaseValue = building.purchaseDate
    ? DateTime.fromJSDate(building.purchaseDate, {
        zone: building.property.timezone,
      }).toFormat("yyyy-MM-dd")
    : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{building.name}</h1>
        <p className="text-muted-foreground">
          <Link
            href={`/properties/${building.propertyId}`}
            className="hover:underline"
          >
            {building.property.name}
          </Link>{" "}
          · {building._count.units} unit{building._count.units === 1 ? "" : "s"}
          {building.purchaseDate
            ? ` · purchased ${building.purchaseDate.toLocaleDateString("en-US", {
                timeZone: building.property.timezone,
              })}`
            : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit building</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateBuilding} className="space-y-3 max-w-lg">
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
            <div className="space-y-2">
              <Label htmlFor="purchaseDate">Purchase date</Label>
              <Input
                id="purchaseDate"
                name="purchaseDate"
                type="date"
                defaultValue={purchaseValue}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" defaultValue={building.notes ?? ""} />
            </div>
            <Button type="submit" size="sm">
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
