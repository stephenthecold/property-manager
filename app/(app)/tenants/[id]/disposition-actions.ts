"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { fromCents } from "@/lib/money";
import {
  createDraftDisposition,
  updateDraftDisposition,
  finalizeDisposition,
  discardDraftDisposition,
  getDisposition,
  serializeDisposition,
  type SerializedDisposition,
} from "@/lib/services/deposit-disposition";
import type { DepositDeduction } from "@/lib/accounting/deposit-disposition";

/**
 * Server actions for the move-out deposit disposition flow, called imperatively
 * from the dialog. Money crosses the boundary as decimal-cents strings. Every
 * action gates on `payments.manage` and delegates the audited ledger work to
 * the service — finalize is the only one that posts, and it's CAS-guarded there
 * so a double-submit can't double-post.
 */
export interface DispositionActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  disposition?: SerializedDisposition | null;
}

interface DraftInput {
  dispositionId: string;
  /** Refundable deposit held, as a cents string. */
  depositHeldCents: string;
  deductions: { label: string; amountCents: string }[];
  notes?: string | null;
}

function parseCents(s: string): bigint | null {
  try {
    return BigInt(s || "0");
  } catch {
    return null;
  }
}

function toDeductions(
  lines: { label: string; amountCents: string }[],
): DepositDeduction[] | null {
  const out: DepositDeduction[] = [];
  for (const l of lines) {
    const c = parseCents(l.amountCents);
    if (c == null) return null;
    out.push({ label: String(l.label ?? ""), amountCents: c });
  }
  return out;
}

export async function startDispositionAction(
  leaseId: string,
): Promise<DispositionActionResult> {
  await requireCapability("payments.manage");
  if (!leaseId) return { ok: false, error: "Missing lease id." };
  const res = await createDraftDisposition({ leaseId, actor: await auditActor() });
  if (!res.ok) return { ok: false, error: res.error };
  const row = await getDisposition(res.dispositionId);
  return { ok: true, disposition: row ? serializeDisposition(row) : null };
}

export async function saveDispositionDraftAction(
  input: DraftInput,
): Promise<DispositionActionResult> {
  await requireCapability("payments.manage");
  const held = parseCents(input.depositHeldCents);
  if (held == null) return { ok: false, error: "Invalid deposit amount." };
  const deductions = toDeductions(input.deductions);
  if (deductions == null) return { ok: false, error: "Invalid deduction amount." };

  const res = await updateDraftDisposition({
    dispositionId: input.dispositionId,
    depositHeldCents: held,
    deductions,
    notes: input.notes ?? null,
    actor: await auditActor(),
  });
  if (!res.ok) return { ok: false, error: res.error };
  const row = await getDisposition(input.dispositionId);
  return {
    ok: true,
    message: "Draft saved.",
    disposition: row ? serializeDisposition(row) : null,
  };
}

export async function finalizeDispositionAction(
  input: DraftInput,
): Promise<DispositionActionResult> {
  await requireCapability("payments.manage");
  const actor = await auditActor();
  const held = parseCents(input.depositHeldCents);
  if (held == null) return { ok: false, error: "Invalid deposit amount." };
  const deductions = toDeductions(input.deductions);
  if (deductions == null) return { ok: false, error: "Invalid deduction amount." };

  // Persist the on-screen itemization first (validated there), then finalize
  // against the CURRENT ledger balance. The finalize is the CAS-guarded post.
  const upd = await updateDraftDisposition({
    dispositionId: input.dispositionId,
    depositHeldCents: held,
    deductions,
    notes: input.notes ?? null,
    actor,
  });
  if (!upd.ok) return { ok: false, error: upd.error };

  const fin = await finalizeDisposition({ dispositionId: input.dispositionId, actor });
  if (!fin.ok) return { ok: false, error: fin.error };

  const row = await getDisposition(input.dispositionId);
  if (row) {
    // The ledger changed — refresh anything that reads the balance.
    revalidatePath(`/tenants/${row.tenantId}`);
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    revalidatePath("/payments");
  }
  return {
    ok: true,
    message: `Settlement finalized — refund due ${fromCents(fin.result.refundDueCents)}, balance owed ${fromCents(fin.result.balanceOwedCents)}.`,
    disposition: row ? serializeDisposition(row) : null,
  };
}

export async function discardDispositionAction(
  dispositionId: string,
): Promise<DispositionActionResult> {
  await requireCapability("payments.manage");
  if (!dispositionId) return { ok: false, error: "Missing disposition id." };
  const res = await discardDraftDisposition({
    dispositionId,
    actor: await auditActor(),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, message: "Draft discarded.", disposition: null };
}
