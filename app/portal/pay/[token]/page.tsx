import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/config/env";
import { formatCurrency } from "@/lib/money";
import { requirePortalSession } from "@/lib/portal/session";
import { verifyCheckoutToken } from "@/lib/providers/payment/checkout-token";
import { completePortalCheckoutAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stub gateway's dev-simulated hosted checkout. Verifies the signed token AND
 * that the signed-in tenant is on the named lease before showing a "complete
 * payment" button. NO real charge — completing records a payment through the
 * existing webhook→ledger service. A real provider would host this step itself.
 */
export default async function PortalPayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { tenant } = await requirePortalSession();
  const { token } = await params;

  const secret = getEnv().PAYMENT_WEBHOOK_SECRET ?? null;
  const claims = secret ? verifyCheckoutToken(token, secret) : null;

  // Scope: the token's lease must belong to the signed-in tenant.
  const lease = claims
    ? await prisma.lease.findFirst({
        where: {
          id: claims.leaseId,
          OR: [
            { tenantId: tenant.id },
            { coTenants: { some: { tenantId: tenant.id } } },
          ],
        },
        include: { unit: { include: { property: { select: { currency: true } } } } },
      })
    : null;

  if (!claims || !lease) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="py-10 text-center">
            <div className="text-lg font-semibold">This payment link is invalid.</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Start a new payment from your portal home.
            </p>
            <Button className="mt-4" render={<Link href="/portal" />}>
              Back to portal
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const amountCents = BigInt(claims.amountCents);
  if (amountCents <= 0n) redirect("/portal?payerror=amount");
  const currency = lease.unit.property.currency;

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Confirm your payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You&apos;re paying for unit {lease.unit.unitNumber}.
          </p>
          <div className="rounded-md border bg-card p-4 text-center">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Amount
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatCurrency(amountCents, currency)}
            </div>
          </div>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            Demo checkout — no real charge is made. This simulates the payment
            provider so the flow can be tested end to end.
          </div>
          <form action={completePortalCheckoutAction} className="space-y-2">
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="w-full">
              Complete payment
            </Button>
          </form>
          <p className="text-center text-xs">
            <Link href="/portal" className="text-muted-foreground hover:underline">
              Cancel
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
