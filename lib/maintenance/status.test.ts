import { describe, it, expect } from "vitest";
import {
  isOpenStatus,
  MAINTENANCE_STATUSES,
  OPEN_STATUSES,
  parseMaintenanceStatus,
  statusBadgeClass,
  statusLabel,
} from "@/lib/maintenance/status";

describe("isOpenStatus", () => {
  it("is true for the four non-terminal states", () => {
    for (const s of ["pending", "assigned", "in_progress", "on_hold"] as const) {
      expect(isOpenStatus(s)).toBe(true);
    }
  });

  it("is false for terminal states", () => {
    expect(isOpenStatus("completed")).toBe(false);
    expect(isOpenStatus("canceled")).toBe(false);
  });

  it("agrees with OPEN_STATUSES exactly", () => {
    for (const s of MAINTENANCE_STATUSES) {
      expect(isOpenStatus(s)).toBe(OPEN_STATUSES.includes(s));
    }
  });
});

describe("OPEN_STATUSES", () => {
  it("excludes completed and canceled", () => {
    expect(OPEN_STATUSES).not.toContain("completed");
    expect(OPEN_STATUSES).not.toContain("canceled");
  });
});

describe("parseMaintenanceStatus", () => {
  it("accepts known statuses", () => {
    expect(parseMaintenanceStatus("in_progress")).toBe("in_progress");
    expect(parseMaintenanceStatus("canceled")).toBe("canceled");
  });

  it("returns null for blank/unknown", () => {
    expect(parseMaintenanceStatus("")).toBeNull();
    expect(parseMaintenanceStatus(null)).toBeNull();
    expect(parseMaintenanceStatus("bogus")).toBeNull();
  });
});

describe("statusLabel + statusBadgeClass", () => {
  it("labels every status and underscores read as words", () => {
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(statusLabel("on_hold")).toBe("On hold");
    expect(statusLabel("pending")).toBe("Pending");
  });

  it("gives every status a themed tint with a dark: variant", () => {
    for (const s of MAINTENANCE_STATUSES) {
      const cls = statusBadgeClass(s);
      expect(cls.length).toBeGreaterThan(0);
      // Every colored tint must carry a dark: variant (CLAUDE.md UI rule);
      // the muted (canceled) tint is theme-aware via the token.
      expect(cls.includes("dark:") || cls.includes("muted")).toBe(true);
    }
  });
});
