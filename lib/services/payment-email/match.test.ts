import { describe, expect, it } from "vitest";
import { suggestLeaseId, type LeaseMatchOption } from "@/lib/services/payment-email/match";

const OPTS: LeaseMatchOption[] = [
  { leaseId: "L1", tenantFirst: "Ronnie", tenantLast: "Conner" },
  { leaseId: "L2", tenantFirst: "John", tenantLast: "Rich" },
  { leaseId: "L3", tenantFirst: "James", tenantLast: "Smith" },
  { leaseId: "L4", tenantFirst: "James", tenantLast: "Brown" },
];

describe("suggestLeaseId", () => {
  it("matches a unique full name", () => {
    expect(suggestLeaseId("Ronnie Conner", OPTS)).toBe("L1");
    expect(suggestLeaseId("John Rich", OPTS)).toBe("L2");
  });

  it("is case- and punctuation-insensitive", () => {
    expect(suggestLeaseId("john   RICH.", OPTS)).toBe("L2");
  });

  it("does NOT guess on a first name only (avoids wrong-credit)", () => {
    // Two tenants named James → ambiguous even if a last name appeared; with
    // only "James" we have a single token, so never match.
    expect(suggestLeaseId("James", OPTS)).toBeNull();
  });

  it("returns null when nothing matches or input is empty", () => {
    expect(suggestLeaseId("Nobody Here", OPTS)).toBeNull();
    expect(suggestLeaseId(null, OPTS)).toBeNull();
    expect(suggestLeaseId("RoseT070126R", OPTS)).toBeNull(); // invoice code
  });

  it("does not suggest when the full name is ambiguous across leases", () => {
    const dupes: LeaseMatchOption[] = [
      { leaseId: "A", tenantFirst: "James", tenantLast: "Smith" },
      { leaseId: "B", tenantFirst: "James", tenantLast: "Smith" },
    ];
    expect(suggestLeaseId("James Smith", dupes)).toBeNull();
  });
});
