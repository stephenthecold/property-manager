import { describe, it, expect } from "vitest";
import {
  formatExpirationDigest,
  formatMaintenanceDigest,
  formatOverdueDigest,
  isoWeekKey,
  type ExpirationDigestRow,
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

describe("formatMaintenanceDigest", () => {
  const now = new Date("2026-06-12T09:00:00Z");

  it("returns null when nothing is scheduled", () => {
    expect(
      formatMaintenanceDigest({ businessName: "Acme", now, jobs: [], tasks: [] }),
    ).toBeNull();
  });

  it("renders jobs and tasks in date order with overdue + monthly markers", () => {
    const digest = formatMaintenanceDigest({
      businessName: "Acme",
      now,
      jobs: [
        {
          title: "Fix gutter",
          propertyName: "Maple St",
          unitLabel: "2B",
          dueISO: "2026-06-15",
          overdue: false,
        },
        {
          title: "Replace filter",
          propertyName: "Maple St",
          unitLabel: null,
          dueISO: "2026-06-10",
          overdue: true,
        },
      ],
      tasks: [
        { title: "Spraying", propertyName: "Oak Ave", dueISO: "2026-06-14" },
      ],
    });
    expect(digest).not.toBeNull();
    expect(digest!.subject).toBe(
      "Maintenance this week: 3 items (1 overdue) — Acme",
    );
    const text = digest!.text;
    // Jobs sorted by date: the overdue one first, flagged.
    expect(text.indexOf("2026-06-10 — Replace filter — Maple St (OVERDUE)")).toBeGreaterThan(-1);
    expect(text.indexOf("2026-06-15 — Fix gutter — Maple St · 2B")).toBeGreaterThan(
      text.indexOf("Replace filter"),
    );
    expect(text).toContain("2026-06-14 — Spraying — Oak Ave (monthly)");
  });

  it("singularizes one item and omits the overdue suffix when none are", () => {
    const digest = formatMaintenanceDigest({
      businessName: "Acme",
      now,
      jobs: [],
      tasks: [{ title: "Mowing", propertyName: "Oak Ave", dueISO: "2026-06-13" }],
    });
    expect(digest!.subject).toBe("Maintenance this week: 1 item — Acme");
    expect(digest!.text).not.toContain("Jobs:");
  });
});

describe("formatExpirationDigest", () => {
  const now = new Date("2026-06-12T09:00:00Z");

  function expRow(
    overrides: Partial<ExpirationDigestRow> = {},
  ): ExpirationDigestRow {
    return {
      tenantName: "Dana Smith",
      propertyName: "Maple St",
      unitLabel: "2B",
      endISO: "2026-07-30",
      daysUntilExpiry: 48,
      state: "upcoming",
      ...overrides,
    };
  }

  it("returns null when nothing is expiring", () => {
    expect(
      formatExpirationDigest({
        businessName: "Acme",
        now,
        windowDays: 60,
        rows: [],
      }),
    ).toBeNull();
  });

  it("counts leases, echoes the window, and flags expired ones in the subject", () => {
    const digest = formatExpirationDigest({
      businessName: "Acme",
      now,
      windowDays: 90,
      rows: [
        expRow({ daysUntilExpiry: 10, state: "expiring_soon" }),
        expRow({ tenantName: "Lee Park", daysUntilExpiry: -3, state: "expired" }),
      ],
    });
    expect(digest!.subject).toBe(
      "Leases expiring: 2 in the next 90 days (1 expired) — Acme",
    );
  });

  it("uses the singular and omits the expired suffix when none are past", () => {
    const digest = formatExpirationDigest({
      businessName: "Acme",
      now,
      windowDays: 60,
      rows: [expRow()],
    });
    expect(digest!.subject).toBe("Lease expiring: 1 in the next 60 days — Acme");
  });

  it("sorts soonest-first and marks expired rows in the body", () => {
    const digest = formatExpirationDigest({
      businessName: "Acme",
      now,
      windowDays: 60,
      rows: [
        expRow({ tenantName: "Later", endISO: "2026-07-30", daysUntilExpiry: 48 }),
        expRow({
          tenantName: "Past",
          endISO: "2026-06-09",
          daysUntilExpiry: -3,
          state: "expired",
        }),
        expRow({ tenantName: "Soon", endISO: "2026-06-20", daysUntilExpiry: 8, state: "expiring_soon" }),
      ],
    });
    const lines = digest!.text.split("\n");
    const order = ["Past", "Soon", "Later"].map((n) =>
      lines.findIndex((l) => l.includes(n)),
    );
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(digest!.text).toContain(
      "2026-06-09 — Past — Maple St · 2B — 3 days ago (EXPIRED)",
    );
    expect(digest!.text).toContain(
      "2026-06-20 — Soon — Maple St · 2B — in 8 days",
    );
  });

  it("ends with a link-free footer naming the business", () => {
    const digest = formatExpirationDigest({
      businessName: "Sunrise Rentals",
      now,
      windowDays: 60,
      rows: [expRow()],
    });
    const lines = digest!.text.split("\n");
    expect(lines[lines.length - 1]).toBe(
      "Sent by Sunrise Rentals property manager — weekly lease-expiration digest",
    );
    expect(digest!.text).not.toMatch(/https?:\/\//);
  });
});
