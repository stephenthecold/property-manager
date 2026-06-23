/**
 * 10DLC / A2P SMS "brand verification" readiness for the public site.
 *
 * Before carriers (via The Campaign Registry) approve an SMS campaign, they
 * review the brand's website for: the business name, a phone number, an email,
 * a physical/mailing address, and a clear description of the business and its
 * services — all reachable WITHOUT a login. This pure helper checks the
 * operator's settings against that list so the UI can show a checklist and head
 * off a vetting rejection (e.g. the common TELNYX_FAILED "the website does not
 * provide any details about the brand").
 *
 * Pure + DB-free: the caller passes the already-resolved settings fields.
 */

/** The placeholder businessName getAppSettings falls back to when it's unset. */
export const DEFAULT_BUSINESS_NAME = "Property Manager";

export interface PublicSiteReadinessInput {
  /** Is the "Public website" module on? With it off, the public domain
   *  redirects to the resident login — carriers see no brand info at all. */
  moduleEnabled: boolean;
  businessName: string;
  businessPhone: string | null;
  businessEmail: string | null;
  businessAddress: string | null;
  publicSiteIntro: string | null;
  publicSiteUrl: string | null;
}

export interface PublicSiteReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  /** Why carriers want it (shown when missing). */
  hint: string;
  /** Settings route that fixes it. */
  fixHref: string;
}

export interface PublicSiteReadinessReport {
  items: PublicSiteReadinessItem[];
  missingCount: number;
  /** True when every carrier-required item is satisfied. */
  ready: boolean;
}

const has = (v: string | null | undefined): boolean => !!v && v.trim().length > 0;

export function publicSiteReadiness(
  i: PublicSiteReadinessInput,
): PublicSiteReadinessReport {
  const items: PublicSiteReadinessItem[] = [
    {
      key: "module",
      label: "Public website is live",
      ok: i.moduleEnabled,
      hint: "With the public website off, your domain redirects to the resident login — carriers can't verify a login page.",
      fixHref: "/settings/modules",
    },
    {
      key: "name",
      label: "Business name set",
      // The default placeholder means the operator never set a real name.
      ok: has(i.businessName) && i.businessName.trim() !== DEFAULT_BUSINESS_NAME,
      hint: "Your real business name must appear on the homepage.",
      fixHref: "/settings/organization",
    },
    {
      key: "phone",
      label: "Phone number set",
      ok: has(i.businessPhone),
      hint: "Carriers require a contact phone number on the site.",
      fixHref: "/settings/organization",
    },
    {
      key: "email",
      label: "Email address set",
      ok: has(i.businessEmail),
      hint: "Carriers require a contact email on the site.",
      fixHref: "/settings/organization",
    },
    {
      key: "address",
      label: "Mailing address set",
      ok: has(i.businessAddress),
      hint: "A physical/mailing address strengthens brand verification.",
      fixHref: "/settings/organization",
    },
    {
      key: "about",
      label: "About / services description written",
      ok: has(i.publicSiteIntro),
      hint: "The intro must clearly describe your business and the services you provide (e.g. residential property management & rentals).",
      fixHref: "/settings/public-site",
    },
    {
      key: "url",
      label: "Public site address set",
      ok: has(i.publicSiteUrl),
      hint: "Set the public URL carriers will review (it also drives tenant-portal links).",
      fixHref: "/settings/public-site",
    },
  ];
  const missingCount = items.filter((it) => !it.ok).length;
  return { items, missingCount, ready: missingCount === 0 };
}
