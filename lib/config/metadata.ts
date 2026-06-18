import type { Metadata } from "next";

/**
 * Branded page metadata derived from the org business name (Settings →
 * Organization). Used by the surfaces that already resolve AppSettings so the
 * browser tab / shared-link preview shows the business, not a generic title.
 * Display-only — no secrets.
 */

/**
 * For a LAYOUT: sets the default tab title to the business name and a
 * `"%s · Business"` template that child pages fill via their own `title`.
 */
export function brandedLayoutMetadata(businessName: string): Metadata {
  const name = businessName.trim() || "Property Manager";
  return {
    title: { default: name, template: `%s · ${name}` },
    openGraph: { siteName: name, type: "website" },
  };
}

/** For a standalone PAGE: "Page · Business" (or just the business name). */
export function brandedPageMetadata(
  businessName: string,
  page?: string,
): Metadata {
  const name = businessName.trim() || "Property Manager";
  const title = page ? `${page} · ${name}` : name;
  return {
    title,
    openGraph: { title, siteName: name, type: "website" },
  };
}
