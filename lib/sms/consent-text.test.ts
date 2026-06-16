import { describe, it, expect } from "vitest";
import {
  SMS_CONSENT_TEXT,
  SMS_CONSENT_LINK_PHRASES,
  SMS_CONSENT_VERSION,
  SMS_STOP_REPLY,
  SMS_HELP_REPLY,
} from "@/lib/sms/consent-text";

// The consent language is legally significant — guard the exact wording so it
// can't drift without a deliberate edit (and a version bump).
const EXPECTED_CONSENT_TEXT =
  "By checking this box, I agree to receive SMS/text messages related to my " +
  "tenancy, including rent reminders, overdue rent balance notices, tenant " +
  "portal login links, maintenance scheduling, maintenance updates, account " +
  "notices, and other rental-related communications. Message frequency varies. " +
  "Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. " +
  "Mobile information will not be shared with third parties or affiliates for " +
  "promotional or marketing purposes. SMS consent is optional and is not " +
  "required as a condition of renting. View our Privacy Policy and Terms and " +
  "Conditions.";

describe("SMS consent language", () => {
  it("matches the exact required wording", () => {
    expect(SMS_CONSENT_TEXT).toBe(EXPECTED_CONSENT_TEXT);
  });

  it("has a version set", () => {
    expect(SMS_CONSENT_VERSION).toMatch(/\S/);
  });

  it("contains each link phrase exactly once (so linking is unambiguous)", () => {
    for (const phrase of Object.values(SMS_CONSENT_LINK_PHRASES)) {
      expect(SMS_CONSENT_TEXT.split(phrase).length - 1).toBe(1);
    }
  });
});

describe("inbound reply text", () => {
  it("uses the exact STOP unsubscribe confirmation", () => {
    expect(SMS_STOP_REPLY).toBe(
      "You have been unsubscribed from tenant SMS notifications. You will receive " +
        "no further SMS messages unless you opt in again.",
    );
  });

  it("uses the exact HELP reply", () => {
    expect(SMS_HELP_REPLY).toBe(
      "Help is available through the support contact listed on our website. " +
        "Messages may include rent reminders, account notices, portal links, and " +
        "maintenance updates. Reply STOP to opt out.",
    );
  });
});
