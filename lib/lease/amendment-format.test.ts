import { describe, it, expect } from "vitest";
import {
  AMENDMENT_TEMPLATE,
  amendmentVarOverrides,
  validateAmendmentInput,
  extractAmendmentTitle,
  AMENDMENT_BODY_MAX,
  AMENDMENT_TITLE_MAX,
} from "@/lib/lease/amendment-format";
import { renderTemplate } from "@/lib/reminders/templates";
import { markerPassthroughVars } from "@/lib/esign/markers";

// Stand-in for the vars buildAgreementVars() supplies at send time.
const VARS = {
  business_legal_name: "Acme Holdings LLC",
  tenant_names: "Alice Adams, Bob Adams",
  property_name: "Maple Court",
  unit: "2B",
  start_date: "January 1, 2026",
  today: "June 28, 2026",
};

/** Render the template exactly as createSigningRequest does. */
function render(title: string, body: string): string {
  return renderTemplate(AMENDMENT_TEMPLATE, {
    ...markerPassthroughVars(),
    ...VARS,
    ...amendmentVarOverrides({ title, body }),
  });
}

describe("amendmentVarOverrides", () => {
  it("maps title/body under the amendment var keys, trimmed", () => {
    const o = amendmentVarOverrides({ title: "  Pet Addendum  ", body: "  One cat.  " });
    expect(o.amendment_title).toBe("Pet Addendum");
    expect(o.amendment_body).toBe("One cat.");
  });
});

describe("AMENDMENT_TEMPLATE rendering", () => {
  it("injects the title and body and fills the lease vars", () => {
    const doc = render("Pet Addendum", "Tenant may keep one (1) cat. Pet deposit: $300.");
    expect(doc).toContain("Pet Addendum");
    expect(doc).toContain("Tenant may keep one (1) cat. Pet deposit: $300.");
    expect(doc).toContain("Acme Holdings LLC");
    expect(doc).toContain("Alice Adams, Bob Adams");
    expect(doc).toContain("Maple Court, Unit 2B");
    expect(doc).toContain("dated January 1, 2026");
    // No unresolved standard placeholders survive.
    expect(doc).not.toMatch(/\{\{\s*(today|tenant_names|property_name|unit|start_date|business_legal_name)\s*\}\}/);
  });

  it("preserves the signature markers for the engine to stamp", () => {
    const doc = render("Rent Rider", "Rent increases to $1,300 effective August 1, 2026.");
    expect(doc).toContain("{{landlord_signature}}");
    expect(doc).toContain("{{tenant_signatures}}");
  });

  it("does NOT have a tenant_initials marker (single-signature flow)", () => {
    const doc = render("Parking Addendum", "Assigns parking space #7.");
    expect(doc).not.toContain("{{tenant_initials}}");
  });

  it("is injection-safe: a {{var}} typed into the body stays literal", () => {
    // A confused/malicious operator types a marker/var into the body — single-pass
    // rendering inserts it as literal text, never expanding it into a real value
    // or an active signature marker.
    const doc = render("Sneaky", "Rent is {{rent}} and sign here {{tenant_signatures}} now.");
    expect(doc).toContain("Rent is {{rent}} and sign here {{tenant_signatures}} now.");
    // The body's literal "{{tenant_signatures}}" plus the template's real marker.
    expect(doc.match(/\{\{tenant_signatures\}\}/g)).toHaveLength(2);
    // {{rent}} was NOT replaced with an actual rent value (it isn't in VARS anyway,
    // and even if it were, the body value is not re-expanded).
    expect(doc).toContain("{{rent}}");
  });
});

describe("extractAmendmentTitle", () => {
  it("round-trips the title out of a rendered document", () => {
    const doc = render("Pet Addendum", "One cat allowed.");
    expect(extractAmendmentTitle(doc)).toBe("Pet Addendum");
  });
  it("falls back to 'Amendment' for unexpected text", () => {
    expect(extractAmendmentTitle("")).toBe("Amendment");
    expect(extractAmendmentTitle("\n\n   \n")).toBe("Amendment");
  });
});

describe("validateAmendmentInput", () => {
  it("accepts a normal title + body", () => {
    expect(validateAmendmentInput({ title: "Pet Addendum", body: "One cat." })).toEqual({
      ok: true,
    });
  });
  it("rejects empty title/body (after trim)", () => {
    expect(validateAmendmentInput({ title: "   ", body: "x" })).toEqual({
      ok: false,
      error: "title_required",
    });
    expect(validateAmendmentInput({ title: "x", body: "   " })).toEqual({
      ok: false,
      error: "body_required",
    });
  });
  it("rejects over-long title/body", () => {
    expect(validateAmendmentInput({ title: "a".repeat(AMENDMENT_TITLE_MAX + 1), body: "x" })).toEqual(
      { ok: false, error: "title_too_long" },
    );
    expect(validateAmendmentInput({ title: "x", body: "a".repeat(AMENDMENT_BODY_MAX + 1) })).toEqual(
      { ok: false, error: "body_too_long" },
    );
  });
});
