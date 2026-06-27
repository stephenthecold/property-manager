import { describe, it, expect } from "vitest";
import {
  DEFAULT_TURNOVER_ITEMS,
  OPEN_TURNOVER_STATUSES,
  TURNOVER_STATUSES,
  deriveTurnoverStatus,
  isTurnoverOpen,
  parseTurnoverStatus,
  turnoverProgress,
  turnoverStatusBadgeClass,
  turnoverStatusLabel,
} from "@/lib/maintenance/turnover-status";

describe("isTurnoverOpen", () => {
  it("is true for the non-terminal states", () => {
    expect(isTurnoverOpen("open")).toBe(true);
    expect(isTurnoverOpen("in_progress")).toBe(true);
  });

  it("is false for the terminal ready state", () => {
    expect(isTurnoverOpen("ready")).toBe(false);
  });

  it("agrees with OPEN_TURNOVER_STATUSES exactly", () => {
    for (const s of TURNOVER_STATUSES) {
      expect(isTurnoverOpen(s)).toBe(OPEN_TURNOVER_STATUSES.includes(s));
    }
  });
});

describe("parseTurnoverStatus", () => {
  it("accepts known statuses", () => {
    expect(parseTurnoverStatus("open")).toBe("open");
    expect(parseTurnoverStatus("in_progress")).toBe("in_progress");
    expect(parseTurnoverStatus("ready")).toBe("ready");
  });

  it("returns null for blank/unknown", () => {
    expect(parseTurnoverStatus("")).toBeNull();
    expect(parseTurnoverStatus(null)).toBeNull();
    expect(parseTurnoverStatus("bogus")).toBeNull();
  });
});

describe("turnoverStatusLabel + turnoverStatusBadgeClass", () => {
  it("labels every status", () => {
    expect(turnoverStatusLabel("open")).toBe("Open");
    expect(turnoverStatusLabel("in_progress")).toBe("In progress");
    expect(turnoverStatusLabel("ready")).toBe("Ready");
  });

  it("gives every status a themed tint with a dark: variant", () => {
    for (const s of TURNOVER_STATUSES) {
      const cls = turnoverStatusBadgeClass(s);
      expect(cls.length).toBeGreaterThan(0);
      // Every colored tint must carry a dark: variant (CLAUDE.md UI rule).
      expect(cls.includes("dark:") || cls.includes("muted")).toBe(true);
    }
  });
});

describe("turnoverProgress", () => {
  it("counts done items and computes percent", () => {
    const items = [{ done: true }, { done: false }, { done: true }, { done: false }];
    expect(turnoverProgress(items)).toEqual({ done: 2, total: 4, percent: 50 });
  });

  it("is 0/0 = 0% for an empty checklist (no divide-by-zero)", () => {
    expect(turnoverProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("rounds the percent", () => {
    // 1 of 3 -> 33%
    expect(turnoverProgress([{ done: true }, { done: false }, { done: false }]).percent).toBe(33);
  });
});

describe("deriveTurnoverStatus", () => {
  it("is open when nothing is done", () => {
    expect(deriveTurnoverStatus([{ done: false }, { done: false }])).toBe("open");
  });

  it("is in_progress when some but not all are done", () => {
    expect(deriveTurnoverStatus([{ done: true }, { done: false }])).toBe("in_progress");
  });

  it("is ready only when every item is done (and there is at least one)", () => {
    expect(deriveTurnoverStatus([{ done: true }, { done: true }])).toBe("ready");
  });

  it("treats an empty checklist as open (not ready)", () => {
    expect(deriveTurnoverStatus([])).toBe("open");
  });
});

describe("DEFAULT_TURNOVER_ITEMS", () => {
  it("seeds a non-empty template with labels + areas", () => {
    expect(DEFAULT_TURNOVER_ITEMS.length).toBeGreaterThan(0);
    for (const it of DEFAULT_TURNOVER_ITEMS) {
      expect(it.label.length).toBeGreaterThan(0);
      expect(it.area.length).toBeGreaterThan(0);
    }
  });
});
