import { describe, it, expect } from "vitest";
import {
  isEmailSuppressed,
  isSuppressedEmailStatus,
  suppressionStatusForEvent,
  parseBouncePayload,
  normalizeEmail,
} from "@/lib/reminders/suppression";

describe("isEmailSuppressed", () => {
  it("suppresses bounced + complained", () => {
    expect(isEmailSuppressed("bounced")).toBe(true);
    expect(isEmailSuppressed("complained")).toBe(true);
  });

  it("does NOT suppress a healthy/null tenant", () => {
    expect(isEmailSuppressed(null)).toBe(false);
    expect(isEmailSuppressed(undefined)).toBe(false);
    expect(isEmailSuppressed("")).toBe(false);
  });

  it("treats an unknown/transient value as NOT suppressed (no silent black-hole)", () => {
    expect(isEmailSuppressed("soft_bounce")).toBe(false);
    expect(isEmailSuppressed("delivered")).toBe(false);
    expect(isEmailSuppressed("queued")).toBe(false);
  });

  it("isSuppressedEmailStatus narrows the same set", () => {
    expect(isSuppressedEmailStatus("bounced")).toBe(true);
    expect(isSuppressedEmailStatus("opened")).toBe(false);
  });
});

describe("suppressionStatusForEvent — only hard, terminal kinds suppress", () => {
  it("maps hard-bounce spellings to 'bounced'", () => {
    for (const t of [
      "bounce",
      "Bounce",
      "bounced",
      "hard_bounce",
      "HardBounce",
      "hard-bounce",
      "permanent_fail",
      "PermanentFailure",
      "failed",
      "dropped",
    ]) {
      expect(suppressionStatusForEvent(t)).toBe("bounced");
    }
  });

  it("maps complaint spellings to 'complained'", () => {
    for (const t of [
      "complaint",
      "Complaint",
      "complained",
      "spam",
      "spam_report",
      "SpamReport",
      "abuse",
    ]) {
      expect(suppressionStatusForEvent(t)).toBe("complained");
    }
  });

  it("does NOT suppress soft/transient/non-actionable events", () => {
    for (const t of [
      "soft_bounce",
      "deferred",
      "delivered",
      "open",
      "click",
      "unknown",
      "",
      null,
      undefined,
    ]) {
      expect(suppressionStatusForEvent(t as string | null)).toBeNull();
    }
  });
});

describe("normalizeEmail", () => {
  it("lower-cases + trims, '' → null", () => {
    expect(normalizeEmail("  Tenant@Example.COM ")).toBe("tenant@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("parseBouncePayload — untrusted payload normalization", () => {
  it("parses a hard bounce with the canonical fields", () => {
    expect(
      parseBouncePayload({ type: "bounce", email: "A@B.co" }),
    ).toEqual({ status: "bounced", email: "a@b.co" });
  });

  it("parses a complaint and accepts alternative field names", () => {
    expect(
      parseBouncePayload({ event: "Complaint", recipient: "Foo@Bar.io" }),
    ).toEqual({ status: "complained", email: "foo@bar.io" });
    expect(
      parseBouncePayload({ notificationType: "Bounce", to: "x@y.z" }),
    ).toEqual({ status: "bounced", email: "x@y.z" });
  });

  it("returns null for a soft bounce / non-suppressing type", () => {
    expect(parseBouncePayload({ type: "soft_bounce", email: "a@b.co" })).toBeNull();
    expect(parseBouncePayload({ type: "delivered", email: "a@b.co" })).toBeNull();
  });

  it("returns null when the email is missing or blank", () => {
    expect(parseBouncePayload({ type: "bounce" })).toBeNull();
    expect(parseBouncePayload({ type: "bounce", email: "   " })).toBeNull();
  });

  it("returns null for non-object / junk payloads (never throws)", () => {
    expect(parseBouncePayload(null)).toBeNull();
    expect(parseBouncePayload(undefined)).toBeNull();
    expect(parseBouncePayload("bounce")).toBeNull();
    expect(parseBouncePayload(42)).toBeNull();
    expect(parseBouncePayload([])).toBeNull();
    expect(parseBouncePayload({ type: 123, email: {} })).toBeNull();
  });
});
