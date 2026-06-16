import { DateTime } from "luxon";

/**
 * Receipt numbering: "<PREFIX>-YYYYMMDD-NNNN" where YYYYMMDD is the payment date
 * in the property timezone and NNNN is a per-day sequence (zero-padded to 4
 * digits, never truncated past 9999). The prefix is operator-configurable
 * (Settings → Organization) and defaults to "RCT". Pure and DB-free; the service
 * layer reads existing numbers and persists, this module only does the
 * string/date math.
 */

export const DEFAULT_RECEIPT_PREFIX = "RCT";

/**
 * Normalize an operator-entered receipt prefix: uppercase A–Z/0–9 only (so it
 * never breaks the "-"-delimited number parsing), max 8 chars; blank/garbage
 * falls back to the default. Pure so it can be reused at validation and read time.
 */
export function sanitizeReceiptPrefix(raw: string | null | undefined): string {
  const cleaned = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return cleaned || DEFAULT_RECEIPT_PREFIX;
}

/** "YYYYMMDD" for the given instant in the property timezone. */
export function receiptDateKey(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("yyyyMMdd");
}

/** The "<PREFIX>-YYYYMMDD-" stem shared by formatting and sequence parsing. */
function numberStem(dateKey: string, prefix: string): string {
  return `${sanitizeReceiptPrefix(prefix)}-${dateKey}-`;
}

/** "RCT-YYYYMMDD-0001"; pads to 4 but wider sequences are kept whole. */
export function formatReceiptNumber(
  dateKey: string,
  seq: number,
  prefix: string = DEFAULT_RECEIPT_PREFIX,
): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`Receipt sequence must be a positive integer, got ${seq}`);
  }
  return `${numberStem(dateKey, prefix)}${String(seq).padStart(4, "0")}`;
}

/**
 * Next sequence for a day: 1 + max sequence parsed from `existing` receipt
 * numbers belonging to `dateKey` (under the same prefix). Other days, other
 * prefixes, and malformed strings are ignored.
 */
export function nextSequenceFromNumbers(
  dateKey: string,
  existing: string[],
  prefix: string = DEFAULT_RECEIPT_PREFIX,
): number {
  const stem = numberStem(dateKey, prefix);
  let max = 0;
  for (const number of existing) {
    if (!number.startsWith(stem)) continue;
    const tail = number.slice(stem.length);
    if (!/^\d+$/.test(tail)) continue;
    const seq = Number(tail); // a sequence counter, not money
    if (Number.isSafeInteger(seq) && seq > max) max = seq;
  }
  return max + 1;
}
