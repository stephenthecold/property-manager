/**
 * Pure parsing/validation for the "additional deposits" rows submitted with
 * the new-lease form. The client serializes its dynamic rows into ONE hidden
 * input (`depositsJson`) as a JSON array of `{ label, amount, nonRefundable }`;
 * this module turns that string into validated rows with integer-cent amounts
 * (via {@link toCents} — never floats) or a single user-facing error message.
 * DB-free and side-effect-free so it can be unit-tested like lib/accounting.
 */

import { toCents, type Cents } from "@/lib/money";

export interface DepositRow {
  label: string;
  amountCents: Cents;
  /** Whole-deposit toggle: the entire amount is either refundable or not. */
  nonRefundable: boolean;
}

export type ParseDepositRowsResult =
  | { deposits: DepositRow[] }
  | { error: string };

/**
 * Parse the `depositsJson` form field. Empty/blank input means "no additional
 * deposits". Each row needs a non-empty label and a positive money amount;
 * the first invalid row short-circuits with an error naming that row.
 */
export function parseDepositRows(json: string): ParseDepositRowsResult {
  if (!json.trim()) return { deposits: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: "Additional deposits could not be read — please re-enter them." };
  }
  if (!Array.isArray(raw)) {
    return { error: "Additional deposits could not be read — please re-enter them." };
  }

  const deposits: DepositRow[] = [];
  for (const [index, item] of raw.entries()) {
    const rowNo = index + 1;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { error: `Additional deposit ${rowNo} is malformed — please re-enter it.` };
    }
    const { label, amount, nonRefundable } = item as Record<string, unknown>;

    const labelStr = typeof label === "string" ? label.trim() : "";
    if (!labelStr) {
      return {
        error: `Additional deposit ${rowNo} needs a label (e.g. "Pet deposit").`,
      };
    }

    const amountStr =
      typeof amount === "string" || typeof amount === "number"
        ? String(amount).trim()
        : "";
    if (!amountStr) {
      return { error: `Enter an amount for "${labelStr}".` };
    }
    let amountCents: Cents;
    try {
      amountCents = toCents(amountStr);
    } catch {
      return {
        error: `The amount for "${labelStr}" must be a dollar amount like 250 or 250.00.`,
      };
    }
    if (amountCents <= 0n) {
      return { error: `The amount for "${labelStr}" must be greater than zero.` };
    }

    deposits.push({ label: labelStr, amountCents, nonRefundable: nonRefundable === true });
  }

  return { deposits };
}
