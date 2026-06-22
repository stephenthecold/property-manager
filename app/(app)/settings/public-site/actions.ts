"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { savePublicSiteSettings } from "@/lib/services/app-settings";
import type { FormState } from "@/lib/forms";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/**
 * Save the public-site copy + base URL. Validation problems are RETURNED (not
 * thrown) so they render inline instead of the opaque production digest page.
 */
export async function savePublicSiteAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("organization.settings");

  // Normalize the public base URL: must be http/https; keep only the origin so
  // a stray path/trailing slash can't break generated portal links.
  let publicSiteUrl: string | null = str(fd, "publicSiteUrl") || null;
  if (publicSiteUrl) {
    let parsed: URL;
    try {
      parsed = new URL(publicSiteUrl);
    } catch {
      return { error: "Enter a valid public site URL, e.g. https://newedgerentals.com." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "Public site URL must start with http:// or https://." };
    }
    publicSiteUrl = parsed.origin;
  }

  await savePublicSiteSettings(
    {
      publicSiteUrl,
      publicSiteTagline: str(fd, "publicSiteTagline") || null,
      publicSiteIntro: str(fd, "publicSiteIntro") || null,
      publicSiteAreas: str(fd, "publicSiteAreas") || null,
      publicSiteHours: str(fd, "publicSiteHours") || null,
    },
    await auditActor(),
  );
  revalidatePath("/welcome");
  return { ok: true };
}
