import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import { leaseSnapshot } from "@/lib/services/accounting";
import { listDocuments } from "@/lib/services/documents";
import {
  buildReminderVars,
  DEFAULT_TEMPLATES,
  renderTemplate,
} from "@/lib/reminders/templates";
import { voidPaymentAction } from "@/app/(app)/payments/actions";
import { RecordPaymentDialog } from "@/components/app/record-payment-dialog";
import { SendReminderDialog } from "@/components/app/send-reminder-dialog";
import { UploadDocumentDialog } from "@/components/app/upload-document-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function summary(label: string, value: string) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

export default async function TenantDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = new Date();
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      leases: {
        orderBy: { startDate: "desc" },
        include: { unit: { include: { property: true } } },
      },
    },
  });
  if (!tenant) notFound();

  const activeLease =
    tenant.leases.find((l) => l.status === "active" || l.status === "month_to_month") ??
    null;

  const snap = activeLease
    ? await leaseSnapshot(
        activeLease,
        activeLease.unit,
        now,
        activeLease.unit.property.timezone,
      )
    : null;

  const ledger = activeLease
    ? await prisma.ledgerEntry.findMany({
        where: { leaseId: activeLease.id },
        orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
      })
    : [];

  const payments = activeLease
    ? await prisma.payment.findMany({
        where: { leaseId: activeLease.id },
        orderBy: { paymentDate: "desc" },
      })
    : [];

  const currency = activeLease?.unit.property.currency ?? "USD";

  const documents = await listDocuments({ tenantId: tenant.id });

  const reminders = await prisma.reminder.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  // Pre-render the default SMS template bodies server-side (the dialog is a
  // client component and must not import lib/reminders). With no active lease,
  // fall back to the most recent lease's figures, else empty strings.
  const templateLease = activeLease ?? tenant.leases[0] ?? null;
  const templateCurrency = templateLease?.unit.property.currency ?? "USD";
  const templateVars = buildReminderVars({
    tenantFirstName: tenant.firstName,
    tenantLastName: tenant.lastName,
    propertyName: templateLease?.unit.property.name ?? "",
    unitLabel: templateLease?.unit.unitNumber ?? "",
    amountDueFormatted: templateLease
      ? formatCurrency(
          snap && snap.currentPeriodOutstandingCents > 0n
            ? snap.currentPeriodOutstandingCents
            : templateLease.rentAmountCents,
          templateCurrency,
        )
      : "",
    dueDateFormatted:
      activeLease && snap?.currentPeriodDueDate
        ? snap.currentPeriodDueDate.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: activeLease.unit.property.timezone,
          })
        : "",
    balanceFormatted: snap
      ? formatCurrency(snap.netBalanceCents, templateCurrency)
      : "",
  });
  const defaultBodies: Record<string, string> = {};
  for (const t of [
    "rent_due_soon",
    "rent_overdue",
    "partial_balance",
    "payment_receipt",
  ] as const) {
    defaultBodies[t] = renderTemplate(DEFAULT_TEMPLATES[t], templateVars);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {tenant.firstName} {tenant.lastName}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>
              {[tenant.phone, tenant.email].filter(Boolean).join(" · ") ||
                "No contact info"}
            </span>
            {tenant.smsConsent ? (
              <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-100 font-medium text-emerald-800"
              >
                SMS consent
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                No SMS consent
              </Badge>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SendReminderDialog
            tenantId={tenant.id}
            leaseId={activeLease?.id}
            tenantName={`${tenant.firstName} ${tenant.lastName}`}
            hasConsent={tenant.smsConsent}
            hasPhone={!!tenant.phone?.trim()}
            defaultBodies={defaultBodies}
          />
          {activeLease && (
            <RecordPaymentDialog
              leaseId={activeLease.id}
              defaultAmount={(Number(activeLease.rentAmountCents) / 100).toFixed(2)}
            />
          )}
        </div>
      </div>

      {activeLease && snap ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>
                  {activeLease.unit.property.name} · {activeLease.unit.unitNumber}
                </span>
                <StatusBadge status={snap.status} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {summary("Current balance", formatCurrency(snap.netBalanceCents, currency))}
                {summary("Monthly rent", formatCurrency(activeLease.rentAmountCents, currency))}
                {summary("Total owed", formatCurrency(snap.totalOwedCents, currency))}
                {summary("Credit", formatCurrency(snap.creditCents, currency))}
                {summary("Due day", `Day ${activeLease.dueDay}`)}
                {summary(
                  "Last payment",
                  snap.daysSinceLastPayment == null
                    ? "Never"
                    : `${snap.daysSinceLastPayment} days ago`,
                )}
                {summary("Past due (1–30)", formatCurrency(snap.aging.d1_30, currency))}
                {summary("Past due (90+)", formatCurrency(snap.aging.d90plus, currency))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ledger</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.effectiveDate.toLocaleDateString()}</TableCell>
                      <TableCell className="capitalize">
                        {e.entryType.replace("_", " ")}
                      </TableCell>
                      <TableCell>{e.periodKey ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.reason ?? e.description ?? ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(e.amountCents, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {ledger.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No ledger entries.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.paymentDate.toLocaleDateString()}</TableCell>
                      <TableCell className="capitalize">{p.method.replace("_", " ")}</TableCell>
                      <TableCell>{p.referenceNumber ?? "—"}</TableCell>
                      <TableCell className="capitalize">{p.status}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(p.amountCents, currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        {p.status === "posted" ? (
                          <form action={voidPaymentAction} className="flex justify-end gap-2">
                            <input type="hidden" name="paymentId" value={p.id} />
                            <input
                              name="reason"
                              placeholder="Reason"
                              className="h-8 w-28 rounded border px-2 text-xs"
                              required
                            />
                            <Button type="submit" variant="outline" size="sm">
                              Void
                            </Button>
                          </form>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {payments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No payments yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-between py-6">
            <p className="text-muted-foreground">No active lease for this tenant.</p>
            <Button render={<Link href={`/leases/new?tenantId=${tenant.id}`} />}>
              Create lease
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Documents</CardTitle>
          <UploadDocumentDialog tenantId={tenant.id} trigger="Upload" />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.createdAt.toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Link
                      href={`/documents/${d.id}`}
                      className="font-medium hover:underline"
                    >
                      {d.fileName ?? "Untitled file"}
                    </Link>
                  </TableCell>
                  <TableCell className="capitalize">
                    {d.uploadType.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatBytes(d.fileSize)}</TableCell>
                </TableRow>
              ))}
              {documents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No documents yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Reminders</CardTitle>
          <Link href="/reminders" className="text-sm font-medium hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reminders.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.createdAt.toLocaleDateString()}</TableCell>
                  <TableCell className="capitalize">
                    {r.reminderType.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="capitalize">{r.status}</TableCell>
                </TableRow>
              ))}
              {reminders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No reminders yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
