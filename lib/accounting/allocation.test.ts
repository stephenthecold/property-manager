import { describe, it, expect } from "vitest";
import {
  agingFromOpenCharges,
  type ChargeInput,
  computeOpenCharges,
  netReversalsIntoCharges,
  planFifoAllocation,
} from "@/lib/accounting/allocation";

const TZ = "America/New_York";

const charges: ChargeInput[] = [
  { entryId: "jan", amountCents: 120000n, dueDate: new Date("2026-01-01T05:00:00Z") },
  { entryId: "feb", amountCents: 120000n, dueDate: new Date("2026-02-01T05:00:00Z") },
  { entryId: "mar", amountCents: 120000n, dueDate: new Date("2026-03-01T05:00:00Z") },
];

describe("computeOpenCharges", () => {
  it("nets allocations and sorts oldest-first", () => {
    const open = computeOpenCharges(charges, { jan: 120000n, feb: 50000n });
    expect(open.map((c) => c.entryId)).toEqual(["feb", "mar"]); // jan fully paid
    expect(open[0].outstandingCents).toBe(70000n);
    expect(open[1].outstandingCents).toBe(120000n);
  });
});

describe("netReversalsIntoCharges", () => {
  it("a full waive zeroes the charge's outstanding", () => {
    const netted = netReversalsIntoCharges(charges, [
      { amountCents: -120000n, reversesEntryId: "jan" },
    ]);
    const open = computeOpenCharges(netted, {});
    expect(open.map((c) => c.entryId)).toEqual(["feb", "mar"]); // jan settled
  });

  it("a partial waive reduces the outstanding", () => {
    const netted = netReversalsIntoCharges(charges, [
      { amountCents: -20000n, reversesEntryId: "jan" },
    ]);
    const open = computeOpenCharges(netted, {});
    expect(open[0]).toMatchObject({ entryId: "jan", outstandingCents: 100000n });
  });

  it("stacks multiple partial waives on the same charge", () => {
    const netted = netReversalsIntoCharges(charges, [
      { amountCents: -20000n, reversesEntryId: "jan" },
      { amountCents: -30000n, reversesEntryId: "jan" },
    ]);
    expect(netted.find((c) => c.entryId === "jan")?.amountCents).toBe(70000n);
  });

  it("interacts with existing allocations; outstanding never goes negative", () => {
    // jan: 120000 charged, 50000 already paid, 70000 waived => fully settled.
    const netted = netReversalsIntoCharges(charges, [
      { amountCents: -70000n, reversesEntryId: "jan" },
    ]);
    const open = computeOpenCharges(netted, { jan: 50000n });
    expect(open.map((c) => c.entryId)).toEqual(["feb", "mar"]);
    // Even over-reversed charges are simply filtered out (>0n), never negative.
    const over = computeOpenCharges(
      netReversalsIntoCharges(charges, [
        { amountCents: -130000n, reversesEntryId: "jan" },
      ]),
      { jan: 50000n },
    );
    expect(over.every((c) => c.outstandingCents > 0n)).toBe(true);
    expect(over.map((c) => c.entryId)).toEqual(["feb", "mar"]);
  });

  it("leaves charges without reversals unchanged", () => {
    expect(netReversalsIntoCharges(charges, [])).toEqual(charges);
    const netted = netReversalsIntoCharges(charges, [
      { amountCents: -10000n, reversesEntryId: "feb" },
    ]);
    expect(netted.find((c) => c.entryId === "jan")?.amountCents).toBe(120000n);
    expect(netted.find((c) => c.entryId === "mar")?.amountCents).toBe(120000n);
  });

  it("ignores reversals pointing at a non-charge id (e.g. a voided payment)", () => {
    const netted = netReversalsIntoCharges(charges, [
      { amountCents: -120000n, reversesEntryId: "some-payment-entry" },
      { amountCents: -5000n, reversesEntryId: null },
    ]);
    expect(netted).toEqual(charges);
  });
});

describe("planFifoAllocation", () => {
  it("applies a partial payment to the oldest charge", () => {
    const open = computeOpenCharges(charges, {});
    const plan = planFifoAllocation(100000n, open);
    expect(plan.allocations).toEqual([
      { chargeEntryId: "jan", amountCents: 100000n },
    ]);
    expect(plan.leftoverCents).toBe(0n);
  });

  it("spreads a larger payment across charges oldest-first", () => {
    const open = computeOpenCharges(charges, {});
    const plan = planFifoAllocation(250000n, open);
    expect(plan.allocations).toEqual([
      { chargeEntryId: "jan", amountCents: 120000n },
      { chargeEntryId: "feb", amountCents: 120000n },
      { chargeEntryId: "mar", amountCents: 10000n },
    ]);
    expect(plan.leftoverCents).toBe(0n);
  });

  it("returns leftover as credit when payment exceeds all charges", () => {
    const open = computeOpenCharges(charges, {});
    const plan = planFifoAllocation(400000n, open);
    expect(plan.allocations.reduce((s, a) => s + a.amountCents, 0n)).toBe(360000n);
    expect(plan.leftoverCents).toBe(40000n);
  });
});

describe("agingFromOpenCharges", () => {
  it("buckets outstanding by days past due", () => {
    const now = new Date("2026-04-05T12:00:00-04:00");
    const open = computeOpenCharges(charges, {});
    const aging = agingFromOpenCharges(open, now, TZ);
    // Jan 1 ~ 94 days (90+), Feb 1 ~ 63 days (61-90), Mar 1 ~ 35 days (31-60).
    expect(aging.d90plus).toBe(120000n);
    expect(aging.d61_90).toBe(120000n);
    expect(aging.d31_60).toBe(120000n);
    expect(aging.current).toBe(0n);
    expect(aging.total).toBe(360000n);
  });

  it("counts not-yet-due charges as current", () => {
    const future: ChargeInput[] = [
      { entryId: "fut", amountCents: 120000n, dueDate: new Date("2026-12-01T05:00:00Z") },
    ];
    const open = computeOpenCharges(future, {});
    const aging = agingFromOpenCharges(open, new Date("2026-06-01T12:00:00-04:00"), TZ);
    expect(aging.current).toBe(120000n);
    expect(aging.total).toBe(120000n);
  });
});
