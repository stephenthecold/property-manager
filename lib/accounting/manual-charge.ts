import type { LedgerEntryType } from "@/lib/generated/prisma/enums";

/**
 * Categories for a staff-posted one-off ledger entry, and how each maps onto the
 * ledger. PURE — no I/O, unit-tested. The service (lib/services/manual-charge.ts)
 * reads this to decide the entry type + sign; the dialog reads the labels.
 *
 * Sign convention follows the ledger: a positive amount is a CHARGE (increases
 * what the tenant owes), a negative amount is a CREDIT (reduces it). Deposits
 * are liabilities, not revenue, so they post as `adjustment` and stay OUT of the
 * income/"rent billed" reports (which only count rent_charge/late_fee/payment).
 * Prorated rent IS revenue, so it posts as a real `rent_charge`.
 */
export type ManualChargeCategory =
  | "security_deposit"
  | "pet_deposit"
  | "prorated_rent"
  | "other_charge"
  | "credit";

export interface ManualChargeSpec {
  /** Human label shown in the dialog + stored in the entry description. */
  label: string;
  /** The ledger entry type this category posts. */
  entryType: Extract<LedgerEntryType, "adjustment" | "rent_charge" | "credit">;
  /** +1 = charge (adds to balance); -1 = credit (reduces it). */
  sign: 1 | -1;
  /** Whether it counts toward rent-billed/revenue reports (only prorated rent). */
  countsAsRent: boolean;
}

export const MANUAL_CHARGE_SPECS: Record<ManualChargeCategory, ManualChargeSpec> = {
  security_deposit: { label: "Security deposit", entryType: "adjustment", sign: 1, countsAsRent: false },
  pet_deposit: { label: "Pet deposit", entryType: "adjustment", sign: 1, countsAsRent: false },
  prorated_rent: { label: "Prorated rent", entryType: "rent_charge", sign: 1, countsAsRent: true },
  other_charge: { label: "Other charge", entryType: "adjustment", sign: 1, countsAsRent: false },
  credit: { label: "Credit / concession", entryType: "credit", sign: -1, countsAsRent: false },
};

/** Ordered list for the category dropdown. */
export const MANUAL_CHARGE_CATEGORIES = Object.keys(
  MANUAL_CHARGE_SPECS,
) as ManualChargeCategory[];

export function isManualChargeCategory(v: string): v is ManualChargeCategory {
  return v in MANUAL_CHARGE_SPECS;
}

/**
 * Pure: the SIGNED ledger amount for a posting, given a positive magnitude.
 * Throws on a non-positive magnitude — the amount field is always entered as a
 * positive figure; the category decides the direction.
 */
export function signedManualAmountCents(
  category: ManualChargeCategory,
  magnitudeCents: bigint,
): bigint {
  if (magnitudeCents <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  return MANUAL_CHARGE_SPECS[category].sign === 1 ? magnitudeCents : -magnitudeCents;
}
