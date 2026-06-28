import Link from "next/link";
import { FileSignatureIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { formatCurrency, sumCents } from "@/lib/money";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { LeaseStatus } from "@/lib/generated/prisma/enums";
import {
  terminateLease,
  archiveLeaseAction,
  unarchiveLeaseAction,
  deleteLeaseAction,
} from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const runtime = "nodejs";
export const metadata = { title: "Leases" };

const LEASE_STATUSES = ["draft", "active", "month_to_month", "ended", "eviction"] as const;

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("leases.manage");
  const sp = await searchParams;
  const first = (key: string): string => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };

  const error = first("error");
  const statusRaw = first("status");
  // "archived" is a pseudo-status: it selects on isArchived, not LeaseStatus.
  const showArchived = statusRaw === "archived";
  const status =
    !showArchived && (LEASE_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as LeaseStatus)
      : undefined;
  const propertyId = first("propertyId") || undefined;

  // Archived leases are hidden everywhere except the explicit Archived view.
  const where: Prisma.LeaseWhereInput = { isArchived: showArchived };
  if (status) where.status = status;
  if (propertyId) where.unit = { propertyId };
  const filtering = Boolean(status || propertyId || showArchived);

  const properties = await prisma.property.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const leases = await prisma.lease.findMany({
    where,
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    // Cap like the other lists (payments/financials/maintenance/audit); the
    // client DataTable paginates within this set.
    take: 200,
    include: {
      tenant: true,
      unit: { include: { property: true } },
      deposits: true,
      _count: { select: { payments: true } },
      // Deletable = a mistake lease: no payments AND nothing in the ledger
      // beyond system-minted charges (matches deleteLeaseAction's guard).
      ledgerEntries: {
        where: { entryType: { notIn: ["rent_charge", "late_fee"] } },
        select: { id: true },
        take: 1,
      },
    },
  });

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <PageHeader
        title="Leases"
        actions={<Button render={<Link href="/leases/new" />}>Create lease</Button>}
      />

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={showArchived ? "archived" : (status ?? "")}
            className="h-9 w-44 rounded-md border px-3 text-sm capitalize"
          >
            <option value="">All statuses</option>
            {LEASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="propertyId">Property</Label>
          <select
            id="propertyId"
            name="propertyId"
            defaultValue={propertyId ?? ""}
            className="h-9 w-48 rounded-md border px-3 text-sm"
          >
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
        {filtering && (
          <Button variant="ghost" size="sm" render={<Link href="/leases" />}>
            Clear
          </Button>
        )}
      </form>

      <DataTable
        emptyState={
          <EmptyState
            icon={<FileSignatureIcon />}
            title={
              filtering
                ? showArchived
                  ? "No archived leases"
                  : "No matching leases"
                : "No leases yet"
            }
            description={
              filtering
                ? "Try a different status or property — or clear the filters."
                : "Create your first lease to start billing rent and tracking balances."
            }
            action={
              filtering ? (
                <Button variant="outline" size="sm" render={<Link href="/leases" />}>
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" render={<Link href="/leases/new" />}>
                  Create lease
                </Button>
              )
            }
          />
        }
        columns={[
          { key: "tenant", label: "Tenant" },
          { key: "unit", label: "Unit" },
          { key: "rent", label: "Rent", align: "right", numeric: true },
          {
            key: "deposits",
            label: "Deposits",
            align: "right",
            numeric: true,
            className: "hidden md:table-cell",
          },
          {
            key: "dueDay",
            label: "Due day",
            numeric: true,
            className: "hidden sm:table-cell",
          },
          { key: "status", label: "Status" },
          { key: "action", label: "Action", align: "right", sortable: false },
        ]}
        rows={leases.map((l) => {
          const depositsHeldCents = sumCents([
            l.securityDepositCents,
            ...l.deposits.map((d) => d.amountCents),
          ]);
          const terminated = l.status === "ended" || l.status === "eviction";
          return {
            key: l.id,
            sortValues: [
              `${l.tenant.lastName}, ${l.tenant.firstName}`,
              `${l.unit.property.name} · ${l.unit.unitNumber}`,
              String(l.rentAmountCents),
              String(depositsHeldCents),
              l.dueDay,
              l.status,
              null,
            ],
            cells: [
              <Link
                key="t"
                href={`/tenants/${l.tenantId}`}
                className="font-medium hover:underline"
              >
                {l.tenant.firstName} {l.tenant.lastName}
              </Link>,
              <Link
                key="u"
                href={`/units/${l.unitId}`}
                className="hover:underline"
              >
                {l.unit.property.name} · {l.unit.unitNumber}
              </Link>,
              <span key="r" className="tabular-nums">
                {formatCurrency(l.rentAmountCents, l.unit.property.currency)}
              </span>,
              <span
                key="dep"
                className="tabular-nums"
                title={
                  l.deposits.length > 0
                    ? `Security ${formatCurrency(l.securityDepositCents, l.unit.property.currency)} + ${l.deposits
                        .map(
                          (d) =>
                            `${d.label} ${formatCurrency(d.amountCents, l.unit.property.currency)}`,
                        )
                        .join(" + ")}`
                    : undefined
                }
              >
                {formatCurrency(depositsHeldCents, l.unit.property.currency)}
              </span>,
              l.dueDay,
              <span key="s" className="flex items-center gap-2">
                <span className="capitalize">{l.status.replace(/_/g, " ")}</span>
                {l.isArchived && (
                  <Badge variant="outline" className="text-muted-foreground">
                    Archived
                  </Badge>
                )}
              </span>,
              <div key="a" className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="xs"
                  render={<Link href={`/leases/${l.id}/abstract`} />}
                >
                  Abstract
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  render={<Link href={`/leases/${l.id}/agreement`} />}
                >
                  Agreement
                </Button>
                {l.isArchived ? (
                  <>
                    <form action={unarchiveLeaseAction}>
                      <input type="hidden" name="leaseId" value={l.id} />
                      <Button type="submit" variant="outline" size="xs">
                        Unarchive
                      </Button>
                    </form>
                    {l._count.payments === 0 && l.ledgerEntries.length === 0 && (
                      <form action={deleteLeaseAction}>
                        <input type="hidden" name="leaseId" value={l.id} />
                        <ConfirmSubmitButton
                          variant="destructive"
                          size="xs"
                          confirmMessage="Permanently delete this lease? Its auto-generated charge history is erased and cannot be recovered."
                        >
                          Delete
                        </ConfirmSubmitButton>
                      </form>
                    )}
                  </>
                ) : l.status === "active" || l.status === "month_to_month" ? (
                  <form action={terminateLease}>
                    <input type="hidden" name="leaseId" value={l.id} />
                    <ConfirmSubmitButton
                      variant="outline"
                      size="xs"
                      confirmMessage="Terminate this lease? The unit becomes vacant and billing stops; this cannot be undone from the UI."
                    >
                      Terminate
                    </ConfirmSubmitButton>
                  </form>
                ) : terminated ? (
                  <form action={archiveLeaseAction}>
                    <input type="hidden" name="leaseId" value={l.id} />
                    <Button type="submit" variant="outline" size="xs">
                      Archive
                    </Button>
                  </form>
                ) : null}
              </div>,
            ],
          };
        })}
      />
    </div>
  );
}
