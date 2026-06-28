import { notFound, redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import {
  getInspection,
  getInspectionChecklist,
  dispositionForInspection,
} from "@/lib/services/inspections";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import { inspectionStatusLabel, inspectionTypeLabel } from "@/lib/inspections/disposition";
import {
  checklistStatusClass,
  checklistStatusLabel,
  sumChecklistDeductions,
  tallyChecklist,
} from "@/lib/inspections/checklist";
import { formatCurrency } from "@/lib/money";
import { PrintButton } from "@/components/app/print-button";
import { BackLink } from "@/components/app/back-link";
import { Card, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";
export const metadata = { title: "Inspection report" };

export default async function InspectionReportPage({
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

  const app = settings;
  const checklist = await getInspectionChecklist(inspection.id);
  const disposition =
    inspection.type === "move_out"
      ? await dispositionForInspection(inspection.lease.id, sumChecklistDeductions(checklist))
      : null;
  const tally = tallyChecklist(checklist);

  const property = inspection.lease.unit.property;
  const tz = property.timezone;
  const fmtDate = (d: Date | null) =>
    d ? d.toLocaleDateString("en-US", { timeZone: tz, dateStyle: "long" }) : "—";

  let logoUrl: string | null = null;
  if (app.logoDocumentId) {
    try {
      logoUrl = (await getDocumentDownloadUrl(app.logoDocumentId))?.url ?? null;
    } catch {
      logoUrl = null; // storage unavailable — render the report anyway
    }
  }
  const businessContact = [app.businessPhone, app.businessEmail]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="print-hidden flex flex-wrap items-center gap-2">
        <PrintButton />
        <BackLink href={`/inspections/${inspection.id}`} label="Back to inspection" />
      </div>

      <Card>
        <CardContent className="space-y-6 py-6">
          {/* Branded header */}
          <div className="space-y-1 text-center">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL
              <img
                src={logoUrl}
                alt={app.businessName}
                className="mx-auto mb-2 max-h-14 object-contain"
              />
            )}
            <div className="text-lg font-semibold">{app.businessName}</div>
            {app.businessAddress && (
              <div className="whitespace-pre-line text-xs text-muted-foreground">
                {app.businessAddress}
              </div>
            )}
            {businessContact && (
              <div className="text-xs text-muted-foreground">{businessContact}</div>
            )}
          </div>

          {/* Title + property · unit */}
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-wide">
              {inspectionTypeLabel(inspection.type).toUpperCase()} INSPECTION
            </h1>
            <div className="text-sm font-medium">
              {property.name} · Unit {inspection.lease.unit.unitNumber}
            </div>
            <div className="text-xs text-muted-foreground">
              {inspection.lease.tenant.firstName} {inspection.lease.tenant.lastName} ·{" "}
              {inspectionStatusLabel(inspection.status)}
            </div>
          </div>

          {/* Detail grid */}
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Detail label="Scheduled" value={fmtDate(inspection.scheduledFor)} />
            <Detail label="Completed" value={fmtDate(inspection.completedAt)} />
            <Detail label="Inspector" value={inspection.inspector || "—"} />
            <Detail label="Template" value={inspection.template?.name ?? "—"} />
          </div>

          {inspection.summary && (
            <div>
              <SectionHeading>Summary</SectionHeading>
              <p className="text-sm whitespace-pre-wrap">{inspection.summary}</p>
            </div>
          )}

          {/* Checklist */}
          <div>
            <SectionHeading>
              Condition checklist
              {tally.total > 0 && (
                <span className="ml-2 text-xs font-normal normal-case text-muted-foreground">
                  {tally.pass} pass · {tally.fail} fail · {tally.na} N/A
                  {tally.pending > 0 ? ` · ${tally.pending} pending` : ""}
                </span>
              )}
            </SectionHeading>
            {checklist.length === 0 ? (
              <p className="text-sm text-muted-foreground">No checklist items recorded.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {checklist.map((item) => (
                  <li key={item.id} className="space-y-2 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${checklistStatusClass(item.status)}`}
                      >
                        {checklistStatusLabel(item.status)}
                      </span>
                      <span className="font-medium">{item.label}</span>
                      {(item.area || item.category) && (
                        <span className="text-xs text-muted-foreground">
                          ({[item.area, item.category].filter(Boolean).join(" · ")})
                        </span>
                      )}
                    </div>
                    {item.note && (
                      <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                        {item.note}
                      </p>
                    )}
                    {item.photos.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {item.photos.map((p) =>
                          p.url ? (
                            // eslint-disable-next-line @next/next/no-img-element -- signed URL, not optimizable
                            <img
                              key={p.id}
                              src={p.url}
                              alt={p.fileName ?? "Inspection photo"}
                              className="aspect-square w-full rounded-md border object-cover"
                            />
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
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Move-out deposit disposition summary */}
          {disposition && (
            <div>
              <SectionHeading>Deposit disposition</SectionHeading>
              <dl className="text-sm">
                <TermRow label="Deposit on file" value={formatCurrency(disposition.depositTotalCents, property.currency)} />
                <TermRow label="Non-refundable" value={formatCurrency(disposition.nonRefundableCents, property.currency)} />
                <TermRow label="Refundable" value={formatCurrency(disposition.refundableCents, property.currency)} />
                <TermRow label="Deductions" value={formatCurrency(disposition.deductionsCents, property.currency)} />
                {disposition.balanceOwedCents > 0n ? (
                  <TermRow
                    label="Balance owed by tenant"
                    value={formatCurrency(disposition.balanceOwedCents, property.currency)}
                  />
                ) : (
                  <TermRow
                    label="Refund to tenant"
                    value={formatCurrency(disposition.refundCents, property.currency)}
                  />
                )}
              </dl>
              {checklist.some((it) => it.amountCents > 0n) && (
                <ul className="mt-2 divide-y rounded-md border text-sm">
                  {checklist
                    .filter((it) => it.amountCents > 0n)
                    .map((it) => (
                      <li key={it.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span>{it.label}</span>
                        <span className="font-medium tabular-nums">
                          {formatCurrency(it.amountCents, property.currency)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          <div className="border-t pt-4 text-center text-xs text-muted-foreground">
            Inspection report · prepared {fmtDate(new Date())} for {app.businessName}
            {app.businessLegalName ? ` (${app.businessLegalName})` : ""}.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

function TermRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}
