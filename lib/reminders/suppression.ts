/**
 * Pure email-suppression decisions — DB-free and unit-tested, mirroring
 * `resolveReminderDelivery` (channel.ts). A tenant whose email has hard-bounced
 * or who filed a spam complaint is *suppressed*: we stop sending them email
 * reminders until staff clear it (after the tenant fixes their address). This
 * module owns the "is this address suppressed / should we still send email"
 * logic so the service layer and the webhook never re-implement it.
 *
 * The two terminal states we record are provider-agnostic:
 *  - "bounced"    — a hard bounce (mailbox does not exist / rejected delivery).
 *  - "complained" — a spam/abuse complaint (the recipient marked us as spam).
 * A soft/transient bounce is NOT suppressed (the provider keeps retrying), so we
 * only ever map the terminal kinds onto these two values. `null` = healthy.
 */

/** The terminal delivery states that suppress further email sends. */
export const SUPPRESSED_EMAIL_STATUSES = ["bounced", "complained"] as const;

export type SuppressedEmailStatus = (typeof SUPPRESSED_EMAIL_STATUSES)[number];

/**
 * Provider bounce/complaint event kinds we accept on the webhook, normalized to
 * one of our two terminal statuses. We deliberately accept only the hard,
 * terminal kinds: a soft/transient/deferred bounce must NOT suppress (the
 * provider retries it), so it has no mapping here. Keys are the SEPARATOR-FREE,
 * lower-cased form (see `suppressionStatusForEvent`), so "HardBounce",
 * "hard_bounce", and "hard-bounce" all collapse to `hardbounce`.
 */
const EVENT_TYPE_TO_STATUS: Record<string, SuppressedEmailStatus> = {
  // Hard bounces (mailbox doesn't exist / permanently rejected).
  bounce: "bounced",
  bounced: "bounced",
  hardbounce: "bounced",
  permanentfail: "bounced",
  permanentfailure: "bounced",
  failed: "bounced",
  dropped: "bounced",
  // Spam/abuse complaints.
  complaint: "complained",
  complained: "complained",
  spam: "complained",
  spamreport: "complained",
  abuse: "complained",
};

/** True when `status` is one of our suppressing terminal states. */
export function isSuppressedEmailStatus(
  status: string | null | undefined,
): status is SuppressedEmailStatus {
  return (
    status != null &&
    (SUPPRESSED_EMAIL_STATUSES as readonly string[]).includes(status)
  );
}

/**
 * Whether a tenant with this stored `emailDeliveryStatus` is currently
 * suppressed for email. `null`/healthy → not suppressed. A transient/unknown
 * value (should never be persisted) is treated as NOT suppressed so a bad row
 * can't silently black-hole a tenant's email forever.
 */
export function isEmailSuppressed(
  emailDeliveryStatus: string | null | undefined,
): boolean {
  return isSuppressedEmailStatus(emailDeliveryStatus);
}

/**
 * Map a provider event-type string onto the terminal suppression status, or
 * `null` when it isn't a hard bounce/complaint we should suppress on (soft
 * bounce, delivered, opened, …). Case- and separator-insensitive so
 * "HardBounce", "hard_bounce", and "hard-bounce" all match.
 */
export function suppressionStatusForEvent(
  eventType: string | null | undefined,
): SuppressedEmailStatus | null {
  if (!eventType) return null;
  // Strip ALL whitespace/underscores/hyphens and lower-case, so "HardBounce",
  // "hard bounce", "hard-bounce", and "hard_bounce" all collapse to one key.
  const compact = eventType.toLowerCase().replace(/[\s_-]+/g, "");
  return EVENT_TYPE_TO_STATUS[compact] ?? null;
}

/** A bounce/complaint event extracted (and validated) from a webhook payload. */
export interface ParsedBounceEvent {
  email: string;
  status: SuppressedEmailStatus;
}

/**
 * Normalize an untrusted webhook payload into a {email, status} we can act on,
 * or `null` when it isn't an actionable hard bounce/complaint (missing email,
 * soft bounce, unknown type, …). NEVER trusts the payload shape: every field is
 * type-checked, and the email is lower-cased + trimmed for the lookup. Accepts
 * the common provider field spellings (`type`/`event`/`eventType`,
 * `email`/`recipient`/`recipientEmail`/`to`).
 *
 * Kept pure so the route stays a thin auth+IO shell over a tested decision.
 */
export function parseBouncePayload(payload: unknown): ParsedBounceEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;

  const rawType = firstString(o.type, o.event, o.eventType, o.notificationType);
  const status = suppressionStatusForEvent(rawType);
  if (!status) return null;

  const rawEmail = firstString(o.email, o.recipient, o.recipientEmail, o.to);
  const email = normalizeEmail(rawEmail);
  if (!email) return null;

  return { email, status };
}

/** First argument that is a non-empty string (after trim), else undefined. */
function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return undefined;
}

/** Lower-case + trim an email for case-insensitive lookup; "" → null. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e === "" ? null : e;
}
