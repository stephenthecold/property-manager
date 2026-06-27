"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  getAppSettings,
  PUBLIC_SITE_GALLERY_MAX,
  savePublicSiteGallery,
  savePublicSiteHeroDocument,
  savePublicSiteSettings,
} from "@/lib/services/app-settings";
import { createUploadedDocument } from "@/lib/services/documents";
import { getFormString as str, type FormState } from "@/lib/forms";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Validate an image File against the type + size rules; null = ok. */
function imageError(file: File): string | null {
  if (!IMAGE_TYPES.has(file.type)) return "Photos must be PNG, JPEG, or WebP.";
  if (file.size > IMAGE_MAX_BYTES) return "Each photo must be under 5 MB.";
  return null;
}

function storageError(e: unknown): string {
  console.error("[public-site] image upload failed:", e);
  return e instanceof Error && /storage is not configured/i.test(e.message)
    ? "File storage is not configured (set STORAGE_PROVIDER=local or s3) — photo uploads are unavailable."
    : "Upload failed — check the server log for the cause (storage permissions are the usual suspect).";
}

/**
 * Save the public-site copy + base URL + the amenities list and the
 * show-availability toggle. Validation problems are RETURNED (not thrown) so
 * they render inline instead of the opaque production digest page. Photos are
 * handled by the dedicated actions below.
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
      publicSiteAmenities: str(fd, "publicSiteAmenities") || null,
      publicSiteShowAvailability: fd.get("publicSiteShowAvailability") === "on",
    },
    await auditActor(),
  );
  revalidatePath("/welcome");
  return { ok: true };
}

/** Upload/replace (or remove) the hero/banner image. */
export async function savePublicSiteHeroAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("organization.settings");
  const actor = await auditActor();
  const file = fd.get("heroImage");
  const remove = fd.get("removeHero") === "on";

  if (file instanceof File && file.size > 0) {
    if (!IMAGE_TYPES.has(file.type)) {
      return { error: "Hero image must be a PNG, JPEG, or WebP." };
    }
    if (file.size > IMAGE_MAX_BYTES) {
      return { error: "Hero image too large (max 5 MB)." };
    }
    try {
      const { documentId } = await createUploadedDocument({
        body: Buffer.from(await file.arrayBuffer()),
        fileName: file.name || "hero",
        contentType: file.type,
        uploadType: "public_site",
        notes: "Public site hero image",
        actor,
      });
      await savePublicSiteHeroDocument(documentId, actor);
    } catch (e) {
      return { error: storageError(e) };
    }
  } else if (remove) {
    await savePublicSiteHeroDocument(null, actor);
  } else {
    return { error: "Choose an image, or check Remove." };
  }

  revalidatePath("/welcome");
  revalidatePath("/settings/public-site");
  return { ok: true };
}

/** Append one or more photos to the gallery (capped). */
export async function addGalleryImagesAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("organization.settings");
  const actor = await auditActor();
  const files = fd
    .getAll("galleryImages")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Choose one or more photos to add." };

  const current = (await getAppSettings()).publicSiteGallery;
  const room = PUBLIC_SITE_GALLERY_MAX - current.length;
  if (room <= 0) {
    return { error: `The gallery is full (max ${PUBLIC_SITE_GALLERY_MAX} photos).` };
  }
  const toUpload = files.slice(0, room); // silently cap to the remaining slots

  // Validate the WHOLE batch BEFORE uploading any — otherwise a bad file partway
  // through would leave the earlier ones stored but orphaned (the early return
  // never saves the gallery list).
  for (const file of toUpload) {
    const err = imageError(file);
    if (err) return { error: err };
  }

  const additions: { id: string }[] = [];
  try {
    for (const file of toUpload) {
      const { documentId } = await createUploadedDocument({
        body: Buffer.from(await file.arrayBuffer()),
        fileName: file.name || "photo",
        contentType: file.type,
        uploadType: "public_site",
        notes: "Public site gallery photo",
        actor,
      });
      additions.push({ id: documentId });
    }
  } catch (e) {
    // A storage failure mid-batch can orphan an earlier upload (a stray, never-
    // referenced marketing image) — acceptable; surface the error.
    return { error: storageError(e) };
  }

  await savePublicSiteGallery([...current, ...additions], actor);
  revalidatePath("/welcome");
  revalidatePath("/settings/public-site");
  return { ok: true };
}

/** Remove one photo from the gallery (the stored image is left in storage). */
export async function removeGalleryImageAction(fd: FormData): Promise<void> {
  await requireCapability("organization.settings");
  const id = str(fd, "id");
  if (!id) return;
  const current = (await getAppSettings()).publicSiteGallery;
  await savePublicSiteGallery(
    current.filter((g) => g.id !== id),
    await auditActor(),
  );
  revalidatePath("/welcome");
  revalidatePath("/settings/public-site");
}
