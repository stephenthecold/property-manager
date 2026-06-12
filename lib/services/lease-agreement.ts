import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { formatCurrency } from "@/lib/money";
import {
  getAppSettings,
  type ResolvedAppSettings,
} from "@/lib/services/app-settings";
import { UTILITY_OPTIONS, sanitizeUtilities } from "@/lib/config/lease";
import type { TemplateVars } from "@/lib/reminders/templates";

/**
 * Lease-agreement variable building: one place that turns a lease (+ relations
 * + AppSettings branding) into the `{{var}}` map consumed by BOTH the built-in
 * printable agreement page and the fill-your-own .docx template
 * (lib/documents/docx-fill.ts). All money goes through formatCurrency with the
 * property currency; all dates are rendered in the property timezone.
 */

const LEASE_INCLUDE = {
  tenant: true,
  unit: { include: { property: true } },
  coTenants: { include: { tenant: true }, orderBy: { createdAt: "asc" } },
  deposits: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.LeaseInclude;

export type AgreementLease = Prisma.LeaseGetPayload<{
  include: typeof LEASE_INCLUDE;
}>;

export interface AgreementContext {
  vars: TemplateVars;
  lease: AgreementLease;
  app: ResolvedAppSettings;
}

/** "1" -> "1st", "22" -> "22nd", "13" -> "13th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function longDate(d: Date, tz: string): string {
  return DateTime.fromJSDate(d, { zone: tz })
    .setLocale("en-US")
    .toLocaleString(DateTime.DATE_FULL);
}

function fullName(t: { firstName: string; lastName: string }): string {
  return `${t.firstName} ${t.lastName}`.trim();
}

/** Percentage from basis points, trimmed ("500" -> "5", "550" -> "5.5"). */
function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2).replace(/\.?0+$/, "");
}

/** Humanized late-fee policy sentence for every LateFeeType (incl. none). */
function lateFeeTerms(lease: AgreementLease, currency: string): string {
  const graceClause =
    lease.gracePeriodDays > 0
      ? `after the ${lease.gracePeriodDays}-day grace period`
      : "after the due date";
  switch (lease.lateFeeType) {
    case "fixed":
      return lease.lateFeeAmountCents != null
        ? `A one-time late fee of ${formatCurrency(lease.lateFeeAmountCents, currency)} applies to rent received ${graceClause}.`
        : "No late fee applies.";
    case "percentage":
      return lease.lateFeeBps != null
        ? `A one-time late fee of ${bpsToPercent(lease.lateFeeBps)}% of the monthly rent applies to rent received ${graceClause}.`
        : "No late fee applies.";
    case "daily": {
      if (lease.lateFeeAmountCents == null) return "No late fee applies.";
      const cap =
        lease.lateFeeMaxCents != null
          ? `, up to ${formatCurrency(lease.lateFeeMaxCents, currency)} per rental period`
          : "";
      return `A late fee of ${formatCurrency(lease.lateFeeAmountCents, currency)} per day accrues on rent remaining unpaid ${graceClause}${cap}.`;
    }
    case "none":
    default:
      return "No late fee applies.";
  }
}

/** "Pet deposit: $300.00 (non-refundable); Key deposit: $50.00" or "—". */
function additionalDeposits(lease: AgreementLease, currency: string): string {
  if (lease.deposits.length === 0) return "—";
  return lease.deposits
    .map((d) => {
      const amount = formatCurrency(d.amountCents, currency);
      if (d.nonRefundableCents <= 0n) return `${d.label}: ${amount}`;
      if (d.nonRefundableCents >= d.amountCents) {
        return `${d.label}: ${amount} (non-refundable)`;
      }
      return `${d.label}: ${amount} (${formatCurrency(d.nonRefundableCents, currency)} non-refundable)`;
    })
    .join("; ");
}

/**
 * Load a lease (with tenant, unit→property, co-tenants, deposits) and the app
 * settings, and build the full agreement variable map. Returns null when the
 * lease does not exist.
 */
export async function buildAgreementVars(
  leaseId: string,
): Promise<AgreementContext | null> {
  const [lease, app] = await Promise.all([
    prisma.lease.findUnique({ where: { id: leaseId }, include: LEASE_INCLUDE }),
    getAppSettings(),
  ]);
  if (!lease) return null;

  const property = lease.unit.property;
  const currency = property.currency;
  const tz = property.timezone;

  const coTenantNames = lease.coTenants.map((ct) => fullName(ct.tenant));
  const allNames = [fullName(lease.tenant), ...coTenantNames];

  const propertyAddress = [
    property.addressLine1,
    property.addressLine2,
    [property.city, property.state, property.zip].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const landlordUtilities = sanitizeUtilities(
    Array.isArray(lease.utilitiesPaid)
      ? (lease.utilitiesPaid as unknown[]).map(String)
      : [],
  );
  const landlordSet = new Set<string>(landlordUtilities);
  const tenantUtilities = UTILITY_OPTIONS.filter((u) => !landlordSet.has(u));

  const vars: TemplateVars = {
    business_name: app.businessName,
    business_legal_name: app.businessLegalName ?? app.businessName,
    // The stored address is multiline; agreements want it on one line.
    business_address:
      app.businessAddress?.replace(/\s*\n+\s*/g, ", ").trim() ?? "",
    business_phone: app.businessPhone ?? "",
    business_email: app.businessEmail ?? "",
    tenant_names: allNames.join(", "),
    primary_tenant: fullName(lease.tenant),
    co_tenants: coTenantNames.length > 0 ? coTenantNames.join(", ") : "—",
    property_name: property.name,
    property_address: propertyAddress,
    unit: lease.unit.unitNumber,
    start_date: longDate(lease.startDate, tz),
    end_date: lease.endDate ? longDate(lease.endDate, tz) : "month-to-month",
    rent: formatCurrency(lease.rentAmountCents, currency),
    due_day: ordinal(lease.dueDay),
    grace_days: String(lease.gracePeriodDays),
    late_fee_terms: lateFeeTerms(lease, currency),
    security_deposit: formatCurrency(lease.securityDepositCents, currency),
    additional_deposits: additionalDeposits(lease, currency),
    internet: lease.internetEnabled
      ? `Included at ${formatCurrency(lease.internetFeeCents, currency)}/month`
      : "Not included",
    utilities_landlord:
      landlordUtilities.length > 0 ? landlordUtilities.join(", ") : "None",
    utilities_tenant:
      tenantUtilities.length > 0 ? tenantUtilities.join(", ") : "None",
    utilities_notes: lease.utilitiesNotes ?? "",
    today: longDate(new Date(), tz),
  };

  return { vars, lease, app };
}
