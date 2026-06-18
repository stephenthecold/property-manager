import Link from "next/link";
import { notFound } from "next/navigation";
import { getDisplayRole, requireCapability } from "@/lib/auth/session";
import { hasCapability } from "@/lib/auth/permissions";
import {
  buildAgreementVars,
  resolveLandlordSignature,
} from "@/lib/services/lease-agreement";
import {
  getDocumentDownloadUrl,
  listDocuments,
} from "@/lib/services/documents";
import {
  getLeaseSigningOverview,
  signingKindLabel,
} from "@/lib/services/esign";
import { renderTemplate } from "@/lib/reminders/templates";
import {
  documentHasInlineSignatures,
  markerPassthroughVars,
} from "@/lib/esign/markers";
import { AgreementText, SIGNATURE_FONT } from "@/components/app/agreement-text";
import { DEFAULT_LEASE_AGREEMENT_TEXT } from "@/lib/config/lease-agreement";
import { PrintButton } from "@/components/app/print-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GenerateDocxForm } from "./generate-docx-form";
import {
  cancelEsignRequestAction,
  resendEsignLinkAction,
  sendEsignRequestAction,
} from "./actions";

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

function SignatureBlock({
  role,
  name,
  signature,
}: {
  role: string;
  name: string;
  /** When present, the saved signature is stamped on the line and the date filled. */
  signature?: { name: string; imageDataUrl?: string; date: string };
}) {
  return (
    <div className="grid grid-cols-[3fr_2fr_1.2fr] items-end gap-x-8 gap-y-1">
      <div>
        <div className="flex h-7 items-end overflow-hidden border-b">
          {signature ? (
            signature.imageDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- inline data URL
              <img
                src={signature.imageDataUrl}
                alt={`${signature.name} signature`}
                className="max-h-7 object-contain object-left"
              />
            ) : (
              <span
                className="text-2xl leading-none italic"
                style={{ fontFamily: SIGNATURE_FONT }}
              >
                {signature.name}
              </span>
            )
          ) : null}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{role} signature</div>
      </div>
      <div>
        <div className="flex h-7 items-end border-b text-sm">{name}</div>
        <div className="mt-1 text-xs text-muted-foreground">Printed name</div>
      </div>
      <div>
        <div className="flex h-7 items-end border-b text-sm">{signature?.date ?? ""}</div>
        <div className="mt-1 text-xs text-muted-foreground">Date</div>
      </div>
    </div>
  );
}

