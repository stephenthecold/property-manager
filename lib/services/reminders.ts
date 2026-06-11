import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { Lease, Property, Tenant, Unit } from "@/lib/generated/prisma/client";
import type { ReminderStatus, ReminderType } from "@/lib/generated/prisma/enums";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { formatCurrency } from "@/lib/money";
import {
  getAppSettings,
  resolveSmsProvider,
} from "@/lib/services/app-settings";
import type { SendSmsResult } from "@/lib/providers/sms/types";
import { computeOpenCharges } from "@/lib/accounting/allocation";
import { daysBetween } from "@/lib/accounting/periods";
import { expectedMonthlyChargeCents } from "@/lib/accounting/rent";
import { leaseSnapshot, loadLeaseAccounting } from "@/lib/services/accounting";
import { buildReminderVars, renderTemplate } from "@/lib/reminders/templates";
import { dueSoonCandidate, isPastGrace } from "@/lib/reminders/rules";

/**
 * SMS reminder sending. Consent is absolute: no Reminder row is ever created for
 * a tenant without smsConsent + a phone number. Scheduled sends are idempotent
 * via the raw-SQL partial unique UNIQUE(leaseId, reminderType, periodKey) WHERE
 * periodKey IS NOT NULL (per tenant) — a duplicate insert raises P2002 and is skipped, so
 * worker re-runs and double clicks converge to one reminder per lease/type/period.
 */

type LeaseWithProperty = Lease & { unit: Unit & { property: Property } };

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Render the default template for a reminder type from the lease's financials. */
async function renderDefaultBody(
  reminderType: ReminderType,
  tenant: Pick<Tenant, "firstName" | "lastName">,
  lease: LeaseWithProperty,
  periodKey: string | null,
  now: Date,
): Promise<string> {
  const property = lease.unit.property;
  const tz = property.timezone;
  const currency = property.currency;
  const snapshot = await leaseSnapshot(lease, lease.unit, now, tz);

  // Prefer the explicit period's due date (it identifies the charge being
  // reminded about); fall back to the snapshot's current period.
  const dueDt = periodKey
    ? DateTime.fromFormat(periodKey, "yyyy-MM-dd", { zone: tz })
    : snapshot.currentPeriodDueDate
      ? DateTime.fromJSDate(snapshot.currentPeriodDueDate, { zone: tz })
      : null;
  const dueDateFormatted =
    dueDt && dueDt.isValid ? dueDt.toFormat("MMMM d, yyyy") : "";

  const amountDueCents =
    snapshot.currentPeriodOutstandingCents > 0n
      ? snapshot.currentPeriodOutstandingCents
      : expectedMonthlyChargeCents({
          rentAmountCents: lease.rentAmountCents,
          ...lease.unit,
        });

  const { templates } = await getAppSettings();
  return renderTemplate(
    templates[reminderType],
    buildReminderVars({
      tenantFirstName: tenant.firstName,
      tenantLastName: tenant.lastName,
      propertyName: property.name,
      unitLabel: lease.unit.unitNumber,
      amountDueFormatted: formatCurrency(amountDueCents, currency),
      dueDateFormatted,
      balanceFormatted: formatCurrency(snapshot.netBalanceCents, currency),
    }),
  );
}

export interface SendReminderInput {
  tenantId: string;
  leaseId?: string | null;
  reminderType: ReminderType;
  /** Provided for manual sends; scheduled types render DEFAULT_TEMPLATES. */
  messageBody?: string | null;
  periodKey?: string | null;
  actor: AuditContext;
  now?: Date;
}

