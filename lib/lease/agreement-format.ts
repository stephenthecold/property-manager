import { splitOnMarkers, type DocumentPart } from "@/lib/esign/markers";
import { DEFAULT_LEASE_AGREEMENT_TEXT } from "@/lib/config/lease-agreement";

/**
 * Presentation + comparison helpers for lease-agreement clause text. PURE
 * string logic — no DB, no DOM, no React. The structured agreement renderer
 * (components/app/agreement-text.tsx) and the renewal-change diff both build on
 * parseAgreementBlocks so structure detection lives in one place.
 *
 * IMPORTANT: nothing here mutates the agreement SOURCE text. The e-signature
 * snapshot hash (SigningRequest.documentSha256) and the .docx fill operate on
 * the raw template/document text; these helpers only decide how that text is
 * DISPLAYED or COMPARED. Improving them never invalidates an existing
 * signature, so they are safe to evolve.
 */

/** One display block: an optional run-in heading + ordered text/marker runs. */
export interface AgreementBlock {
  /** Run-in heading like "4. UTILITIES." pulled to the front (bolded by the
   *  renderer), or null for the preamble / prose / signature blocks. */
  heading: string | null;
  /** Body runs (heading removed): literal text interleaved with signature markers. */
  parts: DocumentPart[];
}

