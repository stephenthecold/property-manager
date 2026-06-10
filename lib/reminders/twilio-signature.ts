import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio webhook signature scheme (X-Twilio-Signature): take the full webhook
 * URL, append every POST param as key+value sorted by key (no separators),
 * HMAC-SHA1 the result with the account auth token, base64-encode.
 * Pure — no env or clock — so it is unit-testable with fixed vectors.
 */

export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifyTwilioSignature(i: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string;
}): boolean {
  const expected = Buffer.from(
    computeTwilioSignature(i.authToken, i.url, i.params),
  );
  const provided = Buffer.from(i.signature);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
