import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/enums";
import { writeAudit } from "@/lib/audit/audit";
import { toCents } from "@/lib/money";
import {
  getAppSettings,
  resolveEmailProvider,
} from "@/lib/services/app-settings";
import { getOverdue } from "@/lib/services/reports";
import { expiringLeases } from "@/lib/services/lease-expirations";
import {
  formatExpirationDigest,
  formatMaintenanceDigest,
  formatOverdueDigest,
  isoWeekKey,
  type ExpirationDigestRow,
  type MaintenanceDigestJobRow,
  type MaintenanceDigestTaskRow,
  type OverdueDigestRow,
} from "@/lib/reminders/digest";
import { nextOccurrenceISO } from "@/lib/maintenance/schedule";
import { OPEN_STATUSES } from "@/lib/maintenance/status";
import type { EmailProvider } from "@/lib/providers/email/types";

/**
 * Weekly staff digests (worker, STAFF_DIGEST_CRON — Mondays by default):
 * overdue rent, the coming week's maintenance schedule, and leases expiring
 * within the configured alert window. Recipients are active owner/admin/finance/
 * manager users, individually opt-out-able via the per-user notification toggles
 * (Settings → Notifications). Cron-only (never runs at worker startup) so
 * restarts cannot double-send.
 */

export interface StaffDigestResult {
  sent: number;
  skipped: number;
  reason?: string;
}

/** Roles that receive staff notifications; viewers are read-only and excluded. */
export const STAFF_ROLES: Role[] = ["owner", "admin", "finance", "manager"];

/** Per-user opt-out columns, one per notification type. */
type NotifyFlag =
  | "notifyOverdueDigest"
  | "notifyMaintenanceDigest"
  | "notifyLeaseExpiration"
  | "notifyCashPickup";

/**
 * Active staff (manager+) who have the given notification toggle on. Returns
 * email + phone so callers can choose the channel (digests are email-only).
 */
export async function staffNotificationRecipients(
  flag: NotifyFlag,
): Promise<{ email: string; phone: string | null }[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: STAFF_ROLES }, [flag]: true },
    select: { email: true, phone: true },
    orderBy: { email: "asc" },
  });
  return users.filter((u) => u.email.trim() !== "");
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runWeeklyStaffDigest(
  now: Date,
): Promise<StaffDigestResult> {
  const settings = await getAppSettings();
  if (!settings.emailEnabled) {
    return { sent: 0, skipped: 0, reason: "email disabled" };
  }

  // Overdue rows come from the same report the rent-roll screen/CSV uses —
  // never re-derive balance math here.
  const rows = await getOverdue(now);
  if (rows.length === 0) {
    return { sent: 0, skipped: 0, reason: "nothing overdue" };
  }

  const recipients = await staffNotificationRecipients("notifyOverdueDigest");
  if (recipients.length === 0) {
    return { sent: 0, skipped: 0, reason: "no staff recipients" };
  }

  let provider: EmailProvider;
  try {
    provider = await resolveEmailProvider();
  } catch (e) {
    // Unconfigured/incomplete email: every would-be recipient is skipped.
    return { sent: 0, skipped: recipients.length, reason: errorMessage(e) };
  }

  // Shape report rows (display strings) into the pure formatter's input.
  // toCents is the one sanctioned parser back to integer cents.
  const digestRows: OverdueDigestRow[] = rows.map((r) => ({
    tenantName: r.tenant,
    propertyName: r.property,
    unitLabel: r.unit,
    pastDueCents: toCents(r.pastDue),
    balanceCents: toCents(r.balance),
    currency: settings.defaultCurrency,
    daysSinceLastPayment: r.lastPaidDays === "" ? null : Number(r.lastPaidDays),
  }));
  const digest = formatOverdueDigest({
    businessName: settings.businessName,
    now,
    rows: digestRows,
  });
  if (!digest) {
    // Defensive: rows.length > 0 above means this cannot happen.
    return { sent: 0, skipped: 0, reason: "nothing overdue" };
  }

  // Same digest to every recipient, sequentially; one failure never blocks
  // the rest of the staff list.
  let sent = 0;
  let skipped = 0;
  for (const recipient of recipients) {
    try {
      const res = await provider.send({
        to: recipient.email,
        subject: digest.subject,
        text: digest.text,
      });
      if (res.status === "failed") skipped++;
      else sent++;
    } catch (e) {
      skipped++;
      console.error(`[staff-digest] send failed:`, errorMessage(e));
    }
  }

  // ONE audit row per weekly run, keyed by ISO week. Aggregates only — no
  // recipient addresses, no per-tenant balances. BigInt cents go in as string.
  await writeAudit(prisma, {
    actorType: "system",
    actorId: null,
    action: "digest.staff_overdue_sent",
    entityType: "StaffDigest",
    entityId: isoWeekKey(now),
    after: {
      recipients: sent,
      overdueCount: rows.length,
      totalPastDueCents: digest.totalPastDueCents.toString(),
    },
  });

  return { sent, skipped };
}

