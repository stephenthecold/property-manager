import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { fromCents } from "@/lib/money";
import { leaseSnapshot } from "@/lib/services/accounting";
import { daysBetween } from "@/lib/accounting/periods";
import {
  groupIncomeByMonth,
  type IncomeEntry,
} from "@/lib/accounting/income";

export interface RentRollRow {
  property: string;
  unit: string;
  tenant: string;
  status: string;
  rent: string;
  balance: string;
  pastDue: string;
  lastPaidDays: string;
}

export async function getRentRoll(now: Date): Promise<RentRollRow[]> {
  const leases = await prisma.lease.findMany({
    where: { status: { in: ["active", "month_to_month"] } },
    include: { tenant: true, unit: { include: { property: true } } },
    orderBy: [{ unit: { property: { name: "asc" } } }, { unit: { unitNumber: "asc" } }],
  });
  const rows: RentRollRow[] = [];
  for (const l of leases) {
    const s = await leaseSnapshot(l, l.unit, now, l.unit.property.timezone);
    const pastDue =
      s.aging.d1_30 + s.aging.d31_60 + s.aging.d61_90 + s.aging.d90plus;
    rows.push({
      property: l.unit.property.name,
      unit: l.unit.unitNumber,
      tenant: `${l.tenant.firstName} ${l.tenant.lastName}`,
      status: s.status,
      rent: fromCents(l.rentAmountCents),
      balance: fromCents(s.netBalanceCents),
      pastDue: fromCents(pastDue),
      lastPaidDays: s.daysSinceLastPayment == null ? "" : String(s.daysSinceLastPayment),
    });
  }
  return rows;
}

export async function getOverdue(now: Date): Promise<RentRollRow[]> {
  const all = await getRentRoll(now);
  return all.filter((r) => Number(r.pastDue) > 0 || r.status === "overdue");
}

/** Minimal, dependency-free CSV serializer (RFC-4180 quoting). */
export function toCsv(headers: string[], rows: Record<string, string>[]): string {
  // Formula-injection guard: a cell starting with =, +, @ (or a non-numeric -)
  // would execute when the CSV is opened in a spreadsheet. Tenant names and
  // descriptions are user-controlled, so neutralize with a leading apostrophe.
  // Plain negative numbers (e.g. "-50.00") are legitimate values and exempt.
  const guard = (v: string) =>
    /^[=+@]/.test(v) || (/^-/.test(v) && !/^-\d+(\.\d+)?$/.test(v))
      ? `'${v}`
      : v;
  const esc = (raw: string) => {
    const v = guard(raw);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines = [headers.map(esc).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}

export const RENT_ROLL_HEADERS = [
  "property",
  "unit",
  "tenant",
  "status",
  "rent",
  "balance",
  "pastDue",
  "lastPaidDays",
] as const;

// --- Ledger reports ----------------------------------------------------------

export interface LedgerReportRow {
  /** "yyyy-MM-dd" of effectiveDate in the property timezone. */
  date: string;
  type: string;
  description: string;
  amount: string;
  /** Running SUM(amountCents) in effectiveDate, createdAt, id order. */
  balance: string;
}

export const LEDGER_HEADERS = [
  "date",
  "type",
  "description",
  "amount",
  "balance",
] as const;

/** All ledger entries across the tenant's leases, with a running balance. */
export async function getTenantLedger(
  tenantId: string,
): Promise<LedgerReportRow[]> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { lease: { tenantId } },
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: { lease: { include: { unit: { include: { property: true } } } } },
  });
  let balance = 0n;
  return entries.map((e) => {
    balance += e.amountCents;
    return {
      date: DateTime.fromJSDate(e.effectiveDate, {
        zone: e.lease.unit.property.timezone,
      }).toFormat("yyyy-MM-dd"),
      type: e.entryType,
      description: e.description ?? "",
      amount: fromCents(e.amountCents),
      balance: fromCents(balance),
    };
  });
}

export interface UnitLedgerRow extends LedgerReportRow {
  tenant: string;
}

export const UNIT_LEDGER_HEADERS = [
  "date",
  "tenant",
  "type",
  "description",
  "amount",
  "balance",
] as const;

/**
 * All ledger entries across all leases of the unit. Balance scope is per
 * leaseId (docs/accounting.md) — the running balance RESETS at each lease so a
 * prior tenant's residue never bleeds into the next tenant's rows; the tenant
 * column makes the boundaries visible.
 */
export async function getUnitLedger(unitId: string): Promise<UnitLedgerRow[]> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { lease: { unitId } },
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      lease: {
        include: { unit: { include: { property: true } }, tenant: true },
      },
    },
  });
  const balances = new Map<string, bigint>();
  return entries.map((e) => {
    const balance = (balances.get(e.leaseId) ?? 0n) + e.amountCents;
    balances.set(e.leaseId, balance);
    return {
      date: DateTime.fromJSDate(e.effectiveDate, {
        zone: e.lease.unit.property.timezone,
      }).toFormat("yyyy-MM-dd"),
      tenant: `${e.lease.tenant.firstName} ${e.lease.tenant.lastName}`,
      type: e.entryType,
      description: e.description ?? "",
      amount: fromCents(e.amountCents),
      balance: fromCents(balance),
    };
  });
}

// --- Income summary (cash basis) ---------------------------------------------

