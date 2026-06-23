import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getFileStorage } from "@/lib/providers/storage";

export const runtime = "nodejs";

/**
 * Public marketing image server. Sits under the `/welcome` PUBLIC_PREFIX so a
 * logged-out visitor can load hero/gallery photos. It serves ONLY documents with
 * uploadType "public_site" — never tenant/lease/receipt files (those go through
 * the session-checked /api/files and /api/portal/files routes). Bytes are read
 * (and decrypted, for encrypted-local storage) via the storage provider, so it
 * works for stub/local/local-encrypted/s3 alike.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const doc = await prisma.uploadedDocument.findUnique({
    where: { id },
    select: { fileUrl: true, fileType: true, uploadType: true },
  });
  if (!doc || doc.uploadType !== "public_site") {
    return new NextResponse("Not found", { status: 404 });
  }

  let body: Buffer;
  try {
    const storage = await getFileStorage();
    body = await storage.get(doc.fileUrl);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "content-type": doc.fileType || "application/octet-stream",
      "cache-control": "public, max-age=3600",
    },
  });
}
