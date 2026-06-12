"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { postPayment, voidPayment } from "@/lib/services/payments";
import { waiveCharge } from "@/lib/services/charges";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";

export interface RecordPaymentState {
  ok?: boolean;
  error?: string;
  message?: string;
  receiptId?: string;
  receiptNumber?: string;
}

export async function recordPayment(
  _prev: RecordPaymentState,
  fd: FormData,
): Promise<RecordPaymentState> {
  await requireCapability("payments.manage");
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

  // Date-only form values must become midnight in the PROPERTY timezone —
  // receipts, ledger reports, and income bucketing all interpret instants there.
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: { unit: { include: { property: true } } },
  });
  if (!lease) return { error: "Lease not found." };
  const tz = lease.unit.property.timezone;
  const dateRaw = String(fd.get("paymentDate") ?? "");
  const paymentDate = dateRaw
    ? (parseDateOnlyInZone(dateRaw, tz) ?? new Date(dateRaw))
    : new Date();
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
    // A digital receipt is auto-created after posting; look it up for the link.
    const receipt = await prisma.receipt.findFirst({
      where: { paymentId: res.paymentId, receiptType: "digital" },
      select: { id: true, receiptNumber: true },
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
      receiptId: receipt?.id,
      receiptNumber: receipt?.receiptNumber,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to record payment." };
  }
}

export async function voidPaymentAction(fd: FormData): Promise<void> {
  await requireCapability("payments.manage");
  const paymentId = String(fd.get("paymentId") ?? "");
  const reason = String(fd.get("reason") ?? "").trim() || "Voided by user";
  if (!paymentId) throw new Error("Missing payment id.");
  await voidPayment({ paymentId, reason, actor: await auditActor() });
  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/tenants", "layout");
  // Receipt pages render the payment's voided state.
  revalidatePath("/receipts", "layout");
}

export interface WaiveChargeState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/**
 * Waive (fully or partially) an open rent charge / late fee as an append-only
 * ledger reversal. Validation problems are RETURNED as state (useActionState).
 */
export async function waiveChargeAction(
  _prev: WaiveChargeState,
  fd: FormData,
): Promise<WaiveChargeState> {
  await requireCapability("payments.manage");
  const entryId = String(fd.get("entryId") ?? "");
  if (!entryId) return { error: "Missing charge id." };
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return { error: "A reason is required to waive a charge." };

  let amountCents: bigint;
  try {
    amountCents = toCents(String(fd.get("amount") ?? ""));
  } catch {
    return { error: "Enter a valid amount (e.g. 75.00)." };
  }
  if (amountCents <= 0n) return { error: "Amount must be positive." };

  try {
    const res = await waiveCharge({
      entryId,
      amountCents,
      reason,
      actor: await auditActor(),
    });
    revalidatePath(`/tenants/${res.tenantId}`);
    revalidatePath("/payments");
    revalidatePath("/dashboard");
    return {
      ok: true,
      message:
        res.remainingOutstandingCents > 0n
          ? "Charge partially waived; the rest stays outstanding."
          : "Charge waived in full.",
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to waive the charge." };
  }
}
