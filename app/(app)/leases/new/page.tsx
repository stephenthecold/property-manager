import { createLease } from "../actions";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
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

  const [tenants, units] = await Promise.all([
    prisma.tenant.findMany({
      where: { isActive: true },
      orderBy: [{ lastName: "asc" }],
    }),
    prisma.unit.findMany({
      where: { leases: { none: { status: { in: ["active", "month_to_month"] } } } },
      include: { property: true, building: true },
      orderBy: { unitNumber: "asc" },
    }),
  ]);

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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="rentAmount">Monthly rent</Label>
                <Input id="rentAmount" name="rentAmount" inputMode="decimal" placeholder="1200.00" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dueDay">Due day (1–31)</Label>
                <Input id="dueDay" name="dueDay" type="number" min={1} max={31} defaultValue={1} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start date</Label>
                <Input id="startDate" name="startDate" type="date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gracePeriodDays">Grace period (days)</Label>
                <Input id="gracePeriodDays" name="gracePeriodDays" type="number" min={0} defaultValue={5} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="lateFeeType">Late fee type</Label>
                <select
                  id="lateFeeType"
                  name="lateFeeType"
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  defaultValue="none"
                >
                  <option value="none">None</option>
                  <option value="fixed">Fixed</option>
                  <option value="percentage">Percentage</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lateFeeAmount">Late fee (fixed $ or % bps)</Label>
                <Input id="lateFeeAmount" name="lateFeeAmount" placeholder="50.00" />
                <input type="hidden" name="lateFeeBps" id="lateFeeBps" />
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
