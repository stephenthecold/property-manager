import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelnyxSignature } from "@/lib/reminders/telnyx-signature";

// Generate a real Ed25519 keypair and derive the raw 32-byte public key as
// standard base64 — exactly the form the Telnyx portal exposes.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ format: "der", type: "spki" });
const pubB64 = spki.subarray(spki.length - 32).toString("base64");

const BODY = JSON.stringify({
  data: { event_type: "message.received", payload: { id: "abc-123" } },
});
// A fixed "now" so timestamp math is deterministic.
const NOW = new Date("2026-07-01T12:00:00Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

// Telnyx signs `${timestamp}|${rawRequestBody}` with the Ed25519 private key.
function sign(timestamp: string, body: string): string {
  return cryptoSign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString(
    "base64",
  );
}

describe("verifyTelnyxSignature", () => {
  it("accepts a valid signature with a fresh timestamp", () => {
    const timestamp = String(NOW_SECONDS);
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: pubB64,
        payload: BODY,
        signatureBase64: sign(timestamp, BODY),
        timestamp,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("accepts an empty body when the signature covers it", () => {
    const timestamp = String(NOW_SECONDS);
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: pubB64,
        payload: "",
        signatureBase64: sign(timestamp, ""),
        timestamp,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const timestamp = String(NOW_SECONDS);
    const signature = sign(timestamp, BODY);
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: pubB64,
        payload: BODY.replace("abc-123", "evil-999"),
        signatureBase64: signature,
        timestamp,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const timestamp = String(NOW_SECONDS);
    const signature = sign(timestamp, BODY);
    // Flip one byte of the raw signature, then re-encode.
    const raw = Buffer.from(signature, "base64");
    raw[0] ^= 0xff;
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: pubB64,
        payload: BODY,
        signatureBase64: raw.toString("base64"),
        timestamp,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rejects a stale timestamp older than the tolerance", () => {
    // Signed 301s ago; default tolerance is 300s.
    const staleSeconds = NOW_SECONDS - 301;
    const timestamp = String(staleSeconds);
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: pubB64,
        payload: BODY,
        signatureBase64: sign(timestamp, BODY),
        timestamp,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rejects a future timestamp beyond the tolerance", () => {
    const futureSeconds = NOW_SECONDS + 301;
    const timestamp = String(futureSeconds);
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: pubB64,
        payload: BODY,
        signatureBase64: sign(timestamp, BODY),
        timestamp,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("accepts a timestamp within a custom tolerance window", () => {
    const staleSeconds = NOW_SECONDS - 301;
    const timestamp = String(staleSeconds);
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: pubB64,
        payload: BODY,
        signatureBase64: sign(timestamp, BODY),
        timestamp,
        now: NOW,
        toleranceSeconds: 600,
      }),
    ).toBe(true);
  });

  it("rejects missing or empty fields (no throw)", () => {
    const timestamp = String(NOW_SECONDS);
    const signature = sign(timestamp, BODY);
    const base = {
      publicKeyBase64: pubB64,
      payload: BODY,
      signatureBase64: signature,
      timestamp,
      now: NOW,
    };
    expect(verifyTelnyxSignature({ ...base, publicKeyBase64: "" })).toBe(false);
    expect(verifyTelnyxSignature({ ...base, signatureBase64: "" })).toBe(false);
    expect(verifyTelnyxSignature({ ...base, timestamp: "" })).toBe(false);
  });

  it("rejects a non-numeric timestamp (no throw)", () => {
    const timestamp = String(NOW_SECONDS);
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: pubB64,
        payload: BODY,
        signatureBase64: sign(timestamp, BODY),
        timestamp: "not-a-number",
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rejects garbage / malformed base64 without throwing", () => {
    const timestamp = String(NOW_SECONDS);
    // Garbage public key.
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: "!!!not base64!!!",
        payload: BODY,
        signatureBase64: sign(timestamp, BODY),
        timestamp,
        now: NOW,
      }),
    ).toBe(false);
    // Garbage signature.
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: pubB64,
        payload: BODY,
        signatureBase64: "!!!not base64!!!",
        timestamp,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rejects a public key of the wrong length (no throw)", () => {
    const timestamp = String(NOW_SECONDS);
    // 16 zero bytes → wrong length after base64-decode.
    const shortKey = Buffer.alloc(16).toString("base64");
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: shortKey,
        payload: BODY,
        signatureBase64: sign(timestamp, BODY),
        timestamp,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("rejects a signature made by a different key", () => {
    const timestamp = String(NOW_SECONDS);
    const other = generateKeyPairSync("ed25519");
    const foreignSig = cryptoSign(
      null,
      Buffer.from(`${timestamp}|${BODY}`),
      other.privateKey,
    ).toString("base64");
    expect(
      verifyTelnyxSignature({
        publicKeyBase64: pubB64,
        payload: BODY,
        signatureBase64: foreignSig,
        timestamp,
        now: NOW,
      }),
    ).toBe(false);
  });
});
