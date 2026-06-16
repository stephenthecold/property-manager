import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalSession } from "@/lib/portal/session";
import { getFileStorage } from "@/lib/providers/storage";

/**
 * Tenant-scoped document download. /api/portal is a staff-middleware
 * PUBLIC_PREFIX, so the PORTAL session is the gate here — plus a strict
 * ownership check: the document must be attached to THIS tenant, one of
 * their leases, or one of their receipts. Org-level files (logo, lease
 * templates) and other tenants' documents are unreachable regardless of id
 * guessing. Bytes come through the storage provider (decrypting wrapper
 * included), so LOCAL+S3 both work without exposing signed URLs.
 */

export const runtime = "nodejs";

// Deliberately NOT "other" (staff-internal misc uploads) or "lease_template"
// (org file) — only types a tenant plausibly owns.
const ALLOWED_TYPES = new Set(["lease", "tenant_document", "receipt_photo"]);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ documentId: string }> },
) {
  const identity = await getPortalSession();
  if (!identity) return new NextResponse("Unauthorized", { status: 401 });
  const { documentId } = await ctx.params;

  const doc = await prisma.uploadedDocument.findUnique({
    where: { id: documentId },
  });
  if (!doc || !ALLOWED_TYPES.has(doc.uploadType)) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Ownership: direct tenant ref, one of the tenant's leases (primary or
  // co-tenant), or a receipt that belongs to them.
  const tenantId = identity.tenant.id;
  let owned = doc.tenantId === tenantId;
  if (!owned && doc.leaseId) {
    owned =
      (await prisma.lease.count({
        where: {
          id: doc.leaseId,
          OR: [{ tenantId }, { coTenants: { some: { tenantId } } }],
        },
      })) > 0;
  }
  if (!owned && doc.receiptId) {
    owned =
      (await prisma.receipt.count({
        where: { id: doc.receiptId, tenantId },
      })) > 0;
  }
  // 404 (not 403) so probing ids can't distinguish "exists but not yours".
  if (!owned) return new NextResponse("Not found", { status: 404 });

  let body: Buffer;
  try {
    body = await (await getFileStorage()).get(doc.fileUrl);
  } catch (e) {
    console.error(`[portal/files] read failed for document ${doc.id}:`, e);
    return new NextResponse("Not found", { status: 404 });
  }

  const fileName = (doc.fileName ?? "document").replace(/[^\w. -]/g, "_");
  const contentType = doc.fileType ?? "application/octet-stream";
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
      // The signed-agreement artifact is text/html (self-contained, fully
      // escaped). Sandbox anything HTML-ish anyway so no served document can
      // ever run script in the app's origin.
      ...(contentType.includes("html")
        ? { "Content-Security-Policy": "sandbox" }
        : {}),
    },
  });
}
