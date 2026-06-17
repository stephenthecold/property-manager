import type { PayerType } from "@/lib/generated/prisma/enums";

/**
 * Pure helpers for non-tenant payer types (the directory of parties that pay on
 * a tenant's behalf — housing authorities, employers, guarantors, …). Display /
 * parse only; DB-free and unit-tested. A payer never touches the ledger.
 */

/** Order shown in selects. Housing authority first — the primary HUD case. */
export const PAYER_TYPES: PayerType[] = [
  "housing_authority",
  "employer",
  "guarantor",
  "family",
  "nonprofit",
  "other",
];

const LABELS: Record<PayerType, string> = {
  housing_authority: "Housing authority",
  employer: "Employer",
  guarantor: "Guarantor",
  family: "Family",
  nonprofit: "Nonprofit",
  other: "Other",
};

export function isPayerType(value: string): value is PayerType {
  return (PAYER_TYPES as readonly string[]).includes(value);
}

export function parsePayerType(
  raw: string | null | undefined,
  fallback: PayerType = "housing_authority",
): PayerType {
  return raw != null && isPayerType(raw) ? raw : fallback;
}

export function payerTypeLabel(t: PayerType): string {
  return LABELS[t];
}
