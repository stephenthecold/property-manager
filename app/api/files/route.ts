import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  localFilePath,
  verifyLocalFileSignature,
} from "@/lib/providers/storage/local";

/**
 * Serves objects stored by the LOCAL provider only (signed key/exp/sig URLs).
 * S3 presigned URLs never hit this route.
 */

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
  txt: "text/plain",
};

function contentTypeFor(key: string): string {
  const dot = key.lastIndexOf(".");
  const ext = dot >= 0 ? key.slice(dot + 1).toLowerCase() : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const exp = searchParams.get("exp");
  const sig = searchParams.get("sig");
  if (!key || !exp || !sig || !verifyLocalFileSignature({ key, exp, sig })) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let body: Buffer;
  try {
    body = await readFile(localFilePath(key));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return new NextResponse("Not found", { status: 404 });
    }
    throw e;
  }

  const fileName = key.split("/").pop() || "file";
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentTypeFor(key),
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, max-age=300",
      // User-uploaded content: never let the browser sniff a different type.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
