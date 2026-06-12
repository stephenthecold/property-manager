import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePortalSession } from "@/lib/portal/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { formatCurrency } from "@/lib/money";
import { PrintButton } from "@/components/app/print-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tenant-facing receipt — ownership-scoped twin of the staff receipt page:
 * findFirst on (id AND tenantId) means another tenant's receipt id is a 404,
 * indistinguishable from a nonexistent one.
 */
export default async function PortalReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenant } = await requirePortalSession();
  const { id } = await params;
  const [receipt, app] = await Promise.all([
    prisma.receipt.findFirst({ where: { id, tenantId: tenant.id } }),
    getAppSettings(),
  ]);
  if (!receipt) notFound();

  const [payment, property] = await Promise.all([
    receipt.paymentId
      ? prisma.payment.findUnique({ where: { id: receipt.paymentId } })
      : Promise.resolve(null),
    receipt.propertyId
      ? prisma.property.findUnique({
          where: { id: receipt.propertyId },
          select: { currency: true },
        })
      : Promise.resolve(null),
  ]);
  const voided = payment?.status === "voided";
  const currency = property?.currency ?? app.defaultCurrency;

  const detail = (label: string, value: string) => (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="print-hidden flex flex-wrap items-center gap-2">
        <PrintButton />
        <Button variant="ghost" render={<Link href="/portal" />}>
          Back to portal
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-6 py-6">
          {voided && (
            <div className="rounded-md border border-destructive bg-destructive/10 px-4 py-2 text-center text-lg font-bold tracking-widest text-destructive">
              VOIDED
            </div>
          )}
          <div className="space-y-1 text-center">
            <div className="text-lg font-semibold">{app.businessName}</div>
            {app.businessAddress && (
              <div className="whitespace-pre-line text-xs text-muted-foreground">
                {app.businessAddress}
              </div>
            )}
          </div>
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-wide">RENT RECEIPT</h1>
            <p className="text-sm text-muted-foreground">{receipt.receiptNumber}</p>
          </div>
          <div className="space-y-1 text-center">
            <div className="text-4xl font-bold tabular-nums">
              {formatCurrency(receipt.amountCents, currency)}
            </div>
            <div className="text-sm text-muted-foreground">Amount received</div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {detail(
              "Date paid",
              (receipt.paymentDate ?? payment?.paymentDate)?.toLocaleDateString() ?? "—",
            )}
            {detail(
              "Payment method",
              (receipt.paymentMethod ?? payment?.method ?? "—").replace(/_/g, " "),
            )}
            {payment?.referenceNumber
              ? detail("Reference number", payment.referenceNumber)
              : null}
            {detail(
              "Balance after payment",
              receipt.balanceAfterCents != null
                ? formatCurrency(receipt.balanceAfterCents, currency)
                : "—",
            )}
          </div>
          <div className="space-y-2 border-t pt-4 text-center text-xs text-muted-foreground">
            {app.receiptFooter && (
              <div className="whitespace-pre-line">{app.receiptFooter}</div>
            )}
            <div>
              Receipt {receipt.receiptNumber} — {app.businessName}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