// A numbered clause heading: "4. UTILITIES." or "10. ENTIRE AGREEMENT." — a
// leading number then a SHORT, ALL-CAPS label ending at the first period. The
// all-caps requirement (not just an initial capital) is what separates a
// heading from an ordinary capitalized sentence ("1. The tenant agrees…"), so
// the label may run fairly long (verbose legal titles) without swallowing prose.
const HEADING_RE = /^(\d{1,3}\.\s+\p{Lu}[\p{Lu}0-9 ,/&'()-]{0,70}?\.)(?=\s|$)/u;

/** Serialize a block's runs for comparison: literal text plus a stable token
 *  per signature marker, so adding/removing a marker (e.g. a clause that newly
 *  requires the tenant's initials) reads as a change. */
function partsForCompare(parts: DocumentPart[]): string {
  return parts
    .map((p) => (p.type === "text" ? p.value : `{{${p.marker}}}`))
    .join("");
}

/**
 * Split agreement text into display blocks by blank lines, lifting a numbered
 * run-in heading out of each block when present. Text with no blank-line
 * structure collapses to a single block, so the renderer naturally falls back
 * to continuous rendering for custom templates that aren't structured this way.
 */
export function parseAgreementBlocks(text: string): AgreementBlock[] {
  const blocks: AgreementBlock[] = [];
  for (const raw of text.split(/\n[ \t]*\n+/)) {
    const para = raw.trim(); // drop blank edges; inner newlines preserved
    if (para === "") continue;
    const m = HEADING_RE.exec(para);
    if (m) {
      const body = para.slice(m[0].length).replace(/^\s+/, "");
      blocks.push({ heading: m[1], parts: splitOnMarkers(body) });
    } else {
      blocks.push({ heading: null, parts: splitOnMarkers(para) });
    }
  }
  // Degenerate input (all blank) — one empty block so callers never crash.
  return blocks.length > 0 ? blocks : [{ heading: null, parts: [] }];
}

// ---------------------------------------------------------------------------
// Renewal change diff
// ---------------------------------------------------------------------------

/** Collapse runs of whitespace so display-only differences don't read as changes. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Map of clause-number (or heading) -> normalized body for one agreement. The
 * unnumbered preamble is collected under "_preamble" and excluded from the
 * change list (it carries the prepared/term dates, which always differ on a
 * renewal and aren't a wording change the tenant needs to scrutinize).
 */
function sectionMap(text: string): Map<string, { heading: string; body: string }> {
  const map = new Map<string, { heading: string; body: string }>();
  let preamble = "";
  for (const b of parseAgreementBlocks(text)) {
    const body = normalize(partsForCompare(b.parts));
    if (b.heading) {
      const num = /^(\d{1,3})\./.exec(b.heading)?.[1];
      let key = num ?? `h:${normalize(b.heading)}`;
      // Keep duplicate-numbered clauses distinct so neither is silently dropped.
      while (map.has(key)) key = `${key}~${map.size}`;
      // Display heading without its trailing period: "4. UTILITIES".
      map.set(key, { heading: b.heading.replace(/\.\s*$/, ""), body });
    } else {
      preamble += ` ${body}`;
    }
  }
  const pre = normalize(preamble);
  if (pre) map.set("_preamble", { heading: "Introduction", body: pre });
  return map;
}

export interface AgreementChangeSummary {
  /** Clause headings whose wording (or embedded terms) changed, e.g. "4. UTILITIES". */
  changed: string[];
  /** Clause headings present now but absent from the previous agreement. */
  added: string[];
  /** Clause headings present before but absent now. */
  removed: string[];
  /** True when the agreements differ at all — covers unstructured templates,
   *  where the clause lists are empty but the text still changed. */
  hasChanges: boolean;
}

/**
 * Clause-level diff between two agreement texts. Callers pass the UNRENDERED
 * templates (with {{placeholders}}), so substituted values that always differ
 * on a renewal — dates, rent — are identical here and only genuine WORDING
 * edits surface. Returns clause HEADINGS only — never any agreement body text,
 * since the result is shown on the PUBLIC signing page.
 */
export function diffAgreementText(
  previous: string,
  next: string,
): AgreementChangeSummary {
  const prev = sectionMap(previous);
  const cur = sectionMap(next);
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [key, v] of cur) {
    if (key === "_preamble") continue;
    const before = prev.get(key);
    if (!before) added.push(v.heading);
    else if (before.body !== v.body) changed.push(v.heading);
  }
  for (const [key, v] of prev) {
    if (key === "_preamble") continue;
    if (!cur.has(key)) removed.push(v.heading);
  }

  const sectionLevel = changed.length + added.length + removed.length > 0;
  const hasNumberedClauses = [...cur.keys(), ...prev.keys()].some(
    (k) => k !== "_preamble",
  );
  // Structured agreements: trust the clause-level diff (so a renewal that only
  // shifts the prepared/term dates isn't flagged). Unstructured custom
  // templates: fall back to a whole-text comparison.
  const hasChanges = hasNumberedClauses
    ? sectionLevel
    : normalize(partsForCompare(splitOnMarkers(previous))) !==
      normalize(partsForCompare(splitOnMarkers(next)));

  return { changed, added, removed, hasChanges };
}

// ---------------------------------------------------------------------------
// Template resolution — the snapshot/default contract in one place
// ---------------------------------------------------------------------------

// `lease.agreementText` is the clause template a lease was FROZEN with at
// creation; NULL means "built-in default", pinned. Editing the org-wide
// template (AppSettings.leaseAgreementText) only changes NEW leases and the
// wording a RENEWAL adopts. These three helpers keep that rule from drifting
// across the render, e-sign, create, and renewal-completion call sites.

/** Template a lease OPERATES under: its frozen snapshot, else the built-in
 *  default. Used by the printable agreement page and an initial e-sign. */
export function leaseAgreementTemplate(lease: {
  agreementText: string | null;
}): string {
  return lease.agreementText ?? DEFAULT_LEASE_AGREEMENT_TEXT;
}

/** The current ORG-wide template (custom override, else the built-in default).
 *  A renewal e-sign adopts this, so renewed wording can differ from the prior lease. */
export function orgAgreementTemplate(app: {
  leaseAgreementText: string | null;
}): string {
  return app.leaseAgreementText ?? DEFAULT_LEASE_AGREEMENT_TEXT;
}

/** Value to FREEZE onto a lease (at creation and on renewal completion): the
 *  org's custom template, or NULL meaning "built-in default" (pinned). */
export function snapshotAgreementTemplate(app: {
  leaseAgreementText: string | null;
}): string | null {
  return app.leaseAgreementText?.trim() || null;
}
