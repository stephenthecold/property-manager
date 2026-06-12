"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { attachDocument, runOcrOnDocument } from "@/lib/services/documents";
import { postPayment } from "@/lib/services/payments";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";

export async function runOcrAction(fd: FormData): Promise<void> {
  await requireCapability("documents.manage");
  const documentId = String(fd.get("documentId") ?? "").trim();
  if (!documentId) throw new Error("Missing document id.");

  const result = await runOcrOnDocument(documentId, await auditActor());
  if (!result) throw new Error("OCR is disabled (set OCR_ENABLED=true).");

  revalidatePath("/documents", "layout");
}

export async function createPaymentFromDocumentAction(fd: FormData): Promise<void> {
  await requireCapability("payments.manage");
  const leaseId = String(fd.get("leaseId") ?? "").trim();
  const documentId = String(fd.get("documentId") ?? "").trim();
  const idempotencyKey = String(fd.get("idempotencyKey") ?? "").trim();
  // Validation failures redirect back with ?error= so the message survives in
  // production (a thrown server-action error renders the generic error page).
  const back = (code: string): never =>
    redirect(`/documents/${encodeURIComponent(documentId)}?error=${code}`);
  if (!documentId || !idempotencyKey) {
    throw new Error("Missing document id or idempotency key.");
  }
  if (!leaseId) back("lease");

  let amountCents: bigint;
  try {
    amountCents = toCents(String(fd.get("amount") ?? ""));
  } catch {
    amountCents = -1n;
  }
  if (amountCents <= 0n) back("amount");

  const dateRaw = String(fd.get("paymentDate") ?? "").trim();
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: { unit: { include: { property: true } } },
  });
  if (!lease) back("lease");
  // Date-only values are minted at property-tz midnight (matches rent charges).
  const tz = lease!.unit.property.timezone;
  const paymentDate = dateRaw
    ? (parseDateOnlyInZone(dateRaw, tz) ?? new Date(dateRaw))
    : new Date();
  const method = (String(fd.get("method") ?? "cash") || "cash") as PaymentMethod;
  const referenceNumber = String(fd.get("referenceNumber") ?? "").trim() || null;

  const actor = await auditActor();
  const { paymentId } = await postPayment({
    leaseId,
    amountCents,
    paymentDate,
    method,
    referenceNumber,
    notes: `Created from uploaded document ${documentId}`,
    idempotencyKey,
    actor,
  });

  // postPayment auto-creates the digital receipt; link the document to both.
  const receipt = await prisma.receipt.findFirst({
    where: { paymentId, receiptType: "digital" },
  });
  await attachDocument(
    documentId,
    { paymentId, ...(receipt ? { receiptId: receipt.id } : {}) },
    actor,
  );

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/documents", "layout");
  revalidatePath("/tenants", "layout");
  redirect("/payments");
}
