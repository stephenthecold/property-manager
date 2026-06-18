import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { formatCurrency, fromCents } from "@/lib/money";
import { expectedMonthlyChargeCents } from "@/lib/accounting/rent";
import { getLeaseRentShares } from "@/lib/services/rent-shares";
import { computeOpenCharges } from "@/lib/accounting/allocation";
import {
  loadLeaseAccounting,
  snapshotFromAccounting,
} from "@/lib/services/accounting";
import { listDocuments } from "@/lib/services/documents";
import { listInboundForTenant } from "@/lib/services/inbound-messages";
import { getAppSettings } from "@/lib/services/app-settings";
import { getDisplayRole } from "@/lib/auth/session";
import { hasCapability } from "@/lib/auth/permissions";
import { PortalAccessCard } from "./portal-access-card";
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
  updateLease,
  addCoTenant,
  removeCoTenant,
  addLeaseDeposit,
  removeLeaseDeposit,
} from "@/app/(app)/leases/actions";
import { UTILITY_OPTIONS } from "@/lib/config/lease";
import { updateTenant } from "@/app/(app)/tenants/actions";
import { addRentShareAction, removeRentShareAction } from "./rent-share-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RecordPaymentDialog } from "@/components/app/record-payment-dialog";
import { WaiveChargeDialog } from "@/components/app/waive-charge-dialog";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SendReminderDialog } from "@/components/app/send-reminder-dialog";
import { UploadDocumentDialog } from "@/components/app/upload-document-dialog";
import { ChangeHistory } from "@/components/app/change-history";
import { FormDialog } from "@/components/app/form-dialog";
import { ActionForm } from "@/components/app/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/app/data-table";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function lateFeeSummary(
  l: {
    lateFeeType: string;
    lateFeeAmountCents: bigint | null;
    lateFeeBps: number | null;
    lateFeeMaxCents: bigint | null;
    gracePeriodDays: number;
  },
  currency: string,
): string {
  const grace = `grace ${l.gracePeriodDays} day(s)`;
  if (l.lateFeeType === "none") return `${grace} · no late fee`;
  if (l.lateFeeType === "percentage")
    return `${grace} · late fee ${l.lateFeeBps ?? 0} bps (one-time)`;
  const amt = formatCurrency(l.lateFeeAmountCents ?? 0n, currency);
  if (l.lateFeeType === "daily")
    return `${grace} · late fee ${amt}/day past grace${
      l.lateFeeMaxCents != null && l.lateFeeMaxCents > 0n
        ? ` (cap ${formatCurrency(l.lateFeeMaxCents, currency)}/period)`
        : ""
    }`;
  return `${grace} · late fee ${amt} (one-time)`;
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

  // One accounting load powers both the snapshot and the per-charge
  // outstanding map for the ledger's Waive controls (no per-row queries).
  const accounting = activeLease
    ? await loadLeaseAccounting(activeLease.id)
    : null;
  const snap =
    activeLease && accounting
      ? snapshotFromAccounting(
          activeLease,
          activeLease.unit,
          now,
          activeLease.unit.property.timezone,
          accounting,
        )
      : null;
  const outstandingByEntry = new Map<string, bigint>(
    accounting
      ? computeOpenCharges(accounting.charges, accounting.allocatedByCharge).map(
          (c) => [c.entryId, c.outstandingCents] as const,
        )
      : [],
  );

  // Independent reads for this tenant — run them together instead of serially.
  const [ledger, payments, documents, reminders, inboundMessages] = await Promise.all([
    activeLease
      ? prisma.ledgerEntry.findMany({
          where: { leaseId: activeLease.id },
          orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
    activeLease
      ? prisma.payment.findMany({
          where: { leaseId: activeLease.id },
          orderBy: { paymentDate: "desc" },
        })
      : Promise.resolve([]),
    listDocuments({ tenantId: tenant.id }),
    prisma.reminder.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    listInboundForTenant(tenant.id),
  ]);
  const recentInbound = inboundMessages.slice(0, 5);

  const currency = activeLease?.unit.property.currency ?? "USD";

  // Pre-render the default SMS template bodies server-side (the dialog is a
  // client component and must not import lib/reminders). With no active lease,
  // fall back to the most recent lease's figures, else empty strings.
  const appSettings = await getAppSettings();
  const { actingRole } = await getDisplayRole();
  const canManagePortal =
    appSettings.modules.tenantPortal &&
    hasCapability(actingRole, "portal.manage", appSettings.rolePermissions);
  const canImpersonate =
    canManagePortal &&
    hasCapability(actingRole, "portal.impersonate", appSettings.rolePermissions);
  const portalAccount = canManagePortal
    ? await prisma.tenantPortalAccount.findUnique({
        where: { tenantId: tenant.id },
      })
    : null;
  const templateLease = activeLease ?? tenant.leases[0] ?? null;
  const templateCurrency = templateLease?.unit.property.currency ?? "USD";

  const canManageLeases = hasCapability(
    actingRole,
    "leases.manage",
    appSettings.rolePermissions,
  );

  // Active non-tenant payers (HUD/housing authorities, …) for the "Paid by"
  // picker, so a HAP payment can be recorded from the tenant's page.
  const payerOptions = (
    await prisma.payer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    })
  ).map((p) => ({ id: p.id, label: p.name }));

  // Rent split (subsidy) lines for the active lease, and their total for the
  // "matches expected monthly" check. Expectation overlay only — never ledgered.
  const rentShares = activeLease ? await getLeaseRentShares(activeLease.id) : [];
  const rentSharesTotalCents = rentShares.reduce((s, r) => s + r.amountCents, 0n);
  const templateVars = buildReminderVars({
    cashAppTag: appSettings.cashAppCashtag,
    tenantFirstName: tenant.firstName,
    tenantLastName: tenant.lastName,
    propertyName: templateLease?.unit.property.name ?? "",
    unitLabel: templateLease?.unit.unitNumber ?? "",
    amountDueFormatted: templateLease
      ? formatCurrency(
          snap && snap.currentPeriodOutstandingCents > 0n
            ? snap.currentPeriodOutstandingCents
            : expectedMonthlyChargeCents(templateLease),
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
                className="border-emerald-200 bg-emerald-100 font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
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
            <>
              <Button
                variant="outline"
                render={<Link href={`/leases/${activeLease.id}/agreement`} />}
              >
                Lease agreement
              </Button>
              <RecordPaymentDialog
                leaseId={activeLease.id}
                payerOptions={payerOptions}
                defaultAmount={fromCents(expectedMonthlyChargeCents(activeLease))}
              />
            </>
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
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 2xl:grid-cols-8">
                {summary("Current balance", formatCurrency(snap.netBalanceCents, currency))}
                {summary(
                  "Monthly rent",
                  activeLease.internetEnabled
                    ? `${formatCurrency(activeLease.rentAmountCents, currency)} + ${formatCurrency(activeLease.internetFeeCents, currency)} internet`
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
                {summary(
                  "Past due (30+)",
                  formatCurrency(
                    snap.aging.d31_60 + snap.aging.d61_90 + snap.aging.d90plus,
                    currency,
                  ),
                )}
              </div>
              {(activeLease.utilitiesPaid as string[]).length > 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Utilities we pay:{" "}
                  <span className="capitalize">
                    {(activeLease.utilitiesPaid as string[]).join(", ")}
                  </span>
                  {activeLease.utilitiesNotes ? ` — ${activeLease.utilitiesNotes}` : ""}
                </p>
              )}

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
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      No rent increase scheduled.
                    </p>
                    <FormDialog
                      trigger="Schedule rent increase"
                      title="Schedule rent increase"
                      description="Applies to rent charges due on or after the effective date; past periods keep their historical pricing."
                      action={scheduleRentIncrease}
                      submitLabel="Schedule"
                    >
                      <input type="hidden" name="leaseId" value={activeLease.id} />
                      <div className="space-y-2">
                        <Label htmlFor="newRentAmount">New monthly rent</Label>
                        <Input
                          id="newRentAmount"
                          name="newRentAmount"
                          inputMode="decimal"
                          placeholder="New monthly rent"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="effectiveDate">Effective date</Label>
                        <Input
                          id="effectiveDate"
                          name="effectiveDate"
                          type="date"
                          min={DateTime.fromJSDate(now, {
                            zone: activeLease.unit.property.timezone,
                          }).toFormat("yyyy-MM-dd")}
                          required
                        />
                      </div>
                    </FormDialog>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm">
                  <span className="font-medium">Lease term</span>{" "}
                  <span className="text-muted-foreground">
                    — ends{" "}
                    {activeLease.endDate
                      ? activeLease.endDate.toLocaleDateString("en-US", {
                          timeZone: activeLease.unit.property.timezone,
                        })
                      : "open-ended"}
                  </span>
                </p>
                <FormDialog
                  trigger="Extend / renew"
                  title="Extend / renew lease"
                  description="Clear the date for an open-ended term. For a new rate on re-signing, schedule a rent increase so past periods keep their historical pricing."
                  action={renewLease}
                  submitLabel="Extend / renew"
                >
                  <input type="hidden" name="leaseId" value={activeLease.id} />
                  <div className="space-y-2">
                    <Label htmlFor="leaseEndDate">New end date</Label>
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
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="leaseStatus">Status</Label>
                    <select
                      id="leaseStatus"
                      name="status"
                      defaultValue={activeLease.status}
                      className="h-9 w-full rounded-md border px-3 text-sm"
                    >
                      <option value="active">Active</option>
                      <option value="month_to_month">Month-to-month</option>
                    </select>
                  </div>
                </FormDialog>
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
                        <ConfirmSubmitButton
                          variant="ghost"
                          size="xs"
                          confirmMessage={`Remove co-tenant ${ct.tenant.firstName} ${ct.tenant.lastName} from this lease?`}
                        >
                          remove
                        </ConfirmSubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
                {addableCoTenants.length > 0 && (
                  <FormDialog
                    trigger="Add co-tenant"
                    triggerSize="xs"
                    title="Add co-tenant"
                    description="Co-tenants share this lease's ledger; the primary tenant stays the billing contact."
                    action={addCoTenant}
                    submitLabel="Add co-tenant"
                  >
                    <input type="hidden" name="leaseId" value={activeLease.id} />
                    <div className="space-y-2">
                      <Label htmlFor="coTenantId">Tenant</Label>
                      <select
                        id="coTenantId"
                        name="tenantId"
                        defaultValue=""
                        required
                        className="h-9 w-full rounded-md border px-3 text-sm"
                      >
                        <option value="" disabled>
                          Select tenant…
                        </option>
                        {addableCoTenants.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.lastName}, {t.firstName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </FormDialog>
                )}
                {!isPrimaryOnActive && (
                  <p className="text-xs text-muted-foreground">
                    This tenant is a co-tenant; the ledger below is the shared lease
                    ledger (billing contact: primary tenant).
                  </p>
                )}
              </div>

              <div className="mt-4 border-t pt-4">
                <p className="text-sm">
                  <span className="font-medium">Deposits</span>{" "}
                  <span className="text-muted-foreground">
                    — security{" "}
                    <span className="tabular-nums">
                      {formatCurrency(activeLease.securityDepositCents, currency)}
                    </span>
                    {activeLease.deposits.map((d) => (
                      <span key={d.id}>
                        {" · "}
                        {d.label}{" "}
                        <span className="tabular-nums">
                          {formatCurrency(d.amountCents, currency)}
                        </span>
                        {d.nonRefundableCents > 0n ? " (non-refundable)" : ""}
                      </span>
                    ))}
                    {" — manage in Edit lease"}
                  </span>
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm">
                  <span className="font-medium">Billing terms</span>{" "}
                  <span className="text-muted-foreground">
                    — {lateFeeSummary(activeLease, currency)}
                  </span>
                </p>
                <FormDialog
                  trigger="Edit lease"
                  title="Edit lease (billing terms)"
                  description="Changes affect future charges only — already-billed periods never change. For a date-effective rate change, use a scheduled rent increase instead of editing the rent here."
                  wide
                  staticContent
                >
                  <ActionForm
                    action={updateLease}
                    submitLabel="Save lease"
                    successMessage="Lease updated."
                    className="space-y-3"
                  >
                    <input type="hidden" name="leaseId" value={activeLease.id} />
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="elRent">Monthly rent</Label>
                        <Input
                          id="elRent"
                          name="rentAmount"
                          inputMode="decimal"
                          defaultValue={fromCents(activeLease.rentAmountCents)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="elDueDay">Due day (1–31)</Label>
                        <Input
                          id="elDueDay"
                          name="dueDay"
                          type="number"
                          min={1}
                          max={31}
                          defaultValue={activeLease.dueDay}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="elGrace">Grace period (days)</Label>
                        <Input
                          id="elGrace"
                          name="gracePeriodDays"
                          type="number"
                          min={0}
                          defaultValue={activeLease.gracePeriodDays}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="elFeeType">Late fee type</Label>
                        <select
                          id="elFeeType"
                          name="lateFeeType"
                          defaultValue={activeLease.lateFeeType}
                          className="h-9 w-full rounded-md border px-3 text-sm"
                        >
                          <option value="none">None</option>
                          <option value="fixed">Fixed (one-time)</option>
                          <option value="percentage">Percentage (one-time)</option>
                          <option value="daily">Per day past grace</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="elFeeAmount">Late fee ($ / $ per day / bps)</Label>
                        <Input
                          id="elFeeAmount"
                          name="lateFeeAmount"
                          defaultValue={
                            activeLease.lateFeeType === "percentage"
                              ? (activeLease.lateFeeBps ?? "")
                              : activeLease.lateFeeAmountCents != null
                                ? fromCents(activeLease.lateFeeAmountCents)
                                : ""
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="elFeeMax">Daily cap per period</Label>
                        <Input
                          id="elFeeMax"
                          name="lateFeeMax"
                          inputMode="decimal"
                          defaultValue={
                            activeLease.lateFeeMaxCents != null
                              ? fromCents(activeLease.lateFeeMaxCents)
                              : ""
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="elDeposit">Security deposit</Label>
                        <Input
                          id="elDeposit"
                          name="securityDeposit"
                          inputMode="decimal"
                          defaultValue={fromCents(activeLease.securityDepositCents)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="elInternetFee">Monthly internet fee</Label>
                        <Input
                          id="elInternetFee"
                          name="internetFee"
                          inputMode="decimal"
                          defaultValue={fromCents(activeLease.internetFeeCents)}
                          required
                        />
                      </div>
                      <div className="flex items-end pb-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="internetEnabled"
                            defaultChecked={activeLease.internetEnabled}
                            className="size-4 accent-primary"
                          />
                          Internet service on this lease
                        </label>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Utilities we pay</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm capitalize">
                        {UTILITY_OPTIONS.map((u) => (
                          <label key={u} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              name="utilities"
                              value={u}
                              defaultChecked={(
                                activeLease.utilitiesPaid as string[]
                              ).includes(u)}
                              className="size-4 accent-primary"
                            />
                            {u}
                          </label>
                        ))}
                      </div>
                      <Input
                        name="utilitiesNotes"
                        placeholder="Utility notes (optional)"
                        defaultValue={activeLease.utilitiesNotes ?? ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="elNotes">Lease notes</Label>
                      <Textarea
                        id="elNotes"
                        name="notes"
                        defaultValue={activeLease.notes ?? ""}
                      />
                    </div>
                  </ActionForm>

                  <div className="mt-4 space-y-3 border-t pt-4">
                    <p className="text-sm font-medium">Additional deposits</p>
                    <ul className="space-y-1.5 text-sm">
                      {activeLease.deposits.map((d) => (
                        <li
                          key={d.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span>
                            {d.label}:{" "}
                            <span className="tabular-nums">
                              {formatCurrency(d.amountCents, currency)}
                            </span>
                            {d.nonRefundableCents > 0n && (
                              <span className="text-muted-foreground">
                                {" "}
                                (non-refundable)
                              </span>
                            )}
                          </span>
                          <form action={removeLeaseDeposit}>
                            <input type="hidden" name="depositId" value={d.id} />
                            <ConfirmSubmitButton
                              variant="outline"
                              size="xs"
                              confirmMessage={`Remove the ${d.label} deposit (${formatCurrency(d.amountCents, currency)}) from this lease?`}
                            >
                              Remove
                            </ConfirmSubmitButton>
                          </form>
                        </li>
                      ))}
                      {activeLease.deposits.length === 0 && (
                        <li className="text-muted-foreground">
                          No additional deposits.
                        </li>
                      )}
                    </ul>
                    <ActionForm
                      action={addLeaseDeposit}
                      submitLabel="Add deposit"
                      successMessage="Deposit added."
                      className="flex flex-wrap items-end gap-2"
                    >
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
                      <label className="flex h-8 items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          name="nonRefundable"
                          className="size-4 accent-primary"
                        />
                        Non-refundable
                      </label>
                    </ActionForm>
                    <p className="text-xs text-muted-foreground">
                      The security deposit is part of the lease terms above; track
                      extra deposits (pet, key, …) here. Non-refundable marks the
                      whole deposit as kept.
                    </p>
                  </div>
                </FormDialog>
              </div>
            </CardContent>
          </Card>

          <Card className="border-t-4 border-t-sky-500">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span>Rent split (subsidy)</span>
                {canManageLeases && (
                  <FormDialog
                    trigger="Add split line"
                    title="Add rent-split line"
                    description="Declare how much of the monthly rent a party pays. Leave 'Paid by' as Tenant for the tenant's portion; pick a payer (e.g. a housing authority) for a subsidy portion."
                    action={addRentShareAction}
                    submitLabel="Add line"
                  >
                    <input type="hidden" name="leaseId" value={activeLease.id} />
                    <div className="space-y-2">
                      <Label htmlFor="rsLabel">Label</Label>
                      <Input id="rsLabel" name="label" placeholder="HAP subsidy" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rsPayer">Paid by</Label>
                      <select
                        id="rsPayer"
                        name="payerId"
                        defaultValue=""
                        className="h-9 w-full rounded-md border px-3 text-sm"
                      >
                        <option value="">Tenant</option>
                        {payerOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="rsAmount">Amount</Label>
                        <Input id="rsAmount" name="amount" inputMode="decimal" placeholder="800.00" required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="rsEff">Effective date</Label>
                        <Input id="rsEff" name="effectiveDate" type="date" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rsEnd">End date (optional — e.g. at recertification)</Label>
                      <Input id="rsEnd" name="endDate" type="date" />
                    </div>
                  </FormDialog>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rentShares.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rent split set — the tenant owes the full rent. For a
                  subsidized lease, add lines for each portion (e.g. a tenant
                  portion plus a housing-authority HAP subsidy).
                </p>
              ) : (
                <>
                  <ul className="space-y-2 text-sm">
                    {rentShares.map((s) => (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          <span className="font-medium tabular-nums">
                            {formatCurrency(s.amountCents, currency)}
                          </span>{" "}
                          {s.label} —{" "}
                          <span className={s.payerName ? "" : "text-muted-foreground"}>
                            {s.payerName ?? "Tenant"}
                          </span>
                          {s.endDate && (
                            <span className="text-muted-foreground">
                              {" "}
                              (ends{" "}
                              {s.endDate.toLocaleDateString("en-US", {
                                timeZone: activeLease.unit.property.timezone,
                              })}
                              )
                            </span>
                          )}
                        </span>
                        {canManageLeases && (
                          <form action={removeRentShareAction}>
                            <input type="hidden" name="rentShareId" value={s.id} />
                            <ConfirmSubmitButton
                              confirmMessage="Remove this rent-split line?"
                              variant="outline"
                              size="xs"
                            >
                              Remove
                            </ConfirmSubmitButton>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm">
                    Split total{" "}
                    <span className="font-medium tabular-nums">
                      {formatCurrency(rentSharesTotalCents, currency)}
                    </span>{" "}
                    vs expected monthly{" "}
                    <span className="tabular-nums">
                      {formatCurrency(expectedMonthlyChargeCents(activeLease), currency)}
                    </span>
                    {rentSharesTotalCents !== expectedMonthlyChargeCents(activeLease) && (
                      <span className="text-amber-600 dark:text-amber-400">
                        {" "}
                        — doesn&apos;t match; adjust the lines.
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Expectation overlay only — the ledger still carries the whole
                    rent. Missing subsidy payments surface on the{" "}
                    <Link href="/payers" className="underline">
                      Payers
                    </Link>{" "}
                    page.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ledger</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                emptyMessage="No ledger entries."
                columns={[
                  { key: "date", label: "Date" },
                  { key: "type", label: "Type" },
                  { key: "period", label: "Period", className: "hidden sm:table-cell" },
                  {
                    key: "detail",
                    label: "Detail",
                    sortable: false,
                    className: "hidden md:table-cell",
                  },
                  { key: "amount", label: "Amount", align: "right", numeric: true },
                  { key: "action", label: "", align: "right", sortable: false },
                ]}
                rows={ledger.map((e) => {
                  // Open charges (waiver-netted, allocation-netted) get a
                  // Waive control; everything else gets an empty cell.
                  const outstandingCents = outstandingByEntry.get(e.id) ?? 0n;
                  const waivable =
                    (e.entryType === "rent_charge" || e.entryType === "late_fee") &&
                    outstandingCents > 0n;
                  return {
                    key: e.id,
                    sortValues: [
                      e.effectiveDate.toISOString(),
                      e.entryType,
                      e.periodKey,
                      null,
                      String(e.amountCents),
                      null,
                    ],
                    cells: [
                      e.effectiveDate.toLocaleDateString(),
                      <span key="t" className="capitalize">
                        {e.entryType.replace("_", " ")}
                      </span>,
                      e.periodKey ?? "—",
                      <span key="d" className="text-muted-foreground">
                        {e.reason ?? e.description ?? ""}
                      </span>,
                      <span
                        key="a"
                        className={cn(
                          "tabular-nums",
                          e.amountCents < 0n && "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {formatCurrency(e.amountCents, currency)}
                      </span>,
                      waivable ? (
                        <WaiveChargeDialog
                          key="w"
                          entryId={e.id}
                          chargeLabel={
                            e.entryType === "late_fee" ? "Late fee" : "Rent charge"
                          }
                          periodLabel={e.periodKey ?? "—"}
                          outstanding={fromCents(outstandingCents)}
                          outstandingFormatted={formatCurrency(
                            outstandingCents,
                            currency,
                          )}
                        />
                      ) : (
                        <span key="w" />
                      ),
                    ],
                  };
                })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                emptyMessage="No payments yet."
                columns={[
                  { key: "date", label: "Date" },
                  { key: "method", label: "Method" },
                  {
                    key: "reference",
                    label: "Reference",
                    className: "hidden md:table-cell",
                  },
                  { key: "status", label: "Status", className: "hidden sm:table-cell" },
                  { key: "amount", label: "Amount", align: "right", numeric: true },
                  { key: "action", label: "Action", align: "right", sortable: false },
                ]}
                rows={payments.map((p) => ({
                  key: p.id,
                  sortValues: [
                    p.paymentDate.toISOString(),
                    p.method,
                    p.referenceNumber,
                    p.status,
                    String(p.amountCents),
                    null,
                  ],
                  cells: [
                    p.paymentDate.toLocaleDateString(),
                    <span key="m" className="capitalize">
                      {p.method.replace("_", " ")}
                    </span>,
                    p.referenceNumber ?? "—",
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
                    <span key="a" className="tabular-nums">
                      {formatCurrency(p.amountCents, currency)}
                    </span>,
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
                          size="sm"
                          confirmMessage={`Void this ${formatCurrency(p.amountCents, currency)} payment? An offsetting reversal is added; the original is kept.`}
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
                }))}
              />
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
          <DataTable
            emptyMessage="No documents yet."
            columns={[
              { key: "date", label: "Date" },
              { key: "file", label: "File" },
              { key: "type", label: "Type", className: "hidden sm:table-cell" },
              { key: "size", label: "Size", numeric: true, className: "hidden md:table-cell" },
            ]}
            rows={documents.map((d) => ({
              key: d.id,
              sortValues: [
                d.createdAt.toISOString(),
                d.fileName ?? "Untitled file",
                d.uploadType,
                d.fileSize,
              ],
              cells: [
                d.createdAt.toLocaleDateString(),
                <Link
                  key="f"
                  href={`/documents/${d.id}`}
                  className="font-medium hover:underline"
                >
                  {d.fileName ?? "Untitled file"}
                </Link>,
                <span key="t" className="capitalize">
                  {d.uploadType.replace(/_/g, " ")}
                </span>,
                <span key="z" className="tabular-nums">
                  {formatBytes(d.fileSize)}
                </span>,
              ],
            }))}
          />
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
          <DataTable
            emptyMessage="No reminders yet."
            columns={[
              { key: "date", label: "Date" },
              { key: "type", label: "Type" },
              { key: "status", label: "Status" },
            ]}
            rows={reminders.map((r) => ({
              key: r.id,
              sortValues: [r.createdAt.toISOString(), r.reminderType, r.status],
              cells: [
                r.createdAt.toLocaleDateString(),
                <span key="t" className="capitalize">
                  {r.reminderType.replace(/_/g, " ")}
                </span>,
                <span key="s" className="capitalize">
                  {r.status}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Messages</CardTitle>
          <Link href="/messages" className="text-sm font-medium hover:underline">
            Open inbox
          </Link>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No inbound messages from this tenant."
            columns={[
              { key: "received", label: "Received" },
              { key: "body", label: "Message", sortable: false },
            ]}
            rows={recentInbound.map((m) => ({
              key: m.id,
              sortValues: [m.receivedAt.toISOString(), null],
              cells: [
                <span key="r" className="whitespace-nowrap text-sm">
                  {m.receivedAt.toLocaleDateString()}
                  {!m.readAt && (
                    <Badge
                      variant="outline"
                      className="ml-2 border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                    >
                      New
                    </Badge>
                  )}
                </span>,
                <span key="b" className="whitespace-pre-wrap break-words">
                  {m.body || (
                    <span className="text-muted-foreground">(empty)</span>
                  )}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Tenant details</CardTitle>
          <FormDialog
            trigger="Edit tenant"
            title="Edit tenant"
            wide
            action={updateTenant}
            submitLabel="Save tenant"
          >
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
            <div className="space-y-2">
              <Label htmlFor="preferredPaymentMethod">Preferred payment method</Label>
              <select
                id="preferredPaymentMethod"
                name="preferredPaymentMethod"
                defaultValue={tenant.preferredPaymentMethod ?? ""}
                className="h-9 w-full rounded-md border px-3 text-sm capitalize"
              >
                <option value="">Not set</option>
                {["cash", "check", "money_order", "card", "ach", "online", "cash_app", "other"].map(
                  (m) => (
                    <option key={m} value={m}>
                      {m.replace(/_/g, " ")}
                    </option>
                  ),
                )}
              </select>
              <p className="text-xs text-muted-foreground">
                Informational — cash preference means staff arrange pickups.
                Tenants can change this themselves in the portal.
              </p>
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
                  id="emailConsent"
                  name="emailConsent"
                  type="checkbox"
                  defaultChecked={tenant.emailConsent}
                  className="size-4 accent-primary"
                />
                <Label htmlFor="emailConsent">Email consent</Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="reminderChannel">Reminder channel</Label>
                <select
                  id="reminderChannel"
                  name="reminderChannel"
                  defaultValue={tenant.reminderChannel}
                  className="rounded-md border p-1.5 text-sm"
                >
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select>
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
          </FormDialog>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {summary("Phone", tenant.phone ?? "—")}
            {summary("Email", tenant.email ?? "—")}
            {summary("Mailing address", tenant.mailingAddress ?? "—")}
            {summary("Emergency contact", tenant.emergencyContactName ?? "—")}
            {summary("Emergency phone", tenant.emergencyContactPhone ?? "—")}
            {summary("SMS consent", tenant.smsConsent ? "Yes" : "No")}
            {summary("Email consent", tenant.emailConsent ? "Yes" : "No")}
            {summary(
              "Reminder channel",
              tenant.reminderChannel === "email" ? "Email" : "SMS",
            )}
            {summary(
              "Preferred payment",
              tenant.preferredPaymentMethod
                ? tenant.preferredPaymentMethod.replace(/_/g, " ")
                : "—",
            )}
          </div>
          {tenant.notes && (
            <p className="mt-3 text-sm text-muted-foreground">{tenant.notes}</p>
          )}
        </CardContent>
      </Card>

      {canManagePortal && (
        <PortalAccessCard
          tenantId={tenant.id}
          account={{
            exists: !!portalAccount,
            isActive: portalAccount?.isActive ?? false,
            hasPassword: !!portalAccount?.passwordHash,
            invitePending:
              !!portalAccount?.inviteExpiresAt &&
              portalAccount.inviteExpiresAt > now,
            lastLoginAt: portalAccount?.lastLoginAt
              ? portalAccount.lastLoginAt.toLocaleDateString()
              : null,
            email: portalAccount?.email ?? null,
            phone: portalAccount?.phone ?? null,
          }}
          canImpersonate={canImpersonate}
        />
      )}

      <ChangeHistory
        refs={[
          { entityType: "Tenant", entityId: tenant.id },
          ...allLeases.map((l) => ({ entityType: "Lease", entityId: l.id })),
          ...payments.map((p) => ({ entityType: "Payment", entityId: p.id })),
        ]}
      />
    </div>
  );
}
