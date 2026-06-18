import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import { mergeActivity, type ActivityEvent } from "@/lib/activity/merge";

/**
 * Per-tenant unified activity timeline (read-only). Aggregates EXISTING rows
 * for a tenant — payments, ledger charges, reminders, notices, requests,
 * maintenance jobs on their unit(s), audit-log entries, and inbound SMS replies
 * — into one newest-first feed via the pure {@link mergeActivity}.
 *
 * Read-only by construction: it never writes and never re-implements balance
 * math — money is taken straight off existing rows and only ever formatted for
 * display. No schema changes; everything hangs off existing columns.
 */

/** Per-source cap, so one noisy source can't crowd out the others. */
const PER_SOURCE = 15;
/** Overall default cap on the merged feed. */
const DEFAULT_LIMIT = 50;

/** Human label for the verb on an audit row's entity (display only). */
function auditTitle(action: string, entityType: string | null): string {
  const verb = action.replace(/[._]/g, " ");
  return entityType ? `${entityType}: ${verb}` : verb;
}

export async function tenantActivity(
  tenantId: string,
  opts?: { limit?: number },
): Promise<ActivityEvent[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;

  // Resolve the tenant's leases (as primary AND as co-tenant), their units, and
  // each lease's property currency in one round trip — these scope the
  // lease/unit-keyed sources below and pick the display currency.
  const leaseSelect = {
    id: true,
    unitId: true,
    unit: { select: { property: { select: { currency: true } } } },
  } as const;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      leases: { select: leaseSelect },
      coLeases: { select: { lease: { select: leaseSelect } } },
    },
  });
  if (!tenant) return [];

  const leaseRows = [
    ...tenant.leases,
    ...tenant.coLeases.map((ct) => ct.lease),
  ];
  const leaseIds = [...new Set(leaseRows.map((l) => l.id))];
  const unitIds = [...new Set(leaseRows.map((l) => l.unitId))];

  // Money is formatted for display only (never computed). Currency follows the
  // tenant's lease/property; a tenant's leases are in one operator's currency in
  // practice, so the first resolved currency wins (USD when they have no lease).
  const currency = leaseRows[0]?.unit.property.currency ?? "USD";

  const [payments, charges, reminders, notices, requests, maintenance, audits, inbound] =
    await Promise.all([
      // Payments on any of the tenant's leases.
      leaseIds.length
        ? prisma.payment.findMany({
            where: { leaseId: { in: leaseIds } },
            orderBy: { paymentDate: "desc" },
            take: PER_SOURCE,
            select: {
              id: true,
              paymentDate: true,
              amountCents: true,
              method: true,
              status: true,
            },
          })
        : [],
      // Ledger charges (rent + late fees) — the bills the tenant was issued.
      leaseIds.length
        ? prisma.ledgerEntry.findMany({
            where: {
              leaseId: { in: leaseIds },
              entryType: { in: ["rent_charge", "late_fee"] },
            },
            orderBy: { effectiveDate: "desc" },
            take: PER_SOURCE,
            select: {
              id: true,
              entryType: true,
              amountCents: true,
              effectiveDate: true,
              periodKey: true,
            },
          })
        : [],
      // Reminders/notifications sent to the tenant.
      prisma.reminder.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: {
          id: true,
          reminderType: true,
          channel: true,
          status: true,
          sentAt: true,
          createdAt: true,
        },
      }),
      // Legal/formal notices addressed to the tenant.
      prisma.notice.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: {
          id: true,
          type: true,
          status: true,
          subject: true,
          servedAt: true,
          createdAt: true,
        },
      }),
      // Portal requests the tenant submitted.
      prisma.tenantRequest.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: {
          id: true,
          type: true,
          status: true,
          message: true,
          createdAt: true,
        },
      }),
      // Maintenance jobs on the tenant's unit(s). Property-wide jobs (null
      // unitId) are excluded — they aren't specific to this tenant.
      unitIds.length
        ? prisma.maintenanceJob.findMany({
            where: { unitId: { in: unitIds } },
            orderBy: { createdAt: "desc" },
            take: PER_SOURCE,
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              createdAt: true,
            },
          })
        : [],
      // Audit trail for the tenant and their leases (append-only history).
      prisma.auditLog.findMany({
        where: {
          OR: [
            { entityType: "Tenant", entityId: tenantId },
            ...(leaseIds.length
              ? [{ entityType: "Lease", entityId: { in: leaseIds } }]
              : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
        select: {
          id: true,
          action: true,
          entityType: true,
          actorEmail: true,
          createdAt: true,
        },
      }),
      // Inbound SMS replies the tenant texted in (two-way inbox).
      prisma.inboundMessage.findMany({
        where: { tenantId },
        orderBy: { receivedAt: "desc" },
        take: PER_SOURCE,
        select: { id: true, body: true, fromPhone: true, receivedAt: true },
      }),
    ]);

  const groups: ActivityEvent[][] = [
    payments.map((p) => ({
      id: `payment:${p.id}`,
      at: p.paymentDate,
      kind: "payment" as const,
      title: `Payment ${p.status === "voided" ? "voided" : "recorded"} · ${formatCurrency(p.amountCents, currency)}`,
      detail: p.method.replace(/_/g, " "),
      href: `/payments`,
    })),
    charges.map((c) => ({
      id: `charge:${c.id}`,
      at: c.effectiveDate,
      kind: "charge" as const,
      title: `${c.entryType === "late_fee" ? "Late fee" : "Rent charge"} · ${formatCurrency(c.amountCents, currency)}`,
      detail: c.periodKey ? `Period ${c.periodKey}` : undefined,
    })),
    reminders.map((r) => ({
      id: `reminder:${r.id}`,
      at: r.sentAt ?? r.createdAt,
      kind: "reminder" as const,
      title: `Reminder · ${r.reminderType.replace(/_/g, " ")}`,
      detail: `${r.channel.toUpperCase()} · ${r.status}`,
      href: `/reminders`,
    })),
    notices.map((n) => ({
      id: `notice:${n.id}`,
      at: n.servedAt ?? n.createdAt,
      kind: "notice" as const,
      title: `Notice · ${n.type.replace(/_/g, " ")}`,
      detail: `${n.subject} · ${n.status}`,
      href: `/notices/${n.id}`,
    })),
    requests.map((req) => ({
      id: `request:${req.id}`,
      at: req.createdAt,
      kind: "request" as const,
      title: `Request · ${req.type.replace(/_/g, " ")}`,
      detail:
        req.message?.trim()
          ? `${req.status} · ${req.message.trim()}`
          : req.status,
      href: `/requests`,
    })),
    maintenance.map((m) => ({
      id: `maintenance:${m.id}`,
      at: m.createdAt,
      kind: "maintenance" as const,
      title: `Maintenance · ${m.title}`,
      detail: `${m.priority} · ${m.status}`,
      href: `/maintenance/${m.id}`,
    })),
    audits.map((a) => ({
      id: `audit:${a.id}`,
      at: a.createdAt,
      kind: "audit" as const,
      title: auditTitle(a.action, a.entityType),
      detail: a.actorEmail ?? undefined,
    })),
    inbound.map((m) => ({
      id: `message:${m.id}`,
      at: m.receivedAt,
      kind: "message" as const,
      title: "Reply received",
      detail: m.body.trim() ? m.body.trim() : m.fromPhone,
      href: `/messages`,
    })),
  ];

  return mergeActivity(groups).slice(0, limit);
}
