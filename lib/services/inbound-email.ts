import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { emailKey } from "@/lib/portal/identity";
import { createUploadedDocument, runOcrOnDocument } from "@/lib/services/documents";
import { syntheticMessageKey } from "@/lib/providers/inbound-email/parse";
import type { ParsedInboundEmail } from "@/lib/providers/inbound-email/types";

/**
 * Inbound email inbox (module "mailbox"). Captures email pulled off a mailbox by
 * the worker poll into a staff inbox: invoices/receipts (→ a human-reviewed
 * expense) and correspondence. Capture is BEST-EFFORT and IDEMPOTENT on
 * messageId, so a re-poll never double-records and one bad message can't sink
 * the batch. `InboundEmail` is an OPERATING record — it never touches the ledger
 * or tenant balances; an emailed invoice only becomes money via a reviewed
 * PropertyExpense.
 *
 * NOTE: this module stays FREE of any IMAP/MIME-parser import so app routes that
 * read the inbox don't drag the mail client into the Next.js bundle — the
 * provider/poll live in lib/services/inbox-poll.ts (worker-only).
 */

/** System actor for worker-side capture (no signed-in user). */
const SYSTEM_ACTOR: AuditContext = {
  actorType: "system",
  actorEmail: "inbound email",
};

/** Match a tenant by sender email (canonical, case-insensitive). */
async function matchTenantIdByEmail(rawEmail: string): Promise<string | null> {
  const key = emailKey(rawEmail);
  if (!key) return null;
  const tenant = await prisma.tenant.findFirst({
    where: { email: { equals: key, mode: "insensitive" } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return tenant?.id ?? null;
}

/**
 * Record one captured email (idempotent on messageId). Stores the row, then its
 * safe attachments as UploadedDocuments (best-effort OCR for prefill), and
 * returns the row id (or the existing id on a re-poll). NEVER throws.
 */
export async function recordInboundEmail(
  msg: ParsedInboundEmail,
): Promise<string | null> {
  try {
    const fromEmail = (msg.fromEmail ?? "").trim();
    // Always a non-null dedup key: real Message-ID, else a deterministic hash.
    const dedupKey =
      msg.messageId?.trim() ||
      syntheticMessageKey({
        fromEmail,
        subject: msg.subject ?? null,
        receivedAt: msg.receivedAt ?? new Date(),
        size: (msg.text ?? "").length + (msg.attachments?.length ?? 0),
      });

    const existing = await prisma.inboundEmail.findUnique({
      where: { messageId: dedupKey },
      select: { id: true },
    });
    if (existing) return existing.id;

    const tenantId = await matchTenantIdByEmail(fromEmail);
    const created = await prisma.inboundEmail.create({
      data: {
        messageId: dedupKey,
        fromEmail: fromEmail || "(unknown)",
        fromName: msg.fromName ?? null,
        toAddress: msg.toAddress ?? null,
        subject: msg.subject ?? null,
        body: msg.text ?? "",
        tenantId,
        attachmentCount: 0,
        status: "new",
        receivedAt: msg.receivedAt ?? new Date(),
      },
      select: { id: true },
    });

    // Attachments reference the row, so they're stored after it exists.
    let stored = 0;
    for (const att of msg.attachments ?? []) {
      try {
        const { documentId } = await createUploadedDocument({
          body: att.content,
          fileName: att.filename,
          contentType: att.contentType,
          uploadType: "email_attachment",
          inboundEmailId: created.id,
          tenantId,
          notes: `Inbound email from ${fromEmail || "unknown"}${
            msg.subject ? ` — ${msg.subject}` : ""
          }`,
          actor: SYSTEM_ACTOR,
        });
        stored++;
        // Best-effort OCR so the review form can prefill amount/date/reference.
        try {
          await runOcrOnDocument(documentId, SYSTEM_ACTOR);
        } catch {
          // OCR is optional; a failure must not lose the attachment.
        }
      } catch (attErr) {
        console.error(
          "[inbox] attachment store failed:",
          attErr instanceof Error ? attErr.message : "unknown error",
        );
      }
    }
    if (stored > 0) {
      await prisma.inboundEmail.update({
        where: { id: created.id },
        data: { attachmentCount: stored },
      });
    }

    try {
      await writeAudit(prisma, {
        ...SYSTEM_ACTOR,
        action: "inbound_email.received",
        entityType: "InboundEmail",
        entityId: created.id,
        after: {
          fromEmail,
          subject: msg.subject ?? null,
          tenantId,
          attachmentCount: stored,
        },
      });
    } catch (auditErr) {
      console.error(
        "[inbox] audit write failed (email captured):",
        auditErr instanceof Error ? auditErr.message : "unknown error",
      );
    }

    return created.id;
  } catch (e) {
    console.error(
      "[inbox] failed to capture inbound email:",
      e instanceof Error ? e.message : "unknown error",
    );
    return null;
  }
}

export type InboxStatus = "new" | "archived" | "posted";

export interface InboundEmailRow {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  attachmentCount: number;
  status: string;
  tenantId: string | null;
  propertyExpenseId: string | null;
  receivedAt: Date;
  readAt: Date | null;
  tenant: { id: string; firstName: string; lastName: string } | null;
}

const INBOX_SELECT = {
  id: true,
  fromEmail: true,
  fromName: true,
  subject: true,
  attachmentCount: true,
  status: true,
  tenantId: true,
  propertyExpenseId: true,
  receivedAt: true,
  readAt: true,
  tenant: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.InboundEmailSelect;

/** Inbox rows newest-first, filtered by triage status ("new" by default). */
export async function listInboundEmails(
  opts: { status?: InboxStatus | "all" } = {},
): Promise<InboundEmailRow[]> {
  const status = opts.status ?? "new";
  return prisma.inboundEmail.findMany({
    where: status === "all" ? undefined : { status },
    orderBy: { receivedAt: "desc" },
    select: INBOX_SELECT,
  });
}

/** Count of new (un-triaged, unread) inbox items — for the page badge. */
export async function countNewInboundEmails(): Promise<number> {
  return prisma.inboundEmail.count({ where: { status: "new", readAt: null } });
}

/** One inbox item with its stored attachments (for the detail page). */
export async function getInboundEmail(id: string) {
  const email = await prisma.inboundEmail.findUnique({
    where: { id },
    include: {
      tenant: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!email) return null;
  const attachments = await prisma.uploadedDocument.findMany({
    where: { inboundEmailId: id },
    orderBy: { createdAt: "asc" },
  });
  return { email, attachments };
}

/** Mark one inbox item read (idempotent — never re-stamps an already-read row). */
export async function markInboundEmailRead(id: string): Promise<void> {
  await prisma.inboundEmail.updateMany({
    where: { id, readAt: null },
    data: { readAt: new Date() },
  });
}

/** Archive / un-archive an inbox item. A POSTED item is terminal and unchanged. */
export async function setInboundEmailArchived(
  id: string,
  archived: boolean,
  actor: AuditContext,
): Promise<{ ok: boolean }> {
  const row = await prisma.inboundEmail.findUnique({
    where: { id },
    select: { status: true, readAt: true },
  });
  if (!row || row.status === "posted") return { ok: false };
  await prisma.$transaction(async (tx) => {
    await tx.inboundEmail.update({
      where: { id },
      data: {
        status: archived ? "archived" : "new",
        ...(archived && !row.readAt ? { readAt: new Date() } : {}),
      },
    });
    await writeAudit(tx, {
      ...actor,
      action: archived ? "inbound_email.archived" : "inbound_email.unarchived",
      entityType: "InboundEmail",
      entityId: id,
      after: { status: archived ? "archived" : "new" },
    });
  });
  return { ok: true };
}
