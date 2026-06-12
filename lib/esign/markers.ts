/**
 * Inline signature/initial markers for lease agreements. Operators place
 * `{{tenant_signatures}}`, `{{tenant_initials}}`, `{{landlord_signature}}`,
 * and `{{landlord_initials}}` anywhere in the agreement template; the
 * printable page renders them as wet-signature lines, the public /sign page
 * shows "signs here" placeholders, and the final signed artifact stamps the
 * captured marks at every occurrence. Pure string logic — no DB, no DOM.
 */

export const SIGNATURE_MARKERS = [
  "landlord_signature",
  "landlord_initials",
  "tenant_signatures",
  "tenant_initials",
] as const;

export type SignatureMarker = (typeof SIGNATURE_MARKERS)[number];

const MARKER_SET: ReadonlySet<string> = new Set(SIGNATURE_MARKERS);
const MARKER_RE = /\{\{\s*(landlord_signature|landlord_initials|tenant_signatures|tenant_initials)\s*\}\}/g;

/**
 * Identity vars ({{marker}} → "{{marker}}") merged UNDER the real agreement
 * vars so renderTemplate leaves signature markers intact instead of erasing
 * them as unknown keys. Rendering of the markers themselves happens later,
 * per surface (printable / sign page / artifact).
 */
export function markerPassthroughVars(): Record<string, string> {
  return Object.fromEntries(SIGNATURE_MARKERS.map((m) => [m, `{{${m}}}`]));
}

export function hasMarker(text: string, marker: SignatureMarker): boolean {
  return splitOnMarkers(text).some(
    (p) => p.type === "marker" && p.marker === marker,
  );
}

/** True when signing this document must also capture the tenant's initials. */
export function documentNeedsInitials(text: string): boolean {
  return hasMarker(text, "tenant_initials");
}

/** True when the document carries its own inline tenant signature block(s). */
export function documentHasInlineSignatures(text: string): boolean {
  return hasMarker(text, "tenant_signatures");
}

export type DocumentPart =
  | { type: "text"; value: string }
  | { type: "marker"; marker: SignatureMarker };

/**
 * Split agreement text into literal-text and marker parts, in order. Adjacent
 * text is preserved verbatim (including whitespace/newlines) so callers can
 * keep rendering it pre-wrap.
 */
export function splitOnMarkers(text: string): DocumentPart[] {
  const parts: DocumentPart[] = [];
  let last = 0;
  MARKER_RE.lastIndex = 0;
  for (let m = MARKER_RE.exec(text); m; m = MARKER_RE.exec(text)) {
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
    const name = m[1];
    if (MARKER_SET.has(name)) {
      parts.push({ type: "marker", marker: name as SignatureMarker });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

/**
 * Typed initials derived from a full name: first letter of each word, upper-
 * cased, max 4 ("Kevin de la Cruz" → "KDLC", "Kevin Winsett" → "KW").
 */
export function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 4)
    .join("");
}