export interface SendReminderResult {
  reminderId: string | null;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

export async function sendReminder(
  i: SendReminderInput,
): Promise<SendReminderResult> {
  const now = i.now ?? new Date();

  if (!(await getAppSettings()).smsEnabled) {
    return {
      reminderId: null,
      status: "skipped",
      error: "SMS sending is disabled in Settings → Messaging",
    };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: i.tenantId } });
  if (!tenant) {
    return { reminderId: null, status: "skipped", error: "tenant not found" };
  }
  // Consent is absolute: no consent or no phone -> no row, no send.
  if (!tenant.smsConsent) {
    return { reminderId: null, status: "skipped", error: "no SMS consent" };
  }
  const phone = tenant.phone?.trim();
  if (!phone) {
    return { reminderId: null, status: "skipped", error: "no phone number" };
  }

  let body: string;
  if (i.messageBody && i.messageBody.trim() !== "") {
    body = i.messageBody;
  } else {
    if (!i.leaseId) {
      return {
        reminderId: null,
        status: "skipped",
        error: "messageBody or leaseId required",
      };
    }
    const lease = await prisma.lease.findUnique({
      where: { id: i.leaseId },
      include: { unit: { include: { property: true } } },
    });
    if (!lease) {
      return { reminderId: null, status: "skipped", error: "lease not found" };
    }
    body = await renderDefaultBody(
      i.reminderType,
      tenant,
      lease,
      i.periodKey ?? null,
      now,
    );
  }

  // Create the row first (status queued): the partial unique on
  // (leaseId, tenantId, reminderType, periodKey) makes scheduled sends
  // idempotent per recipient (co-tenants each own their slot).
  let reminderId: string;
  try {
    const reminder = await prisma.reminder.create({
      data: {
        tenantId: tenant.id,
        leaseId: i.leaseId ?? null,
        reminderType: i.reminderType,
        periodKey: i.periodKey ?? null,
        destinationPhone: phone,
        messageBody: body,
        status: "queued",
        sentBy: i.actor.actorId ?? null,
      },
    });
    reminderId = reminder.id;
  } catch (e) {
    if (isUniqueViolation(e)) {
      // This tenant's slot exists. A failed (or crash-stranded queued)
      // occupant would otherwise block this period forever — retry delivery
      // on exactly that row (never another co-tenant's).
      if (i.leaseId && i.periodKey) {
        return retryExistingSlot(
          i.leaseId,
          tenant.id,
          i.reminderType,
          i.periodKey,
          i.actor,
          now,
        );
      }
      return { reminderId: null, status: "skipped", error: "duplicate" };
    }
    throw e;
  }

  let result: SendSmsResult;
  try {
    result = await (await resolveSmsProvider()).send({ to: phone, body });
  } catch (e) {
    result = { provider: "unknown", status: "failed", error: errorMessage(e) };
  }
  const ok = result.status !== "failed";
  const status: ReminderStatus = ok ? "sent" : "failed";

  await prisma.$transaction(async (tx) => {
    await tx.reminder.update({
      where: { id: reminderId },
      data: {
        status,
        provider: result.provider,
        providerMessageId: result.providerMessageId ?? null,
        sentAt: ok ? now : null,
      },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: ok ? "reminder.sent" : "reminder.failed",
      entityType: "Reminder",
      entityId: reminderId,
      // Never audit the full phone number or the message body.
      after: { reminderType: i.reminderType, toLast4: phone.slice(-4) },
    });
  });

  return ok
    ? { reminderId, status: "sent" }
    : { reminderId, status: "failed", error: result.error ?? "send failed" };
}

/** A queued row older than this is presumed stranded by a crash mid-send. */
const STUCK_QUEUED_MS = 15 * 60 * 1000;

/**
 * Retry delivery for an existing (leaseId, tenantId, reminderType, periodKey)
 * slot whose occupant is failed or crash-stranded. Successful/delivered
 * occupants are a normal duplicate-skip. Consent is re-checked — it may have
 * been revoked since the row was created.
 */
async function retryExistingSlot(
  leaseId: string,
  tenantId: string,
  reminderType: ReminderType,
  periodKey: string,
  actor: AuditContext,
  now: Date,
): Promise<SendReminderResult> {
  const row = await prisma.reminder.findFirst({
    where: { leaseId, tenantId, reminderType, periodKey },
  });
  const retryable =
    row &&
    (row.status === "failed" ||
      (row.status === "queued" &&
        now.getTime() - row.createdAt.getTime() > STUCK_QUEUED_MS));
  if (!row || !retryable) {
    return { reminderId: null, status: "skipped", error: "duplicate" };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: row.tenantId } });
  const phone = tenant?.smsConsent ? (tenant.phone?.trim() ?? "") : "";
  if (!phone) {
    return { reminderId: null, status: "skipped", error: "no SMS consent" };
  }

  let result: SendSmsResult;
  try {
    result = await (await resolveSmsProvider()).send({
      to: phone,
      body: row.messageBody,
    });
  } catch (e) {
    result = { provider: "unknown", status: "failed", error: errorMessage(e) };
  }
  const ok = result.status !== "failed";

  await prisma.$transaction(async (tx) => {
    await tx.reminder.update({
      where: { id: row.id },
      data: {
        status: ok ? "sent" : "failed",
        provider: result.provider,
        providerMessageId: result.providerMessageId ?? row.providerMessageId,
        destinationPhone: phone,
        sentAt: ok ? now : row.sentAt,
      },
    });
    await writeAudit(tx, {
      ...actor,
      action: ok ? "reminder.sent" : "reminder.failed",
      entityType: "Reminder",
      entityId: row.id,
      after: { reminderType, toLast4: phone.slice(-4), retry: true },
    });
  });

  return ok
    ? { reminderId: row.id, status: "sent" }
    : { reminderId: row.id, status: "failed", error: result.error ?? "send failed" };
}