export interface IncomeRow {
  month: string;
  property: string;
  cashReceived: string;
  paymentCount: string;
  chargesBilled: string;
  lateFeesBilled: string;
}

export const INCOME_HEADERS = [
  "month",
  "property",
  "cashReceived",
  "paymentCount",
  "chargesBilled",
  "lateFeesBilled",
] as const;

/**
 * Cash received per (month, property), bucketed by effectiveDate in the
 * property timezone; payment reversals net cash out. chargesBilled /
 * lateFeesBilled are accrual columns for comparison. See lib/accounting/income.
 */
export async function getIncomeSummary(
  i: { from?: Date; to?: Date; propertyId?: string },
  _now: Date,
): Promise<IncomeRow[]> {
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      ...(i.from || i.to
        ? {
            effectiveDate: {
              ...(i.from ? { gte: i.from } : {}),
              ...(i.to ? { lte: i.to } : {}),
            },
          }
        : {}),
      ...(i.propertyId
        ? { lease: { unit: { propertyId: i.propertyId } } }
        : {}),
    },
    include: {
      lease: { include: { unit: { include: { property: true } } } },
      reversesEntry: true,
    },
  });
  const inputs: IncomeEntry[] = entries.map((e) => ({
    effectiveDate: e.effectiveDate,
    tz: e.lease.unit.property.timezone,
    entryType: e.entryType,
    amountCents: e.amountCents,
    reversesPayment: e.reversesEntry?.entryType === "payment",
    property: e.lease.unit.property.name,
  }));
  return groupIncomeByMonth(inputs).map((g) => ({
    month: g.month,
    property: g.property,
    cashReceived: fromCents(g.cashReceivedCents),
    paymentCount: String(g.paymentCount),
    chargesBilled: fromCents(g.chargesBilledCents),
    lateFeesBilled: fromCents(g.lateFeesBilledCents),
  }));
}

// --- Lease expirations ---------------------------------------------------------

export interface ExpirationRow {
  property: string;
  unit: string;
  tenant: string;
  endDate: string;
  daysLeft: string;
  rent: string;
  status: string;
}

export const EXPIRATION_HEADERS = [
  "property",
  "unit",
  "tenant",
  "endDate",
  "daysLeft",
  "rent",
  "status",
] as const;

/**
 * Active leases ending within [now, now + windowDays] (default 90), soonest
 * first, plus ALL month_to_month leases last (no end date, blank daysLeft).
 */
export async function getLeaseExpirations(
  i: { windowDays?: number },
  now: Date,
): Promise<ExpirationRow[]> {
  const windowDays = i.windowDays ?? 90;
  const leases = await prisma.lease.findMany({
    where: {
      OR: [
        { status: "active", endDate: { not: null } },
        { status: "month_to_month" },
      ],
    },
    include: { tenant: true, unit: { include: { property: true } } },
    orderBy: [
      { unit: { property: { name: "asc" } } },
      { unit: { unitNumber: "asc" } },
    ],
  });

  const expiring: (ExpirationRow & { _daysLeft: number })[] = [];
  const monthToMonth: ExpirationRow[] = [];
  for (const l of leases) {
    const tz = l.unit.property.timezone;
    const base = {
      property: l.unit.property.name,
      unit: l.unit.unitNumber,
      tenant: `${l.tenant.firstName} ${l.tenant.lastName}`,
      rent: fromCents(l.rentAmountCents),
    };
    if (l.status === "month_to_month") {
      monthToMonth.push({
        ...base,
        endDate: "",
        daysLeft: "",
        status: "month_to_month",
      });
      continue;
    }
    if (!l.endDate) continue;
    const daysLeft = daysBetween(now, l.endDate, tz);
    if (daysLeft < 0 || daysLeft > windowDays) continue;
    expiring.push({
      ...base,
      endDate: DateTime.fromJSDate(l.endDate, { zone: tz }).toFormat(
        "yyyy-MM-dd",
      ),
      daysLeft: String(daysLeft),
      status: l.status,
      _daysLeft: daysLeft,
    });
  }
  expiring.sort((a, b) => a._daysLeft - b._daysLeft);
  return [
    ...expiring.map(({ _daysLeft: _, ...row }) => row),
    ...monthToMonth,
  ];
}

// --- Payment method summary ----------------------------------------------------

export interface MethodRow {
  method: string;
  count: string;
  total: string;
}

export const METHOD_HEADERS = ["method", "count", "total"] as const;

/** Posted payments grouped by method, largest total first. */
export async function getPaymentMethodSummary(i: {
  from?: Date;
  to?: Date;
}): Promise<MethodRow[]> {
  const payments = await prisma.payment.findMany({
    where: {
      status: "posted",
      ...(i.from || i.to
        ? {
            paymentDate: {
              ...(i.from ? { gte: i.from } : {}),
              ...(i.to ? { lte: i.to } : {}),
            },
          }
        : {}),
    },
  });
  const byMethod = new Map<string, { count: number; total: bigint }>();
  for (const p of payments) {
    const g = byMethod.get(p.method) ?? { count: 0, total: 0n };
    g.count += 1;
    g.total += p.amountCents;
    byMethod.set(p.method, g);
  }
  return [...byMethod.entries()]
    .sort(([, a], [, b]) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
    .map(([method, g]) => ({
      method,
      count: String(g.count),
      total: fromCents(g.total),
    }));
}
