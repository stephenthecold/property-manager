import { requireCapability } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/services/app-settings";
import { fromCents } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeaseForm } from "./lease-form";

export const runtime = "nodejs";

export default async function NewLeasePage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  await requireCapability("leases.manage");
  const { tenantId } = await searchParams;

  const [tenants, units, { billing }, occupiedPrimary, occupiedCo] =
    await Promise.all([
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
      prisma.lease.findMany({
        where: { status: { in: ["active", "month_to_month"] } },
        select: { tenantId: true },
      }),
      prisma.leaseTenant.findMany({
        where: { lease: { status: { in: ["active", "month_to_month"] } } },
        select: { tenantId: true },
      }),
    ]);

  // Tenants already on an active/month-to-month lease (as primary OR
  // co-tenant) can't be put on a second one — hide them from both pickers.
  const occupied = new Set(
    [...occupiedPrimary, ...occupiedCo].map((r) => r.tenantId),
  );
  const tenantOptions = tenants
    .filter((t) => !occupied.has(t.id))
    .map((t) => ({ id: t.id, label: `${t.lastName}, ${t.firstName}` }));
  const unitOptions = units.map((u) => ({
    id: u.id,
    label: `${u.property.name} · ${u.building?.name ?? "—"} · ${u.unitNumber}`,
  }));
  const unitInternetDefaults = Object.fromEntries(
    units.map((u) => [
      u.id,
      { enabled: u.internetEnabled, fee: fromCents(u.internetFeeCents) },
    ]),
  );

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
          <LeaseForm
            tenants={tenantOptions}
            units={unitOptions}
            unitInternetDefaults={unitInternetDefaults}
            defaults={{
              dueDay: billing.dueDay,
              graceDays: billing.graceDays,
              lateFeeType: billing.lateFeeType,
              lateFeeValue: defaultLateFeeValue,
              lateFeeMax: defaultLateFeeMax,
              internetFallbackFee: fromCents(billing.internetFeeCents),
            }}
            preselectTenantId={tenantId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
