import { createLease } from "../actions";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/services/app-settings";
import { fromCents } from "@/lib/money";
import { UTILITY_OPTIONS } from "@/lib/config/lease";
import { LeaseInternetFields } from "@/components/app/lease-internet-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

export default async function NewLeasePage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  await requireRole("manager");
  const { tenantId } = await searchParams;

  const [tenants, units, { billing }] = await Promise.all([
    prisma.tenant.findMany({
      where: { isActive: true },
      orderBy: [{ lastName: "asc" }],
    }),
    prisma.unit.findMany({
      where: { leases: { none: { status: { in: ["active", "month_to_month"] } } } },
      include: { property: true, building: true },
      orderBy: { unitNumber: "asc" },
    }),
    getAppSettings(),
  ]);
  const defaultLateFeeValue =
    (billing.lateFeeType === "fixed" || billing.lateFeeType === "daily") &&
    billing.lateFeeAmountCents != null
      ? fromCents(billing.lateFeeAmountCents)
      : billing.lateFeeType === "percentage" && billing.lateFeeBps != null
        ? String(billing.lateFeeBps)
        : "";
  const defaultLateFeeMax =
    billing.lateFeeMaxCents != null ? fromCents(billing.lateFeeMaxCents) : "";

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Create lease</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createLease} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenantId">Tenant</Label>
              <select
                id="tenantId"
                name="tenantId"
                defaultValue={tenantId ?? ""}
                required
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="" disabled>
                  Select tenant…
                </option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.lastName}, {t.firstName}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="unitId">Unit (vacant)</Label>
              <select
                id="unitId"
                name="unitId"
                required
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="" disabled selected>
                  Select unit…
                </option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.property.name} · {u.building?.name ?? "—"} · {u.unitNumber}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="coTenants">Co-tenants (optional, hold Ctrl/Cmd to multi-select)</Label>
              <select
                id="coTenants"
                name="coTenants"
                multiple
                size={3}
                className="w-full rounded-md border bg-transparent px-3 py-1 text-sm"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.lastName}, {t.firstName}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="rentAmount">Monthly rent</Label>
                <Input id="rentAmount" name="rentAmount" inputMode="decimal" placeholder="1200.00" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dueDay">Due day (1–31)</Label>
                <Input id="dueDay" name="dueDay" type="number" min={1} max={31} defaultValue={billing.dueDay} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start date</Label>
                <Input id="startDate" name="startDate" type="date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End date (optional)</Label>
                <Input id="endDate" name="endDate" type="date" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="gracePeriodDays">Grace period (days)</Label>
                <Input id="gracePeriodDays" name="gracePeriodDays" type="number" min={0} defaultValue={billing.graceDays} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lateFeeType">Late fee type</Label>
                <select
                  id="lateFeeType"
                  name="lateFeeType"
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  defaultValue={billing.lateFeeType}
                >
                  <option value="none">None</option>
                  <option value="fixed">Fixed (one-time)</option>
                  <option value="percentage">Percentage (one-time)</option>
                  <option value="daily">Per day past grace</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="lateFeeAmount">Late fee ($ fixed / $ per day / % bps)</Label>
                <Input
                  id="lateFeeAmount"
                  name="lateFeeAmount"
                  placeholder="50.00"
                  defaultValue={defaultLateFeeValue}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lateFeeMax">Daily cap per period (optional)</Label>
                <Input
                  id="lateFeeMax"
                  name="lateFeeMax"
                  inputMode="decimal"
                  placeholder="100.00"
                  defaultValue={defaultLateFeeMax}
                />
              </div>
            </div>

            <LeaseInternetFields
              unitDefaults={Object.fromEntries(
                units.map((u) => [
                  u.id,
                  { enabled: u.internetEnabled, fee: fromCents(u.internetFeeCents) },
                ]),
              )}
              fallbackFee={fromCents(billing.internetFeeCents)}
            />

            <div className="rounded-md border p-3 space-y-2">
              <p className="text-sm font-medium">Utilities we pay (informational)</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm capitalize">
                {UTILITY_OPTIONS.map((u) => (
                  <label key={u} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="utilities"
                      value={u}
                      className="size-4 accent-primary"
                    />
                    {u}
                  </label>
                ))}
              </div>
              <Input name="utilitiesNotes" placeholder="Utility notes (optional)" />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="prorateFirstPeriod"
                name="prorateFirstPeriod"
                type="checkbox"
                defaultChecked
                className="size-4 accent-primary"
              />
              <Label htmlFor="prorateFirstPeriod">
                Prorate the move-in month (mid-month start bills only the days occupied)
              </Label>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Backdated lease? Billing &amp; opening balance</p>
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="billingStart"
                    value="start"
                    defaultChecked
                    className="accent-primary"
                  />
                  Bill every period since the start date (full history)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="billingStart"
                    value="current"
                    className="accent-primary"
                  />
                  Start billing at the next due date (importing an existing tenancy)
                </label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="openingBalance">Opening balance still owed (optional)</Label>
                <Input
                  id="openingBalance"
                  name="openingBalance"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="max-w-40"
                />
                <p className="text-xs text-muted-foreground">
                  Only with &ldquo;next due date&rdquo; billing: posted as an
                  opening-balance adjustment that payments pay off oldest-first.
                  Include any rent already due this period; leave empty if the
                  tenant is caught up.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="securityDeposit">Security deposit</Label>
                <Input id="securityDeposit" name="securityDeposit" inputMode="decimal" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  name="status"
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  defaultValue="active"
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="month_to_month">Month-to-month</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              For a percentage late fee, enter basis points in the late-fee field (e.g. 500 = 5%)
              and set type to Percentage.
            </p>

            <Button type="submit">Create lease</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
