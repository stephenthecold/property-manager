"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { parseVendorTrade } from "@/lib/vendors/vendor-trade";
import { createVendor, setVendorActive, updateVendor } from "@/lib/services/vendors";
import type { VendorInput } from "@/lib/services/vendors";
import type { FormState } from "@/lib/forms";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

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

async function gate(): Promise<void> {
  await requireCapability("vendors.manage");
  await assertModuleEnabled("vendors");
}

export async function createVendorAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await gate();
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
  await gate();
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
  await gate();
  const id = String(fd.get("vendorId") ?? "").trim();
  if (!id) throw new Error("Missing vendor id.");
  const isActive = String(fd.get("isActive") ?? "") === "true";
  await setVendorActive({ id, isActive, actor: await auditActor() });
  revalidatePath("/vendors");
}
