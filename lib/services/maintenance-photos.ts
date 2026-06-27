import { createUploadedDocument } from "@/lib/services/documents";
import type { AuditContext } from "@/lib/audit/audit";
import type { UploadType } from "@/lib/generated/prisma/enums";

/**
 * Shared, defensive image-saving for maintenance photos — used by the tenant
 * portal (request photos) and staff (work-order before/after). Never trusts the
 * client-declared MIME type: each file's bytes must match a known image magic
 * number, or it's skipped. Count + size are capped; storage failures are
 * returned, not thrown, so a hiccup never blocks the request/job it rode in on.
 */

export const MAX_MAINTENANCE_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

/** Canonical image type from magic bytes, or null when the bytes aren't a
 *  browser-renderable image (so we never serve arbitrary bytes as an image). */
function detectImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

export interface SavePhotosResult {
  saved: number;
  /** Files dropped for being too big, empty, or not a real image. */
  skipped: number;
  /** Set when storage is unavailable — the caller surfaces a soft warning. */
  storageError?: boolean;
}

export async function saveMaintenancePhotos(i: {
  files: File[];
  tenantRequestId?: string;
  maintenanceJobId?: string;
  unitConditionLogId?: string;
  inspectionChecklistItemId?: string;
  tenantId?: string | null;
  /** Per-file note, e.g. "Tenant photo", "Before", "After". */
  note: string;
  uploadType?: UploadType;
  actor: AuditContext;
}): Promise<SavePhotosResult> {
  const files = i.files
    .filter((f) => f instanceof File && f.size > 0)
    .slice(0, MAX_MAINTENANCE_PHOTOS);

  let saved = 0;
  let skipped = 0;
  for (const f of files) {
    if (f.size > MAX_PHOTO_BYTES) {
      skipped++;
      continue;
    }
    const buf = Buffer.from(await f.arrayBuffer());
    const contentType = detectImageType(buf);
    if (!contentType) {
      skipped++; // bytes aren't a real image — refuse it
      continue;
    }
    try {
      await createUploadedDocument({
        body: buf,
        fileName: f.name || "photo",
        contentType,
        uploadType: i.uploadType ?? "tenant_document",
        tenantId: i.tenantId ?? null,
        tenantRequestId: i.tenantRequestId ?? null,
        maintenanceJobId: i.maintenanceJobId ?? null,
        unitConditionLogId: i.unitConditionLogId ?? null,
        inspectionChecklistItemId: i.inspectionChecklistItemId ?? null,
        notes: i.note,
        actor: i.actor,
      });
      saved++;
    } catch (e) {
      console.error("[maintenance-photos] store failed:", e);
      return { saved, skipped, storageError: true };
    }
  }
  return { saved, skipped };
}
