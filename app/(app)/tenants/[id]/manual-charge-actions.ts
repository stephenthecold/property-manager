"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { toCents } from "@/lib/money";
import { isManualChargeCategory } from "@/lib/accounting/manual-charge";
import {
  postManualLedgerEntry,
  reverseManualLedgerEntry,
} from "@/lib/services/manual-charge";

/**
 * Tenant-page actions for posting/reversing a one-off ledger entry. Both gate on
 * `payments.manage` (same tier as record-payment / void / waive) and delegate
 * the audited, idempotent ledger work to the service. Money crosses the boundary
 * as a decimal string. Failures are returned as state so the dialog can show
 * them; on success the dialog refreshes the page.
 */
export interface ManualChargeState {
  ok?: boolean;
  error?: string;
  message?: string;
}

function revalidateLedger(tenantId: string): void {
  if (tenantId) revalidatePath(`/tenants/${tenantId}`);
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/payments");
}

export async function addManualChargeAction(
  _prev: ManualChargeState,
  fd: FormData,
): Promise<ManualChargeState> {
  await requireCapability("payments.manage");

  const leaseId = String(fd.get("leaseId") ?? "").trim();
  const tenantId = String(fd.get("tenantId") ?? "").trim();
  const category = String(fd.get("category") ?? "");
  const amountRaw = String(fd.get("amount") ?? "").trim();
  const dateRaw = String(fd.get("effectiveDate") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim() || null;
  const idempotencyKey = String(fd.get("idempotencyKey") ?? "").trim();

  if (!leaseId) return { error: "No active lease to charge." };
  if (!isManualChargeCategory(category)) return { error: "Choose a category." };
  if (!amountRaw) return { error: "Enter an amount." };
  let amountCents: bigint;
  try {
    amountCents = toCents(amountRaw);
  } catch {
    return { error: "Enter a valid amount." };
  }
  if (amountCents <= 0n) return { error: "Amount must be greater than zero." };

  let effectiveDate = new Date();
  if (dateRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Enter a valid date." };
    // Noon UTC keeps the day from slipping into an adjacent month in most tzs.
    effectiveDate = new Date(`${dateRaw}T12:00:00Z`);
  }

  const res = await postManualLedgerEntry({
    leaseId,
    category,
    amountCents,
    effectiveDate,
    note,
    idempotencyKey,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error };

  revalidateLedger(tenantId);
  return {
    ok: true,
    message: res.alreadyExisted ? "Already posted." : "Posted to the ledger.",
  };
}

export async function reverseManualEntryAction(
  _prev: ManualChargeState,
  fd: FormData,
): Promise<ManualChargeState> {
  await requireCapability("payments.manage");

  const entryId = String(fd.get("entryId") ?? "").trim();
  const tenantId = String(fd.get("tenantId") ?? "").trim();
  const reason = String(fd.get("reason") ?? "").trim();
  if (!entryId) return { error: "Missing entry." };

  const res = await reverseManualLedgerEntry({
    entryId,
    reason,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error };

  revalidateLedger(tenantId);
  return {
    ok: true,
    message: res.alreadyReversed ? "Already reversed." : "Entry reversed.",
  };
}
