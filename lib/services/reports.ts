import { prisma } from "@/lib/db";
import { fromCents } from "@/lib/money";
import { leaseSnapshot } from "@/lib/services/accounting";

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
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
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
