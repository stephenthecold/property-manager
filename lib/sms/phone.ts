/**
 * Normalize a raw phone number to E.164 for a US (+1) deployment. SMS providers
 * (Telnyx / Twilio) require E.164 (`+1XXXXXXXXXX`), but stored numbers are often
 * bare 10-digit, which they silently reject. PURE — unit-tested, no I/O.
 *
 *   - 10 digits              -> +1XXXXXXXXXX
 *   - 11 digits leading "1"  -> +1XXXXXXXXXX
 *   - already "+…" (E.164)   -> kept (digits only, formatting stripped)
 *   - anything else          -> null
 *
 * Returns null when it can't confidently normalize; callers then LEAVE the
 * stored value untouched (never corrupt a number we don't understand) and, at
 * send time, fall back to the raw value so the provider can surface the error.
 */
export function toE164(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  // Already international (+…): keep it, just strip spacing/punctuation. Guard a
  // sane digit count so "+" or "+abc" doesn't pass.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * E.164 for sending: normalize when we can, else fall back to the raw trimmed
 * value so the provider still gets *something* and logs a rejection (better than
 * dropping the send silently). Empty -> null (nothing to send to).
 */
export function toE164ForSend(raw: string | null | undefined): string | null {
  const normalized = toE164(raw);
  if (normalized) return normalized;
  const trimmed = (raw ?? "").trim();
  return trimmed || null;
}
