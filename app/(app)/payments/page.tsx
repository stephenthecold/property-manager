import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { PaymentMethod, PaymentStatus } from "@/lib/generated/prisma/enums";
import { voidPaymentAction } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DataTable } from "@/components/app/data-table";
import { RecordPaymentDialog } from "@/components/app/record-payment-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const runtime = "nodejs";
export const metadata = { title: "Payments" };

const METHODS = ["cash", "check", "money_order", "card", "ach", "online", "cash_app", "other"] as const;
const STATUSES = ["posted", "voided"] as const;

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (key: string): string => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };

  const methodRaw = first("method");
  const method = (METHODS as readonly string[]).includes(methodRaw)
    ? (methodRaw as PaymentMethod)
    : undefined;
  const statusRaw = first("status");
  const status = (STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as PaymentStatus)
    : undefined;
  const from = first("from");
  const to = first("to");

  const paymentDate: { gte?: Date; lte?: Date } = {};
  if (from) {
    const d = new Date(`${from}T00:00:00`);
    if (!Number.isNaN(d.getTime())) paymentDate.gte = d;
  }
  if (to) {
    // Inclusive "to": end of that day.
    const d = new Date(`${to}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) paymentDate.lte = d;
  }

  const where: Prisma.PaymentWhereInput = {};
  if (method) where.method = method;
  if (status) where.status = status;
  if (paymentDate.gte || paymentDate.lte) where.paymentDate = paymentDate;
  const filtering = Boolean(
    method || status || paymentDate.gte || paymentDate.lte,
  );

  const payments = await prisma.payment.findMany({
    where,
    orderBy: { paymentDate: "desc" },
    take: 100,
    include: {
      lease: { include: { tenant: true, unit: { include: { property: true } } } },
      payer: { select: { name: true } },
    },
  });

  // Active leases for the "Record payment" dialog's lease picker.
  const activeLeases = await prisma.lease.findMany({
    where: { status: { in: ["active", "month_to_month"] } },
    orderBy: [
      { unit: { property: { name: "asc" } } },
      { unit: { unitNumber: "asc" } },
    ],
    select: {
      id: true,
      tenant: { select: { firstName: true, lastName: true } },
      unit: {
        select: { unitNumber: true, property: { select: { name: true } } },
      },
    },
  });
  // Terminated leases that still owe back rent — collectible too (postPayment
  // has no status guard). Balance = SUM(amountCents) (the ledger invariant), so
  // one aggregate finds the owing ones — cheap even as ended leases accumulate,
  // unlike snapshotting every terminated lease on each page load.
  const endedBalances = await prisma.ledgerEntry.groupBy({
    by: ["leaseId"],
    where: { lease: { status: { in: ["ended", "eviction"] } } },
    _sum: { amountCents: true },
  });
  const owingEndedIds = endedBalances
    .filter((g) => (g._sum.amountCents ?? 0n) > 0n)
    .map((g) => g.leaseId);
  const endedLeases = owingEndedIds.length
    ? await prisma.lease.findMany({
        where: { id: { in: owingEndedIds } },
        orderBy: [
          { unit: { property: { name: "asc" } } },
          { unit: { unitNumber: "asc" } },
        ],
        select: {
          id: true,
          tenant: { select: { firstName: true, lastName: true } },
          unit: {
            select: { unitNumber: true, property: { select: { name: true } } },
          },
        },
      })
    : [];
  const leaseOptions = [
    ...activeLeases.map((l) => ({
      id: l.id,
      label: `Unit ${l.unit.unitNumber} — ${l.tenant.lastName}, ${l.tenant.firstName}`,
      group: l.unit.property.name,
    })),
    ...endedLeases.map((l) => ({
      id: l.id,
      label: `Unit ${l.unit.unitNumber} — ${l.tenant.lastName}, ${l.tenant.firstName} (ended)`,
      group: `Back rent — ${l.unit.property.name}`,
    })),
  ];

  // Active non-tenant payers (HUD/housing authorities, …) for the "Paid by" picker.
  const payers = await prisma.payer.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const payerOptions = payers.map((p) => ({ id: p.id, label: p.name }));

  // One query for all rows: digital receipt per payment (partial unique index).
  const receipts = await prisma.receipt.findMany({
    where: {
      paymentId: { in: payments.map((p) => p.id) },
      receiptType: "digital",
    },
    select: { id: true, receiptNumber: true, paymentId: true },
  });
  const receiptByPayment = new Map(
    receipts.map((r) => [r.paymentId ?? "", { id: r.id, receiptNumber: r.receiptNumber }]),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="text-sm text-muted-foreground">
            Showing the 100 most recent.
          </p>
        </div>
        <RecordPaymentDialog
          leaseOptions={leaseOptions}
          payerOptions={payerOptions}
          trigger="Record payment"
        />
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="method">Method</Label>
          <select
            id="method"
            name="method"
            defaultValue={method ?? ""}
            className="h-9 w-40 rounded-md border px-3 text-sm capitalize"
          >
            <option value="">All methods</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="h-9 w-36 rounded-md border px-3 text-sm capitalize"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={from} className="w-40" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={to} className="w-40" />
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
        {filtering && (
          <Button variant="ghost" size="sm" render={<Link href="/payments" />}>
            Clear
          </Button>
        )}
      </form>

      <DataTable
        emptyMessage="No payments yet."
        columns={[
          { key: "date", label: "Date" },
          { key: "tenant", label: "Tenant" },
          { key: "unit", label: "Unit", className: "hidden md:table-cell" },
          { key: "method", label: "Method", className: "hidden sm:table-cell" },
          { key: "status", label: "Status" },
          { key: "receipt", label: "Receipt", className: "hidden lg:table-cell" },
          { key: "amount", label: "Amount", align: "right", numeric: true },
          { key: "action", label: "Action", align: "right", sortable: false },
        ]}
        rows={payments.map((p) => {
          const receipt =
            p.status !== "voided" ? receiptByPayment.get(p.id) : undefined;
          return {
            key: p.id,
            sortValues: [
              p.paymentDate.toISOString(),
              `${p.lease.tenant.lastName}, ${p.lease.tenant.firstName}`,
              `${p.lease.unit.property.name} · ${p.lease.unit.unitNumber}`,
              p.method,
              p.status,
              receipt?.receiptNumber ?? null,
              String(p.amountCents),
              null,
            ],
            cells: [
              p.paymentDate.toLocaleDateString(),
              <div key="t">
                <Link
                  href={`/tenants/${p.lease.tenantId}`}
                  className="font-medium hover:underline"
                >
                  {p.lease.tenant.firstName} {p.lease.tenant.lastName}
                </Link>
                {p.payer && (
                  <div className="text-xs text-muted-foreground">
                    via {p.payer.name}
                  </div>
                )}
              </div>,
              <Link
                key="u"
                href={`/properties/${p.lease.unit.propertyId}`}
                className="hover:underline"
              >
                {p.lease.unit.property.name} · {p.lease.unit.unitNumber}
              </Link>,
              <span key="m" className="capitalize">
                {p.method.replace("_", " ")}
              </span>,
              <span
                key="s"
                className={
                  p.status === "voided"
                    ? "capitalize text-red-600 dark:text-red-400"
                    : "capitalize"
                }
              >
                {p.status}
              </span>,
              receipt ? (
                <Link
                  key="r"
                  href={`/receipts/${receipt.id}`}
                  className="font-medium hover:underline"
                >
                  {receipt.receiptNumber}
                </Link>
              ) : (
                "—"
              ),
              <span key="a" className="tabular-nums">
                {formatCurrency(p.amountCents, p.lease.unit.property.currency)}
              </span>,
              // Voiding works regardless of lease status — payments on
              // terminated/archived leases are only reachable from here (the
              // tenant page shows history for the ACTIVE lease only).
              p.status === "posted" ? (
                <form
                  key="ac"
                  action={voidPaymentAction}
                  className="flex justify-end gap-2"
                >
                  <input type="hidden" name="paymentId" value={p.id} />
                  <input
                    name="reason"
                    placeholder="Reason"
                    className="h-8 w-28 rounded border bg-card px-2 text-xs dark:bg-input/30"
                    required
                  />
                  <ConfirmSubmitButton
                    variant="outline"
                    size="xs"
                    confirmMessage={`Void this ${formatCurrency(p.amountCents, p.lease.unit.property.currency)} payment for ${p.lease.tenant.firstName} ${p.lease.tenant.lastName}? An offsetting reversal is added; the original is kept.`}
                  >
                    Void
                  </ConfirmSubmitButton>
                </form>
              ) : (
                <span key="ac" className="text-xs text-muted-foreground">
                  —
                </span>
              ),
            ],
          };
        })}
      />
    </div>
  );
}
