import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeTwilioSignature,
  verifyTwilioSignature,
} from "@/lib/reminders/twilio-signature";

const AUTH_TOKEN = "12345";
const URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS: Record<string, string> = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+14158675310",
  Digits: "1234",
  From: "+14158675310",
  To: "+18005551212",
};

describe("computeTwilioSignature", () => {
  it("implements the Twilio spec: HMAC-SHA1(url + sorted key+value concat), base64", () => {
    // The exact string Twilio signs, spelled out: full URL (query string
    // included) followed by each POST param as key+value, sorted by key,
    // with no delimiters.
    const data =
      "https://mycompany.com/myapp.php?foo=1&bar=2" +
      "CallSidCA1234567890ABCDE" +
      "Caller+14158675310" +
      "Digits1234" +
      "From+14158675310" +
      "To+18005551212";
    const expected = createHmac("sha1", AUTH_TOKEN)
      .update(data, "utf8")
      .digest("base64");
    expect(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS)).toBe(expected);
    // Frozen regression value for the vector above.
    expect(expected).toBe("GvWf1cFY/Q7PnoempGyD5oXAezc=");
  });

  it("sorts params by key regardless of insertion order", () => {
    const shuffled: Record<string, string> = {
      To: "+18005551212",
      Digits: "1234",
      CallSid: "CA1234567890ABCDE",
      From: "+14158675310",
      Caller: "+14158675310",
    };
    expect(computeTwilioSignature(AUTH_TOKEN, URL, shuffled)).toBe(
      computeTwilioSignature(AUTH_TOKEN, URL, PARAMS),
    );
  });

  it("signs URL alone when there are no params", () => {
    const sig = computeTwilioSignature(AUTH_TOKEN, URL, {});
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(sig).not.toBe(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS));
  });
});

describe("verifyTwilioSignature", () => {
  it("round-trips a computed signature", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: URL,
        params: PARAMS,
        signature,
      }),
    ).toBe(true);
  });

  it("rejects a tampered param value", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: URL,
        params: { ...PARAMS, Digits: "9999" },
        signature,
      }),
    ).toBe(false);
  });

  it("rejects an added param", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: URL,
        params: { ...PARAMS, Extra: "x" },
        signature,
      }),
    ).toBe(false);
  });

  it("rejects a tampered URL", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: "https://evil.example.com/myapp.php?foo=1&bar=2",
        params: PARAMS,
        signature,
      }),
    ).toBe(false);
  });

  it("rejects a tampered signature of the same length", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    const flipped =
      (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: URL,
        params: PARAMS,
        signature: flipped,
      }),
    ).toBe(false);
  });

  it("rejects a signature with a different length (no throw)", () => {
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: URL,
        params: PARAMS,
        signature: "short",
      }),
    ).toBe(false);
    expect(
      verifyTwilioSignature({
        authToken: AUTH_TOKEN,
        url: URL,
        params: PARAMS,
        signature: "",
      }),
    ).toBe(false);
  });

  it("rejects when verified with a different auth token", () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, URL, PARAMS);
    expect(
      verifyTwilioSignature({
        authToken: "67890",
        url: URL,
        params: PARAMS,
        signature,
      }),
    ).toBe(false);
  });
});
