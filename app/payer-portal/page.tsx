import { requirePayerSession } from "@/lib/payer-portal/session";
import { getPayerPortalView } from "@/lib/services/payer-portal";
import { formatCurrency } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PayerPortalHome() {
  const { payer } = await requirePayerSession();
  const view = await getPayerPortalView(payer.id, new Date());

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="border-t-4 border-t-sky-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Expected monthly (your share)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatCurrency(view.totalExpectedCents)}
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Paid by you this month
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatCurrency(view.totalReceivedThisMonthCents)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leases you pay toward</CardTitle>
        </CardHeader>
        <CardContent>
          {view.leases.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leases are currently attributed to you. The property manager
              sets up the rent split for each subsidized lease.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Tenant</th>
                    <th className="py-2 pr-3 font-medium">Unit</th>
                    <th className="py-2 pr-3 text-right font-medium">Expected</th>
                    <th className="py-2 text-right font-medium">Paid this month</th>
                  </tr>
                </thead>
                <tbody>
                  {view.leases.map((l) => {
                    const short = l.receivedThisMonthCents < l.expectedCents;
                    return (
                      <tr key={l.leaseId} className="border-b last:border-0">
                        <td className="py-2 pr-3">{l.tenantName}</td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {l.propertyName} · {l.unitLabel}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatCurrency(l.expectedCents, l.currency)}
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${
                            short
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {formatCurrency(l.receivedThisMonthCents, l.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your recent payments</CardTitle>
        </CardHeader>
        <CardContent>
          {view.recentPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Tenant</th>
                    <th className="py-2 pr-3 font-medium">Reference</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {view.recentPayments.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        {p.date.toLocaleDateString("en-US")}
                      </td>
                      <td className="py-2 pr-3">
                        {p.tenantName}{" "}
                        <span className="text-muted-foreground">· {p.unitLabel}</span>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {p.reference ?? "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatCurrency(p.amountCents, p.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            This is a read-only view of what {payer.name} is expected to pay and
            has paid. Questions about a specific lease? Contact the property
            manager.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
