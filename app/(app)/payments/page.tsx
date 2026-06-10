import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { PaymentMethod, PaymentStatus } from "@/lib/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";

const METHODS = ["cash", "check", "money_order", "card", "ach", "online", "other"] as const;
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
    },
  });

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
      <h1 className="text-2xl font-semibold">Payments</h1>
      <p className="text-sm text-muted-foreground">
        Record payments from a tenant&apos;s page. Showing the 100 most recent.
      </p>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="method">Method</Label>
          <select
            id="method"
            name="method"
            defaultValue={method ?? ""}
            className="h-9 w-40 rounded-md border bg-transparent px-3 text-sm capitalize"
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
            className="h-9 w-36 rounded-md border bg-transparent px-3 text-sm capitalize"
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Receipt</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.paymentDate.toLocaleDateString()}</TableCell>
              <TableCell>
                <Link href={`/tenants/${p.lease.tenantId}`} className="font-medium hover:underline">
                  {p.lease.tenant.firstName} {p.lease.tenant.lastName}
                </Link>
              </TableCell>
              <TableCell>{p.lease.unit.property.name} · {p.lease.unit.unitNumber}</TableCell>
              <TableCell className="capitalize">{p.method.replace("_", " ")}</TableCell>
              <TableCell className="capitalize">{p.status}</TableCell>
              <TableCell>
                {p.status !== "voided" && receiptByPayment.has(p.id) ? (
                  <Link
                    href={`/receipts/${receiptByPayment.get(p.id)!.id}`}
                    className="font-medium hover:underline"
                  >
                    {receiptByPayment.get(p.id)!.receiptNumber}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(p.amountCents, p.lease.unit.property.currency)}
              </TableCell>
            </TableRow>
          ))}
          {payments.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No payments yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
