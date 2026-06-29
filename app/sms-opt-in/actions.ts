"use server";

import { headers } from "next/headers";
import { recordSmsConsent } from "@/lib/services/sms-consent";
import { clientIpFromXff } from "@/lib/http/client-ip";
import { rateLimitHit, RATE_LIMITS } from "@/lib/services/rate-limit";
import { phoneKey } from "@/lib/portal/identity";
import {
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
} from "@/lib/sms/consent-text";

export interface OptInState {
  ok?: boolean;
  /** true = an opt-in was recorded; false = submitted without ticking consent. */
  consented?: boolean;
  error?: string;
}

const str = (fd: FormData, key: string): string =>
  String(fd.get(key) ?? "").trim();

// Length caps for this PUBLIC, unauthenticated form so a malicious client can't
// push unbounded blobs into the (unbounded) text columns. Mirrors /apply.
const MAX = { fullName: 100, phone: 40, email: 254, propertyUnit: 120 } as const;

/**
 * Public SMS opt-in submission (no session). Records consent ONLY when the
 * separate, un-prechecked consent box is ticked; the record stores the exact
 * consent text/version plus request metadata (IP, user agent) for compliance.
 */
export async function submitSmsOptInAction(
  _prev: OptInState,
  fd: FormData,
): Promise<OptInState> {
  const ip = clientIpFromXff((await headers()).get("x-forwarded-for"));
  if (!(await rateLimitHit(RATE_LIMITS.smsOptIn, ip)).allowed) {
    return {
      error: "Too many submissions — please wait a little while and try again.",
    };
  }

  const fullName = str(fd, "fullName");
  const phoneRaw = str(fd, "phone");
  const email = str(fd, "email") || null;
  const propertyUnit = str(fd, "propertyUnit") || null;
  const consent = fd.get("smsConsent") === "on";

  if (!fullName) return { error: "Please enter your full name." };
  if (
    fullName.length > MAX.fullName ||
    phoneRaw.length > MAX.phone ||
    (email?.length ?? 0) > MAX.email ||
    (propertyUnit?.length ?? 0) > MAX.propertyUnit
  ) {
    return { error: "One of your entries is too long. Please shorten it and try again." };
  }
  if (!phoneKey(phoneRaw)) {
    return { error: "Please enter a valid mobile phone number." };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Please enter a valid email address." };
  }
  // SMS consent is OPTIONAL: the form MUST be submittable without ticking the
  // box. Carriers (10DLC) reject a mandatory opt-in checkbox alongside a
  // mandatory phone field as "forced opt-in", so an unticked submit SUCCEEDS and
  // simply records nothing. We never record a public opt-OUT here — that would
  // let anyone opt a tenant out by phone; opt-out is the STOP keyword.
  if (!consent) {
    return { ok: true, consented: false };
  }

  const h = await headers();
  try {
    await recordSmsConsent(
      phoneRaw,
      true,
      "public_sms_opt_in_form",
      { actorType: "system", actorEmail: "public SMS opt-in form" },
      {
        fullName,
        email,
        propertyUnit,
        consentText: SMS_CONSENT_TEXT,
        consentVersion: SMS_CONSENT_VERSION,
        ipAddress: ip,
        userAgent: h.get("user-agent"),
      },
    );
  } catch {
    return {
      error: "Sorry, we couldn't record your opt-in right now. Please try again later.",
    };
  }
  return { ok: true, consented: true };
}