export interface BulkOverdueResult {
  sent: number;
  failed: number;
  skippedNoConsent: number;
  skippedNoPhone: number;
  skippedDuplicate: number;
}

/**
 * Manual "remind everyone overdue" action. One rent_overdue per lease, keyed to
 * the OLDEST open overdue charge's period: a second click in the same period is
 * a duplicate-skip; once the next period goes overdue it fires again.
 */
export async function sendBulkOverdueReminders(
  actor: AuditContext,
  now: Date = new Date(),
): Promise<BulkOverdueResult> {
  const leases = await prisma.lease.findMany({
    where: { status: { in: ["active", "month_to_month"] } },
    include: {
      unit: { include: { property: true } },
      tenant: true,
      coTenants: { select: { tenantId: true } },
    },
  });

  const result: BulkOverdueResult = {
    sent: 0,
    failed: 0,
    skippedNoConsent: 0,
    skippedNoPhone: 0,
    skippedDuplicate: 0,
  };

  for (const lease of leases) {
    try {
      const tz = lease.unit.property.timezone;
      const { entries, charges, allocatedByCharge } = await loadLeaseAccounting(
        lease.id,
      );
      const open = computeOpenCharges(charges, allocatedByCharge);
      const periodKeyById = new Map(entries.map((e) => [e.id, e.periodKey]));
      // Open charges are oldest-first; the first one past its due date wins.
      const oldestOverdue = open.find(
        (c) => daysBetween(c.dueDate, now, tz) > 0 && periodKeyById.get(c.entryId),
      );
      if (!oldestOverdue) continue;

      // Same recipient set as the scheduled sweep, so manual and scheduled
      // sends fill the same per-tenant idempotency slots.
      for (const tenantId of [
        lease.tenantId,
        ...lease.coTenants.map((ct) => ct.tenantId),
      ]) {
        const r = await sendReminder({
          tenantId,
          leaseId: lease.id,
          reminderType: "rent_overdue",
          periodKey: periodKeyById.get(oldestOverdue.entryId) ?? null,
          actor,
          now,
        });
        if (r.status === "sent") result.sent++;
        else if (r.status === "failed") result.failed++;
        else if (r.error === "duplicate") result.skippedDuplicate++;
        else if (r.error === "no phone number") result.skippedNoPhone++;
        else result.skippedNoConsent++;
      }
    } catch (e) {
      result.failed++;
      console.error(
        `[reminders] bulk overdue failed for lease ${lease.id}:`,
        e,
      );
    }
  }
  return result;
}

export interface ScheduledRemindersResult {
  dueSoon: number;
  overdue: number;
  failed: number;
  skipped: number;
}

/**
 * Worker entry: per active lease send (a) one rent_due_soon when the upcoming
 * due date is within REMINDER_DUE_SOON_DAYS and that period's rent charge is
 * still outstanding, and (b) one rent_overdue per open charge past grace.
 * Idempotent via the partial unique; a bad lease never aborts the sweep.
 */