export default async function LeaseAgreementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("leases.manage");
  const { id } = await params;
  const sp = await searchParams;
  const first = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const esignError = first("esign_error");
  const esignMessage = first("esign_message");

  const [ctx, templates] = await Promise.all([
    buildAgreementVars(id),
    listDocuments({ uploadType: "lease_template" }),
  ]);
  if (!ctx) notFound();
  const { vars, lease, app } = ctx;

  // The printable page needs leases.manage; the e-sign panel additionally
  // needs esign.manage (manager+ by default) — hidden, not blocking.
  const { actingRole } = await getDisplayRole();
  const canEsign = hasCapability(actingRole, "esign.manage", app.rolePermissions);
  const esign = canEsign ? await getLeaseSigningOverview(lease.id) : null;
  let signedDocUrl: string | null = null;
  if (esign?.completed?.signedDocumentId) {
    try {
      signedDocUrl =
        (await getDocumentDownloadUrl(esign.completed.signedDocumentId))?.url ??
        null;
    } catch {
      signedDocUrl = null; // storage unavailable — the panel still renders
    }
  }
  const tz = lease.unit.property.timezone;
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: tz,
    });
  const fmtDateTime = (d: Date) =>
    d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });

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

  // Signature/initial markers survive substitution and render as ruled
  // wet-signature lines below; the e-sign flow stamps real marks instead.
  const clauseText = renderTemplate(app.leaseAgreementText ?? DEFAULT_LEASE_AGREEMENT_TEXT, {
    ...markerPassthroughVars(),
    ...vars,
  });
  const inlineSignatures = documentHasInlineSignatures(clauseText);

  const coTenantNames = lease.coTenants.map(
    (ct) => `${ct.tenant.firstName} ${ct.tenant.lastName}`.trim(),
  );

  // The saved landlord signature (Settings → Leases) is pre-applied to the
  // printable agreement, mirroring how e-sign auto-applies it. Best-effort:
  // a storage outage degrades a drawn signature to the typed name.
  const savedSignature = await resolveLandlordSignature(app);
  const landlordSignature = savedSignature
    ? { ...savedSignature, date: vars.today }
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="print-hidden flex flex-wrap items-center gap-2">
        <PrintButton />
        <Button
          variant="ghost"
          render={<Link href={`/leases/${lease.id}/abstract`} />}
        >
          Lease abstract
        </Button>
        <Button variant="ghost" render={<Link href="/leases" />}>
          Back to leases
        </Button>
        <GenerateDocxForm leaseId={lease.id} hasTemplate={templates.length > 0} />
      </div>

      {canEsign && esign && (
        <Card className="print-hidden">
          <CardContent className="space-y-4 py-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                E-signature
              </h2>
              {esign.completed && <Badge>Signed</Badge>}
            </div>

            {esignError && (
              <Alert variant="destructive">
                <AlertDescription>{esignError}</AlertDescription>
              </Alert>
            )}
            {esignMessage && (
              <Alert>
                <AlertDescription>{esignMessage}</AlertDescription>
              </Alert>
            )}

            {esign.completed && (
              <p className="text-sm">
                {signingKindLabel(esign.completed.kind)
                  .charAt(0)
                  .toUpperCase() +
                  signingKindLabel(esign.completed.kind).slice(1)}{" "}
                fully signed
                {esign.completed.completedAt &&
                  ` on ${fmtDate(esign.completed.completedAt)}`}
                .{" "}
                {signedDocUrl ? (
                  <a
                    href={signedDocUrl}
                    className="font-medium underline underline-offset-4"
                  >
                    Download the signed document
                  </a>
                ) : (
                  <span className="text-muted-foreground">
                    The signed document is on the Documents page.
                  </span>
                )}
              </p>
            )}

            {esign.active ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {signingKindLabel(esign.active.kind)
                    .charAt(0)
                    .toUpperCase() +
                    signingKindLabel(esign.active.kind).slice(1)}{" "}
                  sent {fmtDate(esign.active.sentAt)} · expires{" "}
                  {fmtDate(esign.active.expiresAt)}.
                </p>
                <div className="divide-y rounded-md border">
                  {esign.active.signers.map((s) => {
                    const channels = [
                      s.phone ? "SMS" : null,
                      s.email ? "email" : null,
                    ].filter(Boolean);
                    return (
                      <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <div>
                          <div className="font-medium">{s.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {channels.length > 0 ? (
                              <>
                                via {channels.join(" + ")}
                                {s.lastSentAt &&
                                  ` · last sent ${fmtDateTime(s.lastSentAt)}`}
                              </>
                            ) : (
                              <span className="text-destructive">
                                no contact method on file
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {s.signedAt ? (
                            <Badge>Signed {fmtDateTime(s.signedAt)}</Badge>
                          ) : (
                            <>
                              <Badge variant="outline">Pending</Badge>
                              <form action={resendEsignLinkAction}>
                                <input
                                  type="hidden"
                                  name="leaseId"
                                  value={lease.id}
                                />
                                <input
                                  type="hidden"
                                  name="signerId"
                                  value={s.id}
                                />
                                <Button type="submit" variant="outline" size="xs">
                                  Resend
                                </Button>
                              </form>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <form action={cancelEsignRequestAction}>
                  <input type="hidden" name="leaseId" value={lease.id} />
                  <input
                    type="hidden"
                    name="requestId"
                    value={esign.active.id}
                  />
                  <ConfirmSubmitButton confirmMessage="Cancel this signing request? Links already sent will stop working.">
                    Cancel request
                  </ConfirmSubmitButton>
                </form>
              </div>
            ) : (
              <div className="space-y-3">
                {esign.expired && (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>
                      The previous request expired{" "}
                      {fmtDate(esign.expired.expiresAt)} without all
                      signatures.
                    </span>
                    <form action={cancelEsignRequestAction}>
                      <input type="hidden" name="leaseId" value={lease.id} />
                      <input
                        type="hidden"
                        name="requestId"
                        value={esign.expired.id}
                      />
                      <ConfirmSubmitButton
                        confirmMessage="Dismiss the expired signing request?"
                        variant="outline"
                      >
                        Dismiss
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                )}
                <form
                  action={sendEsignRequestAction}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="leaseId" value={lease.id} />
                  <select
                    name="kind"
                    defaultValue="lease"
                    className="h-8 rounded-md border px-2 text-sm"
                    aria-label="Agreement kind"
                  >
                    <option value="lease">Lease</option>
                    <option value="renewal">Renewal</option>
                  </select>
                  <Button type="submit">Send for e-signature</Button>
                </form>
                {app.landlordSignatureName ? (
                  <p className="text-xs text-muted-foreground">
                    Each tenant gets a private signing link by SMS/email. Your
                    saved landlord signature ({app.landlordSignatureName}) is
                    applied automatically.
                  </p>
                ) : (
                  <p className="text-xs text-destructive">
                    No landlord signature is saved yet — set it up under{" "}
                    <Link
                      href="/settings/leases"
                      className="font-medium underline underline-offset-4"
                    >
                      Settings → Leases
                    </Link>{" "}
                    before sending.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
          <AgreementText
            text={clauseText}
            mode="wet"
            landlordName={vars.business_legal_name}
            tenantNames={[vars.primary_tenant, ...coTenantNames]}
            landlordSignature={landlordSignature}
          />

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

          {/* Signatures — skipped when the clause text places its own
              {{tenant_signatures}} block inline */}
          {!inlineSignatures && (
            <div className="space-y-8 border-t pt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Signatures
              </h2>
              <SignatureBlock
                role="Landlord"
                name={vars.business_legal_name}
                signature={
                  landlordSignature
                    ? {
                        name: landlordSignature.name,
                        imageDataUrl: landlordSignature.imageDataUrl,
                        date: landlordSignature.date,
                      }
                    : undefined
                }
              />
              <SignatureBlock role="Tenant" name={vars.primary_tenant} />
              {coTenantNames.map((name) => (
                <SignatureBlock key={name} role="Co-tenant" name={name} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
