import { describe, it, expect } from "vitest";
import { deriveStatus, type StatusInput } from "@/lib/accounting/status";

const TZ = "America/New_York";
const base: StatusInput = {
  occupancy: "occupied",
  hasActiveLease: true,
  currentPeriodOutstandingCents: 0n,
  currentPeriodPaidCents: 0n,
  currentPeriodDueDate: new Date("2026-06-01T04:00:00Z"),
  gracePeriodDays: 5,
  tz: TZ,
  now: new Date("2026-06-03T12:00:00-04:00"),
};

describe("deriveStatus precedence", () => {
  it("vacant beats everything", () => {
    expect(deriveStatus({ ...base, occupancy: "vacant" })).toBe("vacant");
  });

  it("occupied but no active lease", () => {
    expect(
      deriveStatus({ ...base, occupancy: "occupied", hasActiveLease: false }),
    ).toBe("no_active_lease");
  });

  it("paid when nothing outstanding", () => {
    expect(deriveStatus({ ...base, currentPeriodOutstandingCents: 0n })).toBe(
      "paid",
    );
  });

  it("overdue when past due + grace and still owing", () => {
    expect(
      deriveStatus({
        ...base,
        currentPeriodOutstandingCents: 120000n,
        now: new Date("2026-06-20T12:00:00-04:00"),
      }),
    ).toBe("overdue");
  });

  it("partially_paid when some applied this period and still owing within grace", () => {
    expect(
      deriveStatus({
        ...base,
        currentPeriodOutstandingCents: 70000n,
        currentPeriodPaidCents: 50000n,
      }),
    ).toBe("partially_paid");
  });

  it("due_soon when owing, nothing applied, within grace", () => {
    expect(
      deriveStatus({
        ...base,
        currentPeriodOutstandingCents: 120000n,
        currentPeriodPaidCents: 0n,
      }),
    ).toBe("due_soon");
  });

  it("a tenant with prior arrears but current period paid is NOT mislabeled overdue", () => {
    // Current period fully covered; global arrears are surfaced elsewhere, not here.
    expect(
      deriveStatus({ ...base, currentPeriodOutstandingCents: 0n }),
    ).toBe("paid");
  });
});
