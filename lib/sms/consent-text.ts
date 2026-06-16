/**
 * Canonical SMS consent language + compliance copy (DB-free). The opt-in UI
 * renders SMS_CONSENT_TEXT verbatim (with the Privacy Policy / Terms phrases as
 * links); the SAME string is stored on every SmsConsentRecord so the exact text
 * a person agreed to is provable. Bump SMS_CONSENT_VERSION whenever the wording
 * changes.
 */

export const SMS_CONSENT_VERSION = "2026-06-16.1";

export const SMS_CONSENT_TEXT =
  "By checking this box, I agree to receive SMS/text messages related to my " +
  "tenancy, including rent reminders, overdue rent balance notices, tenant " +
  "portal login links, maintenance scheduling, maintenance updates, account " +
  "notices, and other rental-related communications. Message frequency varies. " +
  "Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. " +
  "Mobile information will not be shared with third parties or affiliates for " +
  "promotional or marketing purposes. SMS consent is optional and is not " +
  "required as a condition of renting. View our Privacy Policy and Terms and " +
  "Conditions.";

// Phrases within SMS_CONSENT_TEXT that the UI turns into links (to /privacy, /terms).
export const SMS_CONSENT_LINK_PHRASES = {
  privacy: "Privacy Policy",
  terms: "Terms and Conditions",
} as const;

/** Exact reply sent on an inbound opt-out (STOP/UNSUBSCRIBE/CANCEL/END/QUIT). */
export const SMS_STOP_REPLY =
  "You have been unsubscribed from tenant SMS notifications. You will receive " +
  "no further SMS messages unless you opt in again.";

/** Exact reply sent on an inbound HELP. */
export const SMS_HELP_REPLY =
  "Help is available through the support contact listed on our website. " +
  "Messages may include rent reminders, account notices, portal links, and " +
  "maintenance updates. Reply STOP to opt out.";

/** Confirmation sent on an inbound opt-in (START/YES) that matched an account. */
export const SMS_START_REPLY =
  "You are now opted in to tenant SMS notifications. Reply HELP for help, " +
  "STOP to opt out.";

/** The valid sources for an SmsConsentRecord. */
export type SmsConsentSource =
  | "public_sms_opt_in_form"
  | "rental_application"
  | "portal"
  | "inbound_sms_keyword"
  | "staff";
