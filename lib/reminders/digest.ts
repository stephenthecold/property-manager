import { DateTime } from "luxon";
import { formatCurrency, sumCents, type Cents } from "@/lib/money";

/**
 * Pure formatting for the weekly staff overdue-rent email digest. DB-free and
 * clock-injected (`now`), mirroring lib/reminders/rules.ts: the service layer
 * (lib/services/staff-digest.ts) shapes rows from the rent-roll report and this
 * module turns them into one deterministic plain-text email shared by every
 * staff recipient.
 */

/** One overdue lease, pre-shaped by the service from a rent-roll report row. */
export interface OverdueDigestRow {
  /** Display name as reported (e.g. "Dana Smith", possibly with a " +1" co-tenant suffix). */
  tenantName: string;
  propertyName: string;
  unitLabel: string;
  /** Past-due portion (aging buckets) in integer cents. */
  pastDueCents: Cents;
  /** Full net lease balance in integer cents (may exceed pastDue when the current period is open). */
  balanceCents: Cents;
  /** ISO 4217 code for display formatting. */
  currency: string;
  /** Days since the last payment, or null when the lease has none. */
  daysSinceLastPayment: number | null;
}

export interface OverdueDigestInput {
  businessName: string;
  now: Date;
  rows: OverdueDigestRow[];
}

export interface OverdueDigest {
  subject: string;
  text: string;
  /** Sum of pastDueCents across all rows (for the audit aggregate — never re-derive). */
  totalPastDueCents: Cents;
}

/** "3 tenants" / "1 tenant". */
function tenantCount(n: number): string {
  return `${n} tenant${n === 1 ? "" : "s"}`;
}

/** Parenthesized extras for a row line; "" when there is nothing extra to say. */
function rowExtras(row: OverdueDigestRow): string {
  const extras: string[] = [];
  if (row.balanceCents !== row.pastDueCents) {
    extras.push(`balance ${formatCurrency(row.balanceCents, row.currency)}`);
  }
  if (row.daysSinceLastPayment != null) {
    extras.push(
      `last payment ${row.daysSinceLastPayment} day${
        row.daysSinceLastPayment === 1 ? "" : "s"
      } ago`,
    );
  }
  return extras.length === 0 ? "" : ` (${extras.join(", ")})`;
}

/**
 * Build the digest email. Returns null when there is nothing overdue — the
 * caller must not send an empty digest.
 *
 * Rows are sorted by pastDue descending (ties broken by tenant name so the
 * output is deterministic). The total/subject are formatted in the first row's
 * currency; per-row amounts use each row's own currency.
 */
export function formatOverdueDigest(
  input: OverdueDigestInput,
): OverdueDigest | null {
  const { businessName, now, rows } = input;
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => {
    if (a.pastDueCents !== b.pastDueCents) {
      return b.pastDueCents > a.pastDueCents ? 1 : -1;
    }
    return a.tenantName.localeCompare(b.tenantName);
  });

  const totalPastDueCents = sumCents(sorted.map((r) => r.pastDueCents));
  const totalFormatted = formatCurrency(totalPastDueCents, sorted[0].currency);
  const count = tenantCount(sorted.length);

  const subject = `Overdue rent: ${count} owe${
    sorted.length === 1 ? "s" : ""
  } ${totalFormatted} — ${businessName}`;

  const lines = sorted.map(
    (r) =>
      `${r.tenantName} — ${r.propertyName} · ${r.unitLabel} — ${formatCurrency(
        r.pastDueCents,
        r.currency,
      )} past due${rowExtras(r)}`,
  );

  const dateUtc = now.toISOString().slice(0, 10);
  const text = [
    `Overdue rent as of ${dateUtc} — ${count}:`,
    "",
    ...lines,
    "",
    `Total past due: ${totalFormatted} across ${count}.`,
    "",
    `Sent by ${businessName} property manager — weekly overdue digest`,
  ].join("\n");

  return { subject, text, totalPastDueCents };
}

/**
 * ISO-8601 week key for `now` in UTC, e.g. "2026-W24" — used as the audit
 * entityId so each weekly run lands on a stable identifier ("kkkk" is the ISO
 * week-numbering year, which differs from the calendar year at boundaries).
 */
export function isoWeekKey(now: Date): string {
  return DateTime.fromJSDate(now, { zone: "utc" }).toFormat("kkkk-'W'WW");
}
