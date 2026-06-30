import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  postManualLedgerEntry,
  reverseManualLedgerEntry,
} from "@/lib/services/manual-charge";
import { loadLeaseAccounting } from "@/lib/services/accounting";
import { netBalanceCents } from "@/lib/accounting/ledger";

/**
 * Integration test (real Postgres): staff-posted ledger charges/credits — the
 * right entry type + sign, idempotency, the prorate-as-rent anchor + collision
 * guard, credit FIFO allocation, and reversal.
 */

const P = `itest-mc-${Math.random().toString(36).slice(2, 8)}`;
const propertyId = `${P}-prop`;
const unitId = `${P}-unit`;
const tenantId = `${P}-tenant`;
const leaseId = `${P}-lease`;
const ACTOR = { actorType: "system" as const, actorId: null };

async function balance(): Promise<bigint> {
  return netBalanceCents((await loadLeaseAccounting(leaseId)).entries);
}

beforeAll(async () => {
  await prisma.property.create({
    data: { id: propertyId, name: `${P} Property`, timezone: "America/Chicago" },
  });
  await prisma.unit.create({
    data: { id: unitId, propertyId, unitNumber: "1", serviceStatus: "in_service" },
  });
  await prisma.tenant.create({ data: { id: tenantId, firstName: "Test", lastName: P } });
  await prisma.lease.create({
    data: {
      id: leaseId,
      tenantId,
      unitId,
      startDate: new Date("2026-01-15T06:00:00Z"), // mid-month → a move-in prorate exists
      rentAmountCents: 120000n,
      dueDay: 1,
      status: "active",
      securityDepositCents: 150000n,
    },
  });
  // A full-period rent charge for a credit to FIFO-allocate against.
  await prisma.ledgerEntry.create({
    data: {
      leaseId,
      tenantId,
      entryType: "rent_charge",
      amountCents: 120000n,
      periodKey: "2026-02-01",
      effectiveDate: new Date("2026-02-01T06:00:00Z"),
      sourceType: "charge",
    },
  });
});

afterAll(async () => {
  // Lease cascade removes ledger entries + allocations. AuditLog is append-only
  // (the posts/reverse wrote rows) — left in place, like the other suites.
  await prisma.lease.deleteMany({ where: { id: leaseId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("postManualLedgerEntry", () => {
  it("posts a deposit as a balance-only adjustment and is idempotent on the token", async () => {
    const before = await balance();
    const r = await postManualLedgerEntry({
      leaseId,
      category: "security_deposit",
      amountCents: 150000n,
      effectiveDate: new Date("2026-01-20T06:00:00Z"),
      note: "move-in",
      idempotencyKey: `${P}-dep`,
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const entry = await prisma.ledgerEntry.findUnique({ where: { id: r.entryId } });
    expect(entry?.entryType).toBe("adjustment");
    expect(entry?.amountCents).toBe(150000n);
    expect(await balance()).toBe(before + 150000n);

    // Replay with the same token → the same entry, no second charge.
    const replay = await postManualLedgerEntry({
      leaseId,
      category: "security_deposit",
      amountCents: 150000n,
      effectiveDate: new Date("2026-01-20T06:00:00Z"),
      note: "move-in",
      idempotencyKey: `${P}-dep`,
      actor: ACTOR,
    });
    expect(replay.ok && replay.alreadyExisted).toBe(true);
    const count = await prisma.ledgerEntry.count({
      where: { sourceType: "manual_charge", sourceId: `${P}-dep` },
    });
    expect(count).toBe(1);
  });

  it("posts prorated rent as a rent_charge at the move-in anchor; a second is blocked", async () => {
    const r = await postManualLedgerEntry({
      leaseId,
      category: "prorated_rent",
      amountCents: 65806n,
      effectiveDate: new Date("2026-01-15T06:00:00Z"),
      note: null,
      idempotencyKey: `${P}-pro`,
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const entry = await prisma.ledgerEntry.findUnique({ where: { id: r.entryId } });
    expect(entry?.entryType).toBe("rent_charge"); // counts as rent
    expect(entry?.periodKey).toBeTruthy(); // the otherwise-never-billed anchor
    expect(entry?.periodKey).not.toBe("2026-02-01"); // not the full-period slot

    // A second prorate (different token) collides with the anchor → blocked,
    // never a duplicate move-in charge.
    const second = await postManualLedgerEntry({
      leaseId,
      category: "prorated_rent",
      amountCents: 65806n,
      effectiveDate: new Date("2026-01-15T06:00:00Z"),
      note: null,
      idempotencyKey: `${P}-pro2`,
      actor: ACTOR,
    });
    expect(second.ok).toBe(false);
  });

  it("posts a credit that reduces the balance and FIFO-allocates against open charges", async () => {
    const before = await balance();
    const r = await postManualLedgerEntry({
      leaseId,
      category: "credit",
      amountCents: 50000n,
      effectiveDate: new Date("2026-02-02T06:00:00Z"),
      note: "concession",
      idempotencyKey: `${P}-cr`,
      actor: ACTOR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const entry = await prisma.ledgerEntry.findUnique({ where: { id: r.entryId } });
    expect(entry?.entryType).toBe("credit");
    expect(entry?.amountCents).toBe(-50000n);
    expect(await balance()).toBe(before - 50000n);
    const allocations = await prisma.chargeAllocation.count({
      where: { paymentEntryId: r.entryId },
    });
    expect(allocations).toBeGreaterThan(0); // retired an open charge
  });

  it("reverses a manual entry (restoring the balance) and is idempotent", async () => {
    const dep = await prisma.ledgerEntry.findFirstOrThrow({
      where: { sourceType: "manual_charge", sourceId: `${P}-dep` },
    });
    const before = await balance();
    const rev = await reverseManualLedgerEntry({
      entryId: dep.id,
      reason: "posted in error",
      actor: ACTOR,
    });
    expect(rev.ok).toBe(true);
    expect(await balance()).toBe(before - 150000n); // deposit backed out

    const again = await reverseManualLedgerEntry({
      entryId: dep.id,
      reason: "posted in error",
      actor: ACTOR,
    });
    expect(again.ok && again.alreadyReversed).toBe(true);
    const reversals = await prisma.ledgerEntry.count({
      where: { entryType: "reversal", reversesEntryId: dep.id },
    });
    expect(reversals).toBe(1); // exactly one reversal, never two
  });
});
