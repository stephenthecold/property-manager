import { describe, expect, it } from "vitest";
import {
  brandColorStyles,
  hexToOklchHue,
  isValidHexColor,
  readableTextColor,
  relativeLuminance,
} from "@/lib/config/brand";

describe("isValidHexColor", () => {
  it("accepts #rgb and #rrggbb", () => {
    expect(isValidHexColor("#abc")).toBe(true);
    expect(isValidHexColor("#2563EB")).toBe(true);
    expect(isValidHexColor("  #2563eb  ")).toBe(true);
  });
  it("rejects anything else", () => {
    for (const bad of ["2563eb", "#12", "#xyzxyz", "rgb(0,0,0)", ""]) {
      expect(isValidHexColor(bad)).toBe(false);
    }
  });
});

describe("hexToOklchHue", () => {
  // Reference hues for common Tailwind-500 colours (OKLCH), ±3° tolerance.
  it.each([
    ["#3b82f6", 262], // blue
    ["#ef4444", 27], // red
    ["#22c55e", 150], // green
    ["#f59e0b", 70], // amber
  ])("%s ≈ %i°", (hex, expected) => {
    const h = hexToOklchHue(hex);
    expect(h).not.toBeNull();
    expect(Math.abs((h as number) - expected)).toBeLessThanOrEqual(3);
  });

  it("expands 3-digit hex", () => {
    expect(hexToOklchHue("#00f")).toBeCloseTo(hexToOklchHue("#0000ff")!, 1);
  });

  it("returns null for greys (no meaningful hue) and invalid input", () => {
    expect(hexToOklchHue("#808080")).toBeNull();
    expect(hexToOklchHue("#ffffff")).toBeNull();
    expect(hexToOklchHue("#000000")).toBeNull();
    expect(hexToOklchHue("nope")).toBeNull();
  });
});

describe("brandColorStyles", () => {
  it("re-tints both themes to the colour's hue, keeping shipped L/C", () => {
    const css = brandColorStyles("#3b82f6");
    expect(css).not.toBeNull();
    const hue = hexToOklchHue("#3b82f6");
    // Light primary keeps L=0.45 C=0.14; dark primary keeps L=0.75 C=0.1.
    expect(css).toContain(`--primary: oklch(0.45 0.14 ${hue})`);
    expect(css).toContain(":root {");
    expect(css).toContain(".dark {");
    expect(css).toContain(`--primary: oklch(0.75 0.1 ${hue})`);
  });

  it("is null for unusable colours so the shipped palette stays", () => {
    expect(brandColorStyles("#808080")).toBeNull();
    expect(brandColorStyles("not-a-color")).toBeNull();
  });
});

describe("relativeLuminance / readableTextColor", () => {
  it("ranks black < mid < white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    const mid = relativeLuminance("#2563eb")!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("picks a light letter on dark brands and a dark letter on light brands", () => {
    expect(readableTextColor("#1d2a45")).toBe("#f1f5f9"); // navy → light text
    expect(readableTextColor("#2563eb")).toBe("#f1f5f9"); // blue-600 → light text
    expect(readableTextColor("#fde047")).toBe("#0b1220"); // yellow → dark text
    expect(readableTextColor("#ffffff")).toBe("#0b1220");
  });

  it("falls back to a light letter for an invalid colour", () => {
    expect(readableTextColor("nope")).toBe("#f1f5f9");
  });
});
