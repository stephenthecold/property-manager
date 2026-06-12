import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  collapseSplitPlaceholders,
  escapeXml,
  fillDocxTemplate,
} from "@/lib/documents/docx-fill";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const W_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body}</w:body></w:document>`;
}

/** Minimal in-memory .docx: [Content_Types].xml + word/document.xml (+ extras). */
async function makeDocx(
  body: string,
  extraParts: Record<string, string> = {},
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("word/document.xml", documentXml(body));
  for (const [name, content] of Object.entries(extraParts)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

async function readPart(buf: Buffer, name = "word/document.xml"): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.files[name];
  if (!file) throw new Error(`missing part ${name}`);
  return file.async("string");
}

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`A & B <C> "q" 'a'`)).toBe(
      "A &amp; B &lt;C&gt; &quot;q&quot; &#39;a&#39;",
    );
  });
});

describe("fillDocxTemplate", () => {
  it("replaces a simple same-run placeholder", async () => {
    const docx = await makeDocx(
      `<w:p><w:r><w:t>Rent is {{rent}} monthly.</w:t></w:r></w:p>`,
    );
    const out = await readPart(await fillDocxTemplate(docx, { rent: "$1,200.00" }));
    expect(out).toContain("Rent is $1,200.00 monthly.");
    expect(out).not.toContain("{{rent}}");
  });

  it("allows whitespace inside the braces", async () => {
    const docx = await makeDocx(`<w:p><w:r><w:t>Hello {{ tenant_names }}!</w:t></w:r></w:p>`);
    const out = await readPart(
      await fillDocxTemplate(docx, { tenant_names: "Jane Doe" }),
    );
    expect(out).toContain("Hello Jane Doe!");
  });

  it("XML-escapes substituted values", async () => {
    const docx = await makeDocx(`<w:p><w:r><w:t>{{notes}}</w:t></w:r></w:p>`);
    const out = await readPart(
      await fillDocxTemplate(docx, { notes: `Water & sewer <included> "yes"` }),
    );
    expect(out).toContain("Water &amp; sewer &lt;included&gt; &quot;yes&quot;");
    expect(out).not.toContain("<included>");
  });

  it("leaves unknown placeholders intact (typos stay visible)", async () => {
    const docx = await makeDocx(
      `<w:p><w:r><w:t>{{rent}} and {{not_a_var}}</w:t></w:r></w:p>`,
    );
    const out = await readPart(await fillDocxTemplate(docx, { rent: "$900.00" }));
    expect(out).toContain("$900.00 and {{not_a_var}}");
  });

  it("collapses a placeholder Word split across runs and fills it", async () => {
    const docx = await makeDocx(
      `<w:p><w:r><w:t>Rent: {{re</w:t></w:r><w:r><w:t>nt}}</w:t></w:r><w:r><w:t> due monthly</w:t></w:r></w:p>`,
    );
    const out = await readPart(await fillDocxTemplate(docx, { rent: "$1,500.00" }));
    expect(out).toContain("Rent: $1,500.00");
    // The spanned characters were removed from the trailing run, not duplicated.
    expect(out).not.toContain("nt}}");
    expect(out).toContain(" due monthly");
  });

  it("handles a placeholder split across three runs", async () => {
    const docx = await makeDocx(
      `<w:p><w:r><w:t>{{</w:t></w:r><w:r><w:t>due_</w:t></w:r><w:r><w:t>day}}</w:t></w:r></w:p>`,
    );
    const out = await readPart(await fillDocxTemplate(docx, { due_day: "1st" }));
    expect(out).toContain(">1st</w:t>");
    expect(out).not.toContain("{{");
  });

  it("handles two placeholders sharing a run boundary", async () => {
    const docx = await makeDocx(
      `<w:p><w:r><w:t>{{a}}{{</w:t></w:r><w:r><w:t>b}}</w:t></w:r></w:p>`,
    );
    const out = await readPart(await fillDocxTemplate(docx, { a: "ONE", b: "TWO" }));
    expect(out).toContain("ONETWO");
  });

  it("fills headers and footers too", async () => {
    const header = `<?xml version="1.0"?><w:hdr ${W_NS}><w:p><w:r><w:t>{{business_name}}</w:t></w:r></w:p></w:hdr>`;
    const footer = `<?xml version="1.0"?><w:ftr ${W_NS}><w:p><w:r><w:t>{{property_name}}</w:t></w:r></w:p></w:ftr>`;
    const docx = await makeDocx(`<w:p><w:r><w:t>body</w:t></w:r></w:p>`, {
      "word/header1.xml": header,
      "word/footer1.xml": footer,
    });
    const filled = await fillDocxTemplate(docx, {
      business_name: "Acme Rentals",
      property_name: "Maple Court",
    });
    expect(await readPart(filled, "word/header1.xml")).toContain("Acme Rentals");
    expect(await readPart(filled, "word/footer1.xml")).toContain("Maple Court");
  });

  it("rejects an archive without word/document.xml", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", CONTENT_TYPES);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    await expect(fillDocxTemplate(buf, {})).rejects.toThrow(/document\.xml/);
  });

  it("rejects a non-zip buffer", async () => {
    await expect(
      fillDocxTemplate(Buffer.from("not a zip"), {}),
    ).rejects.toThrow();
  });
});

describe("collapseSplitPlaceholders", () => {
  it("does not alter paragraphs without spanning placeholders", () => {
    const xml = `<w:p><w:r><w:t>plain {{x}} text</w:t></w:r><w:r><w:t>more</w:t></w:r></w:p>`;
    expect(collapseSplitPlaceholders(xml)).toBe(xml);
  });

  it("marks emptied runs with xml:space='preserve'", () => {
    const xml = `<w:p><w:r><w:t>{{sp</w:t></w:r><w:r><w:t>lit}} tail</w:t></w:r></w:p>`;
    const out = collapseSplitPlaceholders(xml);
    expect(out).toContain(`<w:t xml:space="preserve">{{split}}</w:t>`);
    expect(out).toContain(`<w:t xml:space="preserve"> tail</w:t>`);
  });
});
