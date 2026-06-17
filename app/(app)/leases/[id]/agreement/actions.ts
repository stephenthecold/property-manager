"use server";

import { redirect } from "next/navigation";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  buildAgreementVars,
  signatureMarkerDocxVars,
} from "@/lib/services/lease-agreement";
import {
  createUploadedDocument,
  getDocumentDownloadUrl,
  listDocuments,
} from "@/lib/services/documents";
import { getFileStorage } from "@/lib/providers/storage";
import { DOCX_CONTENT_TYPE, fillDocxTemplate } from "@/lib/documents/docx-fill";
import {
  cancelSigningRequest,
  createSigningRequest,
  resendSignerLink,
  type CancelResult,
  type CreateSigningRequestResult,
  type ResendResult,
  type SignerSendStatus,
} from "@/lib/services/esign";

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
    templateBytes = await (await getFileStorage()).get(templateDoc.fileUrl);
  } catch (e) {
    return {
      error: storageUnconfigured(e)
        ? "File storage is not configured (set STORAGE_PROVIDER=local or s3) — template generation is unavailable."
        : "Could not read the uploaded template from storage.",
    };
  }

  // Signature markers ({{landlord_signature}} etc.) aren't data vars — fill them
  // with the saved landlord signature (as text) and the tenants' printed names
  // so they don't survive as literal "{{…}}" tags in the Word document.
  const docxVars = {
    ...ctx.vars,
    ...signatureMarkerDocxVars(ctx.app, ctx.vars),
  };

  let filled: Buffer;
  try {
    filled = await fillDocxTemplate(templateBytes, docxVars);
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

// ---------------------------------------------------------------------------
// E-signature panel actions (esign.manage). These are row-style server forms:
// guard failures land back on the agreement page as ?esign_error= banners —
// never thrown (a thrown server-action error renders the opaque production
// digest page). redirect() is never called inside try/catch.
// ---------------------------------------------------------------------------

function backToAgreement(
  leaseId: string,
  result: { error?: string; message?: string },
): never {
  const qs = result.error
    ? `esign_error=${encodeURIComponent(result.error)}`
    : `esign_message=${encodeURIComponent(result.message ?? "Done.")}`;
  redirect(`/leases/${leaseId}/agreement?${qs}`);
}

/** "Jane Doe: sent via SMS + email; John Roe: no message sent …" */
function describeSends(sends: SignerSendStatus[]): string {
  if (sends.length === 0) return "No signers.";
  return sends
    .map((s) => {
      const channels = [
        s.sms === "sent" ? "SMS" : null,
        s.email === "sent" ? "email" : null,
      ].filter(Boolean);
      return channels.length > 0
        ? `${s.name}: sent via ${channels.join(" + ")}`
        : `${s.name}: NO message sent (no reachable contact method — fix their phone/email, then Resend)`;
    })
    .join("; ");
}

/** Send the current agreement for e-signature (one signer per tenant). */
export async function sendEsignRequestAction(fd: FormData): Promise<void> {
  await requireCapability("esign.manage");
  const actor = await auditActor();

  const leaseId = String(fd.get("leaseId") ?? "").trim();
  if (!leaseId) redirect("/leases?error=Missing%20lease%20id.");
  const kind =
    String(fd.get("kind") ?? "lease") === "renewal" ? "renewal" : "lease";

  let result: CreateSigningRequestResult;
  try {
    result = await createSigningRequest({ leaseId, kind, actor });
  } catch (e) {
    console.error("[esign] send request failed:", e);
    result = {
      ok: false,
      error: "Could not create the signing request — check the server log.",
    };
  }
  if (!result.ok) backToAgreement(leaseId, { error: result.error });
  backToAgreement(leaseId, {
    message: `E-sign request sent. ${describeSends(result.sends)}.`,
  });
}

/** Re-mint one signer's link (the old link stops working) and resend it. */
export async function resendEsignLinkAction(fd: FormData): Promise<void> {
  await requireCapability("esign.manage");
  const actor = await auditActor();

  const leaseId = String(fd.get("leaseId") ?? "").trim();
  const signerId = String(fd.get("signerId") ?? "").trim();
  if (!leaseId) redirect("/leases?error=Missing%20lease%20id.");
  if (!signerId) backToAgreement(leaseId, { error: "Missing signer." });

  let result: ResendResult;
  try {
    result = await resendSignerLink({ signerId, actor });
  } catch (e) {
    console.error("[esign] resend failed:", e);
    result = { ok: false, error: "Could not resend — check the server log." };
  }
  if (!result.ok) backToAgreement(leaseId, { error: result.error });
  backToAgreement(leaseId, {
    message: `New link sent. ${describeSends([result.send])}.`,
  });
}

/** Cancel the in-flight signing request (links already sent stop working). */
export async function cancelEsignRequestAction(fd: FormData): Promise<void> {
  await requireCapability("esign.manage");
  const actor = await auditActor();

  const leaseId = String(fd.get("leaseId") ?? "").trim();
  const requestId = String(fd.get("requestId") ?? "").trim();
  if (!leaseId) redirect("/leases?error=Missing%20lease%20id.");
  if (!requestId) backToAgreement(leaseId, { error: "Missing request." });

  let result: CancelResult;
  try {
    result = await cancelSigningRequest({ requestId, actor });
  } catch (e) {
    console.error("[esign] cancel failed:", e);
    result = { ok: false, error: "Could not cancel — check the server log." };
  }
  if (!result.ok) backToAgreement(leaseId, { error: result.error });
  backToAgreement(leaseId, { message: "Signing request canceled." });
}
