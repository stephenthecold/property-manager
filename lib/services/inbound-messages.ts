import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { writeAudit } from "@/lib/audit/audit";
import { phoneKey } from "@/lib/portal/identity";

/**
 * Two-way SMS inbox (Initiative H). Inbound, NON-keyword SMS replies are captured
 * here into a per-tenant thread staff can read in the Messages inbox. STOP/START/
 * HELP keywords are handled by the consent flow (`sms-consent.ts`) and are NEVER
 * stored as messages.
 *
 * Capture is BEST-EFFORT: `recordInboundSms` must never throw, so the inbound
 * webhook can always return 200 (a thrown capture would make Twilio retry-storm).
 * `InboundMessage` is an operational record — it never touches the ledger or
 * tenant balances.
 */

/** Defensive cap so a hostile/oversized body can't bloat a row (Twilio SMS ≤ 1600). */
const MAX_BODY_LENGTH = 1600;

/**
 * Match a tenant by inbound phone using the SAME canonical last-10-digit key the
 * consent flow uses (`phoneKey`), so the inbox and STOP/START handling agree on
 * who a number belongs to. Returns the first matching tenant id, or null.
 */
async function matchTenantIdByPhone(rawPhone: string): Promise<string | null> {
  const key = phoneKey(rawPhone);
  if (!key) return null;
  const candidates = await prisma.tenant.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
  });
  return candidates.find((t) => phoneKey(t.phone) === key)?.id ?? null;
}

export interface RecordInboundSmsInput {
  fromPhone: string;
  body: string;
  providerSid?: string | null;
}

/**
 * Capture one inbound (non-keyword) SMS. Best-effort: swallows all errors and
 * logs, so the caller (the inbound webhook) always succeeds. Returns the created
 * row id, or null when capture failed.
 */
export async function recordInboundSms(
  input: RecordInboundSmsInput,
): Promise<string | null> {
  try {
    const fromPhone = (input.fromPhone ?? "").trim();
    if (!fromPhone) return null; // nothing to attribute a message to
    const body = (input.body ?? "").slice(0, MAX_BODY_LENGTH);
    const tenantId = await matchTenantIdByPhone(fromPhone);
    const providerSid = input.providerSid?.trim() || null;

    const row = await prisma.inboundMessage.create({
      data: { channel: "sms", fromPhone, body, tenantId, providerSid },
      select: { id: true },
    });

    // Audit is also best-effort — a failed audit row must NOT lose the capture.
    try {
      await writeAudit(prisma, {
        actorType: "system",
        actorEmail: "inbound SMS",
        action: "inbound_message.received",
        entityType: "InboundMessage",
        entityId: row.id,
        after: { fromPhone, tenantId, providerSid },
      });
    } catch (auditErr) {
      console.error(
        "[sms:inbound] audit write failed (message captured):",
        auditErr instanceof Error ? auditErr.message : "unknown error",
      );
    }

    return row.id;
  } catch (e) {
    console.error(
      "[sms:inbound] failed to capture inbound message:",
      e instanceof Error ? e.message : "unknown error",
    );
    return null;
  }
}

export interface InboundMessageRow {
  id: string;
  fromPhone: string;
  body: string;
  tenantId: string | null;
  providerSid: string | null;
  receivedAt: Date;
  readAt: Date | null;
  tenant: { id: string; firstName: string; lastName: string } | null;
}

// Typed against InboundMessageSelect so an invalid field (e.g. a relation that
// doesn't exist) is a compile error here, not a runtime Prisma throw.
const INBOUND_SELECT = {
  id: true,
  fromPhone: true,
  body: true,
  tenantId: true,
  providerSid: true,
  receivedAt: true,
  readAt: true,
  tenant: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.InboundMessageSelect;

/** Inbound messages newest-first, optionally only unread, for the staff inbox. */
export async function listInboundMessages(
  opts: { unreadOnly?: boolean } = {},
): Promise<InboundMessageRow[]> {
  return prisma.inboundMessage.findMany({
    where: opts.unreadOnly ? { readAt: null } : undefined,
    orderBy: { receivedAt: "desc" },
    select: INBOUND_SELECT,
  });
}

/** Inbound messages for one tenant, newest-first (tenant-detail "Messages" card). */
export async function listInboundForTenant(
  tenantId: string,
): Promise<InboundMessageRow[]> {
  return prisma.inboundMessage.findMany({
    where: { tenantId },
    orderBy: { receivedAt: "desc" },
    select: INBOUND_SELECT,
  });
}

/** Count of unread inbound messages (for the nav/inbox unread badge). */
export async function countUnreadInbound(): Promise<number> {
  return prisma.inboundMessage.count({ where: { readAt: null } });
}

/** Mark one inbound message read (idempotent — never re-stamps an already-read row). */
export async function markInboundRead(id: string): Promise<void> {
  await prisma.inboundMessage.updateMany({
    where: { id, readAt: null },
    data: { readAt: new Date() },
  });
}
