import { DateTime } from "luxon";
import { formatCurrency, sumCents, type Cents } from "@/lib/money";
import {
  daysUntilLabel,
  type ExpirationStateName,
} from "@/lib/leases/expiration";

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

// ---------------------------------------------------------------------------
// Weekly maintenance-schedule digest (same Monday cron as the overdue digest)
// ---------------------------------------------------------------------------

/** One pending job with a due date inside the digest window (or overdue). */
export interface MaintenanceDigestJobRow {
  title: string;
  propertyName: string;
  /** Unit-scoped job; null = whole property. */
  unitLabel: string | null;
  /** "yyyy-MM-dd" due date in the property timezone. */
  dueISO: string;
  overdue: boolean;
}

/** One recurring monthly task whose next occurrence is inside the window. */
export interface MaintenanceDigestTaskRow {
  title: string;
  propertyName: string;
  /** "yyyy-MM-dd" next occurrence in the property timezone. */
  dueISO: string;
}

export interface MaintenanceDigestInput {
  businessName: string;
  now: Date;
  jobs: MaintenanceDigestJobRow[];
  tasks: MaintenanceDigestTaskRow[];
}

function digestLine(d: {
  dueISO: string;
  title: string;
  propertyName: string;
  unitLabel?: string | null;
  suffix?: string;
}): string {
  const where = d.unitLabel
    ? `${d.propertyName} · ${d.unitLabel}`
    : d.propertyName;
  return `${d.dueISO} — ${d.title} — ${where}${d.suffix ?? ""}`;
}

/**
 * Build the weekly maintenance digest email. Returns null when there is
 * nothing scheduled (the caller must not send an empty digest). Jobs and
 * tasks are each sorted by date then title so output is deterministic.
 */
export function formatMaintenanceDigest(
  input: MaintenanceDigestInput,
): { subject: string; text: string } | null {
  const { businessName, now, jobs, tasks } = input;
  const total = jobs.length + tasks.length;
  if (total === 0) return null;

  const byDate = <T extends { dueISO: string; title: string }>(a: T, b: T) =>
    a.dueISO.localeCompare(b.dueISO) || a.title.localeCompare(b.title);
  const sortedJobs = [...jobs].sort(byDate);
  const sortedTasks = [...tasks].sort(byDate);
  const overdueCount = sortedJobs.filter((j) => j.overdue).length;

  const subject = `Maintenance this week: ${total} item${total === 1 ? "" : "s"}${
    overdueCount > 0 ? ` (${overdueCount} overdue)` : ""
  } — ${businessName}`;

  const sections: string[] = [
    `Maintenance scheduled as of ${now.toISOString().slice(0, 10)}:`,
    "",
  ];
  if (sortedJobs.length > 0) {
    sections.push(
      "Jobs:",
      ...sortedJobs.map((j) =>
        digestLine({ ...j, suffix: j.overdue ? " (OVERDUE)" : "" }),
      ),
      "",
    );
  }
  if (sortedTasks.length > 0) {
    sections.push(
      "Recurring tasks:",
      ...sortedTasks.map((t) => digestLine({ ...t, suffix: " (monthly)" })),
      "",
    );
  }
  sections.push(`Sent by ${businessName} property manager — weekly maintenance digest`);

  return { subject, text: sections.join("\n") };
}

// ---------------------------------------------------------------------------
// Weekly lease-expiration digest (same Monday cron as the other staff digests)
// ---------------------------------------------------------------------------

/** One active lease ending inside the configured alert window (or already past). */
export interface ExpirationDigestRow {
  tenantName: string;
  propertyName: string;
  unitLabel: string;
  /** "yyyy-MM-dd" lease end date in the property timezone. */
  endISO: string;
  /** Whole days from now to the end date (negative once past). */
  daysUntilExpiry: number;
  /** Pure classification from expirationState. In practice the loader only
   *  emits eligible rows, so this is "expired" | "expiring_soon" | "upcoming"
   *  (never "none") — only "expired" changes the rendering. */
  state: ExpirationStateName;
}

export interface ExpirationDigestInput {
  businessName: string;
  now: Date;
  /** The configured alert window (days), echoed into the subject/footer copy. */
  windowDays: number;
  rows: ExpirationDigestRow[];
}

/**
 * Build the weekly lease-expiration digest email. Returns null when nothing is
 * expiring (the caller must not send an empty digest). Rows are sorted soonest
 * end first (ties broken by tenant name) so the output is deterministic, and
 * each line carries its days-left chip plus an "(EXPIRED)" marker once past.
 */
