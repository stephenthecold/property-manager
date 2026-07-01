/**
 * Normalize a Telnyx v2 messaging webhook into a small discriminated union the
 * app can act on. PURE — no I/O, no DB, deterministic, unit-tested. NEVER throws:
 * every malformed/unknown shape collapses to `{ kind: "ignored" }` so the caller
 * can safely `parseTelnyxWebhook(await req.json())` and switch on `.kind`.
 *
 * Telnyx v2 body shape (top-level): `{ data: { event_type, payload } }`.
 *
 *   - "message.received"  -> INBOUND reply (from / text / message id)
 *   - "message.sent" | "message.finalized" -> DELIVERY status. `payload.to` is an
 *     ARRAY of `{ phone_number, status }`; we use the FIRST element's `status`.
 *     `payload.errors` (may be absent/empty) carries `{ code, title, detail }`.
 *
 * Telnyx per-recipient `status` values seen on the wire:
 *   queued | sending | sent | delivered | sending_failed | delivery_failed | expired
 * mapped to our coarse set: delivered / failed / sent / queued (anything else -> ignored).
 *
 * The raw signing/HMAC verification is a separate concern (Telnyx signs with
 * Ed25519); this module only interprets an already-parsed, already-trusted body.
 */

export type TelnyxWebhookEvent =
  | { kind: "inbound"; from: string; text: string; providerMessageId: string }
  | {
      kind: "status";
      providerMessageId: string;
      status: "delivered" | "failed" | "sent" | "queued";
      errorCode: string | null;
      errorMessage: string | null;
    }
  | { kind: "ignored" };

const IGNORED: TelnyxWebhookEvent = { kind: "ignored" };

/** Narrow to a plain object (records only — not null, arrays, or primitives). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Return the string value at `key`, or undefined if absent / not a string. */
function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Map a raw Telnyx per-recipient status to our coarse set. Returns null for any
 * value we don't explicitly recognize, so the caller treats it as "ignored"
 * rather than inventing a status.
 */
function normalizeStatus(
  raw: string | undefined,
): "delivered" | "failed" | "sent" | "queued" | null {
  switch (raw) {
    case "delivered":
      return "delivered";
    case "delivery_failed":
    case "sending_failed":
    case "expired":
      return "failed";
    case "sent":
      return "sent";
    case "queued":
    case "sending":
      return "queued";
    default:
      return null;
  }
}

/**
 * Pull `errorCode` / `errorMessage` from the FIRST entry of a Telnyx `errors`
 * array. `code` is normalized to a string (Telnyx sends it as a string, but be
 * defensive about numbers); `errorMessage` joins the non-empty `title`/`detail`
 * with ": ". Missing/empty -> nulls.
 */
function firstError(errors: unknown): {
  errorCode: string | null;
  errorMessage: string | null;
} {
  if (!Array.isArray(errors) || errors.length === 0) {
    return { errorCode: null, errorMessage: null };
  }
  const first = asRecord(errors[0]);
  if (!first) return { errorCode: null, errorMessage: null };

  const rawCode = first.code;
  const errorCode =
    typeof rawCode === "string"
      ? rawCode
      : typeof rawCode === "number"
        ? String(rawCode)
        : null;

  const title = stringField(first, "title")?.trim();
  const detail = stringField(first, "detail")?.trim();
  const message = [title, detail].filter(Boolean).join(": ").trim();

  return { errorCode, errorMessage: message.length > 0 ? message : null };
}

export function parseTelnyxWebhook(body: unknown): TelnyxWebhookEvent {
  const data = asRecord(asRecord(body)?.data);
  if (!data) return IGNORED;

  const eventType = stringField(data, "event_type");
  const payload = asRecord(data.payload);
  if (!payload) return IGNORED;

  if (eventType === "message.received") {
    const providerMessageId = stringField(payload, "id");
    const from = stringField(asRecord(payload.from), "phone_number");
    // Text may legitimately be "" (e.g. an MMS with only media); default to "".
    // Both `from` and `id` are required — without them the reply is unroutable.
    if (!providerMessageId || !from) return IGNORED;
    return {
      kind: "inbound",
      from,
      text: stringField(payload, "text") ?? "",
      providerMessageId,
    };
  }

  if (eventType === "message.sent" || eventType === "message.finalized") {
    const providerMessageId = stringField(payload, "id");
    if (!providerMessageId) return IGNORED;

    const to = payload.to;
    if (!Array.isArray(to) || to.length === 0) return IGNORED;
    const status = normalizeStatus(stringField(asRecord(to[0]), "status"));
    if (!status) return IGNORED;

    const { errorCode, errorMessage } = firstError(payload.errors);
    return { kind: "status", providerMessageId, status, errorCode, errorMessage };
  }

  return IGNORED;
}
