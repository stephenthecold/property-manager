import { toCents } from "@/lib/money";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";

/**
 * Parse a payment-notification email (PayPal, Cash App, Blackbaud/Financial
 * Edge) into one or more payment SUGGESTIONS for staff to review and approve.
 * PURE — no DB, no network — so it's unit-tested against real email bodies.
 *
 * The output only ever PREFILLS the record-payment form; nothing here posts a
 * payment or touches the ledger. Treat the email as untrusted: every field is
 * a hint the operator confirms before anything is recorded.
 */

export type PaymentEmailProvider = "paypal" | "cashapp" | "blackbaud" | "unknown";

export interface ParsedPaymentLine {
  amountCents: bigint;
  /** Best-effort payer name for tenant matching (null when not derivable). */
  payerName: string | null;
  /** Prefill for the date input; null falls back to the email's received date. */
  paymentDate: Date | null;
  /** Transaction id / invoice number — also the stable idempotency row key. */
  reference: string | null;
  memo: string | null;
}

export interface ParsedPaymentEmail {
  provider: PaymentEmailProvider;
  method: PaymentMethod;
  lines: ParsedPaymentLine[];
}

/** Map a provider to the closest existing PaymentMethod (no enum changes). */
const PROVIDER_METHOD: Record<PaymentEmailProvider, PaymentMethod> = {
  cashapp: "cash_app",
  paypal: "online",
  blackbaud: "ach",
  unknown: "other",
};

/** Parse a "$1,234.56" / "+$100.00" money token to integer cents, or null. */
function moneyToCents(raw: string | null | undefined): bigint | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  try {
    return toCents(cleaned);
  } catch {
    return null;
  }
}

/** Lenient date parse for prefill only (the action re-parses in property tz). */
function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  return Number.isNaN(t) ? null : new Date(t);
}

function detectProvider(fromEmail: string, body: string): PaymentEmailProvider {
  const from = fromEmail.toLowerCase();
  const hay = `${from}\n${body}`.toLowerCase();
  if (from.includes("paypal.com") || hay.includes("paypal")) return "paypal";
  if (from.includes("square.com") || from.includes("cash.app") || hay.includes("cash app"))
    return "cashapp";
  if (from.includes("blackbaud.com") || hay.includes("financial edge") || hay.includes("blackbaud"))
    return "blackbaud";
  return "unknown";
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() || null;
}

/** "Value follows its label on a later (possibly blank-separated) line." */
function valueAfterLabel(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (label.test(lines[i].trim())) {
      for (let j = i + 1; j < lines.length; j++) {
        const v = lines[j].trim();
        if (v) return v;
      }
    }
  }
  return null;
}

function parsePayPal(subject: string, body: string): ParsedPaymentLine[] {
  const lines = body.split(/\r?\n/);
  // "Ronnie Conner sent you $625.00 USD" (subject or body).
  const sentLine = `${subject}\n${body}`.match(
    /^(.*?)\s+sent you\s+\$[\d,]+\.\d{2}/im,
  );
  const payerName = sentLine?.[1]?.trim() || null;
  // Only the "X sent you $…" line or the labeled "Amount" — NOT the first '$'
  // anywhere, so PayPal activity/marketing boilerplate can't synthesize a line.
  const amountCents =
    moneyToCents(firstMatch(`${subject}\n${body}`, /sent you\s+(\$[\d,]+\.\d{2})/i)) ??
    moneyToCents(valueAfterLabel(lines, /^Amount$/i));
  if (amountCents == null || amountCents <= 0n) return [];
  return [
    {
      amountCents,
      payerName,
      paymentDate: parseDate(valueAfterLabel(lines, /^Transaction date$/i)),
      reference: valueAfterLabel(lines, /^Transaction ID$/i),
      memo: null,
    },
  ];
}

function parseCashApp(body: string): ParsedPaymentLine[] {
  const lines = body.split(/\r?\n/);
  const amountCents = moneyToCents(firstMatch(body, /\+\s*(\$[\d,]+\.\d{2})/));
  if (amountCents == null) return [];
  const payerName = firstMatch(body, /^\s*Sender:\s*(.+?)\s*$/im);
  // "For Toward July rent" / "For rent deposit" — the first short "For …" line,
  // never the boilerplate "For any issues…" further down.
  let memo: string | null = null;
  for (const raw of lines) {
    const l = raw.trim();
    const m = l.match(/^For\s+(.{1,60})$/i);
    if (m && !/^any issues/i.test(m[1]) && !/^more/i.test(m[1])) {
      memo = m[1].trim();
      break;
    }
  }
  const reference = firstMatch(body, /Transaction number\s*\n+\s*#?\s*([A-Z0-9-]+)/i);
  return [
    {
      amountCents,
      payerName,
      paymentDate: null, // Cash App shows "Today", not a date
      reference,
      memo,
    },
  ];
}

function parseBlackbaud(body: string): ParsedPaymentLine[] {
  // The HTML table flattens to: <invoice> \n <$amount> \n <MM/DD/YYYY>, repeated.
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ParsedPaymentLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const amt = lines[i].match(/^\+?\$([\d,]+\.\d{2})$/);
    if (!amt) continue;
    const amountCents = moneyToCents(amt[1]);
    if (amountCents == null) continue;
    const prev = lines[i - 1] ?? "";
    // The invoice line is an alnum code WITH a digit (real codes encode a date),
    // never a header ("Invoice number"/"Payment amount") or a stray word.
    const invoice =
      /^[A-Za-z0-9][A-Za-z0-9._-]{2,}$/.test(prev) && /\d/.test(prev)
        ? prev
        : null;
    const next = lines[i + 1] ?? "";
    const paymentDate = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(next)
      ? parseDate(next)
      : null;
    out.push({ amountCents, payerName: null, paymentDate, reference: invoice, memo: invoice });
  }
  return out;
}

export function parsePaymentEmail(input: {
  fromEmail: string;
  subject: string | null;
  body: string;
}): ParsedPaymentEmail {
  const subject = input.subject ?? "";
  const body = input.body ?? "";
  const provider = detectProvider(input.fromEmail ?? "", body);
  const lines = (
    provider === "paypal"
      ? parsePayPal(subject, body)
      : provider === "cashapp"
        ? parseCashApp(body)
        : provider === "blackbaud"
          ? parseBlackbaud(body)
          : []
  ).filter((l) => l.amountCents > 0n); // never surface a $0 / negative line
  return { provider, method: PROVIDER_METHOD[provider], lines };
}

/**
 * Stable per-line idempotency key segment. ALWAYS positional so two lines that
 * share a reference (or both fall back) can never collide to one key — a
 * collision would let postPayment's idempotency fast-path silently drop the
 * second payment. The stored body is immutable + parse is deterministic, so the
 * index is stable across re-renders (no double-credit risk).
 */
export function paymentLineKey(line: ParsedPaymentLine, index: number): string {
  const ref = (line.reference ?? "").replace(/[^A-Za-z0-9]/g, "");
  return ref.length >= 4 ? `${ref}_${index}` : `idx${index}`;
}
