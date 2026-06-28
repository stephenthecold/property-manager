import Link from "next/link";
import { Building2Icon } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";

export const runtime = "nodejs";
export const metadata = { title: "Properties" };

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("properties.manage");
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  // Active by default; archived properties are hidden until you switch the view.
  const view = first(sp.view) === "all" ? "all" : "active";

  const properties = await prisma.property.findMany({
    where: view === "all" ? {} : { isActive: true },
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
      <PageHeader
        title="Properties"
        actions={<Button render={<Link href="/properties/new" />}>Add property</Button>}
      />

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="view">Show</Label>
          <select
            id="view"
            name="view"
            defaultValue={view}
            className="h-9 w-36 rounded-md border px-3 text-sm"
          >
            <option value="active">Active</option>
            <option value="all">All</option>
          </select>
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
        {view !== "active" && (
          <Button variant="ghost" size="sm" render={<Link href="/properties" />}>
            Clear
          </Button>
        )}
      </form>

      <DataTable
        emptyState={
          <EmptyState
            icon={<Building2Icon />}
            title={view === "all" ? "No properties yet" : "No active properties"}
            description="Add your first property to start tracking buildings, units, and leases."
            action={
              <Button size="sm" render={<Link href="/properties/new" />}>
                Add property
              </Button>
            }
          />
        }
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
