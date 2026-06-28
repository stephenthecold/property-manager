import { describe, it, expect } from "vitest";
import {
  parseReminderPrefChannel,
  resolveEffectiveChannel,
} from "@/lib/reminders/pref";

describe("parseReminderPrefChannel", () => {
  it("accepts the three valid channel states", () => {
    expect(parseReminderPrefChannel("sms")).toBe("sms");
    expect(parseReminderPrefChannel("email")).toBe("email");
    expect(parseReminderPrefChannel("off")).toBe("off");
  });

  it("rejects unknown / empty / nullish values", () => {
    expect(parseReminderPrefChannel("none")).toBeNull();
    expect(parseReminderPrefChannel("SMS")).toBeNull();
    expect(parseReminderPrefChannel("")).toBeNull();
    expect(parseReminderPrefChannel(null)).toBeNull();
    expect(parseReminderPrefChannel(undefined)).toBeNull();
  });
});

describe("resolveEffectiveChannel", () => {
  it("uses the global channel when there is no override", () => {
    expect(
      resolveEffectiveChannel({ globalChannel: "sms", override: null }),
    ).toBe("sms");
    expect(
      resolveEffectiveChannel({ globalChannel: "email", override: undefined }),
    ).toBe("email");
  });

  it("lets a per-event override win over the global channel", () => {
    expect(
      resolveEffectiveChannel({ globalChannel: "sms", override: "email" }),
    ).toBe("email");
    expect(
      resolveEffectiveChannel({ globalChannel: "email", override: "sms" }),
    ).toBe("sms");
  });

  it("returns null (suppressed) when the override is 'off'", () => {
    expect(
      resolveEffectiveChannel({ globalChannel: "sms", override: "off" }),
    ).toBeNull();
    expect(
      resolveEffectiveChannel({ globalChannel: "email", override: "off" }),
    ).toBeNull();
  });

  it("falls back to the global channel for an unrecognized override", () => {
    expect(
      resolveEffectiveChannel({ globalChannel: "sms", override: "carrier-pigeon" }),
    ).toBe("sms");
    expect(
      resolveEffectiveChannel({ globalChannel: "email", override: "" }),
    ).toBe("email");
  });
});
