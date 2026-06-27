import { describe, expect, it } from "vitest";
import {
  CHECKLIST_STATUSES,
  checklistStatusClass,
  checklistStatusLabel,
  isChecklistStatus,
  parseChecklistStatus,
  tallyChecklist,
} from "@/lib/inspections/checklist";

describe("inspections/checklist", () => {
  it("labels and parses every status", () => {
    for (const s of CHECKLIST_STATUSES)
      expect(checklistStatusLabel(s).length).toBeGreaterThan(0);
    expect(checklistStatusLabel("na")).toBe("N/A");
    expect(checklistStatusLabel("pass")).toBe("Pass");
  });

  it("validates and parses status strings safely", () => {
    expect(isChecklistStatus("fail")).toBe(true);
    expect(isChecklistStatus("nope")).toBe(false);
    expect(parseChecklistStatus("pass")).toBe("pass");
    expect(parseChecklistStatus(null)).toBe("pending");
    expect(parseChecklistStatus("garbage")).toBe("pending");
    expect(parseChecklistStatus("garbage", "na")).toBe("na");
  });

  it("gives every status a non-empty class with a dark variant where tinted", () => {
    for (const s of CHECKLIST_STATUSES) {
      const cls = checklistStatusClass(s);
      expect(cls.length).toBeGreaterThan(0);
      // na uses theme tokens (no literal tint); the rest carry dark: variants.
      if (s !== "na") expect(cls).toContain("dark:");
    }
  });

  it("tallies items by status", () => {
    const t = tallyChecklist([
      { status: "pass" },
      { status: "pass" },
      { status: "fail" },
      { status: "na" },
      { status: "pending" },
    ]);
    expect(t).toEqual({ total: 5, pass: 2, fail: 1, na: 1, pending: 1 });
    expect(tallyChecklist([])).toEqual({ total: 0, pass: 0, fail: 0, na: 0, pending: 0 });
  });
});
