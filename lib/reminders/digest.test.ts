import { describe, it, expect } from "vitest";
import {
  formatOverdueDigest,
  isoWeekKey,
  type OverdueDigestRow,
} from "@/lib/reminders/digest";

const NOW = new Date("2026-06-12T14:00:00Z");

function row(overrides: Partial<OverdueDigestRow> = {}): OverdueDigestRow {
  return {
    tenantName: "Dana Smith",
    propertyName: "Maple St",
    unitLabel: "2B",
    pastDueCents: 150000n,
    balanceCents: 150000n,
    currency: "USD",
    daysSinceLastPayment: null,
    ...overrides,
  };
}

describe("formatOverdueDigest / empty guard", () => {
  it("returns null when there are no rows", () => {
    expect(
      formatOverdueDigest({ businessName: "Acme", now: NOW, rows: [] }),
    ).toBeNull();
  });
});

describe("formatOverdueDigest / subject", () => {
  it("pluralizes for multiple tenants and totals their past due", () => {
    const digest = formatOverdueDigest({
      businessName: "Property Manager",
      now: NOW,
      rows: [
        row({ pastDueCents: 150000n }),
        row({ tenantName: "Lee Park", pastDueCents: 200000n }),
        row({ tenantName: "Ana Ruiz", pastDueCents: 75000n }),
      ],
    });
    expect(digest!.subject).toBe(
      "Overdue rent: 3 tenants owe $4,250.00 — Property Manager",
    );
  });

  it("uses the singular form for one tenant", () => {
    const digest = formatOverdueDigest({
      businessName: "Acme",
      now: NOW,
      rows: [row({ pastDueCents: 150000n })],
    });
    expect(digest!.subject).toBe("Overdue rent: 1 tenant owes $1,500.00 — Acme");
  });
});

describe("formatOverdueDigest / body", () => {
  it("renders one line per tenant in the documented format", () => {
    const digest = formatOverdueDigest({
      businessName: "Acme",
      now: NOW,
      rows: [row()],
    });
    expect(digest!.text).toContain(
      "Dana Smith — Maple St · 2B — $1,500.00 past due",
    );
  });

  it("sorts lines by pastDue descending", () => {
    const digest = formatOverdueDigest({
      businessName: "Acme",
      now: NOW,
      rows: [
        row({ tenantName: "Small Debt", pastDueCents: 5000n, balanceCents: 5000n }),
        row({ tenantName: "Big Debt", pastDueCents: 900000n, balanceCents: 900000n }),
        row({ tenantName: "Mid Debt", pastDueCents: 40000n, balanceCents: 40000n }),
      ],
    });
    const lines = digest!.text.split("\n");
    const order = ["Big Debt", "Mid Debt", "Small Debt"].map((name) =>
      lines.findIndex((l) => l.startsWith(name)),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("breaks pastDue ties by tenant name for deterministic output", () => {
    const digest = formatOverdueDigest({
      businessName: "Acme",
      now: NOW,
      rows: [
        row({ tenantName: "Zoe Tie" }),
        row({ tenantName: "Abe Tie" }),
      ],
    });
    const text = digest!.text;
    expect(text.indexOf("Abe Tie")).toBeLessThan(text.indexOf("Zoe Tie"));
  });

  it("includes a total line summing past due across tenants", () => {
    const digest = formatOverdueDigest({
      businessName: "Acme",
      now: NOW,
      rows: [
        row({ pastDueCents: 150000n }),
        row({ tenantName: "Lee Park", pastDueCents: 25n }),
      ],
    });
    expect(digest!.text).toContain(
      "Total past due: $1,500.25 across 2 tenants.",
    );
    expect(digest!.totalPastDueCents).toBe(150025n);
  });

  it("appends balance and aging extras only when they add information", () => {
    const digest = formatOverdueDigest({
      businessName: "Acme",
      now: NOW,
      rows: [
        row({
          tenantName: "Extras Tenant",
          pastDueCents: 150000n,
          balanceCents: 155000n,
          daysSinceLastPayment: 45,
        }),
        row({ tenantName: "Plain Tenant" }),
      ],
    });
    expect(digest!.text).toContain(
      "Extras Tenant — Maple St · 2B — $1,500.00 past due (balance $1,550.00, last payment 45 days ago)",
    );
    expect(digest!.text).toContain(
      "Plain Tenant — Maple St · 2B — $1,500.00 past due\n",
    );
  });

  it("ends with a link-free footer naming the business", () => {
    const digest = formatOverdueDigest({
      businessName: "Sunrise Rentals",
      now: NOW,
      rows: [row()],
    });
    const lines = digest!.text.split("\n");
    expect(lines[lines.length - 1]).toBe(
      "Sent by Sunrise Rentals property manager — weekly overdue digest",
    );
    expect(digest!.text).not.toMatch(/https?:\/\//);
  });

  it("stamps the body with the UTC date of the run", () => {
    const digest = formatOverdueDigest({
      businessName: "Acme",
      now: NOW,
      rows: [row()],
    });
    expect(digest!.text.split("\n")[0]).toBe(
      "Overdue rent as of 2026-06-12 — 1 tenant:",
    );
  });
});

describe("isoWeekKey", () => {
  it("formats a mid-year date as its ISO week", () => {
    expect(isoWeekKey(new Date("2026-06-12T09:00:00Z"))).toBe("2026-W24");
  });

  it("pads single-digit weeks", () => {
    expect(isoWeekKey(new Date("2026-01-07T00:00:00Z"))).toBe("2026-W02");
  });

  it("uses the ISO week-numbering year across the December boundary", () => {
    // Mon 2025-12-29 belongs to ISO week 1 of 2026.
    expect(isoWeekKey(new Date("2025-12-29T12:00:00Z"))).toBe("2026-W01");
  });

  it("uses the ISO week-numbering year across the January boundary", () => {
    // Fri 2027-01-01 belongs to ISO week 53 of 2026.
    expect(isoWeekKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
});