/**
 * Weekly maintenance-schedule digest: pending jobs due in the next 7 days
 * (plus anything already overdue) and recurring tasks whose next occurrence
 * falls in the next 7 days. Skipped entirely when the Maintenance module or
 * email is off. Same Monday cron as the overdue digest, cron-only.
 */
export async function runWeeklyMaintenanceDigest(
  now: Date,
): Promise<StaffDigestResult> {
  const settings = await getAppSettings();
  if (!settings.modules.maintenance) {
    return { sent: 0, skipped: 0, reason: "maintenance module disabled" };
  }
  if (!settings.emailEnabled) {
    return { sent: 0, skipped: 0, reason: "email disabled" };
  }

  const [jobs, tasks] = await Promise.all([
    prisma.maintenanceJob.findMany({
      where: { status: { in: OPEN_STATUSES }, dueDate: { not: null } },
      include: {
        property: { select: { name: true, timezone: true } },
        unit: { select: { unitNumber: true } },
      },
    }),
    prisma.recurringTask.findMany({
      where: { active: true, dueDay: { not: null } },
      include: { property: { select: { name: true, timezone: true } } },
    }),
  ]);

  const WINDOW_DAYS = 7;
  const jobRows: MaintenanceDigestJobRow[] = [];
  for (const j of jobs) {
    const tz = j.property.timezone;
    const today = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
    // Stored dueDate is midnight in the property tz — render it back there.
    const due = DateTime.fromJSDate(j.dueDate as Date, { zone: tz }).startOf("day");
    const daysUntil = Math.round(due.diff(today, "days").days);
    if (daysUntil > WINDOW_DAYS) continue; // anything older stays (overdue)
    jobRows.push({
      title: j.title,
      propertyName: j.property.name,
      unitLabel: j.unit?.unitNumber ?? null,
      dueISO: due.toFormat("yyyy-MM-dd"),
      overdue: daysUntil < 0,
    });
  }

  const taskRows: MaintenanceDigestTaskRow[] = [];
  for (const t of tasks) {
    const tz = t.property.timezone;
    const occurrenceISO = nextOccurrenceISO({
      now,
      tz,
      dueDay: t.dueDay as number, // non-null by the where clause
    });
    const today = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
    const occurrence = DateTime.fromISO(occurrenceISO, { zone: tz });
    const daysUntil = Math.round(occurrence.diff(today, "days").days);
    if (daysUntil < 0 || daysUntil > WINDOW_DAYS) continue;
    // Already done this month (in the property tz) → not due again yet.
    if (
      t.lastDoneOn &&
      DateTime.fromJSDate(t.lastDoneOn, { zone: tz }).hasSame(occurrence, "month")
    ) {
      continue;
    }
    taskRows.push({
      title: t.title,
      propertyName: t.property.name,
      dueISO: occurrenceISO,
    });
  }

  const digest = formatMaintenanceDigest({
    businessName: settings.businessName,
    now,
    jobs: jobRows,
    tasks: taskRows,
  });
  if (!digest) {
    return { sent: 0, skipped: 0, reason: "nothing scheduled" };
  }

  const recipients = await staffNotificationRecipients("notifyMaintenanceDigest");
  if (recipients.length === 0) {
    return { sent: 0, skipped: 0, reason: "no staff recipients" };
  }

  let provider: EmailProvider;
  try {
    provider = await resolveEmailProvider();
  } catch (e) {
    return { sent: 0, skipped: recipients.length, reason: errorMessage(e) };
  }

  let sent = 0;
  let skipped = 0;
  for (const recipient of recipients) {
    try {
      const res = await provider.send({
        to: recipient.email,
        subject: digest.subject,
        text: digest.text,
      });
      if (res.status === "failed") skipped++;
      else sent++;
    } catch (e) {
      skipped++;
      console.error(`[maintenance-digest] send failed:`, errorMessage(e));
    }
  }

  // ONE audit row per weekly run, keyed by ISO week. Aggregates only.
  await writeAudit(prisma, {
    actorType: "system",
    actorId: null,
    action: "digest.staff_maintenance_sent",
    entityType: "StaffDigest",
    entityId: `maintenance:${isoWeekKey(now)}`,
    after: {
      recipients: sent,
      jobCount: jobRows.length,
      taskCount: taskRows.length,
    },
  });

  return { sent, skipped };
}

