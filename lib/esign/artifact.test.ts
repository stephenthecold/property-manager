import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  looksLikePng,
  renderSignedArtifactHtml,
  type SignedArtifactInput,
} from "@/lib/esign/artifact";

function baseInput(over: Partial<SignedArtifactInput> = {}): SignedArtifactInput {
  return {
    documentText: "1. TERM. The tenancy begins on June 1, 2026.",
    documentSha256: "ab".repeat(32),
    businessName: "Warren Properties",
    leaseLabel: "Unit 2B — Jane Doe",
    landlord: { name: "Stephen Warren", signedAtISO: "2026-06-12T10:00:00Z" },
    signers: [
      {
        name: "Jane Doe",
        signedAtISO: "2026-06-12T11:30:00Z",
        kind: "typed",
        signatureText: "Jane Doe",
        ip: "203.0.113.7",
      },
    ],
    completedAtISO: "2026-06-12T11:30:00Z",
    ...over,
  };
}

describe("escapeHtml", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHtml(`<a href="x" onload='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; onload=&#39;y&#39;&gt;&amp;",
    );
  });
});

describe("renderSignedArtifactHtml", () => {
  it("renders a self-contained document with all parties and evidence", () => {
    const html = renderSignedArtifactHtml(baseInput());
    expect(html).toContain("Warren Properties");
    expect(html).toContain("Unit 2B — Jane Doe");
    expect(html).toContain("Stephen Warren");
    expect(html).toContain("Jane Doe");
    expect(html).toContain("ab".repeat(32));
    expect(html).toContain("2026-06-12T11:30:00Z");
    expect(html).toContain("203.0.113.7");
    expect(html).toContain("The tenancy begins");
    // White-space preserving body so plain-text agreements keep their layout.
    expect(html).toContain("white-space: pre-wrap");
    // Self-contained: no external resources of any kind.
    expect(html).not.toMatch(/src="https?:/i);
    expect(html).not.toMatch(/href=/i);
    expect(html).not.toMatch(/<script/i);
  });

  it("escapes hostile agreement text (XSS)", () => {
    const html = renderSignedArtifactHtml(
      baseInput({
        documentText: `Hello <script>alert("xss")</script> & "quotes"`,
      }),
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  });

  it("escapes hostile signer and business names", () => {
    const html = renderSignedArtifactHtml(
      baseInput({
        businessName: `<img src=x onerror=alert(1)>`,
        signers: [
          {
            name: `Eve <b>bold</b>`,
            signedAtISO: "2026-06-12T11:30:00Z",
            kind: "typed",
            signatureText: `"><svg/onload=alert(2)>`,
          },
        ],
      }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).not.toContain("<svg/onload");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("embeds drawn signatures as data URLs and typed ones in cursive style", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    const html = renderSignedArtifactHtml(
      baseInput({
        landlord: {
          name: "Stephen Warren",
          signedAtISO: "2026-06-12T10:00:00Z",
          signatureImageDataUrl: dataUrl,
        },
        signers: [
          {
            name: "Jane Doe",
            signedAtISO: "2026-06-12T11:30:00Z",
            kind: "drawn",
            signatureImageDataUrl: dataUrl,
          },
          {
            name: "John Roe",
            signedAtISO: "2026-06-12T11:40:00Z",
            kind: "typed",
            signatureText: "John Q. Roe",
          },
        ],
      }),
    );
    expect(html.match(/<img class="sig-img" src="data:image\/png;base64,/g)?.length).toBe(2);
    expect(html).toContain('class="sig-typed"');
    expect(html).toContain("John Q. Roe");
    // Co-tenant labeling: first signer is Tenant, later ones Co-tenant.
    expect(html).toContain("Co-tenant");
  });

  it("falls back to the signer name when typed text is missing", () => {
    const html = renderSignedArtifactHtml(
      baseInput({
        signers: [
          { name: "Jane Doe", signedAtISO: "2026-06-12T11:30:00Z", kind: "typed" },
        ],
      }),
    );
    expect(html).toContain('<div class="sig-typed">Jane Doe</div>');
  });
});

describe("looksLikePng", () => {
  const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("accepts a buffer starting with the PNG magic bytes", () => {
    expect(looksLikePng(Buffer.concat([PNG_HEADER, Buffer.from("IHDR-ish")]))).toBe(true);
  });

  it("rejects arbitrary bytes, truncated headers, and embedded-late magic", () => {
    expect(looksLikePng(Buffer.from("not a png at all"))).toBe(false);
    expect(looksLikePng(PNG_HEADER.subarray(0, 4))).toBe(false);
    expect(looksLikePng(Buffer.concat([Buffer.from("x"), PNG_HEADER]))).toBe(false);
    expect(looksLikePng(Buffer.alloc(0))).toBe(false);
  });
});

describe("inline signature/initial markers", () => {
  it("stamps marks at every marker and skips the end signatures section", () => {
    const html = renderSignedArtifactHtml(
      baseInput({
        documentText:
          "Clause 1. {{tenant_initials}} {{landlord_initials}}\n\nLANDLORD:\n{{landlord_signature}}\nTENANTS:\n{{tenant_signatures}}",
        signers: [
          {
            name: "Jane Doe",
            signedAtISO: "2026-06-12T11:30:00Z",
            kind: "typed",
            signatureText: "Jane Doe",
            initialsKind: "typed",
            initialsText: "JD",
            ip: "203.0.113.7",
          },
        ],
      }),
    );
    // Inline marks present…
    expect(html).toContain(`class="ini-typed"`);
    expect(html).toContain(">JD<");
    // Landlord typed initials derived from the name (no saved image).
    expect(html).toContain(">SW<");
    // …and exactly one set of tenant signature blocks (inline, not appended).
    expect(html.match(/class="sig-block"/g)).toHaveLength(2); // landlord + 1 tenant
    expect(html).not.toContain("<h2>Signatures</h2>");
    // Evidence footer always remains.
    expect(html).toContain("Signing evidence");
  });

  it("renders drawn initials as embedded images", () => {
    const html = renderSignedArtifactHtml(
      baseInput({
        documentText: "Initial here: {{tenant_initials}}",
        signers: [
          {
            name: "Jane Doe",
            signedAtISO: "2026-06-12T11:30:00Z",
            kind: "typed",
            signatureText: "Jane Doe",
            initialsKind: "drawn",
            initialsImageDataUrl: "data:image/png;base64,QUJD",
          },
        ],
      }),
    );
    expect(html).toContain(`class="ini-img"`);
    expect(html).toContain("data:image/png;base64,QUJD");
    // No tenant_signatures marker → the appended signatures section stays.
    expect(html).toContain("<h2>Signatures</h2>");
  });

  it("keeps marker-free documents byte-identical in the body path", () => {
    const html = renderSignedArtifactHtml(baseInput());
    expect(html).toContain(
      `<section class="doc-text">1. TERM. The tenancy begins on June 1, 2026.</section>`,
    );
  });

  it("never lets tenant text smuggle markup through a marker boundary", () => {
    const html = renderSignedArtifactHtml(
      baseInput({
        documentText: `<script>alert(1)</script>{{tenant_initials}}<img src=x>`,
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x>");
  });
});
