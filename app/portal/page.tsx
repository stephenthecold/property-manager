import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePortalSession } from "@/lib/portal/session";
import { getAppSettings } from "@/lib/services/app-settings";
import {
  loadLeaseAccounting,
  snapshotFromAccounting,
} from "@/lib/services/accounting";
import { cashAppLink } from "@/lib/payments/cash-app";
import { resolveComplianceLinks } from "@/lib/config/compliance";
import { formatCurrency, fromCents } from "@/lib/money";
import { onlinePaymentsConfigured } from "@/lib/services/gateway-checkout";
import { countServedNoticesForTenant } from "@/lib/services/notices";
import { startPortalCheckoutAction } from "./pay/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CashPickupForm,
  MaintenanceRequestForm,
  PaymentPreferenceForm,
  SmsConsentForm,
} from "./portal-forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tenant dashboard: THEIR active lease (primary or co-tenant), live balance
 * from the same accounting snapshot the staff pages use, charge/payment
 * history, receipts and documents (scoped downloads), how-to-pay, and
 * request forms. Everything is filtered by the signed-in tenant id — no
 * other tenant's data is ever loaded.
 */

function entryLabel(t: string): string {
  return t.replace(/_/g, " ");
}

function money(cents: bigint, currency: string): string {
  return formatCurrency(cents, currency);
}

