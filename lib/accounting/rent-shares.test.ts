import { describe, expect, it } from "vitest";
import {
  expectedByPayer,
  payerKey,
  reconcileExpectations,
  type RentShareInput,
  sharesEffectiveAt,
  sharesTotalCents,
  splitMatchesExpected,
} from "@/lib/accounting/rent-shares";

const HA = "payer_ha";

function share(p: Partial<RentShareInput>): RentShareInput {
  return {
    payerId: null,
    label: "x",
    amountCents: 0n,
    effectiveDate: new Date("2026-01-01T00:00:00Z"),
    endDate: null,
    ...p,
  };
}

describe("rent-shares", () => {
  const tenant = share({ payerId: null, label: "Tenant portion", amountCents: 20000n });
  const subsidy = share({ payerId: HA, label: "HAP subsidy", amountCents: 80000n });

  it("keys the tenant portion as the empty string", () => {
    expect(payerKey(null)).toBe("");
    expect(payerKey(HA)).toBe(HA);
  });

  it("totals and groups by payer", () => {
    expect(sharesTotalCents([tenant, subsidy])).toBe(100000n);
    const by = expectedByPayer([tenant, subsidy]);
    expect(by.get("")).toBe(20000n);
    expect(by.get(HA)).toBe(80000n);
  });

  it("sums multiple lines for the same payer", () => {
    const by = expectedByPayer([
      share({ payerId: HA, amountCents: 50000n }),
      share({ payerId: HA, amountCents: 30000n }),
    ]);
    expect(by.get(HA)).toBe(80000n);
  });

  it("checks the split against the expected monthly charge", () => {
    expect(splitMatchesExpected([tenant, subsidy], 100000n)).toBe(true);
    expect(splitMatchesExpected([tenant, subsidy], 99900n)).toBe(false);
  });

  it("filters shares by effective window (inclusive start, exclusive end)", () => {
    const asOf = new Date("2026-06-15T00:00:00Z");
    const current = share({
      amountCents: 100n,
      effectiveDate: new Date("2026-06-01T00:00:00Z"),
      endDate: null,
    });
    const ended = share({
      amountCents: 200n,
      effectiveDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-06-01T00:00:00Z"),
    });
    const future = share({
      amountCents: 300n,
      effectiveDate: new Date("2026-07-01T00:00:00Z"),
      endDate: null,
    });
    const active = sharesEffectiveAt([current, ended, future], asOf);
    expect(active).toEqual([current]);
  });

  it("reconciles expected vs received and floors missing at 0", () => {
    // Tenant paid their $200; the housing authority's $800 HAP hasn't arrived.
    const received = new Map<string, bigint>([["", 20000n]]);
    const rows = reconcileExpectations([tenant, subsidy], received);
    const byPayer = Object.fromEntries(rows.map((r) => [r.payerId ?? "tenant", r]));
    expect(byPayer["tenant"].missingCents).toBe(0n);
    expect(byPayer[HA].missingCents).toBe(80000n);
    expect(byPayer[HA].receivedCents).toBe(0n);
  });

  it("treats an overpayment as not missing", () => {
    const received = new Map<string, bigint>([[HA, 90000n]]);
    const rows = reconcileExpectations([subsidy], received);
    expect(rows[0].missingCents).toBe(0n);
    expect(rows[0].receivedCents).toBe(90000n);
  });
});
