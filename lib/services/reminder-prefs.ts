import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import type { NotificationChannel, ReminderType } from "@/lib/generated/prisma/enums";
import {
  parseReminderPrefChannel,
  resolveEffectiveChannel,
  type ReminderPrefChannel,
} from "@/lib/reminders/pref";

/**
 * Service bridge for per-reminder-type channel overrides (TenantReminderPref).
 * The pure resolution + validation lives in lib/reminders/pref.ts; this module
 * only reads/writes the rows and audits changes. Every write is scoped to a
 * caller-supplied tenantId — callers in the portal MUST pass the signed-in
 * tenant's id (never a tenantId from a form).
 */

/**
 * The reminder types a tenant can self-manage in the portal. Internal types
 * (`manual`, `maintenance`) are deliberately excluded: `manual` is a staff
 * free-text send and `maintenance` is operational, not an automated dunning
 * reminder the tenant opts in/out of here.
 */
export const PORTAL_REMINDER_TYPES = [
  "rent_due_soon",
  "rent_overdue",
  "partial_balance",
  "payment_receipt",
] as const satisfies readonly ReminderType[];

export type PortalReminderType = (typeof PORTAL_REMINDER_TYPES)[number];

export function isPortalReminderType(v: string): v is PortalReminderType {
  return (PORTAL_REMINDER_TYPES as readonly string[]).includes(v);
}

/** Load all of a tenant's overrides as { reminderType → stored channel }. */
export async function loadReminderPrefMap(
  tenantId: string,
): Promise<Map<string, string>> {
  const rows = await prisma.tenantReminderPref.findMany({
    where: { tenantId },
    select: { reminderType: true, channel: true },
  });
  return new Map(rows.map((r) => [r.reminderType, r.channel]));
}

/** Per-tenant override lookup: tenantId → (reminderType → stored channel). */
export type ReminderPrefsByTenant = Map<string, Map<string, string>>;

/**
 * Batch-load all overrides for many tenants in ONE query, for the worker sweep
 * (which otherwise loops sendReminder over leases × recipients × charges).
 * EVERY requested id gets an entry (an empty map when it has no rows), so a
 * caller's `.get(id)` is always a defined map — passing it to sendReminder
 * therefore takes the no-query local-resolve path even for tenants with no
 * overrides (the common case). Mirrors batchLeaseAccounting /
 * loadTenantOverdueGuards so the sweep stays at a fixed number of queries
 * instead of an N+1 on the hot path.
 */
export async function loadReminderPrefsForTenants(
  tenantIds: string[],
): Promise<ReminderPrefsByTenant> {
  const byTenant: ReminderPrefsByTenant = new Map(
    tenantIds.map((id) => [id, new Map<string, string>()]),
  );
  if (tenantIds.length === 0) return byTenant;
  const rows = await prisma.tenantReminderPref.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { tenantId: true, reminderType: true, channel: true },
  });
  for (const r of rows) {
    // Every tenantId from `rows` was in `tenantIds`, so the map always exists.
    byTenant.get(r.tenantId)?.set(r.reminderType, r.channel);
  }
  return byTenant;
}

/**
 * The effective channel for one (tenant, reminderType), layering the stored
 * override on top of the tenant's global `reminderChannel`. Returns null when
 * the tenant has muted this type ("off"). Used by the send path.
 */
export async function effectiveChannelFor(
  tenantId: string,
  reminderType: ReminderType,
  globalChannel: NotificationChannel,
): Promise<NotificationChannel | null> {
  const row = await prisma.tenantReminderPref.findUnique({
    where: { tenantId_reminderType: { tenantId, reminderType } },
    select: { channel: true },
  });
  return resolveEffectiveChannel({ globalChannel, override: row?.channel });
}

/**
 * Set (or clear) a tenant's override for one reminder type. Audited. Scoped to
 * the given tenantId. `channel` must be one of "sms" | "email" | "off"; an
 * unrecognized value is rejected (returns false, no write).
 *
 * Note: this stores the RAW preference. Consent gating ("you can't pick SMS
 * without SMS consent") is enforced at the action/UI layer, which has the
 * tenant's live consent + contact state — we never silently downgrade a saved
 * preference here, so re-granting consent restores the chosen channel.
 */
export async function setTenantReminderPref(
  tenantId: string,
  reminderType: PortalReminderType,
  channel: ReminderPrefChannel,
  actor: AuditContext,
): Promise<boolean> {
  if (parseReminderPrefChannel(channel) == null) return false;

  const existing = await prisma.tenantReminderPref.findUnique({
    where: { tenantId_reminderType: { tenantId, reminderType } },
    select: { channel: true },
  });
  if (existing?.channel === channel) return true; // no-op, no audit noise

  await prisma.$transaction(async (tx) => {
    await tx.tenantReminderPref.upsert({
      where: { tenantId_reminderType: { tenantId, reminderType } },
      create: { tenantId, reminderType, channel },
      update: { channel },
    });
    await writeAudit(tx, {
      ...actor,
      action: "tenant.reminder_pref_updated",
      entityType: "Tenant",
      entityId: tenantId,
      before: { reminderType, channel: existing?.channel ?? null },
      after: { reminderType, channel },
    });
  });
  return true;
}