/**
 * Weekly lease-expiration digest: active leases ending within the configured
 * alert window (AppSettings.leaseExpirationAlertDays, default 60 — the same
 * window the dashboard section honors), plus any already past their end while
 * still active. Reuses the expiringLeases loader (pure expirationState math) —
 * never re-derives the date logic. Email-only, same Monday cron, cron-only so a
 * restart can't double-send (one audit row per ISO week is the idempotency key).
 */
export async function runWeeklyLeaseExpirationDigest(
  now: Date,
): Promise<StaffDigestResult> {
  const settings = await getAppSettings();
  if (!settings.emailEnabled) {
    return { sent: 0, skipped: 0, reason: "email disabled" };
  }

  // Single source of truth for the window + the date math.
  const leases = await expiringLeases({
    now,
    withinDays: settings.leaseExpirationAlertDays,
  });
  if (leases.length === 0) {
    return { sent: 0, skipped: 0, reason: "nothing expiring" };
  }

  const rows: ExpirationDigestRow[] = leases.map((l) => ({
    tenantName: l.tenantName,
    propertyName: l.propertyName,
    unitLabel: l.unitLabel,
    // endDate is stored midnight in the property tz — render it back there.
    endISO: DateTime.fromJSDate(l.endDate, { zone: l.timezone }).toFormat(
      "yyyy-MM-dd",
    ),
    daysUntilExpiry: l.daysUntilExpiry,
    state: l.state,
  }));

  const digest = formatExpirationDigest({
    businessName: settings.businessName,
    now,
    windowDays: settings.leaseExpirationAlertDays,
    rows,
  });
  if (!digest) {
    // Defensive: leases.length > 0 above means this cannot happen.
    return { sent: 0, skipped: 0, reason: "nothing expiring" };
  }

  const recipients = await staffNotificationRecipients("notifyLeaseExpiration");
  if (recipients.length === 0) {
    return { sent: 0, skipped: 0, reason: "no staff recipients" };
  }

  let provider: EmailProvider;
  try {
    provider = await resolveEmailProvider();
  } catch (e) {
    return { sent: 0, skipped: recipients.length, reason: errorMessage(e) };
  }

  let sent = 0;
  let skipped = 0;
  for (const recipient of recipients) {
    try {
      const res = await provider.send({
        to: recipient.email,
        subject: digest.subject,
        text: digest.text,
      });
      if (res.status === "failed") skipped++;
      else sent++;
    } catch (e) {
      skipped++;
      console.error(`[lease-expiration-digest] send failed:`, errorMessage(e));
    }
  }

  // ONE audit row per weekly run, keyed by ISO week. Aggregates only.
  await writeAudit(prisma, {
    actorType: "system",
    actorId: null,
    action: "digest.staff_lease_expiration_sent",
    entityType: "StaffDigest",
    entityId: `lease_expiration:${isoWeekKey(now)}`,
    after: {
      recipients: sent,
      leaseCount: rows.length,
      windowDays: settings.leaseExpirationAlertDays,
    },
  });

  return { sent, skipped };
}
