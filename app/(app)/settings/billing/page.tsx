import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { fromCents } from "@/lib/money";
import { saveBillingDefaultsAction, applyChargeTermsToActiveLeases } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

export default async function BillingSettingsPage() {
  await requireRole("finance");
  const { billing } = await getAppSettings();
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
          <form action={saveBillingDefaultsAction} className="max-w-lg space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="dueDay">Rent due day (1–31)</Label>
                <Input
                  id="dueDay"
                  name="dueDay"
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={billing.dueDay}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="graceDays">Grace period (days)</Label>
                <Input
                  id="graceDays"
                  name="graceDays"
                  type="number"
                  min={0}
                  max={60}
                  defaultValue={billing.graceDays}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="lateFeeType">Late fee type</Label>
                <select
                  id="lateFeeType"
                  name="lateFeeType"
                  defaultValue={billing.lateFeeType}
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                >
                  <option value="none">None</option>
                  <option value="fixed">Fixed</option>
                  <option value="percentage">Percentage</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lateFeeAmount">Fixed amount</Label>
                <Input
                  id="lateFeeAmount"
                  name="lateFeeAmount"
                  inputMode="decimal"
                  placeholder="50.00"
                  defaultValue={
                    billing.lateFeeAmountCents != null
                      ? fromCents(billing.lateFeeAmountCents)
                      : ""
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lateFeeBps">Percent (bps)</Label>
                <Input
                  id="lateFeeBps"
                  name="lateFeeBps"
                  type="number"
                  min={0}
                  max={10000}
                  placeholder="500 = 5%"
                  defaultValue={billing.lateFeeBps ?? ""}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="internetFee">Default internet fee (new units)</Label>
              <Input
                id="internetFee"
                name="internetFee"
                inputMode="decimal"
                defaultValue={fromCents(billing.internetFeeCents)}
                className="max-w-40"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              For a percentage late fee, the base is the full monthly charge
              (rent plus internet add-on). 500 bps = 5%.
            </p>
            <Button type="submit" size="sm">
              Save defaults
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Apply to existing leases</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={applyChargeTermsToActiveLeases}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <p className="max-w-xl text-sm text-muted-foreground">
              Overwrites the grace period and late-fee terms on all{" "}
              <span className="font-medium text-foreground">{activeLeases}</span>{" "}
              active lease{activeLeases === 1 ? "" : "s"} with the saved defaults
              above (audited per lease). The due day is never bulk-changed —
              adjust that per lease.
            </p>
            <ConfirmSubmitButton
              confirmMessage={`Overwrite grace + late-fee terms on ${activeLeases} active lease(s) with the saved defaults? This is audited per lease.`}
            >
              Apply to {activeLeases} lease{activeLeases === 1 ? "" : "s"}
            </ConfirmSubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
