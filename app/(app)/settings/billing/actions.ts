"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole, auditActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/audit";
import { saveBillingDefaults, getAppSettings } from "@/lib/services/app-settings";
import { toCents } from "@/lib/money";
import type { LateFeeType } from "@/lib/generated/prisma/enums";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function saveBillingDefaultsAction(fd: FormData): Promise<void> {
  await requireRole("finance");
  const actor = await auditActor();

  const dueDay = Number(str(fd, "dueDay") || "1");
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new Error("Due day must be between 1 and 31.");
  }
  const graceDays = Number(str(fd, "graceDays") || "0");
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 60) {
    throw new Error("Grace period must be between 0 and 60 days.");
  }

  const lateFeeType = (str(fd, "lateFeeType") || "none") as LateFeeType;
  let lateFeeAmountCents: bigint | null = null;
  let lateFeeBps: number | null = null;
  let lateFeeMaxCents: bigint | null = null;
  if (lateFeeType === "fixed" || lateFeeType === "daily") {
    const raw = str(fd, "lateFeeAmount");
    if (!raw) {
      throw new Error(
        lateFeeType === "daily"
          ? "Enter the daily late-fee rate."
          : "Enter the fixed late-fee amount.",
      );
    }
    lateFeeAmountCents = toCents(raw);
    if (lateFeeAmountCents < 0n) throw new Error("Late fee cannot be negative.");
    if (lateFeeType === "daily") {
      const capRaw = str(fd, "lateFeeMax");
      if (capRaw) {
        lateFeeMaxCents = toCents(capRaw);
        if (lateFeeMaxCents < lateFeeAmountCents) {
          throw new Error("The cap must be at least one day's rate.");
        }
      }
    }
  } else if (lateFeeType === "percentage") {
    const bps = Number(str(fd, "lateFeeBps") || "0");
    if (!Number.isInteger(bps) || bps <= 0 || bps > 10000) {
      throw new Error("Late-fee percentage must be 1–10000 basis points (500 = 5%).");
    }
    lateFeeBps = bps;
  }

  const internetFeeRaw = str(fd, "internetFee");
  if (!internetFeeRaw) throw new Error("Internet fee is required (enter 0 for none).");
  const internetFeeCents = toCents(internetFeeRaw);
  if (internetFeeCents < 0n) throw new Error("Internet fee cannot be negative.");

  await saveBillingDefaults(
    {
      dueDay,
      graceDays,
      lateFeeType,
      lateFeeAmountCents,
      lateFeeBps,
      lateFeeMaxCents,
      internetFeeCents,
    },
    actor,
  );
  revalidatePath("/settings/billing");
}

/**
 * Bulk-apply the CURRENT default grace/late-fee terms to all active leases.
 * Explicit and confirm-guarded — saving the defaults alone never touches
 * existing leases. Due day is intentionally NOT bulk-applied: changing it
 * mid-lease shifts every future period key and due date.
 */
export async function applyChargeTermsToActiveLeases(): Promise<void> {
  await requireRole("finance");
  const actor = await auditActor();
  const { billing } = await getAppSettings();

  const leases = await prisma.lease.findMany({
    where: { status: { in: ["active", "month_to_month"] } },
  });

  let changed = 0;
  for (const lease of leases) {
    const same =
      lease.gracePeriodDays === billing.graceDays &&
      lease.lateFeeType === billing.lateFeeType &&
      lease.lateFeeAmountCents === billing.lateFeeAmountCents &&
      lease.lateFeeBps === billing.lateFeeBps &&
      lease.lateFeeMaxCents === billing.lateFeeMaxCents;
    if (same) continue;

    await prisma.$transaction(async (tx) => {
      await tx.lease.update({
        where: { id: lease.id },
        data: {
          gracePeriodDays: billing.graceDays,
          lateFeeType: billing.lateFeeType,
          lateFeeAmountCents: billing.lateFeeAmountCents,
          lateFeeBps: billing.lateFeeBps,
          lateFeeMaxCents: billing.lateFeeMaxCents,
        },
      });
      await writeAudit(tx, {
        ...actor,
        action: "lease.charge_terms_bulk_applied",
        entityType: "Lease",
        entityId: lease.id,
        before: {
          gracePeriodDays: lease.gracePeriodDays,
          lateFeeType: lease.lateFeeType,
          lateFeeAmountCents: lease.lateFeeAmountCents,
          lateFeeBps: lease.lateFeeBps,
          lateFeeMaxCents: lease.lateFeeMaxCents,
        },
        after: {
          gracePeriodDays: billing.graceDays,
          lateFeeType: billing.lateFeeType,
          lateFeeAmountCents: billing.lateFeeAmountCents,
          lateFeeBps: billing.lateFeeBps,
          lateFeeMaxCents: billing.lateFeeMaxCents,
        },
      });
    });
    changed++;
  }

  await writeAudit(prisma, {
    ...actor,
    action: "settings.billing.bulk_applied",
    entityType: "AppSettings",
    entityId: "singleton",
    after: { leasesChanged: changed, leasesTotal: leases.length },
  });

  revalidatePath("/settings/billing");
  revalidatePath("/leases");
}
