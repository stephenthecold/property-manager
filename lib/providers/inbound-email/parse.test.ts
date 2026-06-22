import { describe, expect, it } from "vitest";
import {
  capBody,
  cleanMessageId,
  filterAttachments,
  htmlToText,
  syntheticMessageKey,
  MAX_ATTACHMENTS,
  MAX_BODY_LENGTH,
} from "@/lib/providers/inbound-email/parse";

describe("cleanMessageId", () => {
  it("strips angle brackets and whitespace", () => {
    expect(cleanMessageId("  <abc@host>  ")).toBe("abc@host");
  });
  it("returns null for empty / bracket-only / missing", () => {
    expect(cleanMessageId("")).toBeNull();
    expect(cleanMessageId(null)).toBeNull();
    expect(cleanMessageId("<>")).toBeNull();
  });
});

describe("syntheticMessageKey", () => {
  const base = {
    fromEmail: "a@b.com",
    subject: "Hi" as string | null,
    receivedAt: new Date("2026-06-01T10:00:00.000Z"),
    size: 100,
  };

  it("is deterministic and namespaced so it can't collide with a real Message-ID", () => {
    const k1 = syntheticMessageKey(base);
    const k2 = syntheticMessageKey({ ...base });
    expect(k1).toBe(k2);
    expect(k1.startsWith("synthetic:")).toBe(true);
  });

  it("changes when any input part changes", () => {
    expect(syntheticMessageKey(base)).not.toBe(
      syntheticMessageKey({ ...base, size: 101 }),
    );
    expect(syntheticMessageKey(base)).not.toBe(
      syntheticMessageKey({ ...base, subject: "Bye" }),
    );
  });

  it("is stable within the same second (so a re-poll keys the same row)", () => {
    expect(
      syntheticMessageKey({ ...base, receivedAt: new Date("2026-06-01T10:00:00.400Z") }),
    ).toBe(
      syntheticMessageKey({ ...base, receivedAt: new Date("2026-06-01T10:00:00.900Z") }),
    );
  });
});

describe("capBody", () => {
  it("caps to MAX_BODY_LENGTH and tolerates null", () => {
    expect(capBody("x".repeat(MAX_BODY_LENGTH + 50)).length).toBe(MAX_BODY_LENGTH);
    expect(capBody(null)).toBe("");
  });
});

describe("htmlToText", () => {
  it("drops tags + scripts and unescapes a few entities", () => {
    const t = htmlToText("<p>Hello &amp; <b>world</b></p><script>alert(1)</script>");
    expect(t).toContain("Hello &");
    expect(t).toContain("world");
    expect(t).not.toContain("<");
    expect(t).not.toContain("alert");
  });
});

describe("filterAttachments", () => {
  const buf = (n: number) => Buffer.alloc(n, 1);

  it("keeps pdfs/images and drops disallowed types", () => {
    const out = filterAttachments([
      { filename: "a.pdf", contentType: "application/pdf", content: buf(10) },
      { filename: "b.exe", contentType: "application/x-msdownload", content: buf(10) },
      { filename: "c.png", contentType: "image/png", content: buf(10) },
    ]);
    expect(out.map((a) => a.filename)).toEqual(["a.pdf", "c.png"]);
  });

  it("accepts octet-stream only when the filename looks like an allowed doc", () => {
    const out = filterAttachments([
      { filename: "scan.pdf", contentType: "application/octet-stream", content: buf(10) },
      { filename: "blob.bin", contentType: "application/octet-stream", content: buf(10) },
    ]);
    expect(out.map((a) => a.filename)).toEqual(["scan.pdf"]);
  });

  it("skips empty content and caps the per-message count", () => {
    expect(
      filterAttachments([
        { filename: "empty.png", contentType: "image/png", content: Buffer.alloc(0) },
      ]),
    ).toEqual([]);

    const many = Array.from({ length: MAX_ATTACHMENTS + 5 }, (_, i) => ({
      filename: `f${i}.png`,
      contentType: "image/png",
      content: buf(10),
    }));
    expect(filterAttachments(many).length).toBe(MAX_ATTACHMENTS);
  });
});
