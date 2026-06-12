"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCapability, auditActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/audit";
import {
  saveBillingDefaults,
  saveCashAppCashtag,
  getAppSettings,
} from "@/lib/services/app-settings";
import { normalizeCashtag } from "@/lib/payments/cash-app";
import { toCents } from "@/lib/money";
import type { LateFeeType } from "@/lib/generated/prisma/enums";

/**
 * Validation failures are RETURNED, never thrown: a thrown error in a server
 * action surfaces in production as the opaque "A server error occurred"
 * digest page instead of an inline message.
 */
export interface BillingState {
  ok?: boolean;
  error?: string;
  message?: string;
}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function parseMoney(
  raw: string,
  label: string,
): { cents: bigint } | { error: string } {
  try {
    const cents = toCents(raw);
    if (cents < 0n) return { error: `${label} cannot be negative.` };
    return { cents };
  } catch {
    return { error: `${label} must be a dollar amount like 25 or 25.00.` };
  }
}

export async function saveBillingDefaultsAction(
  _prev: BillingState,
  fd: FormData,
): Promise<BillingState> {
  await requireCapability("billing.settings");
  const actor = await auditActor();

  const dueDay = Number(str(fd, "dueDay") || "1");
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return { error: "Due day must be between 1 and 31." };
  }
  const graceDays = Number(str(fd, "graceDays") || "0");
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 60) {
    return { error: "Grace period must be between 0 and 60 days." };
  }

  const lateFeeType = (str(fd, "lateFeeType") || "none") as LateFeeType;
  let lateFeeAmountCents: bigint | null = null;
  let lateFeeBps: number | null = null;
  let lateFeeMaxCents: bigint | null = null;
  if (lateFeeType === "fixed" || lateFeeType === "daily") {
    const raw = str(fd, "lateFeeAmount");
    if (!raw) {
      return {
        error:
          lateFeeType === "daily"
            ? "Enter the daily late-fee rate."
            : "Enter the fixed late-fee amount.",
      };
    }
    const amount = parseMoney(raw, "Late fee");
    if ("error" in amount) return amount;
    lateFeeAmountCents = amount.cents;
    if (lateFeeType === "daily") {
      const capRaw = str(fd, "lateFeeMax");
      if (capRaw) {
        const cap = parseMoney(capRaw, "Daily cap");
        if ("error" in cap) return cap;
        lateFeeMaxCents = cap.cents;
        if (lateFeeMaxCents < lateFeeAmountCents) {
          return { error: "The cap must be at least one day's rate." };
        }
      }
    }
  } else if (lateFeeType === "percentage") {
    const bps = Number(str(fd, "lateFeeBps") || "0");
    if (!Number.isInteger(bps) || bps <= 0 || bps > 10000) {
      return { error: "Late-fee percentage must be 1–10000 basis points (500 = 5%)." };
    }
    lateFeeBps = bps;
  }

  const internetFeeRaw = str(fd, "internetFee");
  if (!internetFeeRaw) {
    return { error: "Internet fee is required (enter 0 for none)." };
  }
  const internetFee = parseMoney(internetFeeRaw, "Internet fee");
  if ("error" in internetFee) return internetFee;

  try {
    await saveBillingDefaults(
      {
        dueDay,
        graceDays,
        lateFeeType,
        lateFeeAmountCents,
        lateFeeBps,
        lateFeeMaxCents,
        internetFeeCents: internetFee.cents,
      },
      actor,
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save defaults." };
  }
  revalidatePath("/settings/billing");
  return { ok: true, message: "Charge defaults saved." };
}

/**
 * Bulk-apply the CURRENT default grace/late-fee terms to all active leases.
 * Explicit and confirm-guarded — saving the defaults alone never touches
 * existing leases. Due day is intentionally NOT bulk-applied: changing it
 * mid-lease shifts every future period key and due date.
 */
export async function applyChargeTermsToActiveLeases(
  _prev: BillingState,
  _fd: FormData,
): Promise<BillingState> {
  await requireCapability("billing.settings");
  const actor = await auditActor();

  try {
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
    return {
      ok: true,
      message:
        changed === 0
          ? `All ${leases.length} active leases already match the defaults.`
          : `Updated ${changed} of ${leases.length} active lease${leases.length === 1 ? "" : "s"}.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Bulk apply failed." };
  }
}

/**
 * Save the org Cash App cashtag. Empty input clears it; otherwise it is
 * canonicalized to "$Tag". Surfaced to tenants via the {{cash_app_tag}} /
 * {{cash_app_link}} template variables and the portal's "how to pay" panel.
 */
export async function savePaymentMethodsAction(
  _prev: BillingState,
  fd: FormData,
): Promise<BillingState> {
  await requireCapability("billing.settings");
  const raw = str(fd, "cashAppCashtag");
  const cashtag = normalizeCashtag(raw);
  if (raw !== "" && cashtag === null) {
    return {
      error:
        "That doesn't look like a cashtag — letters/numbers, starting with a letter, up to 20 characters (the $ is optional).",
    };
  }
  await saveCashAppCashtag(cashtag, await auditActor());
  revalidatePath("/settings/billing");
  return {
    ok: true,
    message: cashtag ? `Cash App cashtag saved as ${cashtag}.` : "Cash App cashtag cleared.",
  };
}
