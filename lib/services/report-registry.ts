import { DateTime } from "luxon";
import { getEnv } from "@/lib/config/env";
import {
  BACK_RENT_HEADERS,
  EXPIRATION_HEADERS,
  INCOME_HEADERS,
  METHOD_HEADERS,
  RENT_ROLL_HEADERS,
  getBackRent,
  getIncomeSummary,
  getLeaseExpirations,
  getOverdue,
  getPaymentMethodSummary,
  getRentRoll,
} from "@/lib/services/reports";

/**
 * Single registry of the "whole-portfolio" reports — the ones with an export
 * button on /reports and the ones a ReportSchedule can deliver. Each entry owns
 * its column headers + a row loader that REUSES lib/services/reports.ts (never
 * re-derives balance math). The CSV route, the PDF/Excel renderers, and the
 * scheduled-delivery worker all resolve a report through this one map so the
 * column set can never drift between formats.
 *
 * Per-tenant / per-unit ledger exports are intentionally NOT here: they need an
 * id parameter and aren't schedulable, so they stay special-cased in the route.
 */

export interface ReportParams {
  /** Inclusive lower bound (already resolved to an instant) — income/methods. */
  from?: Date;
  /** Inclusive upper bound (already resolved to an instant) — income/methods. */
  to?: Date;
  /** Income summary property filter. */
  propertyId?: string;
  /** Lease-expiration look-ahead window in days (clamped by the caller). */
  windowDays?: number;
}

export interface ReportData {
  headers: readonly string[];
  rows: Record<string, string>[];
}

interface ReportDef {
  /** Human title shown in the PDF/Excel header and the schedule UI. */
  title: string;
  headers: readonly string[];
  load: (params: ReportParams, now: Date) => Promise<Record<string, string>[]>;
}

/** Column labels for the human-facing PDF/Excel headers (CSV stays raw keys). */
const COLUMN_LABELS: Record<string, string> = {
  property: "Property",
  unit: "Unit",
  tenant: "Tenant",
  status: "Status",
  rent: "Rent",
  balance: "Balance",
  pastDue: "Past due",
  pastDue90: "90+ days",
  lastPaidDays: "Days since paid",
  endDate: "End date",
  owed: "Owed",
  daysLeft: "Days left",
  month: "Month",
  cashReceived: "Cash received",
  paymentCount: "Payments",
  chargesBilled: "Charges billed",
  lateFeesBilled: "Late fees billed",
  method: "Method",
  count: "Count",
  total: "Total",
};

/** Decimal-string columns that should render with a leading "$" in PDF/Excel. */
const MONEY_COLUMNS = new Set<string>([
  "rent",
  "balance",
  "pastDue",
  "pastDue90",
  "owed",
  "cashReceived",
  "chargesBilled",
  "lateFeesBilled",
  "total",
  // Ledger reports (tenant-ledger / unit-ledger) — the per-entry amount is also
  // money, so it formats like the running balance, not as plain text.
  "amount",
]);

export function columnLabel(key: string): string {
  return COLUMN_LABELS[key] ?? key;
}

export function isMoneyColumn(key: string): boolean {
  return MONEY_COLUMNS.has(key);
}

/**
 * Erase a report row's concrete type to the generic string-record shape the
 * renderers consume. Every report row interface is all-string fields, so this is
 * a safe widening (the row interfaces just lack the loose index signature) — done
 * in one place instead of double-casting at each call site.
 */
function rows<T extends object>(
  p: Promise<T[]>,
): Promise<Record<string, string>[]> {
  return p as unknown as Promise<Record<string, string>[]>;
}

/**
 * The schedulable / exportable reports. Keyed by the same `type` slug the
 * /api/reports/[type] route already uses, so existing CSV links keep working.
 */
export const REPORT_DEFS: Record<string, ReportDef> = {
  "rent-roll": {
    title: "Rent roll",
    headers: RENT_ROLL_HEADERS,
    load: (_p, now) => rows(getRentRoll(now)),
  },
  overdue: {
    title: "Overdue tenants",
    headers: RENT_ROLL_HEADERS,
    load: (_p, now) => rows(getOverdue(now)),
  },
  "back-rent": {
    title: "Back rent (terminated leases)",
    headers: BACK_RENT_HEADERS,
    load: (_p, now) => rows(getBackRent(now)),
  },
  income: {
    title: "Income summary",
    headers: INCOME_HEADERS,
    load: (p, now) =>
      rows(getIncomeSummary({ from: p.from, to: p.to, propertyId: p.propertyId }, now)),
  },
  "lease-expirations": {
    title: "Lease expirations",
    headers: EXPIRATION_HEADERS,
    load: (p, now) => rows(getLeaseExpirations({ windowDays: p.windowDays }, now)),
  },
  "payment-methods": {
    title: "Payments by method",
    headers: METHOD_HEADERS,
    load: (p) => rows(getPaymentMethodSummary({ from: p.from, to: p.to })),
  },
};

/** The slugs a ReportSchedule may target (whole-portfolio reports only). */
export const SCHEDULABLE_REPORT_TYPES = Object.keys(REPORT_DEFS);

export function isSchedulableReportType(type: string): boolean {
  return type in REPORT_DEFS;
}

export function reportTitle(type: string): string {
  return REPORT_DEFS[type]?.title ?? type;
}

/** Load a registry report's headers + rows for the given type and params. */
export async function loadReport(
  type: string,
  params: ReportParams,
  now: Date,
): Promise<ReportData | null> {
  const def = REPORT_DEFS[type];
  if (!def) return null;
  const rows = await def.load(params, now);
  return { headers: def.headers, rows };
}

/**
 * For scheduled delivery the worker has no request URL to derive a tz from, so
 * the income/methods date columns (when a schedule ever carries them) resolve in
 * the org default timezone. Today schedules carry no date params, but this keeps
 * the seam open and documented.
 */
export function defaultReportTimezone(): string {
  return getEnv().DEFAULT_TIMEZONE;
}

/** A stable "as of" stamp for the PDF/Excel header, in the org timezone. */
export function asOfStamp(now: Date): string {
  return DateTime.fromJSDate(now, { zone: defaultReportTimezone() }).toFormat(
    "yyyy-MM-dd HH:mm",
  );
}
