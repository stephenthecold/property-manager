import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { requireCapability } from "@/lib/auth/session";
import { buildAgreementVars } from "@/lib/services/lease-agreement";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import { formatCurrency } from "@/lib/money";
import { PrintButton } from "@/components/app/print-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";
export const metadata = { title: "Lease abstract" };

/** A labelled key/value cell for the abstract's detail grids. */
function detail(label: string, value: string, capitalize = false) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-medium${capitalize ? " capitalize" : ""}`}>{value}</div>
    </div>
  );
}

/** A right-aligned term row (label · value) for the financials list. */
function termRow(label: string, value: string) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export default async function LeaseAbstractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability("leases.manage");
  const { id } = await params;

  const ctx = await buildAgreementVars(id);
  if (!ctx) notFound();
  const { vars, lease, app } = ctx;

  const property = lease.unit.property;
  const currency = property.currency;
  const tz = property.timezone;
  const monthToMonth = !lease.endDate || lease.status === "month_to_month";
  const fmtDate = (d: Date) =>
    DateTime.fromJSDate(d, { zone: tz })
      .setLocale("en-US")
      .toLocaleString(DateTime.DATE_FULL);

  let logoUrl: string | null = null;
  if (app.logoDocumentId) {
    try {
      logoUrl = (await getDocumentDownloadUrl(app.logoDocumentId))?.url ?? null;
    } catch {
      logoUrl = null; // storage unavailable — render the abstract anyway
    }
  }
  const businessContact = [app.businessPhone, app.businessEmail]
    .filter(Boolean)
    .join(" · ");

  // Key flags surfaced from existing lease fields — only the ones that are set
  // are listed, so the abstract stays a clean one-pager.
  const flags: string[] = [];
  if (lease.prorateFirstPeriod) flags.push("Move-in month prorated");
  if (monthToMonth) flags.push("Month-to-month");
  if (lease.billingStartDate)
    flags.push(`Billing starts ${fmtDate(lease.billingStartDate)}`);
  if (lease.internetEnabled) flags.push(`Internet add-on: ${vars.internet}`);
  if (
    lease.scheduledRentAmountCents != null &&
    lease.scheduledRentEffectiveDate
  )
    flags.push(
      `Scheduled rent change to ${formatCurrency(
        lease.scheduledRentAmountCents,
        currency,
      )} on ${fmtDate(lease.scheduledRentEffectiveDate)}`,
    );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="print-hidden flex flex-wrap items-center gap-2">
        <PrintButton />
        <Button
          variant="ghost"
          render={<Link href={`/leases/${lease.id}/agreement`} />}
        >
          Full agreement
        </Button>
        <Button variant="ghost" render={<Link href="/leases" />}>
          Back to leases
        </Button>
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

          {/* Title + property · unit · status */}
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-wide">LEASE ABSTRACT</h1>
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {property.name} · Unit {lease.unit.unitNumber}
              </span>
              <Badge variant="outline" className="capitalize">
                {lease.status.replace(/_/g, " ")}
              </Badge>
            </div>
            {vars.property_address && (
              <div className="text-xs text-muted-foreground">
                {vars.property_address}
              </div>
            )}
          </div>

          {/* Parties */}
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Parties
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {detail("Landlord", vars.business_legal_name)}
              {detail("Primary tenant", vars.primary_tenant)}
              {detail("Co-tenants", vars.co_tenants)}
              {detail("Property", vars.property_name)}
            </div>
          </div>

          {/* Term */}
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Term
            </h2>
            <dl>
              {termRow("Lease start", vars.start_date)}
              {termRow("Lease end", vars.end_date)}
            </dl>
            {monthToMonth && (
              <p className="mt-2 text-xs text-muted-foreground">
                Month-to-month: continues until either party gives written notice
                as required by applicable law.
              </p>
            )}
          </div>

          {/* Financials */}
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Financials
            </h2>
            <dl>
              {termRow("Monthly rent", vars.rent)}
              {termRow("Rent due", `${vars.due_day} of each month`)}
              {termRow("Grace period", `${vars.grace_days} day(s)`)}
              {termRow("Late fee", vars.late_fee_terms)}
              {termRow("Security deposit", vars.security_deposit)}
              {termRow("Additional deposits", vars.additional_deposits)}
            </dl>
          </div>

          {/* Key flags — only when something is set */}
          {flags.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Key flags
              </h2>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t pt-4 text-center text-xs text-muted-foreground">
            Summary only — not the lease agreement. Prepared {vars.today} for{" "}
            {app.businessName}
            {app.businessLegalName ? ` (${app.businessLegalName})` : ""}.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
