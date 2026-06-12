import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { buildAgreementVars } from "@/lib/services/lease-agreement";
import {
  getDocumentDownloadUrl,
  listDocuments,
} from "@/lib/services/documents";
import { renderTemplate } from "@/lib/reminders/templates";
import { DEFAULT_LEASE_AGREEMENT_TEXT } from "@/lib/config/lease-agreement";
import { PrintButton } from "@/components/app/print-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GenerateDocxForm } from "./generate-docx-form";

export const runtime = "nodejs";

function detail(label: string, value: string) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function termRow(label: string, value: string) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function SignatureBlock({ role, name }: { role: string; name: string }) {
  return (
    <div className="grid grid-cols-[3fr_2fr_1.2fr] items-end gap-x-8 gap-y-1">
      <div>
        <div className="h-7 border-b" />
        <div className="mt-1 text-xs text-muted-foreground">{role} signature</div>
      </div>
      <div>
        <div className="flex h-7 items-end border-b text-sm">{name}</div>
        <div className="mt-1 text-xs text-muted-foreground">Printed name</div>
      </div>
      <div>
        <div className="h-7 border-b" />
        <div className="mt-1 text-xs text-muted-foreground">Date</div>
      </div>
    </div>
  );
}

export default async function LeaseAgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability("leases.manage");
  const { id } = await params;

  const [ctx, templates] = await Promise.all([
    buildAgreementVars(id),
    listDocuments({ uploadType: "lease_template" }),
  ]);
  if (!ctx) notFound();
  const { vars, lease, app } = ctx;

  let logoUrl: string | null = null;
  if (app.logoDocumentId) {
    try {
      logoUrl = (await getDocumentDownloadUrl(app.logoDocumentId))?.url ?? null;
    } catch {
      logoUrl = null; // storage unavailable — render the agreement anyway
    }
  }
  const businessContact = [app.businessPhone, app.businessEmail]
    .filter(Boolean)
    .join(" · ");

  const clauseText = renderTemplate(
    app.leaseAgreementText ?? DEFAULT_LEASE_AGREEMENT_TEXT,
    vars,
  );

  const coTenantNames = lease.coTenants.map(
    (ct) => `${ct.tenant.firstName} ${ct.tenant.lastName}`.trim(),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="print-hidden flex flex-wrap items-center gap-2">
        <PrintButton />
        <Button variant="ghost" render={<Link href="/leases" />}>
          Back to leases
        </Button>
        <GenerateDocxForm leaseId={lease.id} hasTemplate={templates.length > 0} />
      </div>

      <Card>
        <CardContent className="space-y-8 py-8">
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

          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-wide">
              RESIDENTIAL LEASE AGREEMENT
            </h1>
            <p className="text-sm text-muted-foreground">Prepared {vars.today}</p>
          </div>

          {/* Parties + property */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            {detail("Landlord", vars.business_legal_name)}
            {detail("Tenant(s)", vars.tenant_names)}
            {detail("Property", vars.property_name)}
            {detail("Unit", vars.unit)}
            {detail("Address", vars.property_address || "—")}
            {detail("Co-tenants", vars.co_tenants)}
          </div>

          {/* Key terms */}
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Key terms
            </h2>
            <dl>
              {termRow("Monthly rent", vars.rent)}
              {termRow("Rent due", `${vars.due_day} of each month`)}
              {termRow("Grace period", `${vars.grace_days} day(s)`)}
              {termRow("Late fee", vars.late_fee_terms)}
              {termRow("Security deposit", vars.security_deposit)}
              {termRow("Additional deposits", vars.additional_deposits)}
              {termRow("Internet", vars.internet)}
              {termRow("Lease start", vars.start_date)}
              {termRow("Lease end", vars.end_date)}
            </dl>
          </div>

          {/* Clause text (settings override or shipped default) */}
          <div className="whitespace-pre-line text-sm leading-6">{clauseText}</div>

          {/* Utility responsibilities */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Utility responsibilities
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {detail("Paid by landlord", vars.utilities_landlord)}
              {detail("Paid by tenant", vars.utilities_tenant)}
            </div>
            {vars.utilities_notes && (
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {vars.utilities_notes}
              </p>
            )}
          </div>

          {/* Signatures */}
          <div className="space-y-8 border-t pt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Signatures
            </h2>
            <SignatureBlock role="Landlord" name={vars.business_legal_name} />
            <SignatureBlock role="Tenant" name={vars.primary_tenant} />
            {coTenantNames.map((name) => (
              <SignatureBlock key={name} role="Co-tenant" name={name} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
