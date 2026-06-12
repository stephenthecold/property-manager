/**
 * Pure identity normalization for tenant-portal logins. Tenants type their
 * phone/email with arbitrary formatting; accounts store CANONICAL values so
 * lookup is a plain equality match.
 */

/**
 * Canonical phone key: digits only, trimmed to the LAST 10 digits when longer
 * (drops the US country code, so "+1 (555) 123-4567" and "5551234567" match).
 * Returns null when there aren't enough digits to be a phone number.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Canonical email: trimmed + lowercased; null when empty or @-less. */
export function emailKey(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || !value.includes("@")) return null;
  return value;
}

/** True when a login identifier looks like an email (vs. a phone number). */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@");
}
