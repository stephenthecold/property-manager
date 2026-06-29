import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { postPayment, voidPayment } from "@/lib/services/payments";
import { loadLeaseAccounting } from "@/lib/services/accounting";
import { netBalanceCents } from "@/lib/accounting/ledger";
import { writeAudit } from "@/lib/audit/audit";

/**
 * Integration tests against a real Postgres (DATABASE_URL from .env). Validates the
 * DB-level guarantees that unit tests cannot: partial unique indexes, payment
 * idempotency, append-only audit, and atomic void/reversal.
 */

const P = `itest-${Math.random().toString(36).slice(2, 8)}`;
const propertyId = `${P}-prop`;
const unitId = `${P}-unit`;
const tenantId = `${P}-tenant`;
const leaseId = `${P}-lease`;
const ACTOR = { actorType: "system" as const, actorId: null };

beforeAll(async () => {
  await prisma.property.create({
    data: { id: propertyId, name: `${P} Property`, timezone: "America/Chicago" },
  });
  await prisma.unit.create({
    data: { id: unitId, propertyId, unitNumber: "1", serviceStatus: "in_service" },
  });
  await prisma.tenant.create({
    data: { id: tenantId, firstName: "Test", lastName: P },
  });
  await prisma.lease.create({
    data: {
      id: leaseId,
      tenantId,
      unitId,
      startDate: new Date("2026-01-01T06:00:00Z"),
      rentAmountCents: 120000n,
      dueDay: 1,
      status: "active",
    },
  });
  // One rent charge for FIFO to apply against.
  await prisma.ledgerEntry.create({
    data: {
      leaseId,
      tenantId,
      entryType: "rent_charge",
      amountCents: 120000n,
      periodKey: "2026-01-01",
      effectiveDate: new Date("2026-01-01T06:00:00Z"),
      sourceType: "charge",
    },
  });
});

afterAll(async () => {
  // Lease cascade removes ledger entries, payments, and allocations.
  await prisma.lease.deleteMany({ where: { id: leaseId } });
  await prisma.property.deleteMany({ where: { id: propertyId } }); // cascades units/buildings
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("partial unique index: one rent_charge per (lease, period)", () => {
  it("rejects a duplicate rent_charge for the same period", async () => {
    await expect(
      prisma.ledgerEntry.create({
        data: {
          leaseId,
          tenantId,
          entryType: "rent_charge",
          amountCents: 120000n,
          periodKey: "2026-01-01", // duplicate
          effectiveDate: new Date("2026-01-01T06:00:00Z"),
          sourceType: "charge",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("payment idempotency", () => {
  it("a repeated idempotencyKey does not create a second payment", async () => {
    const key = `${P}-idem`;
    const first = await postPayment({
      leaseId,
      amountCents: 50000n,
      paymentDate: new Date("2026-01-05T06:00:00Z"),
      method: "cash",
      idempotencyKey: key,
      actor: ACTOR,
    });
    const second = await postPayment({
      leaseId,
      amountCents: 50000n,
      paymentDate: new Date("2026-01-05T06:00:00Z"),
      method: "cash",
      idempotencyKey: key,
      actor: ACTOR,
    });
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.alreadyExisted).toBe(true);

    const payments = await prisma.payment.count({ where: { idempotencyKey: key } });
    expect(payments).toBe(1);
    const paymentEntries = await prisma.ledgerEntry.count({
      where: { leaseId, entryType: "payment", sourceId: first.paymentId },
    });
    expect(paymentEntries).toBe(1);
  });
});

describe("void/reversal is atomic and append-only", () => {
  it("appends a reversal and restores the balance without deleting", async () => {
    const before = await loadLeaseAccounting(leaseId);
    const balBefore = netBalanceCents(before.entries);
    const countBefore = before.entries.length;

    const pay = await postPayment({
      leaseId,
      amountCents: 70000n,
      paymentDate: new Date("2026-01-06T06:00:00Z"),
      method: "check",
      idempotencyKey: `${P}-void`,
      actor: ACTOR,
    });
    const afterPay = await loadLeaseAccounting(leaseId);
    expect(netBalanceCents(afterPay.entries)).toBe(balBefore - 70000n);

    await voidPayment({ paymentId: pay.paymentId, reason: "itest", actor: ACTOR });
    const afterVoid = await loadLeaseAccounting(leaseId);

    // Balance back to pre-payment; payment + reversal both physically present.
    expect(netBalanceCents(afterVoid.entries)).toBe(balBefore);
    expect(afterVoid.entries.length).toBe(countBefore + 2); // payment + reversal
    const voided = await prisma.payment.findUnique({ where: { id: pay.paymentId } });
    expect(voided?.status).toBe("voided");
  });
});

describe("concurrent void writes exactly ONE reversal (CAS guard)", () => {
  it("two simultaneous voids of the same payment do not double-reverse", async () => {
    const before = await loadLeaseAccounting(leaseId);
    const balBefore = netBalanceCents(before.entries);

    const pay = await postPayment({
      leaseId,
      amountCents: 30000n,
      paymentDate: new Date("2026-01-07T06:00:00Z"),
      method: "cash",
      idempotencyKey: `${P}-cvoid`,
      actor: ACTOR,
    });

    // Fire both voids concurrently: the lock-free findUnique means both can read
    // status="posted"; the compare-and-swap must let exactly one win. Without it
    // (the pre-fix code) BOTH would append a reversal and the balance would be
    // over-corrected by one payment.
    const results = await Promise.allSettled([
      voidPayment({ paymentId: pay.paymentId, reason: "race-a", actor: ACTOR }),
      voidPayment({ paymentId: pay.paymentId, reason: "race-b", actor: ACTOR }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    // Exactly one reversal for this payment — never two.
    const reversals = await prisma.ledgerEntry.count({
      where: { sourceType: "payment", sourceId: pay.paymentId, entryType: "reversal" },
    });
    expect(reversals).toBe(1);

    // Net balance returns to pre-payment (payment -30000 + one reversal +30000).
    const after = await loadLeaseAccounting(leaseId);
    expect(netBalanceCents(after.entries)).toBe(balBefore);

    const voided = await prisma.payment.findUnique({ where: { id: pay.paymentId } });
    expect(voided?.status).toBe("voided");
  });
});

describe("AuditLog is append-only", () => {
  it("blocks UPDATE via the DB trigger", async () => {
    await writeAudit(prisma, {
      actorType: "system",
      action: "itest.audit",
      entityType: "Test",
      entityId: P,
    });
    const row = await prisma.auditLog.findFirst({
      where: { action: "itest.audit", entityId: P },
    });
    expect(row).toBeTruthy();
    await expect(
      prisma.auditLog.update({
        where: { id: row!.id },
        data: { action: "tampered" },
      }),
    ).rejects.toThrow();
  });
});
