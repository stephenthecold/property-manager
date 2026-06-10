"use server";

import { revalidatePath } from "next/cache";
import { toCents } from "@/lib/money";
import { auditActor, requireRole } from "@/lib/auth/session";
import { postPayment, voidPayment } from "@/lib/services/payments";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";

export interface RecordPaymentState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export async function recordPayment(
  _prev: RecordPaymentState,
  fd: FormData,
): Promise<RecordPaymentState> {
  await requireRole("manager");
  const leaseId = String(fd.get("leaseId") ?? "");
  const amountRaw = String(fd.get("amount") ?? "");
  const idempotencyKey = String(fd.get("idempotencyKey") ?? "");
  if (!leaseId || !idempotencyKey) return { error: "Missing lease or idempotency key." };

  let amountCents: bigint;
  try {
    amountCents = toCents(amountRaw);
  } catch {
    return { error: "Enter a valid amount (e.g. 1200.00)." };
  }
  if (amountCents <= 0n) return { error: "Amount must be positive." };

  const dateRaw = String(fd.get("paymentDate") ?? "");
  const paymentDate = dateRaw ? new Date(dateRaw) : new Date();
  const method = (String(fd.get("method") ?? "cash") || "cash") as PaymentMethod;
  const reference = String(fd.get("referenceNumber") ?? "").trim() || null;
  const appliedPeriodKey = String(fd.get("appliedPeriodKey") ?? "").trim() || null;
  const notes = String(fd.get("notes") ?? "").trim() || null;

  try {
    const res = await postPayment({
      leaseId,
      amountCents,
      paymentDate,
      method,
      referenceNumber: reference,
      appliedPeriodKey,
      notes,
      idempotencyKey,
      actor: await auditActor(),
    });
    revalidatePath("/dashboard");
    revalidatePath("/payments");
    revalidatePath("/tenants", "layout");
    return {
      ok: true,
      message: res.alreadyExisted
        ? "Payment already recorded (idempotent)."
        : res.leftoverCreditCents > 0n
          ? "Payment recorded; overpayment added as tenant credit."
          : "Payment recorded.",
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to record payment." };
  }
}

export async function voidPaymentAction(fd: FormData): Promise<void> {
  await requireRole("manager");
  const paymentId = String(fd.get("paymentId") ?? "");
  const reason = String(fd.get("reason") ?? "").trim() || "Voided by user";
  if (!paymentId) throw new Error("Missing payment id.");
  await voidPayment({ paymentId, reason, actor: await auditActor() });
  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/tenants", "layout");
}
