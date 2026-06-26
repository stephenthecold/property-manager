import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { listInspections } from "@/lib/services/inspections";
import {
  INSPECTION_TYPES,
  inspectionStatusLabel,
  inspectionTypeLabel,
} from "@/lib/inspections/disposition";
import type { InspectionStatus } from "@/lib/generated/prisma/enums";
import { cancelInspectionAction, createInspectionAction } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const runtime = "nodejs";

function statusClass(s: InspectionStatus): string {
  if (s === "completed") return "text-emerald-600 dark:text-emerald-400";
  if (s === "canceled") return "text-muted-foreground line-through";
  return "text-amber-600 dark:text-amber-400";
}

export default async function InspectionsPage() {
  await requireCapability("inspections.manage");
  const settings = await getAppSettings();
  if (!settings.modules.inspections) redirect("/dashboard");

  const [inspections, activeLeases] = await Promise.all([
    listInspections(),
    prisma.lease.findMany({
      where: { status: { in: ["active", "month_to_month", "ended", "eviction"] } },
      orderBy: [
        { unit: { property: { name: "asc" } } },
        { unit: { unitNumber: "asc" } },
      ],
      select: {
        id: true,
        tenant: { select: { firstName: true, lastName: true } },
        unit: { select: { unitNumber: true, property: { select: { name: true } } } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inspections</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Schedule and record property-condition inspections. Open a move-out
            inspection to itemize deposit deductions and compute the refund.
            Inspections never touch tenant ledger balances.
          </p>
        </div>
        <FormDialog
          trigger="Schedule inspection"
          triggerVariant="default"
          title="Schedule inspection"
          action={createInspectionAction}
          submitLabel="Schedule"
        >
          <div className="space-y-2">
            <Label htmlFor="iLease">Lease</Label>
            <select id="iLease" name="leaseId" required defaultValue="" className="h-9 w-full rounded-md border px-3 text-sm">
              <option value="" disabled>
                Select a lease…
              </option>
              {activeLeases.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.unit.property.name} · {l.unit.unitNumber} — {l.tenant.lastName}, {l.tenant.firstName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="iType">Type</Label>
            <select id="iType" name="type" defaultValue="move_out" className="h-9 w-full rounded-md border px-3 text-sm">
              {INSPECTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {inspectionTypeLabel(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="iDate">Scheduled date (optional)</Label>
            <Input id="iDate" name="scheduledFor" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="iInspector">Inspector (optional)</Label>
            <Input id="iInspector" name="inspector" placeholder="Name of the person inspecting" />
          </div>
        </FormDialog>
      </div>

      <DataTable
        emptyMessage="No inspections yet."
        columns={[
          { key: "scheduled", label: "Scheduled" },
          { key: "tenant", label: "Tenant / unit" },
          { key: "type", label: "Type" },
          { key: "status", label: "Status" },
          { key: "deductions", label: "Deductions", align: "right", className: "hidden sm:table-cell" },
          { key: "actions", label: "", align: "right", sortable: false },
        ]}
        rows={inspections.map((i) => ({
          key: i.id,
          sortValues: [
            i.scheduledFor ? i.scheduledFor.toISOString() : "",
            `${i.lease.tenant.lastName}, ${i.lease.tenant.firstName}`,
            inspectionTypeLabel(i.type),
            i.status,
            i._count.items,
            null,
          ],
          cells: [
            i.scheduledFor ? i.scheduledFor.toLocaleDateString("en-US") : "—",
            <div key="t">
              <Link href={`/tenants/${i.lease.tenantId}`} className="font-medium hover:underline">
                {i.lease.tenant.firstName} {i.lease.tenant.lastName}
              </Link>
              <Link
                href={`/units/${i.lease.unit.id}`}
                className="block text-xs text-muted-foreground hover:underline"
              >
                {i.lease.unit.property.name} · {i.lease.unit.unitNumber}
              </Link>
            </div>,
            inspectionTypeLabel(i.type),
            <span key="s" className={statusClass(i.status)}>
              {inspectionStatusLabel(i.status)}
            </span>,
            i.type === "move_out" ? i._count.items : "—",
            <div key="a" className="flex justify-end gap-2">
              <Button variant="outline" size="xs" render={<Link href={`/inspections/${i.id}`} />}>
                Open
              </Button>
              {i.status !== "canceled" && (
                <form action={cancelInspectionAction}>
                  <input type="hidden" name="inspectionId" value={i.id} />
                  <ConfirmSubmitButton
                    variant="outline"
                    size="xs"
                    confirmMessage="Cancel this inspection? It will be kept but marked canceled."
                  >
                    Cancel
                  </ConfirmSubmitButton>
                </form>
              )}
            </div>,
          ],
        }))}
      />
    </div>
  );
}
