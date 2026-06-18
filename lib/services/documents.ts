import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { UploadedDocument } from "@/lib/generated/prisma/client";
import type { UploadType } from "@/lib/generated/prisma/enums";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { getFileStorage } from "@/lib/providers/storage";
import { getOcrProvider } from "@/lib/providers/ocr";
import { suggestFromOcrText } from "@/lib/providers/ocr/suggest";

/**
 * Uploaded documents (receipt photos, leases, tenant docs). The storage object
 * is written first, then the DB row + audit commit together; a failed DB write
 * triggers a best-effort delete of the orphaned object.
 */

export interface CreateDocumentInput {
  body: Buffer;
  fileName: string;
  contentType?: string | null;
  uploadType: UploadType;
  tenantId?: string | null;
  leaseId?: string | null;
  paymentId?: string | null;
  receiptId?: string | null;
  maintenanceJobId?: string | null;
  tenantRequestId?: string | null;
  notes?: string | null;
  actor: AuditContext;
}

function sanitizeFileName(name: string): string {
  // Collapse dot runs: assertSafeStorageKey rejects any ".." substring, so a
  // name like "scan..jpg" must not survive sanitization only to 500 at put().
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .slice(0, 80);
  return cleaned.length > 0 && cleaned !== "." ? cleaned : "file";
}

export async function createUploadedDocument(
  input: CreateDocumentInput,
): Promise<{ documentId: string; key: string }> {
  const storage = await getFileStorage();
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const key = `uploads/${yyyy}/${mm}/${randomUUID()}-${sanitizeFileName(input.fileName)}`;

  await storage.put({
    key,
    body: input.body,
    contentType: input.contentType ?? undefined,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const doc = await tx.uploadedDocument.create({
        data: {
          fileUrl: key,
          fileName: input.fileName,
          fileType: input.contentType ?? null,
          fileSize: input.body.length,
          uploadType: input.uploadType,
          tenantId: input.tenantId ?? null,
          leaseId: input.leaseId ?? null,
          paymentId: input.paymentId ?? null,
          receiptId: input.receiptId ?? null,
          maintenanceJobId: input.maintenanceJobId ?? null,
          tenantRequestId: input.tenantRequestId ?? null,
          notes: input.notes ?? null,
          createdBy: input.actor.actorId ?? null,
        },
      });
      await writeAudit(tx, {
        ...input.actor,
        action: "document.uploaded",
        entityType: "UploadedDocument",
        entityId: doc.id,
        after: {
          key,
          fileName: input.fileName,
          fileType: input.contentType ?? null,
          fileSize: input.body.length,
          uploadType: input.uploadType,
          tenantId: input.tenantId ?? null,
          leaseId: input.leaseId ?? null,
          paymentId: input.paymentId ?? null,
          receiptId: input.receiptId ?? null,
        },
      });
      return { documentId: doc.id, key };
    });
  } catch (e) {
    try {
      await storage.delete(key);
    } catch {
      // Best effort only — an orphaned object must not mask the original error.
    }
    throw e;
  }
}

export async function getDocumentDownloadUrl(
  documentId: string,
): Promise<{ url: string; fileName: string | null; fileType: string | null } | null> {
  const doc = await prisma.uploadedDocument.findUnique({
    where: { id: documentId },
  });
  if (!doc) return null;
  const url = await (await getFileStorage()).getSignedUrl(doc.fileUrl);
  return { url, fileName: doc.fileName, fileType: doc.fileType };
}

export async function listDocuments(
  filter: {
    tenantId?: string;
    paymentId?: string;
    receiptId?: string;
    maintenanceJobId?: string;
    tenantRequestId?: string;
    uploadType?: UploadType;
  } = {},
): Promise<UploadedDocument[]> {
  return prisma.uploadedDocument.findMany({
    where: {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.paymentId ? { paymentId: filter.paymentId } : {}),
      ...(filter.receiptId ? { receiptId: filter.receiptId } : {}),
      ...(filter.maintenanceJobId ? { maintenanceJobId: filter.maintenanceJobId } : {}),
      ...(filter.tenantRequestId ? { tenantRequestId: filter.tenantRequestId } : {}),
      ...(filter.uploadType ? { uploadType: filter.uploadType } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Image documents attached to a maintenance request and/or its converted job,
 *  newest first. Used by the staff requests + maintenance-job views. */
export async function listMaintenancePhotos(filter: {
  tenantRequestId?: string;
  maintenanceJobId?: string;
}): Promise<UploadedDocument[]> {
  const or: { tenantRequestId?: string; maintenanceJobId?: string }[] = [];
  if (filter.tenantRequestId) or.push({ tenantRequestId: filter.tenantRequestId });
  if (filter.maintenanceJobId) or.push({ maintenanceJobId: filter.maintenanceJobId });
  if (or.length === 0) return [];
  return prisma.uploadedDocument.findMany({
    where: { OR: or, fileType: { startsWith: "image/" } },
    orderBy: { createdAt: "asc" },
  });
}

export async function runOcrOnDocument(
  documentId: string,
  actor: AuditContext,
): Promise<{
  ocrText: string;
  ocrConfidence: number;
  suggestion: ReturnType<typeof suggestFromOcrText>;
} | null> {
  const provider = getOcrProvider();
  if (!provider) return null;

  const doc = await prisma.uploadedDocument.findUnique({
    where: { id: documentId },
  });
  if (!doc) throw new Error("Document not found");

  const body = await (await getFileStorage()).get(doc.fileUrl);
  const { text, confidence } = await provider.extract({
    body,
    contentType: doc.fileType ?? undefined,
    fileName: doc.fileName ?? undefined,
  });

  await prisma.$transaction(async (tx) => {
    await tx.uploadedDocument.update({
      where: { id: doc.id },
      data: { ocrText: text, ocrConfidence: confidence },
    });
    await writeAudit(tx, {
      ...actor,
      action: "document.ocr",
      entityType: "UploadedDocument",
      entityId: doc.id,
      after: {
        provider: provider.name,
        ocrConfidence: confidence,
        ocrTextLength: text.length,
      },
    });
  });

  return { ocrText: text, ocrConfidence: confidence, suggestion: suggestFromOcrText(text) };
}

export async function attachDocument(
  documentId: string,
  refs: { tenantId?: string | null; paymentId?: string | null; receiptId?: string | null },
  actor: AuditContext,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const doc = await tx.uploadedDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new Error("Document not found");

    const before = {
      tenantId: doc.tenantId,
      paymentId: doc.paymentId,
      receiptId: doc.receiptId,
    };
    const updated = await tx.uploadedDocument.update({
      where: { id: doc.id },
      data: {
        ...(refs.tenantId !== undefined ? { tenantId: refs.tenantId } : {}),
        ...(refs.paymentId !== undefined ? { paymentId: refs.paymentId } : {}),
        ...(refs.receiptId !== undefined ? { receiptId: refs.receiptId } : {}),
      },
    });
    await writeAudit(tx, {
      ...actor,
      action: "document.attached",
      entityType: "UploadedDocument",
      entityId: doc.id,
      before,
      after: {
        tenantId: updated.tenantId,
        paymentId: updated.paymentId,
        receiptId: updated.receiptId,
      },
    });
  });
}
