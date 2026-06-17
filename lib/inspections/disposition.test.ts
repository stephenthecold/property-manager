import { describe, expect, it } from "vitest";
import {
  INSPECTION_TYPES,
  computeDisposition,
  inspectionStatusLabel,
  inspectionTypeLabel,
  isInspectionType,
  parseInspectionType,
} from "@/lib/inspections/disposition";

describe("inspections/disposition", () => {
  it("labels and parses types/statuses", () => {
    for (const t of INSPECTION_TYPES) expect(inspectionTypeLabel(t).length).toBeGreaterThan(0);
    expect(inspectionTypeLabel("move_out")).toBe("Move-out");
    expect(inspectionStatusLabel("completed")).toBe("Completed");
    expect(isInspectionType("move_in")).toBe(true);
    expect(isInspectionType("nope")).toBe(false);
    expect(parseInspectionType("move_out")).toBe("move_out");
    expect(parseInspectionType(null)).toBe("routine");
  });

  it("refunds the refundable deposit minus deductions", () => {
    const d = computeDisposition({
      depositTotalCents: 150000n,
      nonRefundableCents: 0n,
      deductionsCents: 40000n,
    });
    expect(d.refundableCents).toBe(150000n);
    expect(d.refundCents).toBe(110000n);
    expect(d.balanceOwedCents).toBe(0n);
  });

  it("excludes the non-refundable portion from the refund", () => {
    const d = computeDisposition({
      depositTotalCents: 150000n,
      nonRefundableCents: 50000n,
      deductionsCents: 30000n,
    });
    expect(d.refundableCents).toBe(100000n);
    expect(d.refundCents).toBe(70000n);
    expect(d.balanceOwedCents).toBe(0n);
  });

  it("reports a balance owed when deductions exceed the refundable deposit", () => {
    const d = computeDisposition({
      depositTotalCents: 100000n,
      nonRefundableCents: 0n,
      deductionsCents: 130000n,
    });
    expect(d.refundCents).toBe(0n);
    expect(d.balanceOwedCents).toBe(30000n);
  });

  it("never returns negative refundable when non-refundable exceeds total", () => {
    const d = computeDisposition({
      depositTotalCents: 50000n,
      nonRefundableCents: 80000n,
      deductionsCents: 0n,
    });
    expect(d.refundableCents).toBe(0n);
    expect(d.refundCents).toBe(0n);
  });
});
