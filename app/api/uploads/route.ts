import { NextResponse } from "next/server";
import { authorizeApiCapability } from "@/lib/auth/session";
import { UploadType } from "@/lib/generated/prisma/enums";
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

/** A plausible cuid; bounds an otherwise-free id form field. */
function isLikelyId(v: string): boolean {
  return /^[a-z0-9]{20,40}$/.test(v);
}

export async function POST(req: Request) {
  const auth = await authorizeApiCapability("documents.manage");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status },
    );
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

  // Optional attachment refs must look like real ids before they reach the DB.
  const tenantId = formString(form, "tenantId");
  const paymentId = formString(form, "paymentId");
  const receiptId = formString(form, "receiptId");
  for (const id of [tenantId, paymentId, receiptId]) {
    if (id && !isLikelyId(id)) {
      return NextResponse.json({ error: "Invalid attachment id" }, { status: 400 });
    }
  }

  try {
    const { documentId } = await createUploadedDocument({
      body: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      contentType: file.type || null,
      uploadType,
      tenantId,
      paymentId,
      receiptId,
      notes: formString(form, "notes"),
      actor: { actorType: "user", actorId: auth.dbUser.id, actorEmail: auth.dbUser.email },
    });
    return NextResponse.json({ documentId }, { status: 201 });
  } catch (e) {
    // Generic message to the client; real cause to the server log.
    console.error("[uploads] upload failed:", e);
    const message = e instanceof Error ? e.message : "";
    if (/storage is not configured/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
