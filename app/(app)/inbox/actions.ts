"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { withAudit } from "@/lib/audit/audit";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { isActiveVendor } from "@/lib/services/vendors";
import {
  clearInboundEmails,
  deleteInboundEmail,
  markInboundEmailRead,
  setInboundEmailArchived,
} from "@/lib/services/inbound-email";
import {
  attachEmailToPayment,
  recordInboundPayment,
} from "@/lib/services/inbox-payment";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import type { ExpenseCategory } from "@/lib/generated/prisma/enums";
import type { FormState } from "@/lib/forms";

const CATEGORIES = ["utilities", "insurance", "maintenance", "taxes", "other"] as const;

/** Thrown inside the post transaction to roll it back when the email was already
 *  posted by a concurrent/double submit (caught to redirect, not error out). */
class AlreadyPostedError extends Error {}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function markInboxReadAction(fd: FormData): Promise<void> {
  await requireCapability("mailbox.manage");
  await assertModuleEnabled("mailbox");
  const id = str(fd, "id");
  if (id) await markInboundEmailRead(id);
  revalidatePath("/inbox");
  if (id) revalidatePath(`/inbox/${id}`);
}

export async function archiveInboxAction(fd: FormData): Promise<void> {
  await requireCapability("mailbox.manage");
  await assertModuleEnabled("mailbox");
  const id = str(fd, "id");
  const archived = str(fd, "archived") !== "false";
  if (id) await setInboundEmailArchived(id, archived, await auditActor());
  revalidatePath("/inbox");
  if (id) revalidatePath(`/inbox/${id}`);
}

/** Permanently delete one inbox message (+ its attachment files). The detail
 *  page is gone afterward, so bounce back to the inbox list. */
export async function deleteInboxAction(fd: FormData): Promise<void> {
  await requireCapability("mailbox.manage");
  await assertModuleEnabled("mailbox");
  const id = str(fd, "id");
  if (id) await deleteInboundEmail(id, await auditActor());
  revalidatePath("/inbox");
  redirect("/inbox");
}

/** Permanently delete ALL non-posted inbox messages (+ their files) — clears
 *  mail captured from a mis-configured mailbox. Posted items are preserved. */
export async function clearInboxAction(_fd: FormData): Promise<void> {
  await requireCapability("mailbox.manage");
  await assertModuleEnabled("mailbox");
  await clearInboundEmails(await auditActor());
  revalidatePath("/inbox");
  redirect("/inbox");
}

/**
 * Record ONE parsed payment line of an email as a tenant payment, after staff
 * review (lease + amount confirmed). HOT ZONE — funnels straight into the
 * battle-tested postPayment via recordInboundPayment; idempotent per (email,
 * row) so a re-submit never double-credits. Returns FormState so the dialog
 * shows validation inline instead of an error page.
 */
export async function recordInboxPaymentAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("payments.manage");
  await assertModuleEnabled("mailbox");

  const emailId = str(fd, "inboundEmailId");
  if (!emailId) return { error: "Missing email." };
  const leaseId = str(fd, "leaseId");
  if (!leaseId) return { error: "Pick the tenant/lease this payment is for." };
  const rowKey = str(fd, "rowKey") || "idx0";

  let amountCents: bigint;
  try {
    amountCents = toCents(str(fd, "amount"));
  } catch {
    return { error: "Enter a valid amount (e.g. 625.00)." };
  }
  if (amountCents <= 0n) return { error: "Amount must be positive." };

  // Date-only value → midnight in the PROPERTY timezone (matches the manual
  // record-payment action; receipts/reports bucket income there).
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: { unit: { include: { property: true } } },
  });
  if (!lease) return { error: "Lease not found." };
  const tz = lease.unit.property.timezone;
  const dateRaw = str(fd, "paymentDate");
  const paymentDate = dateRaw
    ? (parseDateOnlyInZone(dateRaw, tz) ?? new Date(dateRaw))
    : new Date();
  const method = (str(fd, "method") || "online") as PaymentMethod;

  await recordInboundPayment({
    emailId,
    rowKey,
    leaseId,
    amountCents,
    paymentDate,
    method,
    referenceNumber: str(fd, "referenceNumber") || null,
    notes: str(fd, "notes") || null,
    actor: await auditActor(),
  });
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${emailId}`);
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/tenants", "layout");
  return { ok: true };
}

/** Attach an email to an EXISTING payment as documentation (no ledger write). */
export async function attachInboxPaymentAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("payments.manage");
  await assertModuleEnabled("mailbox");

  const emailId = str(fd, "inboundEmailId");
  if (!emailId) return { error: "Missing email." };
  const paymentId = str(fd, "paymentId");
  if (!paymentId) return { error: "Pick a payment to attach to." };

  const res = await attachEmailToPayment({
    emailId,
    paymentId,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: "That payment no longer exists." };
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${emailId}`);
  return { ok: true };
}

