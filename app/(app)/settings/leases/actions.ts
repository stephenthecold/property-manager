"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { saveLeaseAgreementText } from "@/lib/services/app-settings";
import { createUploadedDocument } from "@/lib/services/documents";
import { DEFAULT_LEASE_AGREEMENT_TEXT } from "@/lib/config/lease-agreement";
import { DOCX_CONTENT_TYPE } from "@/lib/documents/docx-fill";

export interface LeaseSettingsState {
  ok?: boolean;
  error?: string;
  message?: string;
}

const TEMPLATE_MAX_BYTES = 2 * 1024 * 1024;
// Browsers occasionally report a generic type for .docx; the extension check
// is the gate that always applies.
const ACCEPTED_DOCX_TYPES = new Set([
  DOCX_CONTENT_TYPE,
  "application/octet-stream",
  "application/zip",
]);

/** Save the printable agreement's clause text. Empty (or exactly the default) reverts to the built-in default. */
export async function saveLeaseAgreementTextAction(
  _prev: LeaseSettingsState,
  fd: FormData,
): Promise<LeaseSettingsState> {
  await requireCapability("organization.settings");
  const actor = await auditActor();

  const text = String(fd.get("text") ?? "").trim();
  const value =
    text === "" || text === DEFAULT_LEASE_AGREEMENT_TEXT.trim() ? null : text;

  try {
    await saveLeaseAgreementText(value, actor);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to save the agreement text.",
    };
  }

  revalidatePath("/settings/leases");
  return {
    ok: true,
    message: value
      ? "Lease agreement text saved."
      : "Reverted to the built-in default text.",
  };
}

/** Upload a fill-your-own .docx template (latest upload becomes the active template). */
export async function uploadLeaseTemplateAction(
  _prev: LeaseSettingsState,
  fd: FormData,
): Promise<LeaseSettingsState> {
  await requireCapability("organization.settings");
  const actor = await auditActor();

  const file = fd.get("template");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a .docx file to upload." };
  }
  if (!/\.docx$/i.test(file.name)) {
    return { error: "The template must be a .docx (Word) file." };
  }
  if (file.type && !ACCEPTED_DOCX_TYPES.has(file.type)) {
    return { error: "That file does not look like a .docx (Word) document." };
  }
  if (file.size > TEMPLATE_MAX_BYTES) {
    return { error: "Template too large (max 2 MB)." };
  }

  try {
    await createUploadedDocument({
      body: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      contentType: DOCX_CONTENT_TYPE,
      uploadType: "lease_template",
      notes: "Lease .docx template",
      actor,
    });
  } catch (e) {
    return {
      error:
        e instanceof Error && /storage is not configured/i.test(e.message)
          ? "File storage is not configured (set STORAGE_PROVIDER=local or s3) — template uploads are unavailable."
          : "Template upload failed.",
    };
  }

  revalidatePath("/settings/leases");
  return {
    ok: true,
    message: "Template uploaded. New generations will use this file.",
  };
}
