import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheckIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { listInspections } from "@/lib/services/inspections";
import { listActiveTemplatesWithItems } from "@/lib/services/inspection-templates";
import {
  INSPECTION_TYPES,
  inspectionStatusLabel,
  inspectionTypeLabel,
} from "@/lib/inspections/disposition";
import type { InspectionStatus } from "@/lib/generated/prisma/enums";
import { cancelInspectionAction, createInspectionAction } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
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

type ScheduleLease = {
  id: string;
  tenant: { firstName: string; lastName: string };
  unit: { unitNumber: string; property: { name: string } };
};

/**
 * The "Schedule inspection" dialog, shared by the page header and the empty
 * state so both offer the same primary action. `idSuffix` keeps field ids
 * unique when two instances render at once (header + empty state).
 */
function ScheduleInspectionDialog({
  activeLeases,
  templates,
  idSuffix = "header",
}: {
  activeLeases: ScheduleLease[];
  templates: Awaited<ReturnType<typeof listActiveTemplatesWithItems>>;
  idSuffix?: string;
}) {
  return (
    <FormDialog
      trigger="Schedule inspection"
      triggerVariant="default"
      title="Schedule inspection"
      action={createInspectionAction}
      submitLabel="Schedule"
    >
      <div className="space-y-2">
        <Label htmlFor={`iLease-${idSuffix}`}>Lease</Label>
        <select
          id={`iLease-${idSuffix}`}
          name="leaseId"
          required
          defaultValue=""
          className="h-9 w-full rounded-md border px-3 text-sm"
        >
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
        <Label htmlFor={`iType-${idSuffix}`}>Type</Label>
        <select
          id={`iType-${idSuffix}`}
          name="type"
          defaultValue="move_out"
          className="h-9 w-full rounded-md border px-3 text-sm"
        >
          {INSPECTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {inspectionTypeLabel(t)}
            </option>
          ))}
        </select>
      </div>
      {templates.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor={`iTemplate-${idSuffix}`}>Checklist template (optional)</Label>
          <select
            id={`iTemplate-${idSuffix}`}
            name="templateId"
            defaultValue=""
            className="h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">— no checklist —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.items.length} item{t.items.length === 1 ? "" : "s"})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Pre-populates the inspection&apos;s condition checklist. Manage
            templates in Settings → Inspection templates.
          </p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor={`iDate-${idSuffix}`}>Scheduled date (optional)</Label>
        <Input id={`iDate-${idSuffix}`} name="scheduledFor" type="date" />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`iInspector-${idSuffix}`}>Inspector (optional)</Label>
        <Input
          id={`iInspector-${idSuffix}`}
          name="inspector"
          placeholder="Name of the person inspecting"
        />
      </div>
    </FormDialog>
  );
}

export default async function InspectionsPage() {
  await requireCapability("inspections.manage");
  const settings = await getAppSettings();
  if (!settings.modules.inspections) redirect("/dashboard");

  const [inspections, activeLeases, templates] = await Promise.all([
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
    listActiveTemplatesWithItems(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inspections"
        description="Schedule and record property-condition inspections. Open a move-out inspection to itemize deposit deductions and compute the refund. Inspections never touch tenant ledger balances."
        actions={
          <ScheduleInspectionDialog activeLeases={activeLeases} templates={templates} />
        }
      />

      <DataTable
        emptyState={
          <EmptyState
            icon={<ClipboardCheckIcon />}
            title="No inspections yet"
            description="Schedule your first inspection to record property condition and itemize move-out deductions."
            action={
              <ScheduleInspectionDialog
                idSuffix="empty"
                activeLeases={activeLeases}
                templates={templates}
              />
            }
          />
        }
        columns={[
          { key: "scheduled", label: "Scheduled" },
          { key: "tenant", label: "Tenant / unit" },
          { key: "type", label: "Type" },
          { key: "status", label: "Status" },
          { key: "checklist", label: "Checklist", align: "right", className: "hidden sm:table-cell" },
          { key: "actions", label: "", align: "right", sortable: false },
        ]}
        rows={inspections.map((i) => ({
          key: i.id,
          sortValues: [
            i.scheduledFor ? i.scheduledFor.toISOString() : "",
            `${i.lease.tenant.lastName}, ${i.lease.tenant.firstName}`,
            inspectionTypeLabel(i.type),
            i.status,
            i._count.checklistItems,
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
            i._count.checklistItems,
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
