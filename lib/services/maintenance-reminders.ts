import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import type { AuditContext } from "@/lib/audit/audit";
import { getAppSettings } from "@/lib/services/app-settings";
import { sendReminder } from "@/lib/services/reminders";
import { buildMaintenanceVars, renderTemplate } from "@/lib/reminders/templates";
import { nextOccurrenceISO, notifyWindow } from "@/lib/maintenance/schedule";

/**
 * Daily maintenance-reminder sweep (worker, same cron as rent reminders).
 * Sends consent-gated SMS to tenants ahead of scheduled recurring tasks
 * (RecurringTask.dueDay) and one-off jobs (MaintenanceJob.dueDate) that have
 * notifyTenants enabled. Idempotent per occurrence via the Reminder partial
 * unique — periodKey is "yyyy-MM-dd/mt:<taskOrJobId>", so each tenant gets at
 * most one text per occurrence even though the window spans several days.
 */

export interface MaintenanceRemindersResult {
  sent: number;
  failed: number;
  skipped: number;
}

/** A recurring task or pending job normalized to one notifiable occurrence. */
interface NotifiableItem {
  /** RecurringTask.id or MaintenanceJob.id — part of the idempotency key. */
  id: string;
  title: string;
  propertyId: string;
  propertyName: string;
  tz: string;
  /** Job scoped to a unit; null = whole property (and all recurring tasks). */
  unitId: string | null;
  /** "yyyy-MM-dd" occurrence date in the property tz. */
  occurrenceISO: string;
  daysBefore: number;
}

export async function runMaintenanceReminders(
  now: Date,
): Promise<MaintenanceRemindersResult> {
  const result: MaintenanceRemindersResult = { sent: 0, failed: 0, skipped: 0 };

  const settings = await getAppSettings();
  if (!settings.modules.maintenance || !settings.smsEnabled) return result;
  const template = settings.templates.maintenance;
  const actor: AuditContext = { actorType: "system", actorId: null };

  const [tasks, jobs] = await Promise.all([
    prisma.recurringTask.findMany({
      where: { active: true, notifyTenants: true, dueDay: { not: null } },
      include: { property: { select: { name: true, timezone: true } } },
    }),
    prisma.maintenanceJob.findMany({
      where: { status: "pending", notifyTenants: true, dueDate: { not: null } },
      include: {
        property: { select: { name: true, timezone: true } },
        unit: { select: { id: true } },
      },
    }),
  ]);

  const items: NotifiableItem[] = [
    ...tasks.map((t) => ({
      id: t.id,
      title: t.title,
      propertyId: t.propertyId,
      propertyName: t.property.name,
      tz: t.property.timezone,
      unitId: null,
      occurrenceISO: nextOccurrenceISO({
        now,
        tz: t.property.timezone,
        dueDay: t.dueDay as number, // non-null by the where clause
      }),
      daysBefore: t.notifyDaysBefore,
    })),
    ...jobs.map((j) => ({
      id: j.id,
      title: j.title,
      propertyId: j.propertyId,
      propertyName: j.property.name,
      tz: j.property.timezone,
      unitId: j.unitId,
      // The stored dueDate is midnight in the property tz — render it back
      // there so behind-UTC zones don't shift to the previous civil day.
      occurrenceISO: DateTime.fromJSDate(j.dueDate as Date, {
        zone: j.property.timezone,
      }).toFormat("yyyy-MM-dd"),
      daysBefore: j.notifyDaysBefore,
    })),
  ];

  for (const item of items) {
    try {
      const inWindow = notifyWindow({
        now,
        tz: item.tz,
        occurrenceISO: item.occurrenceISO,
        daysBefore: item.daysBefore,
      });
      if (!inWindow) continue;

      // Recipients: active leases of the unit (unit-scoped job) or of the
      // whole property (property-wide job / recurring task).
      const leases = await prisma.lease.findMany({
        where: {
          status: { in: ["active", "month_to_month"] },
          ...(item.unitId
            ? { unitId: item.unitId }
            : { unit: { propertyId: item.propertyId } }),
        },
        include: {
          unit: { select: { unitNumber: true } },
          tenant: true,
          coTenants: { select: { tenantId: true } },
        },
      });
      if (leases.length === 0) continue;

      // Co-tenant Tenant rows (names for the template) in one query.
      const coTenantIds = [
        ...new Set(leases.flatMap((l) => l.coTenants.map((ct) => ct.tenantId))),
      ];
      const coTenantById = new Map(
        (coTenantIds.length
          ? await prisma.tenant.findMany({ where: { id: { in: coTenantIds } } })
          : []
        ).map((t) => [t.id, t]),
      );

      const dateFormatted = DateTime.fromISO(item.occurrenceISO, {
        zone: item.tz,
      }).toFormat("MMMM d, yyyy");
      const periodKey = `${item.occurrenceISO}/mt:${item.id}`;

      for (const lease of leases) {
        const recipients = [
          lease.tenant,
          ...lease.coTenants.flatMap((ct) => {
            const t = coTenantById.get(ct.tenantId);
            return t ? [t] : [];
          }),
        ];
        for (const tenant of recipients) {
          const messageBody = renderTemplate(
            template,
            buildMaintenanceVars({
              tenantFirstName: tenant.firstName,
              tenantLastName: tenant.lastName,
              propertyName: item.propertyName,
              unitLabel: lease.unit.unitNumber,
              maintenanceTitle: item.title,
              maintenanceDateFormatted: dateFormatted,
            }),
          );
          const r = await sendReminder({
            tenantId: tenant.id,
            leaseId: lease.id,
            reminderType: "maintenance",
            messageBody,
            periodKey,
            actor,
            now,
          });
          if (r.status === "sent") result.sent++;
          else if (r.status === "failed") result.failed++;
          else result.skipped++;
        }
      }
    } catch (e) {
      // One bad task/job never aborts the sweep.
      result.failed++;
      console.error(
        `[maintenance-reminders] sweep failed for item ${item.id}:`,
        e,
      );
    }
  }

  return result;
}
