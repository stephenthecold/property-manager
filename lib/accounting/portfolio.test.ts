import { describe, it, expect } from "vitest";
import {
  groupByEntity,
  UNASSIGNED_ENTITY_LABEL,
  type PortfolioRowInput,
} from "@/lib/accounting/portfolio";

/** Build a row, defaulting the money fields so a test only states what it cares
 *  about; netMonthCents is independent (the rollup sums whatever is passed). */
function row(overrides: Partial<PortfolioRowInput>): PortfolioRowInput {
  return {
    legalEntityName: null,
    expectedMonthlyCents: 0n,
    collectedMonthCents: 0n,
    mortgageMonthlyCents: 0n,
    insuranceMonthlyCents: 0n,
    taxesMonthlyCents: 0n,
    expensesMonthCents: 0n,
    netMonthCents: 0n,
    ...overrides,
  };
}

describe("groupByEntity", () => {
  it("returns no groups and a zero grand total for an empty input", () => {
    const { groups, grandTotal } = groupByEntity([]);
    expect(groups).toEqual([]);
    expect(grandTotal.collectedMonthCents).toBe(0n);
    expect(grandTotal.netMonthCents).toBe(0n);
  });

  it("buckets properties by entity and subtotals each money field", () => {
    const rows = [
      row({ legalEntityName: "Acme LLC", collectedMonthCents: 100_000n, netMonthCents: 40_000n }),
      row({ legalEntityName: "Acme LLC", collectedMonthCents: 50_000n, netMonthCents: 10_000n }),
      row({ legalEntityName: "Beta Holdings", collectedMonthCents: 70_000n, netMonthCents: 25_000n }),
    ];
    const { groups, grandTotal } = groupByEntity(rows);

    expect(groups.map((g) => g.entity)).toEqual(["Acme LLC", "Beta Holdings"]);
    const acme = groups[0];
    expect(acme.rows).toHaveLength(2);
    expect(acme.subtotal.collectedMonthCents).toBe(150_000n);
    expect(acme.subtotal.netMonthCents).toBe(50_000n);
    expect(groups[1].subtotal.collectedMonthCents).toBe(70_000n);

    expect(grandTotal.collectedMonthCents).toBe(220_000n);
    expect(grandTotal.netMonthCents).toBe(75_000n);
  });

  it("groups case-insensitively but keeps the first-seen spelling as the label", () => {
    const rows = [
      row({ legalEntityName: "Acme LLC", collectedMonthCents: 100n }),
      row({ legalEntityName: "  acme llc ", collectedMonthCents: 200n }),
    ];
    const { groups } = groupByEntity(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].entity).toBe("Acme LLC");
    expect(groups[0].subtotal.collectedMonthCents).toBe(300n);
  });

  it("puts null/blank entities in an Unassigned group, always sorted last", () => {
    const rows = [
      row({ legalEntityName: null, collectedMonthCents: 10n }),
      row({ legalEntityName: "   ", collectedMonthCents: 20n }),
      row({ legalEntityName: "Zeta LLC", collectedMonthCents: 5n }),
      row({ legalEntityName: "Acme LLC", collectedMonthCents: 5n }),
    ];
    const { groups } = groupByEntity(rows);
    expect(groups.map((g) => g.entity)).toEqual([
      "Acme LLC",
      "Zeta LLC",
      UNASSIGNED_ENTITY_LABEL,
    ]);
    const unassigned = groups[groups.length - 1];
    expect(unassigned.unassigned).toBe(true);
    expect(unassigned.rows).toHaveLength(2);
    expect(unassigned.subtotal.collectedMonthCents).toBe(30n);
  });

  it("orders named entities by collation, not insertion", () => {
    const rows = [
      row({ legalEntityName: "Bravo" }),
      row({ legalEntityName: "alpha" }),
      row({ legalEntityName: "Charlie" }),
    ];
    const { groups } = groupByEntity(rows);
    expect(groups.map((g) => g.entity)).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("sum of group subtotals equals the grand total (every money field)", () => {
    const rows = [
      row({
        legalEntityName: "A",
        expectedMonthlyCents: 1n,
        collectedMonthCents: 2n,
        mortgageMonthlyCents: 3n,
        insuranceMonthlyCents: 4n,
        taxesMonthlyCents: 5n,
        expensesMonthCents: 6n,
        netMonthCents: 7n,
      }),
      row({
        legalEntityName: null,
        expectedMonthlyCents: 10n,
        collectedMonthCents: 20n,
        mortgageMonthlyCents: 30n,
        insuranceMonthlyCents: 40n,
        taxesMonthlyCents: 50n,
        expensesMonthCents: 60n,
        netMonthCents: 70n,
      }),
    ];
    const { groups, grandTotal } = groupByEntity(rows);
    const keys = [
      "expectedMonthlyCents",
      "collectedMonthCents",
      "mortgageMonthlyCents",
      "insuranceMonthlyCents",
      "taxesMonthlyCents",
      "expensesMonthCents",
      "netMonthCents",
    ] as const;
    for (const k of keys) {
      const summed = groups.reduce((acc, g) => acc + g.subtotal[k], 0n);
      expect(summed).toBe(grandTotal[k]);
    }
  });
});
