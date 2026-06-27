import { DateTime } from "luxon";
import { LedgerEntryType } from "@/lib/generated/prisma/enums";
import type { TenantLedgerFilter } from "@/lib/services/reports";

/**
 * Shared parsing for the resident-portal ledger export so the rendered page and
 * the CSV API route agree exactly on what the date-range + entry-type filters
 * mean. Pure (no DB, no session) — the caller resolves the tenant and timezone
 * and passes raw query strings in.
 */

/** Entry types a tenant can filter their own ledger by (the schema enum). */
export const TENANT_LEDGER_ENTRY_TYPES: readonly LedgerEntryType[] = [
  LedgerEntryType.rent_charge,
  LedgerEntryType.payment,
  LedgerEntryType.late_fee,
  LedgerEntryType.adjustment,
  LedgerEntryType.credit,
  LedgerEntryType.reversal,
];

/** Human label for an entry type ("rent_charge" -> "rent charge"). */
export function entryTypeLabel(t: string): string {
  return t.replace(/_/g, " ");
}

/** Validate a raw entry-type param against the schema enum; else undefined. */
export function parseEntryType(
  raw: string | null | undefined,
): LedgerEntryType | undefined {
  if (!raw) return undefined;
  return (TENANT_LEDGER_ENTRY_TYPES as readonly string[]).includes(raw)
    ? (raw as LedgerEntryType)
    : undefined;
}

/**
 * Parse a "yyyy-MM-dd" bound as a civil day in `tz`; `endOfDay` makes the upper
 * bound inclusive. Civil-day bounds in the property timezone line up with how
 * effectiveDate is bucketed everywhere else (avoids dropping boundary rows at
 * the UTC edge). Invalid/blank input -> undefined (the filter is ignored).
 */
export function parsePortalDay(
  raw: string | null | undefined,
  tz: string,
  endOfDay = false,
): Date | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const dt = DateTime.fromISO(raw, { zone: tz });
  if (!dt.isValid) return undefined;
  return (endOfDay ? dt.endOf("day") : dt.startOf("day")).toJSDate();
}

/** Raw query strings (page searchParams / request query) for the export. */
export interface RawLedgerFilterParams {
  from?: string | null;
  to?: string | null;
  type?: string | null;
}

/** Resolve raw filter params (in the tenant's timezone) into a typed filter. */
export function resolveLedgerFilter(
  params: RawLedgerFilterParams,
  tz: string,
): TenantLedgerFilter {
  return {
    from: parsePortalDay(params.from, tz),
    to: parsePortalDay(params.to, tz, true),
    entryType: parseEntryType(params.type),
  };
}
