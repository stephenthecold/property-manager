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
