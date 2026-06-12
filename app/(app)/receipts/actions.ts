"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { markReceiptSent } from "@/lib/services/receipts";

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
