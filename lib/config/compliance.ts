/**
 * Pure resolution for the 10DLC / A2P compliance links (DB-free, no clock).
 *
 * Each policy document is either hosted in-app (operator-authored text rendered
 * at /privacy or /terms) or pointed at an externally-hosted page. The external
 * URL wins when set. The settings card passes an absolute `baseUrl` (APP_URL) so
 * it can show the canonical URL to submit for campaign registration; callers
 * that only need an on-site link (the portal footer) omit it for a relative href.
 */

export interface ComplianceLinkFields {
  privacyPolicyText: string | null;
  privacyPolicyUrl: string | null;
  termsText: string | null;
  termsUrl: string | null;
}

export interface ResolvedComplianceLink {
  /** Effective href, or null when neither hosted text nor an external URL is set. */
  href: string | null;
  /** True when this app serves the page (vs. an external URL the operator hosts). */
  hosted: boolean;
}

function resolveOne(
  text: string | null,
  url: string | null,
  path: "/privacy" | "/terms",
  baseUrl: string | undefined,
): ResolvedComplianceLink {
  const external = url?.trim();
  if (external) return { href: external, hosted: false };
  if (text && text.trim()) {
    const base = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
    return { href: `${base}${path}`, hosted: true };
  }
  return { href: null, hosted: false };
}

export interface ResolvedComplianceLinks {
  privacy: ResolvedComplianceLink;
  terms: ResolvedComplianceLink;
}

export function resolveComplianceLinks(
  fields: ComplianceLinkFields,
  baseUrl?: string,
): ResolvedComplianceLinks {
  return {
    privacy: resolveOne(
      fields.privacyPolicyText,
      fields.privacyPolicyUrl,
      "/privacy",
      baseUrl,
    ),
    terms: resolveOne(
      fields.termsText,
      fields.termsUrl,
      "/terms",
      baseUrl,
    ),
  };
}

/**
 * The 10DLC "sample embedded link" — a prefilled, non-functional ("dead")
 * sample of the kind of link this site embeds in messages to tenants (a portal
 * login link). It is derived from APP_URL, never operator-entered or stored, and
 * is display-only: it exists so operators can copy a representative link into
 * their A2P campaign registration. It carries no real token, so it never
 * exposes a tenant session.
 */
export function sampleEmbeddedLink(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/portal/login`;
}

/** Validate an optional operator-entered URL. Empty/blank → ok (cleared). */
export function isValidComplianceUrl(raw: string): boolean {
  const v = raw.trim();
  if (v === "") return true;
  return /^https?:\/\/\S+$/i.test(v);
}

/**
 * Shipped default Privacy Policy, rendered at /privacy when the operator hasn't
 * set their own text or an external URL. It includes the required A2P/10DLC SMS
 * data-handling clause so the policy is compliant out of the box. `{business}`
 * is substituted at render time.
 */
export const DEFAULT_PRIVACY_POLICY = `Privacy Policy

{business} ("we", "us") respects your privacy. This policy explains how we
handle the information we collect to manage your tenancy and our properties.

Information we collect
We collect the information you provide — such as your name, contact details
(including mobile phone number and email address), and tenancy or application
details — to operate our rental business, communicate with you, process
payments, and provide maintenance and account services.

Mobile phone numbers and SMS consent
Your mobile phone number, your SMS consent status, and any SMS opt-in data are
used solely to send you tenancy- and account-related messages that you have
agreed to receive (for example, rent reminders, overdue balance notices, tenant
portal login links, maintenance scheduling and updates, and account notices).
We do NOT sell, rent, trade, or share your mobile phone number, SMS consent, or
SMS opt-in data with third parties or affiliates for marketing or promotional
purposes. SMS consent is optional and is not a condition of renting. You can opt
out at any time by replying STOP to any message, or through your tenant portal.

How we use information
We use your information only to provide and administer rental, account, and
maintenance services, to meet legal and regulatory obligations, and to
communicate with you about your tenancy. Message frequency varies; message and
data rates may apply.

Data sharing
We share information only with service providers who help us operate (for
example, a messaging or payment provider), and only as needed to deliver the
service to you, or where required by law. We never share mobile or SMS data for
third-party marketing.

Contact
For privacy questions or to exercise your choices, contact us using the support
information listed on our website.`;

/**
 * Shipped default Terms and Conditions, rendered at /terms when the operator
 * hasn't set their own text or an external URL. `{business}` is substituted.
 */
export const DEFAULT_TERMS = `Terms and Conditions

These terms govern your use of {business}'s tenant communications and online
services, including the tenant portal and SMS/text notifications.

SMS/text messaging
By opting in, you agree to receive recurring tenancy- and account-related
SMS/text messages from {business}, such as rent reminders, overdue balance
notices, tenant portal login links, maintenance scheduling and updates, and
account notices. Message frequency varies. Message and data rates may apply.
Consent is not a condition of renting. Reply STOP to opt out at any time; reply
HELP for help.

Acceptable use
Our communications and portal are provided to administer your tenancy. You agree
to use them only for their intended purpose and to keep your login credentials
secure.

Changes
We may update these terms from time to time. Continued use after an update
constitutes acceptance of the revised terms.

Contact
Questions about these terms can be directed to the support information listed on
our website.`;

/** Substitute the business name into a default policy template. */
export function fillPolicyTemplate(template: string, businessName: string): string {
  return template.replaceAll("{business}", businessName || "Our company");
}
