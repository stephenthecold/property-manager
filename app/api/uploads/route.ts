import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { roleAtLeast } from "@/lib/auth/rbac";
import { UploadType, type Role } from "@/lib/generated/prisma/enums";
import { createUploadedDocument } from "@/lib/services/documents";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  "text/plain",
]);

function formString(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // DB-authoritative role check (requireRole redirects — wrong for an API).
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || !dbUser.isActive || !roleAtLeast(dbUser.role as Role, "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // securityStamp mismatch = token revoked (same check requireRole performs).
  if (user.securityStamp && dbUser.securityStamp !== user.securityStamp) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 15 MB)" },
      { status: 413 },
    );
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || "unknown"}` },
      { status: 415 },
    );
  }

  const rawUploadType = formString(form, "uploadType");
  const uploadType: UploadType =
    rawUploadType && rawUploadType in UploadType
      ? (rawUploadType as UploadType)
      : "other";

  try {
    const { documentId } = await createUploadedDocument({
      body: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      contentType: file.type || null,
      uploadType,
      tenantId: formString(form, "tenantId"),
      paymentId: formString(form, "paymentId"),
      receiptId: formString(form, "receiptId"),
      notes: formString(form, "notes"),
      actor: { actorType: "user", actorId: dbUser.id, actorEmail: dbUser.email },
    });
    return NextResponse.json({ documentId }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (/storage is not configured/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