export async function runScheduledReminders(
  now: Date,
): Promise<ScheduledRemindersResult> {
  const actor: AuditContext = { actorType: "system", actorId: null };
  const settings = await getAppSettings();
  if (!settings.smsEnabled) {
    return { dueSoon: 0, overdue: 0, failed: 0, skipped: 0 };
  }
  const dueSoonDays = settings.dueSoonDays;

  const leases = await prisma.lease.findMany({
    where: { status: { in: ["active", "month_to_month"] } },
    include: {
      unit: { include: { property: true } },
      tenant: true,
      coTenants: { select: { tenantId: true } },
    },
  });

  const result: ScheduledRemindersResult = {
    dueSoon: 0,
    overdue: 0,
    failed: 0,
    skipped: 0,
  };

  for (const lease of leases) {
    try {
      const tz = lease.unit.property.timezone;
      // Every tenant on the lease gets scheduled reminders (consent permitting);
      // idempotency is per (lease, tenant, type, period), so co-tenants each
      // converge to one row. sendReminder enforces consent/phone per tenant.
      const recipientIds = [
        lease.tenantId,
        ...lease.coTenants.map((ct) => ct.tenantId),
      ];
      const { entries, charges, allocatedByCharge } = await loadLeaseAccounting(
        lease.id,
      );

      // (a) Rent due soon. Billing only mints a period's rent_charge once the
      // due date arrives, so for a future due date there is no charge row yet —
      // the reminder must NOT require one (or it could never fire early and
      // REMINDER_DUE_SOON_DAYS would be inert). When the charge already exists
      // (due today), send only while it is outstanding; when it does not exist
      // yet, send unless standing credit already covers the upcoming rent.
      const candidate = dueSoonCandidate({
        now,
        tz,
        dueDay: lease.dueDay,
        dueSoonDays,
      });
      if (candidate) {
        const charge = entries.find(
          (e) =>
            e.entryType === "rent_charge" && e.periodKey === candidate.periodKey,
        );
        let shouldSend: boolean;
        if (charge) {
          const outstanding =
            charge.amountCents - (allocatedByCharge[charge.id] ?? 0n);
          shouldSend = outstanding > 0n;
        } else {
          const netBalanceCents = entries.reduce(
            (sum, e) => sum + e.amountCents,
            0n,
          );
          shouldSend =
            netBalanceCents >
            -expectedMonthlyChargeCents({
              rentAmountCents: lease.rentAmountCents,
              ...lease.unit,
            });
        }
        if (shouldSend) {
          for (const tenantId of recipientIds) {
            const r = await sendReminder({
              tenantId,
              leaseId: lease.id,
              reminderType: "rent_due_soon",
              periodKey: candidate.periodKey,
              actor,
              now,
            });
            if (r.status === "sent") result.dueSoon++;
            else if (r.status === "failed") result.failed++;
            else result.skipped++;
          }
        }
      }

      // (b) One rent_overdue per open rent charge past its grace deadline.
      const rentChargeEntries = new Map(
        entries
          .filter((e) => e.entryType === "rent_charge" && e.periodKey)
          .map((e) => [e.id, e.periodKey as string]),
      );
      const open = computeOpenCharges(charges, allocatedByCharge);
      for (const c of open) {
        const periodKey = rentChargeEntries.get(c.entryId);
        if (!periodKey) continue;
        const pastGrace = isPastGrace({
          dueDate: c.dueDate,
          tz,
          gracePeriodDays: lease.gracePeriodDays,
          now,
        });
        if (!pastGrace) continue;

        for (const tenantId of recipientIds) {
          const r = await sendReminder({
            tenantId,
            leaseId: lease.id,
            reminderType: "rent_overdue",
            periodKey,
            actor,
            now,
          });
          if (r.status === "sent") result.overdue++;
          else if (r.status === "failed") result.failed++;
          else result.skipped++;
        }
      }
    } catch (e) {
      result.failed++;
      console.error(
        `[reminders] scheduled run failed for lease ${lease.id}:`,
        e,
      );
    }
  }
  return result;
}

const DELIVERY_STATUS_MAP: Record<string, ReminderStatus> = {
  delivered: "delivered",
  undelivered: "failed",
  failed: "failed",
  sent: "sent",
  queued: "sent",
  accepted: "sent",
};

/**
 * Apply a provider delivery-status callback. Idempotent, never downgrades a
 * delivered row, and writes no audit rows (webhook noise, not a user action).
 */
export async function recordDeliveryStatus(
  providerMessageId: string,
  providerStatus: string,
): Promise<boolean> {
  if (!providerMessageId) return false;
  const mapped = DELIVERY_STATUS_MAP[providerStatus.toLowerCase()];
  if (!mapped) return false;

  const where =
    mapped === "delivered"
      ? { providerMessageId }
      : { providerMessageId, status: { not: "delivered" as const } };
  const res = await prisma.reminder.updateMany({
    where,
    data: { status: mapped },
  });
  return res.count > 0;
}