export function formatExpirationDigest(
  input: ExpirationDigestInput,
): { subject: string; text: string } | null {
  const { businessName, now, windowDays, rows } = input;
  if (rows.length === 0) return null;

  const sorted = [...rows].sort(
    (a, b) =>
      a.daysUntilExpiry - b.daysUntilExpiry ||
      a.tenantName.localeCompare(b.tenantName),
  );
  const expiredCount = sorted.filter((r) => r.state === "expired").length;

  const subject = `Lease${sorted.length === 1 ? "" : "s"} expiring: ${
    sorted.length
  } in the next ${windowDays} days${
    expiredCount > 0 ? ` (${expiredCount} expired)` : ""
  } — ${businessName}`;

  const lines = sorted.map(
    (r) =>
      `${r.endISO} — ${r.tenantName} — ${r.propertyName} · ${r.unitLabel} — ${daysUntilLabel(
        r.daysUntilExpiry,
      )}${r.state === "expired" ? " (EXPIRED)" : ""}`,
  );

  const text = [
    `Leases expiring within ${windowDays} days as of ${now
      .toISOString()
      .slice(0, 10)}:`,
    "",
    ...lines,
    "",
    `Sent by ${businessName} property manager — weekly lease-expiration digest`,
  ].join("\n");

  return { subject, text };
}

// ---------------------------------------------------------------------------
// Weekly asset-warranty digest (same Monday cron as the other staff digests)
// ---------------------------------------------------------------------------

/** One registered asset whose warranty is expired or expiring within 30 days. */
export interface WarrantyDigestRow {
  assetName: string;
  propertyName: string;
  /** Unit-scoped asset; null = whole property. */
  unitLabel: string | null;
  /** "yyyy-MM-dd" warranty expiry in the property timezone. */
  expiresISO: string;
  /** Whole days from now to expiry (negative once past). */
  daysUntil: number;
  state: "expired" | "expiring_soon";
}

/**
 * Build the weekly asset-warranty digest email. Returns null when nothing is
 * expiring (the caller must not send an empty digest). Rows are sorted
 * soonest-expiry (most overdue) first, ties broken by asset name.
 */
export function formatWarrantyDigest(input: {
  businessName: string;
  now: Date;
  rows: WarrantyDigestRow[];
}): { subject: string; text: string } | null {
  const { businessName, now, rows } = input;
  if (rows.length === 0) return null;

  const sorted = [...rows].sort(
    (a, b) => a.daysUntil - b.daysUntil || a.assetName.localeCompare(b.assetName),
  );
  const expiredCount = sorted.filter((r) => r.state === "expired").length;

  const subject = `Asset warrant${sorted.length === 1 ? "y" : "ies"} expiring: ${
    sorted.length
  }${expiredCount > 0 ? ` (${expiredCount} expired)` : ""} — ${businessName}`;

  const lines = sorted.map((r) => {
    const where = r.unitLabel
      ? `${r.propertyName} · ${r.unitLabel}`
      : r.propertyName;
    const when =
      r.state === "expired"
        ? `expired ${r.expiresISO}`
        : `expires ${r.expiresISO} (${daysUntilLabel(r.daysUntil)})`;
    return `${r.assetName} — ${where} — ${when}`;
  });

  const text = [
    `Asset warranties expired or expiring within 30 days as of ${now
      .toISOString()
      .slice(0, 10)}:`,
    "",
    ...lines,
    "",
    `Sent by ${businessName} property manager — weekly warranty digest`,
  ].join("\n");

  return { subject, text };
}

// ---------------------------------------------------------------------------
// Weekly preventive-maintenance digest (overdue recurring tasks)
// ---------------------------------------------------------------------------

/** One active recurring task past its due day this period with no completion. */
export interface PreventiveMaintenanceDigestRow {
  title: string;
  propertyName: string;
  /** "yyyy-MM-dd" this month's due date in the property timezone. */
  dueISO: string;
  daysOverdue: number;
}

/**
 * Build the weekly overdue-recurring-task digest email. Returns null when
 * nothing is overdue (the caller must not send an empty digest). Most-overdue
 * first, ties broken by title.
 */
export function formatPreventiveMaintenanceDigest(input: {
  businessName: string;
  now: Date;
  rows: PreventiveMaintenanceDigestRow[];
}): { subject: string; text: string } | null {
  const { businessName, now, rows } = input;
  if (rows.length === 0) return null;

  const sorted = [...rows].sort(
    (a, b) => b.daysOverdue - a.daysOverdue || a.title.localeCompare(b.title),
  );

  const subject = `Overdue recurring task${
    sorted.length === 1 ? "" : "s"
  }: ${sorted.length} — ${businessName}`;

  const lines = sorted.map(
    (r) =>
      `${r.title} — ${r.propertyName} — due ${r.dueISO} (${r.daysOverdue} day${
        r.daysOverdue === 1 ? "" : "s"
      } overdue)`,
  );

  const text = [
    `Recurring maintenance tasks past their due day and not marked done, as of ${now
      .toISOString()
      .slice(0, 10)}:`,
    "",
    ...lines,
    "",
    `Sent by ${businessName} property manager — weekly preventive-maintenance digest`,
  ].join("\n");

  return { subject, text };
}
