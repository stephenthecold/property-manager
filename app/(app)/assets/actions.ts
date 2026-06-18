"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import { createAsset, setAssetActive, updateAsset } from "@/lib/services/assets";
import type { AssetInput } from "@/lib/services/assets";
import type { FormState } from "@/lib/forms";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

async function gate(): Promise<void> {
  await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
}

/**
 * Resolve the two date-only inputs (installedOn / warrantyExpiresOn) in the
 * chosen property's timezone, so they persist at that day's start — consistent
 * with property purchase/maturity dates. Returns an error string on a bad date.
 */
async function readInput(
  fd: FormData,
): Promise<{ data: AssetInput } | { error: string }> {
  const propertyId = str(fd, "propertyId");
  if (!propertyId) return { error: "Property is required." };
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { timezone: true },
  });
  if (!property) return { error: "Property not found." };
  const tz = property.timezone;

  const installedRaw = str(fd, "installedOn");
  const installedOn = installedRaw ? parseDateOnlyInZone(installedRaw, tz) : null;
  if (installedRaw && !installedOn) {
    return { error: "Installed date must be a valid date (YYYY-MM-DD)." };
  }
  const warrantyRaw = str(fd, "warrantyExpiresOn");
  const warrantyExpiresOn = warrantyRaw
    ? parseDateOnlyInZone(warrantyRaw, tz)
    : null;
  if (warrantyRaw && !warrantyExpiresOn) {
    return { error: "Warranty expiry must be a valid date (YYYY-MM-DD)." };
  }

  return {
    data: {
      name: str(fd, "name"),
      category: str(fd, "category") || null,
      propertyId,
      unitId: str(fd, "unitId") || null,
      make: str(fd, "make") || null,
      model: str(fd, "model") || null,
      serialNumber: str(fd, "serialNumber") || null,
      installedOn,
      warrantyExpiresOn,
      notes: str(fd, "notes") || null,
    },
  };
}

export async function createAssetAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await gate();
  const parsed = await readInput(fd);
  if ("error" in parsed) return { error: parsed.error };
  if (!parsed.data.name) return { error: "Name is required." };
  const res = await createAsset({ data: parsed.data, actor: await auditActor() });
  if ("error" in res) return { error: res.error };
  revalidatePath("/assets");
  return { ok: true };
}

export async function updateAssetAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await gate();
  const id = str(fd, "assetId");
  if (!id) return { error: "Missing asset id." };
  const parsed = await readInput(fd);
  if ("error" in parsed) return { error: parsed.error };
  if (!parsed.data.name) return { error: "Name is required." };
  const res = await updateAsset({ id, data: parsed.data, actor: await auditActor() });
  if (!res.ok) return { error: res.error ?? "Update failed." };
  revalidatePath("/assets");
  return { ok: true };
}

export async function setAssetActiveAction(fd: FormData): Promise<void> {
  await gate();
  const id = str(fd, "assetId");
  if (!id) throw new Error("Missing asset id.");
  const active = String(fd.get("active") ?? "") === "true";
  await setAssetActive({ id, active, actor: await auditActor() });
  revalidatePath("/assets");
}
