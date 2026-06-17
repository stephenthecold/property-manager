import { describe, expect, it } from "vitest";
import {
  VENDOR_TRADES,
  isVendorTrade,
  parseVendorTrade,
  vendorTradeLabel,
} from "@/lib/vendors/vendor-trade";

describe("vendors/vendor-trade", () => {
  it("labels every trade", () => {
    for (const t of VENDOR_TRADES) expect(vendorTradeLabel(t).length).toBeGreaterThan(0);
    expect(vendorTradeLabel("hvac")).toBe("HVAC");
  });

  it("recognizes and parses trades with a safe fallback", () => {
    expect(isVendorTrade("plumbing")).toBe(true);
    expect(isVendorTrade("teleportation")).toBe(false);
    expect(parseVendorTrade("electrical")).toBe("electrical");
    expect(parseVendorTrade(null)).toBe("general");
    expect(parseVendorTrade("nope", "roofing")).toBe("roofing");
  });
});
