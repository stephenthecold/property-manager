import { describe, expect, it } from "vitest";
import {
  documentHasInlineSignatures,
  documentNeedsInitials,
  initialsFromName,
  markerPassthroughVars,
  splitOnMarkers,
} from "@/lib/esign/markers";

describe("splitOnMarkers", () => {
  it("returns a single text part when there are no markers", () => {
    expect(splitOnMarkers("plain agreement text")).toEqual([
      { type: "text", value: "plain agreement text" },
    ]);
  });

  it("splits text and markers in order, preserving whitespace", () => {
    const parts = splitOnMarkers(
      "Clause 1. {{tenant_initials}}\n\nSigned:\n{{tenant_signatures}}",
    );
    expect(parts).toEqual([
      { type: "text", value: "Clause 1. " },
      { type: "marker", marker: "tenant_initials" },
      { type: "text", value: "\n\nSigned:\n" },
      { type: "marker", marker: "tenant_signatures" },
    ]);
  });

  it("tolerates inner whitespace and repeated markers", () => {
    const parts = splitOnMarkers("{{ landlord_initials }}x{{landlord_initials}}");
    expect(parts).toEqual([
      { type: "marker", marker: "landlord_initials" },
      { type: "text", value: "x" },
      { type: "marker", marker: "landlord_initials" },
    ]);
  });

  it("leaves unknown placeholders alone as text", () => {
    expect(splitOnMarkers("{{rent}} and {{not_a_marker}}")).toEqual([
      { type: "text", value: "{{rent}} and {{not_a_marker}}" },
    ]);
  });
});

describe("marker predicates", () => {
  it("detects initials and inline-signature needs", () => {
    expect(documentNeedsInitials("a {{tenant_initials}} b")).toBe(true);
    expect(documentNeedsInitials("a {{tenant_signatures}} b")).toBe(false);
    expect(documentHasInlineSignatures("x {{tenant_signatures}}")).toBe(true);
    expect(documentHasInlineSignatures("x")).toBe(false);
  });
});

describe("markerPassthroughVars", () => {
  it("maps every marker to its own literal", () => {
    expect(markerPassthroughVars().tenant_initials).toBe("{{tenant_initials}}");
    expect(markerPassthroughVars().landlord_signature).toBe("{{landlord_signature}}");
  });
});

describe("initialsFromName", () => {
  it("takes the first letter of each word, uppercased", () => {
    expect(initialsFromName("Kevin Winsett")).toBe("KW");
    expect(initialsFromName("ana maría de la cruz")).toBe("AMDL");
    expect(initialsFromName("  Cher ")).toBe("C");
  });

  it("ignores punctuation-only words", () => {
    expect(initialsFromName("Mary-Jane O'Hara")).toBe("MO");
    expect(initialsFromName("")).toBe("");
  });
});
