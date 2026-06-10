import Link from "next/link";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";

export default async function PropertiesPage() {
  const properties = await prisma.property.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { buildings: true, units: true } },
      units: { select: { occupancyStatus: true, defaultRentAmountCents: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Properties</h1>
        <Button render={<Link href="/properties/new" />}>Add property</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Location</TableHead>
            <TableHead className="text-right">Buildings</TableHead>
            <TableHead className="text-right">Units</TableHead>
            <TableHead className="text-right">Occupied</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {properties.map((p) => {
            const occupied = p.units.filter(
              (u) => u.occupancyStatus === "occupied",
            ).length;
            return (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/properties/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {[p.city, p.state].filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-right">{p._count.buildings}</TableCell>
                <TableCell className="text-right">{p._count.units}</TableCell>
                <TableCell className="text-right">
                  {occupied}/{p.units.length}
                </TableCell>
                <TableCell>{p.isActive ? "Active" : "Archived"}</TableCell>
              </TableRow>
            );
          })}
          {properties.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No properties yet. Add one to get started.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
