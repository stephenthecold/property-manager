"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { emailReceiptToTenant, markReceiptSent } from "@/lib/services/receipts";

export interface ReceiptEmailState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** Send the receipt to the tenant's email on file and mark it sent. */
export async function emailReceiptAction(
  _prev: ReceiptEmailState,
  fd: FormData,
): Promise<ReceiptEmailState> {
  await requireCapability("payments.manage");
  const receiptId = String(fd.get("receiptId") ?? "").trim();
  if (!receiptId) return { error: "Missing receipt id." };
  try {
    const { to } = await emailReceiptToTenant(receiptId, await auditActor());
    revalidatePath("/receipts", "layout");
    return { ok: true, message: `Receipt emailed to ${to}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Email send failed." };
  }
}

const SENT_METHODS = ["sms", "email", "printed"] as const;
type SentVia = (typeof SENT_METHODS)[number];

export async function markSentAction(fd: FormData): Promise<void> {
  await requireCapability("payments.manage");
  const receiptId = String(fd.get("receiptId") ?? "").trim();
  const method = String(fd.get("method") ?? "").trim();
  if (!receiptId) throw new Error("Missing receipt id.");
  if (!(SENT_METHODS as readonly string[]).includes(method)) {
    throw new Error("Invalid sent method.");
  }
  await markReceiptSent(receiptId, method as SentVia, await auditActor());
  revalidatePath("/receipts", "layout");
}
