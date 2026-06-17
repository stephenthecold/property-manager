"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { withAudit } from "@/lib/audit/audit";
import { parsePayerType } from "@/lib/payers/payer-type";
import type { FormState } from "@/lib/forms";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = {
  name: 200,
  contactName: 200,
  email: 254,
  phone: 40,
  mailingAddress: 300,
  notes: 2000,
} as const;

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

interface PayerFields {
  name: string;
  type: ReturnType<typeof parsePayerType>;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  mailingAddress: string | null;
  notes: string | null;
}

/** Validate + normalize the shared payer form fields. */
function readPayerFields(fd: FormData): { error: string } | { fields: PayerFields } {
  const name = str(fd, "name");
  if (!name) return { error: "Enter the payer's name." };
  const contactName = str(fd, "contactName") || null;
  const email = str(fd, "email") || null;
  const phone = str(fd, "phone") || null;
  const mailingAddress = str(fd, "mailingAddress") || null;
  const notes = str(fd, "notes") || null;

  if (
    name.length > MAX.name ||
    (contactName?.length ?? 0) > MAX.contactName ||
    (email?.length ?? 0) > MAX.email ||
    (phone?.length ?? 0) > MAX.phone ||
    (mailingAddress?.length ?? 0) > MAX.mailingAddress ||
    (notes?.length ?? 0) > MAX.notes
  ) {
    return { error: "One of the fields is too long. Please shorten it." };
  }
  if (email && !EMAIL_RE.test(email)) {
    return { error: "Enter a valid email address (or leave it blank)." };
  }

  return {
    fields: {
      name,
      type: parsePayerType(str(fd, "type")),
      contactName,
      email,
      phone,
      mailingAddress,
      notes,
    },
  };
}

export async function createPayerAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { dbUser } = await requireCapability("payers.manage");
  const parsed = readPayerFields(fd);
  if ("error" in parsed) return parsed;
  const { fields } = parsed;

  await withAudit(
    {
      ...(await auditActor()),
      action: "payer.created",
      entityType: "Payer",
      entityId: "(new)",
    },
    async (tx) => {
      const created = await tx.payer.create({
        data: { ...fields, createdBy: dbUser.id },
      });
      return {
        result: created,
        entityId: created.id,
        after: { name: fields.name, type: fields.type },
      };
    },
  );

  revalidatePath("/payers");
  return { ok: true };
}

export async function updatePayerAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("payers.manage");
  const id = str(fd, "payerId");
  if (!id) return { error: "Missing payer id." };
  const existing = await prisma.payer.findUnique({ where: { id } });
  if (!existing) return { error: "Payer not found." };

  const parsed = readPayerFields(fd);
  if ("error" in parsed) return parsed;
  const { fields } = parsed;

  await withAudit(
    {
      ...(await auditActor()),
      action: "payer.updated",
      entityType: "Payer",
      entityId: id,
      before: { name: existing.name, type: existing.type, email: existing.email },
    },
    async (tx) => {
      const updated = await tx.payer.update({ where: { id }, data: fields });
      return { result: updated, after: { name: fields.name, type: fields.type } };
    },
  );

  revalidatePath("/payers");
  return { ok: true };
}

export async function setPayerActiveAction(fd: FormData): Promise<void> {
  await requireCapability("payers.manage");
  const id = str(fd, "payerId");
  const isActive = str(fd, "isActive") === "true";
  if (!id) throw new Error("Missing payer id.");
  const existing = await prisma.payer.findUnique({ where: { id } });
  if (!existing || existing.isActive === isActive) return;

  await withAudit(
    {
      ...(await auditActor()),
      action: isActive ? "payer.reactivated" : "payer.deactivated",
      entityType: "Payer",
      entityId: id,
      before: { isActive: existing.isActive },
    },
    async (tx) => {
      await tx.payer.update({ where: { id }, data: { isActive } });
      return { result: undefined, after: { isActive } };
    },
  );

  revalidatePath("/payers");
}
