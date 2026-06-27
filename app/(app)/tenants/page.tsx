import Link from "next/link";
import { UsersIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/money";
import { batchLeaseSnapshots } from "@/lib/services/accounting";
import type { Prisma } from "@/lib/generated/prisma/client";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";
export const metadata = { title: "Tenants" };

function balanceClass(cents: bigint): string {
  if (cents > 0n) return "text-red-600 dark:text-red-400";
  if (cents < 0n) return "text-emerald-600 dark:text-emerald-400";
  return "";
}

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("tenants.manage");
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const q = first(sp.q);
  const error = first(sp.error);
  // Active by default; archived tenants are hidden until you switch the view.
  const view =
    first(sp.view) === "archived" ? "archived" : first(sp.view) === "all" ? "all" : "active";
  const activeFilter: Prisma.TenantWhereInput =
    view === "all" ? {} : { isActive: view === "active" };

  const where: Prisma.TenantWhereInput = {
    ...activeFilter,
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      leases: {
        where: { status: { in: ["active", "month_to_month"] } },
        include: { unit: { include: { property: true } } },
        take: 1,
      },
    },
  });
  // Cheap second count for "N of M" when a search is active (within this view).
  const total = q ? await prisma.tenant.count({ where: activeFilter }) : tenants.length;

  // One batched snapshot load for every tenant's active lease (2 queries total).
  const activeLeases = tenants
    .map((t) => t.leases[0])
    .filter((l): l is NonNullable<typeof l> => !!l);
  const snaps = await batchLeaseSnapshots(activeLeases, now);
  const rows = tenants.map((t) => {
    const lease = t.leases[0];
    return { tenant: t, lease, snap: lease ? snaps.get(lease.id) ?? null : null };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <Button render={<Link href="/tenants/new" />}>Add tenant</Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="w-full space-y-2 sm:w-auto">
          <Label htmlFor="q">Search</Label>
          <Input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Search name, email, phone"
            className="w-full sm:w-64"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="view">Show</Label>
          <select
            id="view"
            name="view"
            defaultValue={view}
            className="h-9 w-36 rounded-md border px-3 text-sm"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
        {(q || view !== "active") && (
          <Button variant="ghost" size="sm" render={<Link href="/tenants" />}>
            Clear
          </Button>
        )}
      </form>

      {q && (
        <p className="text-sm text-muted-foreground">
          {tenants.length} of {total} {view === "active" ? "active " : view === "archived" ? "archived " : ""}tenants
        </p>
      )}

      <DataTable
        emptyState={
          <EmptyState
            icon={<UsersIcon />}
            title={q ? "No matching tenants" : "No tenants yet"}
            description={
              q
                ? "Try a different name, email, or phone — or clear the search."
                : "Add your first tenant to start tracking leases and balances."
            }
            action={
              q ? (
                <Button variant="outline" size="sm" render={<Link href="/tenants" />}>
                  Clear search
                </Button>
              ) : (
                <Button size="sm" render={<Link href="/tenants/new" />}>
                  Add tenant
                </Button>
              )
            }
          />
        }
        columns={[
          { key: "name", label: "Name" },
          { key: "unit", label: "Unit" },
          { key: "status", label: "Status" },
          { key: "balance", label: "Balance", align: "right", numeric: true },
          {
            key: "daysSincePaid",
            label: "Days since paid",
            align: "right",
            numeric: true,
            className: "hidden sm:table-cell",
          },
        ]}
        rows={rows.map(({ tenant, lease, snap }) => ({
          key: tenant.id,
          sortValues: [
            `${tenant.lastName}, ${tenant.firstName}`,
            lease ? `${lease.unit.property.name} · ${lease.unit.unitNumber}` : null,
            tenant.isActive ? (snap?.status ?? null) : "archived",
            snap ? String(snap.netBalanceCents) : null,
            snap?.daysSinceLastPayment ?? null,
          ],
          cells: [
            <Link
              key="n"
              href={`/tenants/${tenant.id}`}
              className="font-medium hover:underline"
            >
              {tenant.firstName} {tenant.lastName}
            </Link>,
            lease ? `${lease.unit.property.name} · ${lease.unit.unitNumber}` : "—",
            !tenant.isActive ? (
              <Badge
                key="s"
                variant="outline"
                className="border-amber-200 bg-amber-100 font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              >
                Archived
              </Badge>
            ) : snap ? (
              <StatusBadge key="s" status={snap.status} />
            ) : (
              <span key="s" className="text-muted-foreground">
                No active lease
              </span>
            ),
            <span
              key="b"
              className={cn("tabular-nums", snap && balanceClass(snap.netBalanceCents))}
            >
              {snap ? formatCurrency(snap.netBalanceCents) : "—"}
            </span>,
            <span key="d" className="tabular-nums">
              {snap?.daysSinceLastPayment ?? "—"}
            </span>,
          ],
        }))}
      />
    </div>
  );
}
