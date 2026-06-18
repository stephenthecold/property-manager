"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  saveOrganizationSettings,
  saveStorageConfig,
} from "@/lib/services/app-settings";
import { sanitizeReceiptPrefix } from "@/lib/accounting/receipts";
import { isValidHexColor } from "@/lib/config/brand";
import { createUploadedDocument } from "@/lib/services/documents";

export interface OrganizationState {
  ok?: boolean;
  error?: string;
  message?: string;
}

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const str = (fd: FormData, key: string): string | null =>
  String(fd.get(key) ?? "").trim() || null;

export async function saveOrganizationAction(
  _prev: OrganizationState,
  fd: FormData,
): Promise<OrganizationState> {
  await requireCapability("organization.settings");
  const actor = await auditActor();

  // Logo: a new file replaces it, the checkbox removes it, otherwise unchanged.
  let logoDocumentId: string | null | undefined = undefined;
  const removeLogo = fd.get("removeLogo") === "on";
  const logo = fd.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!LOGO_TYPES.has(logo.type)) {
      return { error: "Logo must be a PNG, JPEG, or WebP image." };
    }
    if (logo.size > LOGO_MAX_BYTES) {
      return { error: "Logo too large (max 2 MB)." };
    }
    try {
      const { documentId } = await createUploadedDocument({
        body: Buffer.from(await logo.arrayBuffer()),
        fileName: logo.name || "logo",
        contentType: logo.type,
        uploadType: "other",
        notes: "Organization logo",
        actor,
      });
      logoDocumentId = documentId;
    } catch (e) {
      // The UI message stays generic; the CAUSE must reach the server log or
      // storage failures (mount permissions etc.) are undiagnosable.
      console.error("[organization] logo upload failed:", e);
      return {
        error:
          e instanceof Error && /storage is not configured/i.test(e.message)
            ? "File storage is not configured (set STORAGE_PROVIDER=local or s3) — logo uploads are unavailable."
            : "Logo upload failed — check the server log for the cause (storage permissions are the usual suspect).",
      };
    }
  } else if (removeLogo) {
    logoDocumentId = null;
  }

  const email = str(fd, "businessEmail");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid contact email." };
  }
  const brandColor = str(fd, "brandColor");
  if (brandColor && !isValidHexColor(brandColor)) {
    return { error: "Brand colour must be a hex value like #2563eb." };
  }
  const timezone = str(fd, "defaultTimezone");
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return { error: `Unknown IANA timezone: ${timezone}` };
    }
  }

  try {
    await saveOrganizationSettings(
      {
        businessName: str(fd, "businessName"),
        businessLegalName: str(fd, "businessLegalName"),
        businessAddress: str(fd, "businessAddress"),
        businessPhone: str(fd, "businessPhone"),
        businessEmail: email,
        logoDocumentId,
        brandColor: brandColor ? brandColor.toLowerCase() : null,
        receiptFooter: str(fd, "receiptFooter"),
        // Stored raw-ish; sanitized to A-Z/0-9 (max 8) at use, but normalize
        // here too so the saved value reflects what will actually print.
        receiptPrefix: (() => {
          const raw = str(fd, "receiptPrefix");
          return raw ? sanitizeReceiptPrefix(raw) : null;
        })(),
        portalWelcomeText: str(fd, "portalWelcomeText"),
        applyIntroText: str(fd, "applyIntroText"),
        portalPaymentHelpText: str(fd, "portalPaymentHelpText"),
        applyConfirmationText: str(fd, "applyConfirmationText"),
        reportHeaderText: str(fd, "reportHeaderText"),
        // Restrict to the offered options; anything else clears the override.
        defaultTablePageSize: (() => {
          const n = Number(str(fd, "defaultTablePageSize"));
          return [10, 20, 50].includes(n) ? n : null;
        })(),
        defaultTimezone: timezone,
        defaultCurrency: str(fd, "defaultCurrency")?.toUpperCase() ?? null,
      },
      actor,
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save settings." };
  }

  revalidatePath("/", "layout"); // brand name/logo appear on every page
  return { ok: true, message: "Organization settings saved." };
}

const strOrNull = (fd: FormData, key: string): string | null =>
  String(fd.get(key) ?? "").trim() || null;

/**
 * Save NON-SECRET storage overrides (provider + S3 bucket/region/endpoint/
 * path-style). Secrets stay in env. Blank fields clear the override (fall back
 * to env). The storage factory rebuilds on the next request (config-signature
 * cache + invalidated settings cache).
 */
export async function saveStorageConfigAction(
  _prev: OrganizationState,
  fd: FormData,
): Promise<OrganizationState> {
  await requireCapability("organization.settings");
  const actor = await auditActor();

  const pathStyleRaw = String(fd.get("s3ForcePathStyle") ?? "");
  const s3ForcePathStyle =
    pathStyleRaw === "true" ? true : pathStyleRaw === "false" ? false : null;

  try {
    await saveStorageConfig(
      {
        storageProvider: strOrNull(fd, "storageProvider"),
        s3Bucket: strOrNull(fd, "s3Bucket"),
        s3Region: strOrNull(fd, "s3Region"),
        s3Endpoint: strOrNull(fd, "s3Endpoint"),
        s3ForcePathStyle,
      },
      actor,
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save storage config." };
  }
  revalidatePath("/settings/organization");
  return { ok: true, message: "Storage settings saved." };
}
