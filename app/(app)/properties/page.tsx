import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/app/data-table";

export const runtime = "nodejs";

export default async function PropertiesPage() {
  const properties = await prisma.property.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { buildings: true, units: true } },
      units: {
        select: {
          defaultRentAmountCents: true,
          // Occupancy is lease-derived: a unit is occupied iff it has an active lease.
          leases: {
            where: { status: { in: ["active", "month_to_month"] } },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Properties</h1>
        <Button render={<Link href="/properties/new" />}>Add property</Button>
      </div>

      <DataTable
        emptyMessage="No properties yet. Add one to get started."
        defaultSort={{ key: "name", dir: "asc" }}
        columns={[
          { key: "name", label: "Name" },
          { key: "location", label: "Location", className: "hidden sm:table-cell" },
          {
            key: "buildings",
            label: "Buildings",
            align: "right",
            numeric: true,
            className: "hidden md:table-cell",
          },
          { key: "units", label: "Units", align: "right", numeric: true },
          { key: "occupied", label: "Occupied", align: "right", numeric: true },
          { key: "status", label: "Status" },
        ]}
        rows={properties.map((p) => {
          const occupied = p.units.filter((u) => u.leases.length > 0).length;
          return {
            key: p.id,
            sortValues: [
              p.name,
              [p.city, p.state].filter(Boolean).join(", "),
              p._count.buildings,
              p._count.units,
              occupied,
              p.isActive ? "Active" : "Archived",
            ],
            cells: [
              <Link
                key="n"
                href={`/properties/${p.id}`}
                className="font-medium hover:underline"
              >
                {p.name}
              </Link>,
              <span key="l" className="text-muted-foreground">
                {[p.city, p.state].filter(Boolean).join(", ") || "—"}
              </span>,
              p._count.buildings,
              p._count.units,
              <span key="o" className="tabular-nums">
                {occupied}/{p.units.length}
              </span>,
              p.isActive ? (
                <Badge
                  key="s"
                  variant="outline"
                  className="border-emerald-200 bg-emerald-100 font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                >
                  Active
                </Badge>
              ) : (
                <Badge key="s" variant="outline" className="text-muted-foreground">
                  Archived
                </Badge>
              ),
            ],
          };
        })}
      />
    </div>
  );
}