/**
 * Post an emailed invoice/receipt as a PropertyExpense after staff review.
 * Mirrors createExpenseAction's attribution + validation, plus: links the
 * email's attachments to the new expense and marks the inbox item posted
 * (terminal), all in one transaction. Errors bounce back to the detail page
 * with an ?error code (the documents-page pattern); success drops the query.
 */
export async function postInboxExpenseAction(fd: FormData): Promise<void> {
  // Creating a financial record requires the financials capability — on top of
  // the mailbox-gated page that surfaced this form.
  const { dbUser } = await requireCapability("financials.manage");
  await assertModuleEnabled("mailbox");
  await assertModuleEnabled("financials");

  const emailId = str(fd, "inboundEmailId");
  const back = (code: string) => redirect(`/inbox/${emailId}?error=${code}`);

  const email = await prisma.inboundEmail.findUnique({ where: { id: emailId } });
  if (!email) redirect("/inbox");
  if (email.status === "posted") back("already_posted");

  const categoryRaw = str(fd, "category");
  if (!(CATEGORIES as readonly string[]).includes(categoryRaw)) back("category");
  const category = categoryRaw as ExpenseCategory;

  let amountCents: bigint;
  try {
    amountCents = toCents(str(fd, "amount"));
  } catch {
    return back("amount");
  }
  if (amountCents <= 0n) back("amount");

  // The inbox form attributes an emailed invoice to a property (unit/lease
  // attribution can be refined later in Financials), so this is property-level.
  const propertyId = str(fd, "propertyId") || null;
  if (!propertyId) return back("target");
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) back("property");

  const dateRaw = str(fd, "incurredOn");
  const incurredOn = dateRaw
    ? parseDateOnlyInZone(dateRaw, property!.timezone)
    : new Date();
  if (dateRaw && !incurredOn) back("date");

  const vendorId = str(fd, "vendorId") || null;
  if (vendorId && !(await isActiveVendor(vendorId))) back("vendor");

  try {
    await withAudit(
      {
        ...(await auditActor()),
        action: "financials.expense_added",
        entityType: "PropertyExpense",
        entityId: "(new)",
      },
      async (tx) => {
        const created = await tx.propertyExpense.create({
          data: {
            propertyId,
            category,
            amountCents,
            incurredOn: incurredOn!,
            description: str(fd, "description") || null,
            vendorId,
            sourceType: "inbound_email",
            sourceId: email!.id,
            createdBy: dbUser.id,
          },
        });
        // Atomically claim the email: only the FIRST poster flips it to "posted".
        // A concurrent/double submit matches 0 rows here and throws, rolling the
        // whole transaction back (no duplicate expense) → "already posted".
        const claim = await tx.inboundEmail.updateMany({
          where: { id: email!.id, status: { not: "posted" } },
          data: {
            status: "posted",
            propertyExpenseId: created.id,
            handledBy: dbUser.id,
            handledAt: new Date(),
            readAt: email!.readAt ?? new Date(),
          },
        });
        if (claim.count === 0) throw new AlreadyPostedError();
        // Link the email's attachments to the created expense.
        await tx.uploadedDocument.updateMany({
          where: { inboundEmailId: email!.id },
          data: { propertyExpenseId: created.id },
        });
        return {
          result: created,
          entityId: created.id,
          after: {
            propertyId,
            category,
            amountCents,
            sourceType: "inbound_email",
            sourceId: email!.id,
          },
        };
      },
    );
  } catch (e) {
    if (e instanceof AlreadyPostedError) back("already_posted");
    throw e;
  }

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${email!.id}`);
  revalidatePath("/financials");
  revalidatePath("/dashboard");
  redirect(`/inbox/${email!.id}`);
}
