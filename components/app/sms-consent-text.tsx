import {
  SMS_CONSENT_LINK_PHRASES,
  SMS_CONSENT_TEXT,
} from "@/lib/sms/consent-text";

/**
 * Renders the canonical SMS consent language verbatim, turning the "Privacy
 * Policy" and "Terms and Conditions" phrases into links to /privacy and /terms.
 * The exact same string (SMS_CONSENT_TEXT) is stored on the consent record.
 * Plain component (no hooks) so it can be used inside client forms.
 */
export function SmsConsentText() {
  const { privacy, terms } = SMS_CONSENT_LINK_PHRASES;
  const [beforePrivacy, afterPrivacy = ""] = SMS_CONSENT_TEXT.split(privacy);
  const [betweenLinks = "", afterTerms = ""] = afterPrivacy.split(terms);
  const linkClass =
    "text-primary underline underline-offset-2 hover:opacity-80";
  return (
    <span>
      {beforePrivacy}
      <a href="/privacy" target="_blank" rel="noreferrer" className={linkClass}>
        {privacy}
      </a>
      {betweenLinks}
      <a href="/terms" target="_blank" rel="noreferrer" className={linkClass}>
        {terms}
      </a>
      {afterTerms}
    </span>
  );
}
