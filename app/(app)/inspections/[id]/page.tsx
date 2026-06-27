import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import {
  getInspection,
  dispositionForInspection,
  getInspectionChecklist,
} from "@/lib/services/inspections";
import { inspectionStatusLabel, inspectionTypeLabel } from "@/lib/inspections/disposition";
import {
  conditionPhaseLabel,
  listConditionLogsForLease,
} from "@/lib/services/unit-condition";
import { formatCurrency } from "@/lib/money";
import {
  addDeductionAction,
  completeInspectionAction,
  removeDeductionAction,
} from "../actions";
import { InspectionChecklistCard } from "@/components/app/inspection-checklist-card";
import { BackLink } from "@/components/app/back-link";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const runtime = "nodejs";

export default async function InspectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability("inspections.manage");
  const settings = await getAppSettings();
  if (!settings.modules.inspections) redirect("/dashboard");

  const { id } = await params;
  const inspection = await getInspection(id);
  if (!inspection) notFound();

  const isMoveOut = inspection.type === "move_out";
  const disposition = isMoveOut
    ? await dispositionForInspection(inspection.id, inspection.lease.id)
    : null;

  const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-US") : "—");
  const [conditionLogs, checklist] = await Promise.all([
    listConditionLogsForLease(inspection.lease.id),
    getInspectionChecklist(inspection.id),
  ]);
  const unitId = inspection.lease.unit.id;
  const checklistEditable = inspection.status !== "canceled";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <BackLink href="/inspections" label="All inspections" />
          <h1 className="mt-1 text-2xl font-semibold">
            {inspectionTypeLabel(inspection.type)} inspection
          </h1>
          <p className="text-sm text-muted-foreground">
            <Link href={`/tenants/${inspection.lease.tenantId}`} className="hover:underline">
              {inspection.lease.tenant.firstName} {inspection.lease.tenant.lastName}
            </Link>{" "}
            ·{" "}
            <Link href={`/units/${unitId}`} className="hover:underline">
              {inspection.lease.unit.property.name} · {inspection.lease.unit.unitNumber}
            </Link>
          </p>
        </div>
        <Button variant="outline" render={<Link href={`/inspections/${inspection.id}/report`} />}>
          Printable report
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>Details</span>
            <span className="text-sm font-normal">
              {inspectionStatusLabel(inspection.status)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <div className="text-muted-foreground">Scheduled</div>
              <div>{fmtDate(inspection.scheduledFor)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Completed</div>
              <div>{fmtDate(inspection.completedAt)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Inspector</div>
              <div>{inspection.inspector || "—"}</div>
            </div>
          </div>
          {inspection.summary && (
            <div className="pt-2">
              <div className="text-muted-foreground">Summary</div>
              <div className="whitespace-pre-wrap">{inspection.summary}</div>
            </div>
          )}
          {inspection.status === "scheduled" && (
            <div className="pt-2">
              <FormDialog
                trigger="Mark completed"
                triggerVariant="default"
                title="Complete inspection"
                description="Record the outcome. You can still itemize deductions afterward."
                action={completeInspectionAction}
                submitLabel="Mark completed"
                wide
              >
                <input type="hidden" name="inspectionId" value={inspection.id} />
                <div className="space-y-2">
                  <Label htmlFor="summary">Summary / findings</Label>
                  <Textarea id="summary" name="summary" rows={6} />
                </div>
              </FormDialog>
            </div>
          )}
        </CardContent>
      </Card>

      {isMoveOut && disposition && (
        <Card>
          <CardHeader>
            <CardTitle>Deposit disposition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Deposit on file" value={formatCurrency(disposition.depositTotalCents)} />
              <Stat label="Non-refundable" value={formatCurrency(disposition.nonRefundableCents)} />
              <Stat label="Refundable" value={formatCurrency(disposition.refundableCents)} />
              <Stat label="Deductions" value={formatCurrency(disposition.deductionsCents)} />
            </div>

            <div className="rounded-md border p-3">
              {disposition.balanceOwedCents > 0n ? (
                <div className="text-base font-semibold text-red-600 dark:text-red-400">
                  Tenant owes {formatCurrency(disposition.balanceOwedCents)} beyond the deposit
                </div>
              ) : (
                <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
                  Refund to tenant: {formatCurrency(disposition.refundCents)}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Itemized deductions</h3>
                {inspection.status !== "canceled" && (
                  <FormDialog
                    trigger="Add deduction"
                    title="Add deduction"
                    action={addDeductionAction}
                    submitLabel="Add"
                  >
                    <input type="hidden" name="inspectionId" value={inspection.id} />
                    <div className="space-y-2">
                      <Label htmlFor="label">What for</Label>
                      <Input id="label" name="label" required placeholder="e.g. Carpet cleaning" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount</Label>
                      <Input id="amount" name="amount" inputMode="decimal" placeholder="0.00" required />
                    </div>
                  </FormDialog>
                )}
              </div>
              {inspection.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No deductions — the full refundable deposit is returned.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {inspection.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span>{item.label}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-medium">{formatCurrency(item.amountCents)}</span>
                        <form action={removeDeductionAction}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="inspectionId" value={inspection.id} />
                          <Button type="submit" variant="destructive" size="xs">
                            Remove
                          </Button>
                        </form>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <InspectionChecklistCard
        inspectionId={inspection.id}
        items={checklist}
        editable={checklistEditable}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Condition photos</CardTitle>
          <Link href={`/units/${unitId}`} className="text-sm font-medium hover:underline">
            Add / manage on unit
          </Link>
        </CardHeader>
        <CardContent>
          {conditionLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No condition photos for this tenancy yet — add them on the{" "}
              <Link href={`/units/${unitId}`} className="hover:underline">
                unit page
              </Link>
              .
            </p>
          ) : (
            <div className="space-y-4">
              {conditionLogs.map((log) => (
                <div key={log.id} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{conditionPhaseLabel(log.phase)}</span>
                    <span className="text-muted-foreground">
                      ·{" "}
                      {log.conditionDate.toLocaleDateString("en-US", {
                        timeZone: inspection.lease.unit.property.timezone,
                      })}
                    </span>
                  </div>
                  {log.note && (
                    <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {log.note}
                    </p>
                  )}
                  {log.photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {log.photos.map((p) =>
                        p.url ? (
                          <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, not optimizable */}
                            <img
                              src={p.url}
                              alt={p.fileName ?? "Condition photo"}
                              className="aspect-square w-full rounded-md border object-cover"
                            />
                          </a>
                        ) : (
                          <div
                            key={p.id}
                            className="flex aspect-square w-full items-center justify-center rounded-md border text-xs text-muted-foreground"
                          >
                            (unavailable)
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
