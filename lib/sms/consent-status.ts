/**
 * Pure derivation of a contact's SMS consent status for the admin view/filter
 * (DB-free, unit-tested). Distinguishes a fresh "never engaged" contact from one
 * who actively opted out, and flags missing mobile numbers.
 */

export type SmsConsentStatus =
  | "opted_in"
  | "opted_out"
  | "not_opted_in"
  | "missing_mobile";

export const SMS_CONSENT_STATUS_LABEL: Record<SmsConsentStatus, string> = {
  opted_in: "Opted in",
  opted_out: "Opted out",
  not_opted_in: "Not opted in",
  missing_mobile: "Missing mobile number",
};

export function deriveSmsConsentStatus(input: {
  phone: string | null | undefined;
  smsConsent: boolean;
  /** True when a prior consent=false record exists (an explicit opt-out). */
  hasOptOutRecord: boolean;
}): SmsConsentStatus {
  if (!input.phone || input.phone.trim() === "") return "missing_mobile";
  if (input.smsConsent) return "opted_in";
  return input.hasOptOutRecord ? "opted_out" : "not_opted_in";
}
