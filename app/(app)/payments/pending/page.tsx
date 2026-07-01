import Link from "next/link";
import { InboxIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/money";
import { getAppSettings } from "@/lib/services/app-settings";
import { formatDate } from "@/lib/ui/datetime";
import {
  confirmSelfReportedPaymentAction,
  rejectSelfReportedPaymentAction,
} from "../actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
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
  const { defaultTimezone: tz } = await getAppSettings();

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
      <PageHeader
        back={{ href: "/payments", label: "Payments" }}
        title="Pending self-reports"
        description={
          <>
            Payments tenants reported paying offline (Cash App, cash, bank
            transfer). These do{" "}
            <span className="font-medium text-foreground">not</span>{" "}
            affect a tenant&apos;s balance until you confirm them — confirming
            posts the payment to the ledger and applies it oldest-charge-first.
          </>
        }
      />

      {pending.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={<InboxIcon />}
            title="No pending self-reports"
            description="When a tenant reports paying offline, it appears here to confirm and post to the ledger."
          />
        </div>
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
                      <span>Reported {formatDate(p.reportedAt, tz)}</span>
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
