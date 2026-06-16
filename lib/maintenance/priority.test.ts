import { describe, it, expect } from "vitest";
import {
  MAINTENANCE_PRIORITIES,
  comparePriority,
  parseMaintenancePriority,
  priorityLabel,
} from "@/lib/maintenance/priority";

describe("parseMaintenancePriority", () => {
  it("accepts known priorities", () => {
    expect(parseMaintenancePriority("urgent")).toBe("urgent");
    expect(parseMaintenancePriority("low")).toBe("low");
  });

  it("falls back to normal for blank/unknown", () => {
    expect(parseMaintenancePriority("")).toBe("normal");
    expect(parseMaintenancePriority(null)).toBe("normal");
    expect(parseMaintenancePriority("bogus")).toBe("normal");
  });
});

describe("comparePriority", () => {
  it("orders most urgent first", () => {
    const shuffled = ["normal", "urgent", "low", "high"] as const;
    expect([...shuffled].sort(comparePriority)).toEqual([
      "urgent",
      "high",
      "normal",
      "low",
    ]);
  });

  it("matches the declared select order", () => {
    expect([...MAINTENANCE_PRIORITIES].sort(comparePriority)).toEqual(
      MAINTENANCE_PRIORITIES,
    );
  });
});

describe("priorityLabel", () => {
  it("title-cases each priority", () => {
    expect(priorityLabel("urgent")).toBe("Urgent");
    expect(priorityLabel("normal")).toBe("Normal");
  });
});
