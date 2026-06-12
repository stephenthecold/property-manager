"use server";

import { auditActor, requireCapability } from "@/lib/auth/session";
import { buildAgreementVars } from "@/lib/services/lease-agreement";
import {
  createUploadedDocument,
  getDocumentDownloadUrl,
  listDocuments,
} from "@/lib/services/documents";
import { getFileStorage } from "@/lib/providers/storage";
import { DOCX_CONTENT_TYPE, fillDocxTemplate } from "@/lib/documents/docx-fill";

export interface GenerateDocxState {
  ok?: boolean;
  error?: string;
  message?: string;
  documentId?: string;
  /** Signed download URL for the generated file (short-lived). */
  downloadUrl?: string;
  fileName?: string;
}

function slugPart(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

const storageUnconfigured = (e: unknown): boolean =>
  e instanceof Error && /storage is not configured/i.test(e.message);

/**
 * Fill the latest uploaded .docx lease template with this lease's variables
 * and store the result as a "lease" document linked to the lease. All
 * failures are RETURNED as state — never thrown.
 */
export async function generateFromTemplateAction(
  _prev: GenerateDocxState,
  fd: FormData,
): Promise<GenerateDocxState> {
  await requireCapability("leases.manage");
  const actor = await auditActor();

  const leaseId = String(fd.get("leaseId") ?? "").trim();
  if (!leaseId) return { error: "Missing lease." };

  // Latest uploaded template wins (listDocuments orders by createdAt desc).
  const [templateDoc] = await listDocuments({ uploadType: "lease_template" });
  if (!templateDoc) {
    return {
      error:
        "No .docx template has been uploaded yet — add one under Settings → Leases.",
    };
  }

  const ctx = await buildAgreementVars(leaseId);
  if (!ctx) return { error: "Lease not found." };

  let templateBytes: Buffer;
  try {
    templateBytes = await getFileStorage().get(templateDoc.fileUrl);
  } catch (e) {
    return {
      error: storageUnconfigured(e)
        ? "File storage is not configured (set STORAGE_PROVIDER=local or s3) — template generation is unavailable."
        : "Could not read the uploaded template from storage.",
    };
  }

  let filled: Buffer;
  try {
    filled = await fillDocxTemplate(templateBytes, ctx.vars);
  } catch {
    return {
      error:
        "Could not fill the template — make sure the upload is a valid .docx containing {{placeholder}} tags.",
    };
  }

  const fileName = `lease-${slugPart(ctx.lease.unit.unitNumber, "unit")}-${slugPart(
    ctx.lease.tenant.lastName,
    "tenant",
  )}.docx`;

  let documentId: string;
  try {
    ({ documentId } = await createUploadedDocument({
      body: filled,
      fileName,
      contentType: DOCX_CONTENT_TYPE,
      uploadType: "lease",
      leaseId: ctx.lease.id,
      tenantId: ctx.lease.tenantId,
      notes: "Generated from template",
      actor,
    }));
  } catch (e) {
    return {
      error: storageUnconfigured(e)
        ? "File storage is not configured (set STORAGE_PROVIDER=local or s3) — template generation is unavailable."
        : "Could not save the generated document.",
    };
  }

  let downloadUrl: string | undefined;
  try {
    downloadUrl = (await getDocumentDownloadUrl(documentId))?.url;
  } catch {
    downloadUrl = undefined; // saved fine — the Documents page still has it
  }

  return {
    ok: true,
    message: `Generated ${fileName}.`,
    documentId,
    downloadUrl,
    fileName,
  };
}
