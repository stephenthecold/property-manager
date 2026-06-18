import { describe, expect, it } from "vitest";
import {
  resolveLayout,
  sanitizeLayout,
  DASHBOARD_BUBBLE_IDS,
  DASHBOARD_SECTION_IDS,
} from "./layout";

describe("resolveLayout", () => {
  it("defaults to canonical order, nothing collapsed/hidden", () => {
    expect(resolveLayout(null)).toEqual({
      bubbleOrder: [...DASHBOARD_BUBBLE_IDS],
      sectionOrder: [...DASHBOARD_SECTION_IDS],
      collapsed: {},
      hidden: {},
    });
  });

  it("honors saved bubble/section order, collapsed, and hidden", () => {
    const r = resolveLayout({
      bubbleOrder: ["overdue", "net_month"],
      sectionOrder: ["payments", "vacancy"],
      collapsed: { tenants: true },
      hidden: { collected_today: true, tenants: true },
    });
    expect(r.bubbleOrder.slice(0, 2)).toEqual(["overdue", "net_month"]);
    expect(r.bubbleOrder).toHaveLength(DASHBOARD_BUBBLE_IDS.length);
    // saved order first, then any not-yet-saved known sections appended
    expect(r.sectionOrder).toEqual(["payments", "vacancy", "lease_expirations", "tenants"]);
    expect(r.sectionOrder).toHaveLength(DASHBOARD_SECTION_IDS.length);
    expect(r.collapsed).toEqual({ tenants: true });
    expect(r.hidden).toEqual({ collected_today: true, tenants: true });
  });

  it("migrates the legacy { order } (with a dropped 'stats') into sectionOrder", () => {
    const r = resolveLayout({ order: ["stats", "payments", "vacancy", "tenants"], collapsed: { vacancy: true } });
    // dropped "stats", legacy order kept, then the newer "lease_expirations" appended
    expect(r.sectionOrder).toEqual(["payments", "vacancy", "tenants", "lease_expirations"]);
    expect(r.collapsed).toEqual({ vacancy: true });
    expect(r.bubbleOrder).toEqual([...DASHBOARD_BUBBLE_IDS]); // bubbles default on
    expect(r.hidden).toEqual({});
  });

  it("drops unknown ids, de-dupes, ignores non-true flags", () => {
    const r = resolveLayout({
      bubbleOrder: ["bogus", "overdue", "overdue"],
      hidden: { overdue: true, bogus: true, vacancy: "yes" },
      collapsed: { payments: false, nope: true },
    });
    expect(r.bubbleOrder[0]).toBe("overdue");
    expect(r.bubbleOrder.filter((b) => b === "overdue")).toHaveLength(1);
    expect(r.hidden).toEqual({ overdue: true });
    expect(r.collapsed).toEqual({});
  });

  it("a newly-added bubble/section appears at the end, visible", () => {
    const r = resolveLayout(
      { bubbleOrder: ["overdue"], sectionOrder: ["vacancy"] },
      { bubbleIds: ["overdue", "occupied_units"], sectionIds: ["vacancy", "payments"] },
    );
    expect(r.bubbleOrder).toEqual(["overdue", "occupied_units"]);
    expect(r.sectionOrder).toEqual(["vacancy", "payments"]);
  });

  it("tolerates garbage", () => {
    expect(resolveLayout("nope").sectionOrder).toEqual([...DASHBOARD_SECTION_IDS]);
    expect(resolveLayout({ bubbleOrder: 5, hidden: 7 }).hidden).toEqual({});
  });

  it("sanitizeLayout clamps a client payload identically", () => {
    expect(
      sanitizeLayout({ bubbleOrder: ["overdue"], hidden: { overdue: true } }).hidden,
    ).toEqual({ overdue: true });
  });
});
