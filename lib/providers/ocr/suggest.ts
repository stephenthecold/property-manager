import { toCents } from "@/lib/money";

/**
 * Heuristic payment-field suggestions from OCR'd receipt text. Pure string
 * scanning — works on any provider's output, never throws; callers treat every
 * field as a prefill the user confirms, not a fact.
 */
export interface OcrSuggestion {
  /** Largest currency-looking amount, as integer cents (bigint as string). */
  amountCents?: string;
  /** First date found, normalized to "yyyy-MM-dd". */
  paymentDate?: string;
  referenceNumber?: string;
}

// "$1,234.56" / "$500" / bare "1,234.56" / "1234.56" — a bare integer is not
// currency-looking enough without either a dollar sign or two decimals.
const AMOUNT_RE = /\$\s*\d+(?:,\d{3})*(?:\.\d{1,2})?|\b\d+(?:,\d{3})*\.\d{2}\b/g;

// ISO yyyy-MM-dd (groups 1-3) or US MM/DD/YYYY (groups 4-6), in text order.
const DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;

const REFERENCE_RE = /(?:check|chk|ref|receipt)\s*#?\s*(\w[\w-]*)/i;

export function suggestFromOcrText(text: string): OcrSuggestion {
  const suggestion: OcrSuggestion = {};

  let largest: bigint | null = null;
  for (const match of text.matchAll(AMOUNT_RE)) {
    let cents: bigint;
    try {
      cents = toCents(match[0]);
    } catch {
      continue;
    }
    if (largest === null || cents > largest) largest = cents;
  }
  if (largest !== null) suggestion.amountCents = largest.toString();

  for (const match of text.matchAll(DATE_RE)) {
    const [, isoYear, isoMonth, isoDay, usMonth, usDay, usYear] = match;
    const year = isoYear ?? usYear;
    const month = Number(isoMonth ?? usMonth);
    const day = Number(isoDay ?? usDay);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    suggestion.paymentDate = `${year}-${mm}-${dd}`;
    break;
  }

  const ref = REFERENCE_RE.exec(text);
  if (ref) suggestion.referenceNumber = ref[1];

  return suggestion;
}
