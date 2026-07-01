import { createPublicKey, verify as cryptoVerify } from "node:crypto";

/**
 * Telnyx v2 webhook signature scheme (Ed25519 — a PUBLIC key, unlike Twilio's
 * shared-secret HMAC). Two headers arrive with each webhook:
 *   telnyx-signature-ed25519 — base64 of the raw 64-byte Ed25519 signature
 *   telnyx-timestamp          — Unix time in SECONDS, as a string
 * The signed message is the ASCII bytes of `${timestamp}|${rawRequestBody}`
 * (timestamp, a literal pipe, then the EXACT raw request body). The verifying
 * key is the account's Ed25519 public key from the Telnyx portal, given as
 * standard base64 of the raw 32 bytes.
 *
 * Node has no direct raw-key Ed25519 API, so we wrap the 32 raw bytes in the
 * fixed Ed25519 SPKI DER header to build a KeyObject, then crypto.verify.
 *
 * Pure — clock is injected via `now` — so it is unit-testable with fixed
 * vectors. Returns false (never throws) for any malformed input, a stale or
 * future timestamp beyond tolerance, or a signature mismatch.
 */

// Fixed ASN.1/DER prefix for an Ed25519 SubjectPublicKeyInfo: it precedes the
// 32 raw public-key bytes to form a complete SPKI structure.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface TelnyxSignatureInput {
  publicKeyBase64: string; // raw 32-byte ed25519 public key, standard base64
  payload: string; // raw request body
  signatureBase64: string; // telnyx-signature-ed25519 header
  timestamp: string; // telnyx-timestamp header (unix seconds)
  now?: Date; // default new Date()
  toleranceSeconds?: number; // default 300
}

export function verifyTelnyxSignature(i: TelnyxSignatureInput): boolean {
  const { publicKeyBase64, payload, signatureBase64, timestamp } = i;
  const toleranceSeconds = i.toleranceSeconds ?? 300;
  const now = i.now ?? new Date();

  // Reject missing/empty inputs before touching crypto. (payload may legitimately
  // be an empty string, so it is not required to be truthy.)
  if (!publicKeyBase64 || !signatureBase64 || !timestamp) return false;
  if (typeof payload !== "string") return false;

  // Replay protection: the timestamp must be a plain integer within tolerance
  // of now (guards against both stale replays and far-future timestamps).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !/^\d+$/.test(timestamp.trim())) return false;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - ts) > toleranceSeconds) return false;

  try {
    const rawKey = Buffer.from(publicKeyBase64, "base64");
    if (rawKey.length !== 32) return false;

    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length !== 64) return false;

    const der = Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);
    const keyObject = createPublicKey({ key: der, format: "der", type: "spki" });

    // UTF-8, NOT ascii: the route reads the body with req.text() (UTF-8 decode)
    // and Telnyx signs the raw UTF-8 request bytes. Re-encoding as "ascii" would
    // corrupt any non-ASCII byte (emoji/accents/smart-quotes — common in real SMS
    // bodies echoed in inbound + delivery payloads) and reject valid signatures.
    const message = Buffer.from(`${timestamp}|${payload}`, "utf8");
    return cryptoVerify(null, message, keyObject, signature);
  } catch {
    return false;
  }
}
