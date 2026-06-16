import { describe, it, expect } from "vitest";
import { deriveSmsConsentStatus } from "@/lib/sms/consent-status";

describe("deriveSmsConsentStatus", () => {
  it("missing_mobile when no phone (wins over everything)", () => {
    expect(
      deriveSmsConsentStatus({ phone: null, smsConsent: true, hasOptOutRecord: true }),
    ).toBe("missing_mobile");
    expect(
      deriveSmsConsentStatus({ phone: "   ", smsConsent: false, hasOptOutRecord: false }),
    ).toBe("missing_mobile");
  });

  it("opted_in when consent is true and a phone exists", () => {
    expect(
      deriveSmsConsentStatus({ phone: "+15551234567", smsConsent: true, hasOptOutRecord: false }),
    ).toBe("opted_in");
  });

  it("opted_out when consent false AND a prior opt-out record exists", () => {
    expect(
      deriveSmsConsentStatus({ phone: "555", smsConsent: false, hasOptOutRecord: true }),
    ).toBe("opted_out");
  });

  it("not_opted_in when consent false and never engaged", () => {
    expect(
      deriveSmsConsentStatus({ phone: "555", smsConsent: false, hasOptOutRecord: false }),
    ).toBe("not_opted_in");
  });
});
