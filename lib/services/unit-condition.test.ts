import { describe, expect, it } from "vitest";
import {
  CONDITION_PHASES,
  conditionPhaseLabel,
  isConditionPhase,
} from "@/lib/services/unit-condition";

describe("isConditionPhase", () => {
  it("accepts the four known phases and rejects anything else", () => {
    for (const p of CONDITION_PHASES) expect(isConditionPhase(p)).toBe(true);
    expect(isConditionPhase("move_in")).toBe(true);
    expect(isConditionPhase("eviction")).toBe(false);
    expect(isConditionPhase("")).toBe(false);
  });
});

describe("conditionPhaseLabel", () => {
  it("gives a human label for every phase (no raw enum leaks)", () => {
    expect(conditionPhaseLabel("move_in")).toBe("Move-in");
    expect(conditionPhaseLabel("move_out")).toBe("Move-out");
    expect(conditionPhaseLabel("turnover")).toBe("Turnover");
    expect(conditionPhaseLabel("other")).toBe("Other");
    for (const p of CONDITION_PHASES) {
      expect(conditionPhaseLabel(p)).not.toContain("_");
    }
  });
});
