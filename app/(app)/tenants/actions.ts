"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole, auditActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/audit";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function createTenant(fd: FormData): Promise<void> {
  await requireRole("manager");
  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  if (!firstName || !lastName) throw new Error("First and last name are required.");
  const tenant = await prisma.tenant.create({
    data: {
      firstName,
      lastName,
      phone: str(fd, "phone") || null,
      email: str(fd, "email") || null,
      mailingAddress: str(fd, "mailingAddress") || null,
      emergencyContactName: str(fd, "emergencyContactName") || null,
      emergencyContactPhone: str(fd, "emergencyContactPhone") || null,
      smsConsent: fd.get("smsConsent") === "on",
      notes: str(fd, "notes") || null,
    },
  });
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "tenant.created",
    entityType: "Tenant",
    entityId: tenant.id,
    after: { firstName, lastName },
  });
  redirect(`/tenants/${tenant.id}`);
}
