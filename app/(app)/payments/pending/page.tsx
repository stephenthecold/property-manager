import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/money";
import {
  confirmSelfReportedPaymentAction,
  rejectSelfReportedPaymentAction,
} from "../actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Pending self-reports" };

/**
 * Staff queue of tenant SELF-REPORTED payments awaiting confirmation. Each row
 * is a Payment with status="pending" and reportedAt set — and crucially NO
 * ledger entry yet, so it has NOT changed the tenant's balance. Confirming is
 * the only step that posts it to the ledger (FIFO allocation via the shared
 * posting path); rejecting discards it with no ledger touch. Both are audited
 * and idempotent.
 */
export default async function PendingPaymentsPage() {
  await requireCapability("payments.manage");

  const pending = await prisma.payment.findMany({
    where: { status: "pending", reportedAt: { not: null } },
    orderBy: { reportedAt: "asc" },
    take: 200,
    include: {
      lease: { include: { tenant: true, unit: { include: { property: true } } } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pending self-reports</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Payments tenants reported paying offline (Cash App, cash, bank
            transfer). These do <span className="font-medium text-foreground">not</span>{" "}
            affect a tenant&apos;s balance until you confirm them — confirming
            posts the payment to the ledger and applies it oldest-charge-first.
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/payments" />}>
          All payments
        </Button>
      </div>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No self-reported payments are waiting for confirmation.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.map((p) => {
            const currency = p.lease.unit.property.currency;
            const who = `${p.lease.tenant.firstName} ${p.lease.tenant.lastName}`;
            return (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <Link
                      href={`/tenants/${p.lease.tenantId}`}
                      className="hover:underline"
                    >
                      {who}
                    </Link>
                    <span className="tabular-nums">
                      {formatCurrency(p.amountCents, currency)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                    <span>
                      {p.lease.unit.property.name} · Unit {p.lease.unit.unitNumber}
                    </span>
                    <span className="capitalize">
                      Method: {p.method.replace(/_/g, " ")}
                    </span>
                    {p.referenceNumber && <span>Ref: {p.referenceNumber}</span>}
                    {p.reportedAt && (
                      <span>Reported {p.reportedAt.toLocaleDateString()}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={confirmSelfReportedPaymentAction}>
                      <input type="hidden" name="paymentId" value={p.id} />
                      <ConfirmSubmitButton
                        variant="default"
                        confirmMessage={`Confirm and POST this ${formatCurrency(p.amountCents, currency)} ${p.method.replace(/_/g, " ")} payment for ${who}? It will be applied to their open charges oldest-first.`}
                      >
                        Confirm & post
                      </ConfirmSubmitButton>
                    </form>
                    <form
                      action={rejectSelfReportedPaymentAction}
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="paymentId" value={p.id} />
                      <input
                        name="reason"
                        placeholder="Reason (optional)"
                        className="h-8 w-40 rounded border bg-card px-2 text-xs dark:bg-input/30"
                      />
                      <ConfirmSubmitButton
                        variant="outline"
                        confirmMessage={`Reject this self-reported ${formatCurrency(p.amountCents, currency)} payment for ${who}? Nothing is posted to the ledger.`}
                      >
                        Reject
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
