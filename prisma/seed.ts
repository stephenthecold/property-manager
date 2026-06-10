import "dotenv/config";
import { prisma } from "@/lib/db";
import { generateChargesForLease, assessLateFeesForLease } from "@/lib/services/billing";
import { postPayment, voidPayment } from "@/lib/services/payments";
import { ensureReceiptForPayment } from "@/lib/services/receipts";
import type { Lease } from "@/lib/generated/prisma/client";

/**
 * Idempotent seed (fixed ids, upserts). Re-runnable. Exercises the full ledger
 * matrix: fully paid, partial, overdue + late fee, overpayment credit, and a
 * void/reversal pair, across occupied + vacant units and three RBAC users.
 */

const NOW = new Date();
const RENT = 120000n; // $1,200
const SYSTEM = { actorType: "system" as const, actorId: null };

async function main() {
  // --- Users (RBAC) ---
  for (const u of [
    { email: "owner@example.com", name: "Olivia Owner", role: "owner" as const },
    { email: "manager@example.com", name: "Marco Manager", role: "manager" as const },
    { email: "viewer@example.com", name: "Vera Viewer", role: "viewer" as const },
  ]) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: u,
      update: { name: u.name, role: u.role },
    });
  }

  // --- Properties / buildings / units ---
  const props = [
    { id: "seed-prop-oak", name: "Oak Street Apartments", city: "Springfield", state: "IL" },
    { id: "seed-prop-maple", name: "Maple Court", city: "Madison", state: "WI" },
  ];
  for (const p of props) {
    await prisma.property.upsert({
      where: { id: p.id },
      create: { ...p, timezone: "America/Chicago", currency: "USD" },
      update: { name: p.name, city: p.city, state: p.state },
    });
    for (const b of ["A", "B"]) {
      const bid = `${p.id}-bldg-${b}`;
      await prisma.building.upsert({
        where: { id: bid },
        create: { id: bid, propertyId: p.id, name: `Building ${b}` },
        update: { name: `Building ${b}` },
      });
      for (let n = 1; n <= 4; n++) {
        const uid = `${bid}-unit-${n}`;
        await prisma.unit.upsert({
          where: { id: uid },
          create: {
            id: uid,
            propertyId: p.id,
            buildingId: bid,
            unitNumber: `${b}${n}0${n}`,
            unitType: "apartment",
            bedrooms: 2,
            bathrooms: 1,
            defaultRentAmountCents: RENT,
            occupancyStatus: "vacant",
          },
          update: {},
        });
      }
    }
  }

  // --- Tenants + leases (scenarios) ---
  // unit ids: seed-prop-oak-bldg-A-unit-1 ... maple-bldg-B-unit-4
  const scenarios: Array<{
    key: string;
    first: string;
    last: string;
    unitId: string;
    dueDay: number;
    scenario: "paid" | "partial" | "overdue" | "credit" | "void" | "draft";
  }> = [
    { key: "a", first: "Alice", last: "Adams", unitId: "seed-prop-oak-bldg-A-unit-1", dueDay: 1, scenario: "paid" },
    { key: "b", first: "Ben", last: "Brooks", unitId: "seed-prop-oak-bldg-A-unit-2", dueDay: 8, scenario: "partial" },
    { key: "c", first: "Carla", last: "Cole", unitId: "seed-prop-oak-bldg-B-unit-1", dueDay: 1, scenario: "overdue" },
    { key: "d", first: "Dan", last: "Diaz", unitId: "seed-prop-oak-bldg-B-unit-2", dueDay: 1, scenario: "credit" },
    { key: "e", first: "Ella", last: "Evans", unitId: "seed-prop-maple-bldg-A-unit-1", dueDay: 1, scenario: "void" },
    { key: "f", first: "Frank", last: "Ford", unitId: "seed-prop-maple-bldg-A-unit-2", dueDay: 1, scenario: "paid" },
    { key: "g", first: "Gina", last: "Gray", unitId: "seed-prop-maple-bldg-B-unit-1", dueDay: 1, scenario: "partial" },
    { key: "h", first: "Hank", last: "Hill", unitId: "seed-prop-maple-bldg-B-unit-2", dueDay: 1, scenario: "draft" },
  ];

  const start = new Date("2026-03-01T06:00:00Z"); // ~3 months of history

  for (const s of scenarios) {
    const tid = `seed-tenant-${s.key}`;
    await prisma.tenant.upsert({
      where: { id: tid },
      create: {
        id: tid,
        firstName: s.first,
        lastName: s.last,
        phone: `555-01${s.key.charCodeAt(0)}0`,
        email: `${s.first.toLowerCase()}@example.com`,
        smsConsent: true,
      },
      update: { firstName: s.first, lastName: s.last },
    });

    const lid = `seed-lease-${s.key}`;
    const status = s.scenario === "draft" ? "draft" : "active";
    const lease = await prisma.lease.upsert({
      where: { id: lid },
      create: {
        id: lid,
        tenantId: tid,
        unitId: s.unitId,
        startDate: start,
        rentAmountCents: RENT,
        dueDay: s.dueDay,
        gracePeriodDays: 5,
        lateFeeType: "fixed",
        lateFeeAmountCents: 5000n,
        securityDepositCents: RENT,
        status,
      },
      update: { status, dueDay: s.dueDay },
    });
    await prisma.unit.update({
      where: { id: s.unitId },
      data: { occupancyStatus: status === "active" ? "occupied" : "vacant" },
    });

    if (status !== "active") continue;

    await generateChargesForLease(lease as Lease, "America/Chicago", NOW);
    await applyScenario(s.scenario, lease.id, s.key);
    await assessLateFeesForLease(lease as Lease, "America/Chicago", NOW);
  }

  // Mark one vacant unit as under maintenance for variety.
  await prisma.unit.update({
    where: { id: "seed-prop-oak-bldg-A-unit-3" },
    data: { occupancyStatus: "maintenance" },
  });

  // Phase 2: digital receipts. postPayment auto-creates them for NEW payments;
  // this backfills receipts when re-seeding a DB whose payments already existed.
  // Voided payments are excluded — their receipt would postdate the reversal.
  const postedPayments = await prisma.payment.findMany({
    where: { status: "posted" },
  });
  for (const p of postedPayments) {
    await ensureReceiptForPayment(p.id, SYSTEM);
  }

  console.log("Seed complete.");
}

async function applyScenario(
  scenario: string,
  leaseId: string,
  key: string,
): Promise<void> {
  const pay = (amount: bigint, suffix: string, date = NOW) =>
    postPayment({
      leaseId,
      amountCents: amount,
      paymentDate: date,
      method: "check",
      idempotencyKey: `seed-pay-${key}-${suffix}`,
      actor: SYSTEM,
    });

  switch (scenario) {
    case "paid":
      await pay(RENT * 4n, "full"); // covers all generated periods
      break;
    case "partial":
      await pay(RENT * 3n + RENT / 2n, "partial"); // 3.5 months
      break;
    case "overdue":
      await pay(RENT * 2n, "twomonths"); // leaves recent periods unpaid -> late fees
      break;
    case "credit":
      await pay(RENT * 5n, "overpay"); // overpayment -> tenant credit
      break;
    case "void": {
      const r = await pay(RENT * 2n, "tovoid");
      const p = await prisma.payment.findUnique({ where: { id: r.paymentId } });
      if (p && p.status === "posted") {
        await voidPayment({
          paymentId: r.paymentId,
          reason: "Seed: demonstrate void/reversal",
          actor: SYSTEM,
        });
      }
      break;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
