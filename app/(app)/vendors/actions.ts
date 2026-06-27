"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireModuleCapability } from "@/lib/auth/session";
import { parseVendorTrade } from "@/lib/vendors/vendor-trade";
import { createVendor, setVendorActive, updateVendor } from "@/lib/services/vendors";
import type { VendorInput } from "@/lib/services/vendors";
import { getFormString as str, type FormState } from "@/lib/forms";

function readInput(fd: FormData): VendorInput {
  return {
    name: str(fd, "name"),
    trade: parseVendorTrade(str(fd, "trade")),
    contactName: str(fd, "contactName") || null,
    email: str(fd, "email") || null,
    phone: str(fd, "phone") || null,
    mailingAddress: str(fd, "mailingAddress") || null,
    notes: str(fd, "notes") || null,
  };
}

export async function createVendorAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("vendors.manage", "vendors");
  const data = readInput(fd);
  if (!data.name) return { error: "Name is required." };
  const res = await createVendor({ data, actor: await auditActor() });
  if ("error" in res) return { error: res.error };
  revalidatePath("/vendors");
  return { ok: true };
}

export async function updateVendorAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("vendors.manage", "vendors");
  const id = str(fd, "vendorId");
  if (!id) return { error: "Missing vendor id." };
  const data = readInput(fd);
  if (!data.name) return { error: "Name is required." };
  const res = await updateVendor({ id, data, actor: await auditActor() });
  if (!res.ok) return { error: res.error ?? "Update failed." };
  revalidatePath("/vendors");
  return { ok: true };
}

export async function setVendorActiveAction(fd: FormData): Promise<void> {
  await requireModuleCapability("vendors.manage", "vendors");
  const id = String(fd.get("vendorId") ?? "").trim();
  if (!id) throw new Error("Missing vendor id.");
  const isActive = String(fd.get("isActive") ?? "") === "true";
  await setVendorActive({ id, isActive, actor: await auditActor() });
  revalidatePath("/vendors");
}
