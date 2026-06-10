/**
 * The ONE place currency is parsed, formatted, and arithmetic'd.
 *
 * Money is signed integer minor units (cents) as `bigint`. Never use the JS
 * `number` type for money arithmetic and never call `Number(cents)` except for
 * display formatting (see {@link formatCurrency}). All ledger math is exact
 * bigint addition/subtraction; the only multiplication/division is percentage
 * late fees via {@link percentOfBps}, with an explicit half-up rounding rule.
 */

export type Cents = bigint;

/** Parse a human/decimal money value ("1,250.00", "1250", "-37.42") into cents. */
export function toCents(input: string | number): Cents {
  let s = typeof input === "number" ? String(input) : input.trim();
  s = s.replace(/[$,\s]/g, "");
  if (s === "") throw new Error("Empty money value");
  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`Invalid money value: ${JSON.stringify(input)}`);
  }
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  const cents = BigInt(whole) * 100n + BigInt(fracPadded);
  return neg ? -cents : cents;
}

/** Format cents as a plain decimal string ("125000" -> "1250.00"). No currency symbol. */
export function fromCents(cents: Cents): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${neg ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
}

/** Display-only formatting via Intl. Uses Number — acceptable for display, never for math. */
export function formatCurrency(
  cents: Cents,
  currency = "USD",
  locale = "en-US",
): string {
  const value = Number(cents) / 100;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    value,
  );
}

export function absCents(c: Cents): Cents {
  return c < 0n ? -c : c;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

export function maxCents(a: Cents, b: Cents): Cents {
  return a > b ? a : b;
}

export function minCents(a: Cents, b: Cents): Cents {
  return a < b ? a : b;
}

/**
 * Percentage of `base` expressed in basis points (500 = 5%), with half-up rounding.
 * Computed entirely in bigint: round((|base| * |bps|) / 10000) then re-apply sign.
 */
export function percentOfBps(base: Cents, bps: number): Cents {
  const b = BigInt(Math.trunc(bps));
  const negResult = base < 0n !== b < 0n;
  const absBase = base < 0n ? -base : base;
  const absBps = b < 0n ? -b : b;
  const numerator = absBase * absBps;
  const rounded = (numerator + 5000n) / 10000n; // +half then floor = half-up
  return negResult ? -rounded : rounded;
}

// --- Serialization across the RSC / client boundary -------------------------

/** JSON.stringify replacer that renders bigint as a string (bigint is not JSON-serializable). */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function serialize<T>(value: T): string {
  return JSON.stringify(value, bigintReplacer);
}

export interface MoneyDTO {
  /** Integer cents as a string (safe across the wire; parse back with BigInt). */
  cents: string;
  /** Pre-formatted display string for the UI. */
  display: string;
}

/** Convert cents to a DTO safe to pass to client components. */
export function toMoneyDTO(cents: Cents, currency = "USD"): MoneyDTO {
  return { cents: cents.toString(), display: formatCurrency(cents, currency) };
}
