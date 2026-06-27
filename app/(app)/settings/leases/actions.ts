"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  saveLandlordSignature,
  saveLeaseAgreementText,
  saveLeaseExpirationWindow,
} from "@/lib/services/app-settings";
import { MAX_ALERT_DAYS, MIN_ALERT_DAYS } from "@/lib/leases/expiration";
import { createUploadedDocument } from "@/lib/services/documents";
import { getFileStorage } from "@/lib/providers/storage";
import { looksLikePng } from "@/lib/esign/artifact";
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

/**
 * Save the lease-expiration alert window (days ahead) used by the dashboard
 * section and the weekly staff digest. Blank reverts to the shipped default;
 * an out-of-range value is rejected (the resolver also clamps on read).
 */
export async function saveLeaseExpirationWindowAction(
  _prev: LeaseSettingsState,
  fd: FormData,
): Promise<LeaseSettingsState> {
  await requireCapability("organization.settings");
  const actor = await auditActor();

  const raw = String(fd.get("leaseExpirationAlertDays") ?? "").trim();
  let days: number | null;
  if (raw === "") {
    days = null; // -> shipped default
  } else {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < MIN_ALERT_DAYS || n > MAX_ALERT_DAYS) {
      return {
        error: `Enter a whole number of days between ${MIN_ALERT_DAYS} and ${MAX_ALERT_DAYS}, or leave it blank for the default.`,
      };
    }
    days = n;
  }

  try {
    await saveLeaseExpirationWindow(days, actor);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to save the alert window.",
    };
  }

  revalidatePath("/settings/leases");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message:
      days === null
        ? "Reverted to the default alert window."
        : `Alert window set to ${days} days.`,
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
    // Generic message to the client; real cause to the server log.
    console.error("[settings/leases] template upload failed:", e);
    return {
      error:
        e instanceof Error && /storage is not configured/i.test(e.message)
          ? "File storage is not configured (set STORAGE_PROVIDER=local or s3) — template uploads are unavailable."
          : "Template upload failed — check the server log for the cause.",
    };
  }

  revalidatePath("/settings/leases");
  return {
    ok: true,
    message: "Template uploaded. New generations will use this file.",
  };
}

// Landlord signature: a fixed storage key (overwrites are fine — there is only
// ever one saved signature), referenced from AppSettings. NOT an
// UploadedDocument: it isn't a lease/tenant record, just org branding-like
// config consumed by e-sign sends.
const LANDLORD_SIGNATURE_KEY = "signatures/landlord.png";
const LANDLORD_INITIALS_KEY = "signatures/landlord-initials.png";
const SIGNATURE_MAX_BYTES = 150 * 1024;
const SIGNATURE_MAX_DATAURL_LENGTH =
  Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 64;

/** Validate a drawn-mark PNG data URL and return its bytes, or an error string. */
function decodeDrawnDataUrl(
  dataUrl: string,
  what: string,
): Buffer | { error: string } {
  if (dataUrl.length > SIGNATURE_MAX_DATAURL_LENGTH) {
    return { error: `Drawn ${what} is too large (max 150 KB).` };
  }
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) {
    return { error: `Drawn ${what} could not be read — please redraw it.` };
  }
  const body = Buffer.from(match[1], "base64");
  if (body.byteLength === 0 || body.byteLength > SIGNATURE_MAX_BYTES) {
    return { error: `Drawn ${what} is too large (max 150 KB).` };
  }
  if (!looksLikePng(body)) {
    return { error: `Drawn ${what} could not be read — please redraw it.` };
  }
  return body;
}

/**
 * Save the landlord signature (typed name + optional drawn PNG from the
 * signature pad) and optional drawn initials. An empty pad keeps the
 * currently stored image. Managers+ (esign.manage) apply these marks when
 * sending e-sign requests; initials are stamped at {{landlord_initials}}
 * markers (typed initials derived from the name when no image is saved).
 */
export async function saveLandlordSignatureAction(
  _prev: LeaseSettingsState,
  fd: FormData,
): Promise<LeaseSettingsState> {
  await requireCapability("organization.settings");
  const actor = await auditActor();

  const name = String(fd.get("name") ?? "").trim();
  if (!name) {
    return { error: "Enter the landlord signature name (e.g. the legal name)." };
  }
  if (name.length > 120) {
    return { error: "Signature name is too long (max 120 characters)." };
  }

  // undefined = keep the stored image; a key = replace it.
  let imageKey: string | undefined;
  let initialsImageKey: string | undefined;
  const marks: {
    field: string;
    what: string;
    key: string;
    assign: (k: string) => void;
  }[] = [
    {
      field: "signatureImage",
      what: "signature",
      key: LANDLORD_SIGNATURE_KEY,
      assign: (k) => (imageKey = k),
    },
    {
      field: "initialsImage",
      what: "initials",
      key: LANDLORD_INITIALS_KEY,
      assign: (k) => (initialsImageKey = k),
    },
  ];
  for (const mark of marks) {
    const dataUrl = String(fd.get(mark.field) ?? "");
    if (dataUrl === "") continue;
    const body = decodeDrawnDataUrl(dataUrl, mark.what);
    if (!Buffer.isBuffer(body)) return body;
    try {
      await (await getFileStorage()).put({
        key: mark.key,
        body,
        contentType: "image/png",
      });
      mark.assign(mark.key);
    } catch (e) {
      console.error(`[settings/leases] landlord ${mark.what} upload failed:`, e);
      return {
        error:
          e instanceof Error && /storage is not configured/i.test(e.message)
            ? "File storage is not configured (set STORAGE_PROVIDER=local or s3) — drawn signatures are unavailable. You can still save the typed name."
            : `Could not store the drawn ${mark.what} — check the server log.`,
      };
    }
  }

  try {
    await saveLandlordSignature(name, imageKey, actor, initialsImageKey);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to save the signature.",
    };
  }

  revalidatePath("/settings/leases");
  return {
    ok: true,
    message:
      imageKey !== undefined || initialsImageKey !== undefined
        ? "Landlord signature saved (name + drawing)."
        : "Landlord signature saved.",
  };
}

/** Clear the saved landlord signature (name + drawn image references). */
export async function clearLandlordSignatureAction(
  _prev: LeaseSettingsState,
  _fd: FormData,
): Promise<LeaseSettingsState> {
  await requireCapability("organization.settings");
  const actor = await auditActor();

  try {
    await saveLandlordSignature(null, null, actor, null);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to clear the signature.",
    };
  }

  revalidatePath("/settings/leases");
  return { ok: true, message: "Landlord signature cleared." };
}
