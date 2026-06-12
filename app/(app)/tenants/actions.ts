"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCapability, auditActor } from "@/lib/auth/session";
import { writeAudit, withAudit } from "@/lib/audit/audit";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function createTenant(fd: FormData): Promise<void> {
  await requireCapability("tenants.manage");
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

export async function updateTenant(fd: FormData): Promise<void> {
  await requireCapability("tenants.manage");
  const tenantId = str(fd, "tenantId");
  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  if (!tenantId || !firstName || !lastName) {
    throw new Error("First and last name are required.");
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("Tenant not found.");

  const data = {
    firstName,
    lastName,
    phone: str(fd, "phone") || null,
    email: str(fd, "email") || null,
    mailingAddress: str(fd, "mailingAddress") || null,
    emergencyContactName: str(fd, "emergencyContactName") || null,
    emergencyContactPhone: str(fd, "emergencyContactPhone") || null,
    smsConsent: fd.get("smsConsent") === "on",
    isActive: fd.get("isActive") === "on",
    notes: str(fd, "notes") || null,
  };

  await withAudit(
    {
      ...(await auditActor()),
      action: "tenant.updated",
      entityType: "Tenant",
      entityId: tenant.id,
      before: {
        firstName: tenant.firstName,
        lastName: tenant.lastName,
        phone: tenant.phone,
        email: tenant.email,
        mailingAddress: tenant.mailingAddress,
        emergencyContactName: tenant.emergencyContactName,
        emergencyContactPhone: tenant.emergencyContactPhone,
        smsConsent: tenant.smsConsent,
        isActive: tenant.isActive,
        notes: tenant.notes,
      },
    },
    async (tx) => {
      const updated = await tx.tenant.update({ where: { id: tenant.id }, data });
      return { result: updated, after: data };
    },
  );

  revalidatePath(`/tenants/${tenant.id}`);
  revalidatePath("/tenants");
}
