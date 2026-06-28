"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { fromCents, toCents } from "@/lib/money";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  confirmSelfReportedPayment,
  postPayment,
  rejectSelfReportedPayment,
  voidPayment,
} from "@/lib/services/payments";
import { waiveCharge, writeOffLeaseBalance } from "@/lib/services/charges";
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

  // Optional non-tenant payer (e.g. a housing authority paying the HAP portion).
  // Blank = the tenant paid; a value must reference a real, active payer.
  const payerIdRaw = String(fd.get("payerId") ?? "").trim();
  let payerId: string | null = null;
  if (payerIdRaw) {
    const payer = await prisma.payer.findUnique({ where: { id: payerIdRaw } });
    if (!payer || !payer.isActive) return { error: "Select a valid payer." };
    payerId = payer.id;
  }

  try {
    const res = await postPayment({
      leaseId,
      amountCents,
      paymentDate,
      method,
      referenceNumber: reference,
      appliedPeriodKey,
      notes,
      payerId,
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

/**
 * Confirm a tenant self-reported payment: the ONLY step that posts it to the
 * ledger (status→posted, FIFO allocation via the shared posting path). Idempotent
 * — a double-confirm is a no-op (guarded on status in the service). Same
 * capability as recording a payment.
 */
export async function confirmSelfReportedPaymentAction(fd: FormData): Promise<void> {
  await requireCapability("payments.manage");
  const paymentId = String(fd.get("paymentId") ?? "");
  if (!paymentId) throw new Error("Missing payment id.");
  await confirmSelfReportedPayment({ paymentId, actor: await auditActor() });
  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/payments/pending");
  revalidatePath("/tenants", "layout");
}

/**
 * Reject a tenant self-reported payment: marks it voided WITHOUT any ledger
 * touch (it never had a ledger entry). Idempotent on status. Same capability.
 */
export async function rejectSelfReportedPaymentAction(fd: FormData): Promise<void> {
  await requireCapability("payments.manage");
  const paymentId = String(fd.get("paymentId") ?? "");
  const reason = String(fd.get("reason") ?? "").trim() || "Rejected by staff";
  if (!paymentId) throw new Error("Missing payment id.");
  await rejectSelfReportedPayment({ paymentId, reason, actor: await auditActor() });
  revalidatePath("/payments");
  revalidatePath("/payments/pending");
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

export interface WriteOffBalanceState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/**
 * Write off (forgive) a lease's entire outstanding back-rent balance as an
 * append-only set of ledger reversals — the bad-debt case for a terminated
 * lease. Same gate as waiving (`payments.manage`); the ledger stays the source
 * of truth and nothing is deleted. Validation problems are RETURNED as state.
 */
export async function writeOffBalanceAction(
  _prev: WriteOffBalanceState,
  fd: FormData,
): Promise<WriteOffBalanceState> {
  await requireCapability("payments.manage");
  const leaseId = String(fd.get("leaseId") ?? "");
  if (!leaseId) return { error: "Missing lease id." };
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return { error: "A reason is required to write off a balance." };

  try {
    const res = await writeOffLeaseBalance({
      leaseId,
      reason,
      actor: await auditActor(),
    });
    revalidatePath(`/tenants/${res.tenantId}`);
    revalidatePath("/payments");
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    return {
      ok: true,
      message: `Wrote off ${fromCents(res.writtenOffCents)} of back rent across ${res.chargesAffected} charge(s).`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to write off the balance." };
  }
}
