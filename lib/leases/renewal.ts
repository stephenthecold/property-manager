import { DateTime } from "luxon";
import { percentOfBps, type Cents } from "@/lib/money";

/**
 * Pure renewal helpers (DB-free, timezone-injected) — unit-tested. Decides the
 * *terms* of a lease renewal: the contiguous new dates and a suggested rent.
 * The services bridge Prisma ↔ these functions; the apply logic (extend vs
 * successor lease, scheduled-rent write) lives in lib/services and is NOT here.
 */

/** How an accepted renewal is applied. */
export type RenewalModel = "extend" | "successor";

export const RENEWAL_MODELS: RenewalModel[] = ["extend", "successor"];

export function isRenewalModel(v: string): v is RenewalModel {
  return (RENEWAL_MODELS as string[]).includes(v);
}

/** Offer lifecycle. Open = still actionable (can be sent/accepted/canceled). */
export type RenewalOfferStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "expired"
  | "canceled";

export const RENEWAL_OPEN_STATUSES: RenewalOfferStatus[] = ["draft", "sent"];

export function isRenewalOpen(status: string): boolean {
  return (RENEWAL_OPEN_STATUSES as string[]).includes(status);
}

export interface RenewalTerms {
  /** New term start = the day after the current lease ends. */
  effectiveDate: Date;
  /** New lease end = current end + termMonths (calendar months, in `tz`). */
  newEndDate: Date;
}

/**
 * Contiguous renewal dates: the new term starts the day after the current lease
 * ends and runs `termMonths` calendar months, computed in the property timezone
 * so month-length and DST never shift the boundary (e.g. a Dec-31 end + 12mo →
 * Jan-1 effective, Dec-31 next year).
 */
export function computeRenewalTerms(i: {
  currentEndDate: Date;
  termMonths: number;
  tz: string;
}): RenewalTerms {
  const end = DateTime.fromJSDate(i.currentEndDate, { zone: i.tz }).startOf("day");
  return {
    effectiveDate: end.plus({ days: 1 }).toJSDate(),
    newEndDate: end.plus({ months: i.termMonths }).toJSDate(),
  };
}

/**
 * Suggested renewal rent = current rent bumped by `bumpBps` basis points
 * (300 = +3%, 0 = flat), rounded to the cent via the shared money helper.
 * Negative bps (a reduction) is allowed and clamps at zero.
 */
export function suggestRenewalRentCents(currentRentCents: Cents, bumpBps: number): Cents {
  const next = currentRentCents + percentOfBps(currentRentCents, bumpBps);
  return next < 0n ? 0n : next;
}

export type RenewalValidation = { ok: true } | { ok: false; error: string };

/** Validate proposed terms before an offer is created. */
export function validateRenewalOffer(i: {
  currentEndDate: Date | null;
  proposedEndDate: Date;
  proposedRentCents: Cents;
}): RenewalValidation {
  if (i.currentEndDate == null) {
    return { ok: false, error: "This lease has no end date to renew from." };
  }
  if (i.proposedRentCents < 0n) {
    return { ok: false, error: "Rent must be zero or positive." };
  }
  if (i.proposedEndDate.getTime() <= i.currentEndDate.getTime()) {
    return { ok: false, error: "The renewal must end after the current lease." };
  }
  return { ok: true };
}