export default async function PortalHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant } = await requirePortalSession();
  const settings = await getAppSettings();
  const now = new Date();
  const compliance = resolveComplianceLinks(settings);
  const sp = await searchParams;
  const paid = (Array.isArray(sp.paid) ? sp.paid[0] : sp.paid) === "1";
  const payError = Array.isArray(sp.payerror) ? sp.payerror[0] : sp.payerror;

  const leases = await prisma.lease.findMany({
    where: {
      OR: [{ tenantId: tenant.id }, { coTenants: { some: { tenantId: tenant.id } } }],
    },
    orderBy: { startDate: "desc" },
    include: { unit: { include: { property: true } }, tenant: true },
  });
  const activeLease =
    leases.find((l) => l.status === "active" || l.status === "month_to_month") ?? null;
  const leaseIds = leases.map((l) => l.id);

  const currency = activeLease?.unit.property.currency ?? settings.defaultCurrency;
  const tz = activeLease?.unit.property.timezone ?? settings.defaultTimezone;

  const accounting = activeLease ? await loadLeaseAccounting(activeLease.id) : null;
  const snap =
    activeLease && accounting
      ? snapshotFromAccounting(activeLease, activeLease.unit, now, tz, accounting)
      : null;

  // Online "Pay now": available when a gateway is configured and there's an
  // active lease. Default the amount to the balance (or current period due).
  const payNowAvailable = !!activeLease && onlinePaymentsConfigured();
  const defaultPayAmount =
    snap && snap.netBalanceCents > 0n
      ? fromCents(snap.netBalanceCents)
      : snap && snap.currentPeriodOutstandingCents > 0n
        ? fromCents(snap.currentPeriodOutstandingCents)
        : "";

  const [ledger, payments, receipts, documents, requests, noticeCount] = await Promise.all([
    activeLease
      ? prisma.ledgerEntry.findMany({
          where: { leaseId: activeLease.id },
          orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
          take: 15,
        })
      : Promise.resolve([]),
    leaseIds.length
      ? prisma.payment.findMany({
          where: { leaseId: { in: leaseIds } },
          orderBy: { paymentDate: "desc" },
          take: 12,
        })
      : Promise.resolve([]),
    prisma.receipt.findMany({
      where: { tenantId: tenant.id, receiptType: "digital" },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.uploadedDocument.findMany({
      where: {
        uploadType: { in: ["lease", "tenant_document"] },
        OR: [
          { tenantId: tenant.id },
          ...(leaseIds.length ? [{ leaseId: { in: leaseIds } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.tenantRequest.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    settings.modules.notices
      ? countServedNoticesForTenant(tenant.id)
      : Promise.resolve(0),
  ]);

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-6">
      {paid && (
        <Alert>
          <AlertDescription>
            Payment received — thank you! Your balance updates below.
          </AlertDescription>
        </Alert>
      )}
      {payError && (
        <Alert variant="destructive">
          <AlertDescription>
            {payError === "amount"
              ? "Enter a valid payment amount."
              : payError === "unavailable"
                ? "Online payments aren't available right now."
                : "We couldn't start that payment. Please try again."}
          </AlertDescription>
        </Alert>
      )}
      {settings.portalWelcomeText && (
        <Card>
          <CardContent className="py-4 text-sm whitespace-pre-wrap text-muted-foreground">
            {settings.portalWelcomeText}
          </CardContent>
        </Card>
      )}
      {settings.portalPaymentHelpText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to pay</CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-4 text-sm whitespace-pre-wrap text-muted-foreground">
            {settings.portalPaymentHelpText}
          </CardContent>
        </Card>
      )}
      {/* Lease + balance */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your lease</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {activeLease ? (
              <>
                <div className="font-medium">
                  {activeLease.unit.property.name} · Unit {activeLease.unit.unitNumber}
                </div>
                <div className="text-muted-foreground">
                  Rent {money(activeLease.rentAmountCents, currency)}/month · due the{" "}
                  {activeLease.dueDay}
                  {activeLease.dueDay === 1
                    ? "st"
                    : activeLease.dueDay === 2
                      ? "nd"
                      : activeLease.dueDay === 3
                        ? "rd"
                        : "th"}
                </div>
                <div className="text-muted-foreground">
                  {fmtDate(activeLease.startDate)} —{" "}
                  {activeLease.endDate ? fmtDate(activeLease.endDate) : "month-to-month"}
                </div>
                {activeLease.tenantId !== tenant.id && (
                  <div className="text-xs text-muted-foreground">
                    You are a co-tenant on this lease (primary:{" "}
                    {activeLease.tenant.firstName} {activeLease.tenant.lastName}).
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No active lease on file.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Balance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {snap ? (
              <>
                <div
                  className={`text-3xl font-bold tabular-nums ${
                    snap.netBalanceCents > 0n
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {money(snap.netBalanceCents, currency)}
                </div>
                <div className="text-muted-foreground">
                  {snap.netBalanceCents > 0n
                    ? "Currently owed"
                    : snap.netBalanceCents < 0n
                      ? "Credit on your account"
                      : "All paid up — thank you!"}
                </div>
                {snap.currentPeriodDueDate && snap.currentPeriodOutstandingCents > 0n && (
                  <div className="text-muted-foreground">
                    {money(snap.currentPeriodOutstandingCents, currency)} due{" "}
                    {fmtDate(snap.currentPeriodDueDate)}
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Notices inbox */}
      {settings.modules.notices && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="space-y-0.5">
              <div className="text-base font-medium">Notices</div>
              <div className="text-sm text-muted-foreground">
                {noticeCount > 0
                  ? `${noticeCount} notice${noticeCount === 1 ? "" : "s"} from your property manager`
                  : "No notices right now."}
              </div>
            </div>
            <Button variant="outline" size="sm" render={<Link href="/portal/notices" />}>
              View notices
              {noticeCount > 0 && (
                <Badge variant="secondary" className="ml-2 tabular-nums">
                  {noticeCount}
                </Badge>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* How to pay */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to pay</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {payNowAvailable && activeLease && (
            <form
              action={startPortalCheckoutAction}
              className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3"
            >
              <input type="hidden" name="leaseId" value={activeLease.id} />
              <div className="space-y-1">
                <Label htmlFor="payAmount">Pay online</Label>
                <Input
                  id="payAmount"
                  name="amount"
                  inputMode="decimal"
                  defaultValue={defaultPayAmount}
                  placeholder="0.00"
                  className="w-32"
                  required
                />
              </div>
              <Button type="submit">Pay now</Button>
            </form>
          )}
          {settings.cashAppCashtag ? (
            <p>
              Pay with Cash App:{" "}
              <a
                href={cashAppLink(settings.cashAppCashtag)}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline underline-offset-4"
              >
                {settings.cashAppCashtag}
              </a>{" "}
              — include your unit number in the note.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Ask your property manager about payment options.
            </p>
          )}
          <PaymentPreferenceForm current={tenant.preferredPaymentMethod} />
          <div className="border-t pt-4">
            <CashPickupForm leaseId={activeLease?.id ?? null} />
          </div>
        </CardContent>
      </Card>

      {/* Text messages & help */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Text messages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            {tenant.smsConsent
              ? "You're opted in to account text messages."
              : "You're opted out of text messages."}
          </p>
          <SmsConsentForm current={tenant.smsConsent} />
          <div className="space-y-1 border-t pt-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Messaging help</p>
            <p>
              {settings.businessName}{" "}
              sends account messages — rent reminders and payment receipts.
              Message frequency varies. Message &amp; data rates may apply.
            </p>
            <p>
              Reply <span className="font-mono">STOP</span> to unsubscribe or{" "}
              <span className="font-mono">HELP</span> for help at any time.
            </p>
            {(compliance.privacy.href || compliance.terms.href) && (
              <p className="flex flex-wrap gap-x-3">
                {compliance.privacy.href && (
                  <a
                    href={compliance.privacy.href}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Privacy Policy
                  </a>
                )}
                {compliance.terms.href && (
                  <a
                    href={compliance.terms.href}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Terms &amp; Conditions
                  </a>
                )}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Maintenance requests */}
      {settings.modules.maintenance && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Maintenance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <MaintenanceRequestForm leaseId={activeLease?.id ?? null} />
          </CardContent>
        </Card>
      )}

      {/* Their requests */}
      {requests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your requests</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {fmtDate(r.createdAt)}
                  </span>
                  <span className="capitalize">{r.type.replace(/_/g, " ")}</span>
                  {r.message && (
                    <span className="max-w-[24rem] truncate text-muted-foreground">
                      — {r.message}
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={
                      r.status === "done"
                        ? "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : r.status === "declined"
                          ? "text-muted-foreground"
                          : ""
                    }
                  >
                    {r.status.replace(/_/g, " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Charges & payments */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {ledger.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {ledger.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {fmtDate(e.effectiveDate)}
                    </span>
                    <span className="flex-1 capitalize">{entryLabel(e.entryType)}</span>
                    <span
                      className={`tabular-nums ${e.amountCents < 0n ? "text-emerald-600 dark:text-emerald-400" : ""}`}
                    >
                      {money(e.amountCents, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payments & receipts</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {payments.map((p) => {
                  const receipt = receipts.find((r) => r.paymentId === p.id);
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {fmtDate(p.paymentDate)}
                      </span>
                      <span className="flex-1 capitalize">
                        {p.method.replace(/_/g, " ")}
                        {p.status === "voided" && (
                          <span className="ml-1 text-xs text-red-600 dark:text-red-400">
                            (voided)
                          </span>
                        )}
                      </span>
                      {receipt ? (
                        <Link
                          href={`/portal/receipts/${receipt.id}`}
                          className="text-xs font-medium hover:underline"
                        >
                          {receipt.receiptNumber}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      <span className="tabular-nums">{money(p.amountCents, currency)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Documents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your documents</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No documents yet. Signed agreements appear here automatically.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                  <a
                    href={`/api/portal/files/${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium hover:underline"
                  >
                    {d.fileName ?? "Document"}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(d.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
