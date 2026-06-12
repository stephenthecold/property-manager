import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { fromCents } from "@/lib/money";
import { ApplyTermsForm, BillingDefaultsForm, PaymentMethodsForm } from "./billing-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

export default async function BillingSettingsPage() {
  await requireCapability("billing.settings");
  const { billing, cashAppCashtag } = await getAppSettings();
  const activeLeases = await prisma.lease.count({
    where: { status: { in: ["active", "month_to_month"] } },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Charge defaults (rates)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Prefills for new leases and units. Saving here never changes existing
            leases — use the bulk action below for that.
          </p>
          <BillingDefaultsForm
            initial={{
              dueDay: billing.dueDay,
              graceDays: billing.graceDays,
              lateFeeType: billing.lateFeeType,
              lateFeeAmount:
                billing.lateFeeAmountCents != null
                  ? fromCents(billing.lateFeeAmountCents)
                  : "",
              lateFeeBps: billing.lateFeeBps,
              lateFeeMax:
                billing.lateFeeMaxCents != null
                  ? fromCents(billing.lateFeeMaxCents)
                  : "",
              internetFee: fromCents(billing.internetFeeCents),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Apply to existing leases</CardTitle>
        </CardHeader>
        <CardContent>
          <ApplyTermsForm activeLeases={activeLeases} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How tenants pay</CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentMethodsForm initialCashtag={cashAppCashtag ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
