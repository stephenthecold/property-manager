import { describe, expect, it } from "vitest";
import { resolveLayout, sanitizeLayout, DASHBOARD_SECTION_IDS } from "./layout";

const KNOWN = ["stats", "vacancy", "tenants", "payments"];

describe("resolveLayout", () => {
  it("defaults to the canonical order, nothing collapsed", () => {
    expect(resolveLayout(null)).toEqual({ order: [...DASHBOARD_SECTION_IDS], collapsed: {} });
  });

  it("honors a saved order and collapsed flags", () => {
    const r = resolveLayout({ order: ["payments", "stats"], collapsed: { vacancy: true } });
    // saved-known first (payments, stats), then remaining known ids appended
    expect(r.order).toEqual(["payments", "stats", "vacancy", "tenants"]);
    expect(r.collapsed).toEqual({ vacancy: true });
  });

  it("drops unknown ids and de-dupes", () => {
    const r = resolveLayout({ order: ["bogus", "tenants", "tenants", "vacancy"] }, KNOWN);
    expect(r.order).toEqual(["tenants", "vacancy", "stats", "payments"]);
  });

  it("ignores non-true / unknown collapsed values", () => {
    const r = resolveLayout({ collapsed: { stats: "yes", bogus: true, payments: false } });
    expect(r.collapsed).toEqual({});
  });

  it("a newly-added known section appears expanded at the end", () => {
    // saved layout from before "payments" existed
    const r = resolveLayout({ order: ["stats", "vacancy", "tenants"] }, KNOWN);
    expect(r.order).toEqual(["stats", "vacancy", "tenants", "payments"]);
    expect(r.collapsed.payments).toBeUndefined();
  });

  it("tolerates garbage input", () => {
    expect(resolveLayout("nope").order).toEqual([...DASHBOARD_SECTION_IDS]);
    expect(resolveLayout({ order: 5, collapsed: 7 }).order).toEqual([...DASHBOARD_SECTION_IDS]);
  });

  it("sanitizeLayout clamps a client payload identically", () => {
    expect(sanitizeLayout({ order: ["payments"], collapsed: { payments: true } })).toEqual({
      order: ["payments", "stats", "vacancy", "tenants"],
      collapsed: { payments: true },
    });
  });
});
