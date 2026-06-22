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
  markInboundEmailRead,
  setInboundEmailArchived,
} from "@/lib/services/inbound-email";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import type { ExpenseCategory } from "@/lib/generated/prisma/enums";

const CATEGORIES = ["utilities", "insurance", "maintenance", "taxes", "other"] as const;

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

  // Attribution: lease -> unit -> property (same precedence as createExpense).
  const leaseId = str(fd, "leaseId") || null;
  const unitIdRaw = str(fd, "unitId") || null;
  const propertyIdRaw = str(fd, "propertyId") || null;

  let propertyId: string;
  let unitId: string | null = null;
  let buildingId: string | null = null;
  let resolvedLeaseId: string | null = null;

  if (leaseId) {
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
      include: { unit: true },
    });
    if (!lease) back("lease");
    resolvedLeaseId = lease!.id;
    unitId = lease!.unitId;
    buildingId = lease!.unit.buildingId;
    propertyId = lease!.unit.propertyId;
  } else if (unitIdRaw) {
    const unit = await prisma.unit.findUnique({ where: { id: unitIdRaw } });
    if (!unit) back("unit");
    unitId = unit!.id;
    buildingId = unit!.buildingId;
    propertyId = unit!.propertyId;
  } else if (propertyIdRaw) {
    propertyId = propertyIdRaw;
  } else {
    return back("target");
  }

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) back("property");

  const dateRaw = str(fd, "incurredOn");
  const incurredOn = dateRaw
    ? parseDateOnlyInZone(dateRaw, property!.timezone)
    : new Date();
  if (dateRaw && !incurredOn) back("date");

  const vendorId = str(fd, "vendorId") || null;
  if (vendorId && !(await isActiveVendor(vendorId))) back("vendor");

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
          propertyId: propertyId!,
          buildingId,
          unitId,
          leaseId: resolvedLeaseId,
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
      // Link the email's attachments to the expense and mark the inbox item
      // posted (terminal) — same transaction so a failure rolls back together.
      await tx.uploadedDocument.updateMany({
        where: { inboundEmailId: email!.id },
        data: { propertyExpenseId: created.id },
      });
      await tx.inboundEmail.update({
        where: { id: email!.id },
        data: {
          status: "posted",
          propertyExpenseId: created.id,
          handledBy: dbUser.id,
          handledAt: new Date(),
          readAt: email!.readAt ?? new Date(),
        },
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

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${email!.id}`);
  revalidatePath("/financials");
  revalidatePath("/dashboard");
  redirect(`/inbox/${email!.id}`);
}
