import { describe, expect, it } from "vitest";
import { availabilityWhen, formatBedsBaths } from "@/lib/services/public-site";
import { resolvePublicSiteGallery } from "@/lib/services/app-settings";

describe("formatBedsBaths", () => {
  it("joins present sides, omits a missing one, dashes when neither", () => {
    expect(formatBedsBaths(2, 1)).toBe("2 bd · 1 ba");
    expect(formatBedsBaths(2, null)).toBe("2 bd");
    expect(formatBedsBaths(null, 1.5)).toBe("1.5 ba");
    expect(formatBedsBaths(null, null)).toBe("—");
    // 0 is meaningful (a studio) — not treated as "missing".
    expect(formatBedsBaths(0, 1)).toBe("0 bd · 1 ba");
  });
});

describe("availabilityWhen", () => {
  it("is now / soon / a stable UTC date", () => {
    expect(availabilityWhen(true, null)).toBe("Available now");
    expect(availabilityWhen(true, new Date("2026-03-01T00:00:00Z"))).toBe("Available now");
    expect(availabilityWhen(false, null)).toBe("Available soon");
    expect(availabilityWhen(false, new Date("2026-03-01T12:00:00Z"))).toBe(
      "Available Mar 1, 2026",
    );
  });
});

describe("resolvePublicSiteGallery", () => {
  const id = (s: string) => s.padEnd(24, "0"); // 24-char, id-shaped

  it("accepts {id} objects and bare strings, de-dupes, drops junk", () => {
    const a = id("aaaa");
    const b = id("bbbb");
    expect(resolvePublicSiteGallery([{ id: a }, b, { id: a }])).toEqual([
      { id: a },
      { id: b },
    ]);
    expect(resolvePublicSiteGallery("nope")).toEqual([]);
    expect(resolvePublicSiteGallery([{ nope: 1 }, "short", 123, null])).toEqual([]);
  });

  it("caps the list at PUBLIC_SITE_GALLERY_MAX (30)", () => {
    const many = Array.from({ length: 70 }, (_, i) => id(`g${i}`));
    expect(resolvePublicSiteGallery(many)).toHaveLength(30);
  });
});
