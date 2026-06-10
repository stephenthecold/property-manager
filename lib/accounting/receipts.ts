import { DateTime } from "luxon";

/**
 * Receipt numbering: "RCT-YYYYMMDD-NNNN" where YYYYMMDD is the payment date in
 * the property timezone and NNNN is a per-day sequence (zero-padded to 4 digits,
 * never truncated past 9999). Pure and DB-free; the service layer reads existing
 * numbers and persists, this module only does the string/date math.
 */

/** "YYYYMMDD" for the given instant in the property timezone. */
export function receiptDateKey(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("yyyyMMdd");
}

/** "RCT-YYYYMMDD-0001"; pads to 4 but wider sequences are kept whole. */
export function formatReceiptNumber(dateKey: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`Receipt sequence must be a positive integer, got ${seq}`);
  }
  return `RCT-${dateKey}-${String(seq).padStart(4, "0")}`;
}

/**
 * Next sequence for a day: 1 + max sequence parsed from `existing` receipt
 * numbers belonging to `dateKey`. Other days and malformed strings are ignored.
 */
export function nextSequenceFromNumbers(
  dateKey: string,
  existing: string[],
): number {
  const prefix = `RCT-${dateKey}-`;
  let max = 0;
  for (const number of existing) {
    if (!number.startsWith(prefix)) continue;
    const tail = number.slice(prefix.length);
    if (!/^\d+$/.test(tail)) continue;
    const seq = Number(tail); // a sequence counter, not money
    if (Number.isSafeInteger(seq) && seq > max) max = seq;
  }
  return max + 1;
}
