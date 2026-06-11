import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { formatCurrency, fromCents } from "@/lib/money";
import { expectedMonthlyChargeCents } from "@/lib/accounting/rent";
import { leaseSnapshot } from "@/lib/services/accounting";
import { listDocuments } from "@/lib/services/documents";
import {
  buildReminderVars,
  DEFAULT_TEMPLATES,
  renderTemplate,
} from "@/lib/reminders/templates";
import { voidPaymentAction } from "@/app/(app)/payments/actions";
import {
  scheduleRentIncrease,
  cancelRentIncrease,
  renewLease,
  addCoTenant,
  removeCoTenant,
  addLeaseDeposit,
  removeLeaseDeposit,
} from "@/app/(app)/leases/actions";
import { updateTenant } from "@/app/(app)/tenants/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const leaseInclude = {
    unit: { include: { property: true } },
    tenant: true,
    coTenants: { include: { tenant: true }, orderBy: { createdAt: "asc" as const } },
    deposits: { orderBy: { createdAt: "asc" as const } },
  };
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      leases: { orderBy: { startDate: "desc" }, include: leaseInclude },
      coLeases: { include: { lease: { include: leaseInclude } } },
    },
  });
  if (!tenant) notFound();

  // Leases where this tenant is primary, plus ones where they are a co-tenant
  // (sorted so the newest co-lease wins deterministically).
  const coLeases = tenant.coLeases
    .map((ct) => ct.lease)
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  const allLeases = [...tenant.leases, ...coLeases];
  const activeLease =
    allLeases.find((l) => l.status === "active" || l.status === "month_to_month") ??
    null;
  const isPrimaryOnActive = activeLease?.tenantId === tenant.id;
  // Tenants eligible to be added as co-tenants (not already on the lease).
  const addableCoTenants = activeLease
    ? await prisma.tenant.findMany({
        where: {
          isActive: true,
          id: {
            notIn: [
              activeLease.tenantId,
              ...activeLease.coTenants.map((ct) => ct.tenantId),
            ],
          },
        },
        orderBy: [{ lastName: "asc" }],
      })
    : [];

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
            : expectedMonthlyChargeCents({
                rentAmountCents: templateLease.rentAmountCents,
                ...templateLease.unit,
              }),
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
              defaultAmount={fromCents(
                expectedMonthlyChargeCents({
                  rentAmountCents: activeLease.rentAmountCents,
                  ...activeLease.unit,
                }),
              )}
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
                {summary(
                  "Monthly rent",
                  activeLease.unit.internetEnabled
                    ? `${formatCurrency(activeLease.rentAmountCents, currency)} + ${formatCurrency(activeLease.unit.internetFeeCents, currency)} internet`
                    : formatCurrency(activeLease.rentAmountCents, currency),
                )}
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

              <div className="mt-4 border-t pt-4">
                {activeLease.scheduledRentAmountCents != null &&
                activeLease.scheduledRentEffectiveDate != null ? (
                  <form
                    action={cancelRentIncrease}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <input type="hidden" name="leaseId" value={activeLease.id} />
                    <p className="text-sm">
                      Rent increases to{" "}
                      <span className="font-medium">
                        {formatCurrency(activeLease.scheduledRentAmountCents, currency)}
                      </span>{" "}
                      on{" "}
                      {activeLease.scheduledRentEffectiveDate.toLocaleDateString("en-US", {
                        timeZone: activeLease.unit.property.timezone,
                      })}{" "}
                      <span className="text-muted-foreground">
                        (applies to rent charges due on/after that date)
                      </span>
                    </p>
                    <Button type="submit" variant="outline" size="sm">
                      Cancel increase
                    </Button>
                  </form>
                ) : (
                  <form
                    action={scheduleRentIncrease}
                    className="flex flex-wrap items-end gap-3"
                  >
                    <input type="hidden" name="leaseId" value={activeLease.id} />
                    <div className="space-y-1">
                      <Label htmlFor="newRentAmount" className="text-xs">
                        Schedule rent increase
                      </Label>
                      <Input
                        id="newRentAmount"
                        name="newRentAmount"
                        inputMode="decimal"
                        placeholder="New monthly rent"
                        className="h-8 w-40"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="effectiveDate" className="text-xs">
                        Effective date
                      </Label>
                      <Input
                        id="effectiveDate"
                        name="effectiveDate"
                        type="date"
                        min={DateTime.fromJSDate(now, {
                          zone: activeLease.unit.property.timezone,
                        }).toFormat("yyyy-MM-dd")}
                        className="h-8 w-40"
                        required
                      />
                    </div>
                    <Button type="submit" variant="outline" size="sm">
                      Schedule
                    </Button>
                  </form>
                )}
              </div>

              <div className="mt-4 border-t pt-4">
                <form action={renewLease} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="leaseId" value={activeLease.id} />
                  <div className="space-y-1">
                    <Label htmlFor="leaseEndDate" className="text-xs">
                      Lease ends{" "}
                      {activeLease.endDate
                        ? `(${activeLease.endDate.toLocaleDateString("en-US", { timeZone: activeLease.unit.property.timezone })})`
                        : "(open-ended)"}
                    </Label>
                    <Input
                      id="leaseEndDate"
                      name="endDate"
                      type="date"
                      defaultValue={
                        activeLease.endDate
                          ? DateTime.fromJSDate(activeLease.endDate, {
                              zone: activeLease.unit.property.timezone,
                            }).toFormat("yyyy-MM-dd")
                          : ""
                      }
                      className="h-8 w-40"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="leaseStatus" className="text-xs">
                      Status
                    </Label>
                    <select
                      id="leaseStatus"
                      name="status"
                      defaultValue={activeLease.status}
                      className="h-8 rounded-md border bg-transparent px-2 text-sm"
                    >
                      <option value="active">Active</option>
                      <option value="month_to_month">Month-to-month</option>
                    </select>
                  </div>
                  <Button type="submit" variant="outline" size="sm">
                    Extend / renew
                  </Button>
                  <p className="basis-full text-xs text-muted-foreground">
                    Clear the date for an open-ended term. For a new rate on
                    re-signing, schedule a rent increase above so past periods keep
                    their historical pricing.
                  </p>
                </form>
              </div>

              <div className="mt-4 border-t pt-4 space-y-2">
                <p className="text-sm font-medium">Tenants on lease</p>
                <ul className="space-y-1 text-sm">
                  <li className="flex items-center gap-2">
                    <Link
                      href={`/tenants/${activeLease.tenantId}`}
                      className="hover:underline"
                    >
                      {activeLease.tenant.firstName} {activeLease.tenant.lastName}
                    </Link>
                    <Badge variant="outline" className="text-muted-foreground">
                      primary
                    </Badge>
                  </li>
                  {activeLease.coTenants.map((ct) => (
                    <li key={ct.id} className="flex items-center gap-2">
                      <Link href={`/tenants/${ct.tenantId}`} className="hover:underline">
                        {ct.tenant.firstName} {ct.tenant.lastName}
                      </Link>
                      <form action={removeCoTenant}>
                        <input type="hidden" name="leaseTenantId" value={ct.id} />
                        <button
                          type="submit"
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
                {addableCoTenants.length > 0 && (
                  <form action={addCoTenant} className="flex items-center gap-2">
                    <input type="hidden" name="leaseId" value={activeLease.id} />
                    <select
                      name="tenantId"
                      defaultValue=""
                      required
                      className="h-8 rounded-md border bg-transparent px-2 text-sm"
                    >
                      <option value="" disabled>
                        Add co-tenant…
                      </option>
                      {addableCoTenants.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.lastName}, {t.firstName}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="outline" size="sm">
                      Add
                    </Button>
                  </form>
                )}
                {!isPrimaryOnActive && (
                  <p className="text-xs text-muted-foreground">
                    This tenant is a co-tenant; the ledger below is the shared lease
                    ledger (billing contact: primary tenant).
                  </p>
                )}
              </div>

              <div className="mt-4 border-t pt-4 space-y-2">
                <p className="text-sm font-medium">Deposits</p>
                <ul className="space-y-1 text-sm">
                  <li>
                    Security deposit:{" "}
                    <span className="tabular-nums">
                      {formatCurrency(activeLease.securityDepositCents, currency)}
                    </span>
                  </li>
                  {activeLease.deposits.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      <span>
                        {d.label}:{" "}
                        <span className="tabular-nums">
                          {formatCurrency(d.amountCents, currency)}
                        </span>
                        {d.nonRefundableCents > 0n && (
                          <span className="text-muted-foreground">
                            {" "}
                            ({formatCurrency(d.nonRefundableCents, currency)} non-refundable)
                          </span>
                        )}
                      </span>
                      <form action={removeLeaseDeposit}>
                        <input type="hidden" name="depositId" value={d.id} />
                        <button
                          type="submit"
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
                <form action={addLeaseDeposit} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="leaseId" value={activeLease.id} />
                  <div className="space-y-1">
                    <Label htmlFor="depLabel" className="text-xs">
                      Label
                    </Label>
                    <Input
                      id="depLabel"
                      name="label"
                      placeholder="Pet deposit"
                      className="h-8 w-36"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="depAmount" className="text-xs">
                      Amount
                    </Label>
                    <Input
                      id="depAmount"
                      name="amount"
                      inputMode="decimal"
                      placeholder="500.00"
                      className="h-8 w-28"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="depNonRef" className="text-xs">
                      Non-refundable part
                    </Label>
                    <Input
                      id="depNonRef"
                      name="nonRefundable"
                      inputMode="decimal"
                      placeholder="0.00"
                      className="h-8 w-28"
                    />
                  </div>
                  <Button type="submit" variant="outline" size="sm">
                    Add deposit
                  </Button>
                </form>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit tenant</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateTenant} className="space-y-3">
            <input type="hidden" name="tenantId" value={tenant.id} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  name="firstName"
                  defaultValue={tenant.firstName}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  name="lastName"
                  defaultValue={tenant.lastName}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" defaultValue={tenant.phone ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={tenant.email ?? ""}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="mailingAddress">Mailing address</Label>
                <Input
                  id="mailingAddress"
                  name="mailingAddress"
                  defaultValue={tenant.mailingAddress ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContactName">Emergency contact</Label>
                <Input
                  id="emergencyContactName"
                  name="emergencyContactName"
                  defaultValue={tenant.emergencyContactName ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContactPhone">Emergency phone</Label>
                <Input
                  id="emergencyContactPhone"
                  name="emergencyContactPhone"
                  defaultValue={tenant.emergencyContactPhone ?? ""}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <input
                  id="smsConsent"
                  name="smsConsent"
                  type="checkbox"
                  defaultChecked={tenant.smsConsent}
                  className="size-4 accent-primary"
                />
                <Label htmlFor="smsConsent">SMS consent</Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="isActive"
                  name="isActive"
                  type="checkbox"
                  defaultChecked={tenant.isActive}
                  className="size-4 accent-primary"
                />
                <Label htmlFor="isActive">Active tenant</Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenantNotes">Notes</Label>
              <Textarea id="tenantNotes" name="notes" defaultValue={tenant.notes ?? ""} />
            </div>
            <Button type="submit" size="sm">
              Save tenant
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
