import { type Cents, percentOfBps } from "@/lib/money";

export type LateFeeType = "none" | "fixed" | "percentage";

/**
 * Late fee for one period. The percentage base is the immutable rent_charge
 * amount for that period (NOT a non-derivable "outstanding"), so the fee is
 * deterministic and order-independent regardless of prior credits/partials.
 */
export function computeLateFeeCents(opts: {
  type: LateFeeType;
  rentChargeCents: Cents;
  fixedAmountCents?: Cents | null;
  bps?: number | null;
}): Cents {
  switch (opts.type) {
    case "fixed":
      return opts.fixedAmountCents ?? 0n;
    case "percentage":
      return percentOfBps(opts.rentChargeCents, opts.bps ?? 0);
    default:
      return 0n;
  }
}
