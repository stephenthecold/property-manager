"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { saveOrganizationSettings } from "@/lib/services/app-settings";
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
      return {
        error:
          e instanceof Error && /storage is not configured/i.test(e.message)
            ? "File storage is not configured (set STORAGE_PROVIDER=local or s3) — logo uploads are unavailable."
            : "Logo upload failed.",
      };
    }
  } else if (removeLogo) {
    logoDocumentId = null;
  }

  const email = str(fd, "businessEmail");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid contact email." };
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
        receiptFooter: str(fd, "receiptFooter"),
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
