import { describe, expect, it } from "vitest";
import {
  publicSiteReadiness,
  type PublicSiteReadinessInput,
} from "@/lib/services/public-site-readiness";

const COMPLETE: PublicSiteReadinessInput = {
  moduleEnabled: true,
  businessName: "New Edge Rentals",
  businessPhone: "+1 555 0100",
  businessEmail: "hello@newedgerentals.com",
  businessAddress: "600 Congress Ave, Austin TX",
  publicSiteIntro: "New Edge Rentals manages residential rentals in Austin.",
  publicSiteUrl: "https://newedgerentals.com",
};

describe("publicSiteReadiness", () => {
  it("reports ready when every carrier-required field is set", () => {
    const r = publicSiteReadiness(COMPLETE);
    expect(r.ready).toBe(true);
    expect(r.missingCount).toBe(0);
    expect(r.items.every((i) => i.ok)).toBe(true);
  });

  it("flags a blank brand as not ready, every item missing", () => {
    const r = publicSiteReadiness({
      moduleEnabled: false,
      businessName: "Property Manager",
      businessPhone: null,
      businessEmail: null,
      businessAddress: null,
      publicSiteIntro: null,
      publicSiteUrl: null,
    });
    expect(r.ready).toBe(false);
    expect(r.missingCount).toBe(r.items.length);
  });

  it("treats the default business name and whitespace-only fields as missing", () => {
    const r = publicSiteReadiness({
      ...COMPLETE,
      businessName: "Property Manager",
      businessPhone: "   ",
    });
    expect(r.items.find((i) => i.key === "name")?.ok).toBe(false);
    expect(r.items.find((i) => i.key === "phone")?.ok).toBe(false);
    expect(r.ready).toBe(false);
  });

  it("points each missing item at the right Settings page", () => {
    const r = publicSiteReadiness({ ...COMPLETE, moduleEnabled: false, publicSiteIntro: null });
    expect(r.items.find((i) => i.key === "module")?.fixHref).toBe("/settings/modules");
    expect(r.items.find((i) => i.key === "about")?.fixHref).toBe("/settings/public-site");
    expect(r.missingCount).toBe(2);
  });
});
