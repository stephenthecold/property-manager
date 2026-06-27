import { describe, it, expect } from "vitest";
import {
  parseAgreementBlocks,
  diffAgreementText,
} from "@/lib/lease/agreement-format";
import { DEFAULT_LEASE_AGREEMENT_TEXT } from "@/lib/config/lease-agreement";

const textOf = (parts: { type: string; value?: string }[]) =>
  parts.map((p) => (p.type === "text" ? (p.value ?? "") : "")).join("");

describe("parseAgreementBlocks", () => {
  it("detects numbered run-in headings in the default template", () => {
    const blocks = parseAgreementBlocks(DEFAULT_LEASE_AGREEMENT_TEXT);
    const headings = blocks.map((b) => b.heading).filter(Boolean);
    expect(headings).toContain("1. TERM.");
    expect(headings).toContain("4. UTILITIES.");
    expect(headings).toContain("10. ENTIRE AGREEMENT.");
    // The opening paragraph is prose, not a numbered clause.
    expect(blocks[0].heading).toBeNull();
  });

  it("keeps signature markers as marker parts", () => {
    const markers = parseAgreementBlocks(DEFAULT_LEASE_AGREEMENT_TEXT).flatMap(
      (b) => b.parts.flatMap((p) => (p.type === "marker" ? [p.marker] : [])),
    );
    expect(markers).toContain("landlord_signature");
    expect(markers).toContain("tenant_signatures");
  });

  it("lifts the heading out and preserves the clause body verbatim", () => {
    const blocks = parseAgreementBlocks(
      "1. TERM. The tenancy begins on June 1.\n\n2. RENT. Pay $850.",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].heading).toBe("1. TERM.");
    expect(textOf(blocks[0].parts)).toBe("The tenancy begins on June 1.");
  });

  it("falls back to a single block when there is no blank-line structure", () => {
    const blocks = parseAgreementBlocks(
      "Just one continuous custom clause with no breaks.",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].heading).toBeNull();
  });

  it("does not treat an ordinary numbered sentence as a heading", () => {
    // No uppercase label after the number -> not a heading.
    const blocks = parseAgreementBlocks("1. the tenant must pay rent.");
    expect(blocks[0].heading).toBeNull();
  });

  it("does not treat a Capitalized numbered sentence as a heading", () => {
    // Sentence case (not ALL-CAPS) stays prose, so long clause bodies that
    // open with a capital aren't swallowed as headings.
    const blocks = parseAgreementBlocks(
      "1. The tenant agrees to maintain the premises in good repair.",
    );
    expect(blocks[0].heading).toBeNull();
  });

  it("detects a long ALL-CAPS clause heading", () => {
    const blocks = parseAgreementBlocks(
      "3. SECURITY DEPOSIT AND ADDITIONAL RESERVES FOR DAMAGE. Tenant pays a deposit.",
    );
    expect(blocks[0].heading).toBe(
      "3. SECURITY DEPOSIT AND ADDITIONAL RESERVES FOR DAMAGE.",
    );
  });
});

describe("diffAgreementText", () => {
  const A =
    "1. TERM. Begins June 1.\n\n2. RENT. Pay $850 per month.\n\n3. PETS. No pets.";

  it("reports no changes for identical agreements", () => {
    const d = diffAgreementText(A, A);
    expect(d.hasChanges).toBe(false);
    expect(d.changed).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("flags a clause whose wording or terms changed", () => {
    const B =
      "1. TERM. Begins June 1.\n\n2. RENT. Pay $900 per month.\n\n3. PETS. No pets.";
    const d = diffAgreementText(A, B);
    expect(d.changed).toEqual(["2. RENT"]);
    expect(d.hasChanges).toBe(true);
  });

  it("flags added and removed clauses by heading", () => {
    const B =
      "1. TERM. Begins June 1.\n\n2. RENT. Pay $850 per month.\n\n4. SMOKING. No smoking.";
    const d = diffAgreementText(A, B);
    expect(d.added).toEqual(["4. SMOKING"]);
    expect(d.removed).toEqual(["3. PETS"]);
  });

  it("ignores preamble/date-only differences in structured agreements", () => {
    const d = diffAgreementText(
      `Made on June 1, 2026.\n\n${A}`,
      `Made on July 1, 2027.\n\n${A}`,
    );
    expect(d.hasChanges).toBe(false);
  });

  it("ignores placeholder values so a renewal's date/rent roll is not flagged", () => {
    // We diff UNRENDERED templates, so {{start_date}}/{{rent}} are identical in
    // both — a routine renewal with the same wording shows no changes.
    const tmpl =
      "1. TERM. Begins {{start_date}}, ends {{end_date}}.\n\n2. RENT. Pay {{rent}}.";
    expect(diffAgreementText(tmpl, tmpl).hasChanges).toBe(false);
  });

  it("flags a clause that newly requires the tenant's initials (marker added)", () => {
    const before = "4. UTILITIES. Landlord pays water.";
    const after = "4. UTILITIES. Landlord pays {{tenant_initials}} water.";
    expect(diffAgreementText(before, after).changed).toEqual(["4. UTILITIES"]);
  });

  it("keeps duplicate-numbered clauses distinct (no silent drop)", () => {
    const prev = "2. RENT. Pay $850.\n\n2. RENT EXTRA. Plus fees.";
    const next = "2. RENT. Pay $900.\n\n2. RENT EXTRA. Plus fees.";
    expect(diffAgreementText(prev, next).changed).toContain("2. RENT");
  });

  it("falls back to a whole-text comparison for unstructured templates", () => {
    const d = diffAgreementText(
      "A plain custom agreement with no numbered clauses.",
      "A plain custom agreement with different wording.",
    );
    expect(d.hasChanges).toBe(true);
    expect(d.changed).toEqual([]);
  });
});
