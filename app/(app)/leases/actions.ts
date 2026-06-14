"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { toCents } from "@/lib/money";
import { requireCapability, auditActor } from "@/lib/auth/session";
import { writeAudit, withAudit } from "@/lib/audit/audit";
import { generateChargesForLease } from "@/lib/services/billing";
import { daysBetween, parseDateOnlyInZone } from "@/lib/accounting/periods";
import { sanitizeUtilities } from "@/lib/config/lease";
import { getAppSettings } from "@/lib/services/app-settings";
import { parseDepositRows } from "@/lib/leases/deposits";
import { DateTime } from "luxon";
import type { LateFeeType, LeaseStatus } from "@/lib/generated/prisma/enums";
import type { FormState } from "@/lib/forms";

/**
 * Validation failures are RETURNED, never thrown: a thrown error in a server
 * action surfaces in production as the opaque "A server error occurred"
 * digest page instead of an inline message (see settings/billing/actions.ts).
 */
export interface CreateLeaseState {
  error?: string;
}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
function centsOrNull(v: string): bigint | null {
  if (!v) return null;
  try {
    return toCents(v);
  } catch {
    return null;
  }
}

/**
 * Parse + validate the shared late-fee fields (type, amount/rate/bps, daily
 * cap) with the same strictness as the billing-settings action: bad money
 * input throws instead of silently disabling fees.
 */
function parseLateFeeTerms(fd: FormData): {
  lateFeeType: LateFeeType;
  lateFeeAmountCents: bigint | null;
  lateFeeBps: number | null;
  lateFeeMaxCents: bigint | null;
} {
  const lateFeeType = (str(fd, "lateFeeType") || "none") as LateFeeType;
  let lateFeeAmountCents: bigint | null = null;
  let lateFeeBps: number | null = null;
  let lateFeeMaxCents: bigint | null = null;

  if (lateFeeType === "fixed" || lateFeeType === "daily") {
    const raw = str(fd, "lateFeeAmount");
    if (!raw) {
      throw new Error(
        lateFeeType === "daily"
          ? "Enter the daily late-fee rate."
          : "Enter the fixed late-fee amount.",
      );
    }
    lateFeeAmountCents = toCents(raw); // throws on garbage
    if (lateFeeAmountCents < 0n) throw new Error("Late fee cannot be negative.");
    if (lateFeeType === "daily") {
      const capRaw = str(fd, "lateFeeMax");
      if (capRaw) {
        lateFeeMaxCents = toCents(capRaw);
        if (lateFeeMaxCents < lateFeeAmountCents) {
          throw new Error("The daily cap must be at least one day's rate.");
        }
      }
    }
  } else if (lateFeeType === "percentage") {
    const bps = Number(str(fd, "lateFeeAmount") || "0");
    if (!Number.isInteger(bps) || bps < 1 || bps > 10000) {
      throw new Error("Late-fee percentage must be 1–10000 basis points (500 = 5%).");
    }
    lateFeeBps = bps;
  }

  return { lateFeeType, lateFeeAmountCents, lateFeeBps, lateFeeMaxCents };
}

export async function createLease(
  _prev: CreateLeaseState,
  fd: FormData,
): Promise<CreateLeaseState> {
  await requireCapability("leases.manage");
  const tenantId = str(fd, "tenantId");
  const unitId = str(fd, "unitId");
  const rentRaw = str(fd, "rentAmount");
  if (!tenantId || !unitId || !rentRaw) {
    return { error: "Tenant, unit, and rent amount are required." };
  }
  let rentAmountCents: bigint;
  try {
    rentAmountCents = toCents(rentRaw);
  } catch {
    return { error: "Monthly rent must be a valid amount (e.g. 1200.00)." };
  }
  if (rentAmountCents <= 0n) {
    return { error: "Monthly rent must be greater than zero." };
  }
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { property: true },
  });
  if (!unit) return { error: "Unit not found." };
  const tz = unit.property.timezone;

  // parseLateFeeTerms throws (it is shared with updateLease); surface its
  // message inline instead of letting it crash the action.
  let lateFeeTerms: ReturnType<typeof parseLateFeeTerms>;
  try {
    lateFeeTerms = parseLateFeeTerms(fd);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid late-fee terms." };
  }
  const { lateFeeType, lateFeeAmountCents, lateFeeBps, lateFeeMaxCents } =
    lateFeeTerms;

  const statusRaw = str(fd, "status") || "active";
  if (!["draft", "active", "month_to_month"].includes(statusRaw)) {
    return { error: "Status must be draft, active, or month-to-month." };
  }
  const status = statusRaw as LeaseStatus;

  const dueDay = Number(str(fd, "dueDay") || "1");
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return { error: "Due day must be between 1 and 31." };
  }
  const gracePeriodDays = Number(str(fd, "gracePeriodDays") || "0");
  if (!Number.isInteger(gracePeriodDays) || gracePeriodDays < 0) {
    return { error: "Grace period must be 0 or more days." };
  }

  const now = new Date();
  const startRaw = str(fd, "startDate");
  const startDate = startRaw
    ? (parseDateOnlyInZone(startRaw, tz) ?? new Date(startRaw))
    : now;
  if (Number.isNaN(startDate.getTime())) {
    return { error: "Start date must be a valid date." };
  }

  const endRaw = str(fd, "endDate");
  const endDate = endRaw ? parseDateOnlyInZone(endRaw, tz) : null;
  if (endRaw && !endDate) return { error: "End date must be a valid date." };

  // Backdated leases: optionally start billing at the NEXT due date instead
  // of back-filling every period since startDate, and post what the tenant
  // still owes (including any in-progress period) as an opening-balance
  // adjustment (0/empty = caught up).
  const billingStart = str(fd, "billingStart") || "start";
  const billingStartDate = billingStart === "current" ? now : null;
  const openingRaw = str(fd, "openingBalance");
  let openingBalanceCents: bigint;
  try {
    openingBalanceCents = openingRaw ? toCents(openingRaw) : 0n;
  } catch {
    return { error: "Opening balance must be a valid amount (e.g. 500.00)." };
  }
  if (openingBalanceCents < 0n) {
    return {
      error: "Opening balance cannot be negative (use a credit adjustment instead).",
    };
  }
  if (openingBalanceCents > 0n && billingStart !== "current") {
    return {
      error:
        "An opening balance only applies when billing starts at the next due date — " +
        "with full-history billing the back-filled charges already represent the past debt.",
    };
  }

  const securityRaw = str(fd, "securityDeposit");
  let securityDepositCents: bigint;
  try {
    securityDepositCents = securityRaw ? toCents(securityRaw) : 0n;
  } catch {
    return { error: "Security deposit must be a valid amount (e.g. 1200.00)." };
  }
  if (securityDepositCents < 0n) {
    return { error: "Security deposit cannot be negative." };
  }

  // Additional itemized deposits, serialized by the form into one JSON field.
  const depositsParsed = parseDepositRows(str(fd, "depositsJson"));
  if ("error" in depositsParsed) return { error: depositsParsed.error };
  const deposits = depositsParsed.deposits;

  // Internet add-on now lives on the LEASE; the fee falls back to the
  // org-wide default rate.
  const internetEnabled = fd.get("internetEnabled") === "on";
  const internetFeeRaw = str(fd, "internetFee");
  let internetFeeCents: bigint;
  try {
    internetFeeCents = internetFeeRaw
      ? toCents(internetFeeRaw)
      : (await getAppSettings()).billing.internetFeeCents;
  } catch {
    return { error: "Internet fee must be a valid amount (e.g. 25.00)." };
  }
  if (internetFeeCents < 0n) return { error: "Internet fee cannot be negative." };

  const utilitiesPaid = sanitizeUtilities(
    fd.getAll("utilities").map((v) => String(v)),
  );
  const prorateFirstPeriod = fd.get("prorateFirstPeriod") === "on";

  // Co-tenants: any additional tenants on the lease (primary excluded).
  const coTenantIds = [
    ...new Set(
      fd
        .getAll("coTenants")
        .map((v) => String(v).trim())
        .filter((id) => id && id !== tenantId),
    ),
  ];

  // The pickers hide occupied tenants, but never trust the UI: reject anyone
  // (primary or co-tenant) already on an active/month-to-month lease.
  const selectedIds = [tenantId, ...coTenantIds];
  const [selectedTenants, occupiedPrimary, occupiedCo] = await Promise.all([
    prisma.tenant.findMany({
      where: { id: { in: selectedIds } },
      select: { id: true },
    }),
    prisma.lease.findMany({
      where: {
        tenantId: { in: selectedIds },
        status: { in: ["active", "month_to_month"] },
      },
      select: { tenantId: true },
    }),
    prisma.leaseTenant.findMany({
      where: {
        tenantId: { in: selectedIds },
        lease: { status: { in: ["active", "month_to_month"] } },
      },
      select: { tenantId: true },
    }),
  ]);
  if (selectedTenants.length !== selectedIds.length) {
    return { error: "One or more selected tenants no longer exist." };
  }
  const occupied = new Set(
    [...occupiedPrimary, ...occupiedCo].map((r) => r.tenantId),
  );
  if (occupied.has(tenantId)) {
    return { error: "The selected tenant is already on an active lease." };
  }
  if (coTenantIds.some((id) => occupied.has(id))) {
    return { error: "One or more selected co-tenants are already on an active lease." };
  }

  let lease;
  try {
    lease = await prisma.$transaction(async (tx) => {
      const created = await tx.lease.create({
        data: {
          tenantId,
          unitId,
          startDate,
          endDate,
          billingStartDate,
          rentAmountCents,
          dueDay,
          gracePeriodDays,
          lateFeeType,
          lateFeeAmountCents,
          lateFeeBps,
          lateFeeMaxCents,
          securityDepositCents,
          internetEnabled,
          internetFeeCents,
          utilitiesPaid,
          utilitiesNotes: str(fd, "utilitiesNotes") || null,
          prorateFirstPeriod,
          status,
          notes: str(fd, "notes") || null,
        },
      });
      if (coTenantIds.length > 0) {
        await tx.leaseTenant.createMany({
          data: coTenantIds.map((id) => ({ leaseId: created.id, tenantId: id })),
        });
      }
      if (deposits.length > 0) {
        await tx.leaseDeposit.createMany({
          data: deposits.map((d) => ({
            leaseId: created.id,
            label: d.label,
            amountCents: d.amountCents,
            // Whole-deposit toggle, same rule as addLeaseDeposit.
            nonRefundableCents: d.nonRefundable ? d.amountCents : 0n,
          })),
        });
      }
      if (openingBalanceCents > 0n) {
        await tx.ledgerEntry.create({
          data: {
            leaseId: created.id,
            tenantId,
            entryType: "adjustment",
            amountCents: openingBalanceCents,
            effectiveDate: billingStartDate ?? startDate,
            sourceType: "opening_balance",
            description: "Opening balance (pre-existing debt at lease entry)",
          },
        });
      }
      await writeAudit(tx, {
        ...(await auditActor()),
        action: "lease.created",
        entityType: "Lease",
        entityId: created.id,
        after: {
          tenantId,
          unitId,
          status,
          coTenantIds,
          openingBalanceCents,
          billingStartDate,
          depositCount: deposits.length,
          depositLabels: deposits.map((d) => d.label),
        },
      });
      return created;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "That unit already has an active lease." };
    }
    throw e;
  }

  if (status === "active" || status === "month_to_month") {
    await prisma.unit.update({
      where: { id: unitId },
      data: { occupancyStatus: "occupied" },
    });
    await generateChargesForLease(lease, tz, now);
  }

  redirect(`/tenants/${tenantId}`);
}

/**
 * Edit a lease's billing terms. Changes affect FUTURE generated charges only
 * (already-billed periods are immutable); use a scheduled rent increase for
 * date-effective rate changes and renewLease for term/status changes. The due
 * day is locked once anything has been billed — periodKeys derive from it, so
 * changing it would re-key (and re-bill) every elapsed period.
 */
export async function updateLease(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("leases.manage");
  const leaseId = str(fd, "leaseId");
  if (!leaseId) return { error: "Missing lease id." };
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) return { error: "Lease not found." };

  const rentRaw = str(fd, "rentAmount");
  if (!rentRaw) return { error: "Monthly rent is required." };
  let rentAmountCents: bigint;
  try {
    rentAmountCents = toCents(rentRaw);
  } catch {
    return { error: "Monthly rent must be a valid amount (e.g. 1200.00)." };
  }
  if (rentAmountCents <= 0n) return { error: "Monthly rent must be positive." };

  const dueDay = Number(str(fd, "dueDay") || String(lease.dueDay));
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return { error: "Due day must be between 1 and 31." };
  }
  if (dueDay !== lease.dueDay) {
    const charged = await prisma.ledgerEntry.findFirst({
      where: { leaseId: lease.id, entryType: "rent_charge" },
      select: { id: true },
    });
    if (charged) {
      return {
        error:
          "The due day cannot be changed once rent has been charged — period " +
          "identity derives from it, and changing it would re-bill every past " +
          "period. End this lease and create a new one instead.",
      };
    }
  }
  const gracePeriodDays = Number(str(fd, "gracePeriodDays") || "0");
  if (!Number.isInteger(gracePeriodDays) || gracePeriodDays < 0) {
    return { error: "Grace period must be 0 or more days." };
  }

  let lateFeeTerms: ReturnType<typeof parseLateFeeTerms>;
  try {
    lateFeeTerms = parseLateFeeTerms(fd);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid late-fee terms." };
  }
  const { lateFeeType, lateFeeAmountCents, lateFeeBps, lateFeeMaxCents } =
    lateFeeTerms;

  const internetEnabled = fd.get("internetEnabled") === "on";
  const internetFeeRaw = str(fd, "internetFee");
  if (!internetFeeRaw) {
    return { error: "Internet fee is required (enter 0 for none)." };
  }
  let internetFeeCents: bigint;
  try {
    internetFeeCents = toCents(internetFeeRaw);
  } catch {
    return { error: "Internet fee must be a valid amount (e.g. 25.00)." };
  }
  if (internetFeeCents < 0n) return { error: "Internet fee cannot be negative." };

  const data = {
    rentAmountCents,
    dueDay,
    gracePeriodDays,
    lateFeeType,
    lateFeeAmountCents,
    lateFeeBps,
    lateFeeMaxCents,
    securityDepositCents: centsOrNull(str(fd, "securityDeposit")) ?? 0n,
    internetEnabled,
    internetFeeCents,
    utilitiesPaid: sanitizeUtilities(fd.getAll("utilities").map((v) => String(v))),
    utilitiesNotes: str(fd, "utilitiesNotes") || null,
    notes: str(fd, "notes") || null,
  };

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.updated",
      entityType: "Lease",
      entityId: lease.id,
      before: {
        rentAmountCents: lease.rentAmountCents,
        dueDay: lease.dueDay,
        gracePeriodDays: lease.gracePeriodDays,
        lateFeeType: lease.lateFeeType,
        lateFeeAmountCents: lease.lateFeeAmountCents,
        lateFeeBps: lease.lateFeeBps,
        lateFeeMaxCents: lease.lateFeeMaxCents,
        securityDepositCents: lease.securityDepositCents,
        internetEnabled: lease.internetEnabled,
        internetFeeCents: lease.internetFeeCents,
        utilitiesPaid: lease.utilitiesPaid,
        utilitiesNotes: lease.utilitiesNotes,
        notes: lease.notes,
      },
    },
    async (tx) => {
      const updated = await tx.lease.update({ where: { id: lease.id }, data });
      return { result: updated, after: data };
    },
  );

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath(`/units/${lease.unitId}`);
  revalidatePath("/leases");
  return { ok: true };
}

/**
 * Extend / renew a lease (re-sign): set a new end date (empty = open-ended)
 * and optionally flip between active and month-to-month. A new rate for the
 * renewal should be scheduled separately as a rent increase so period pricing
 * stays historically correct.
 */
export async function renewLease(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("leases.manage");
  const leaseId = str(fd, "leaseId");
  if (!leaseId) return { error: "Missing lease id." };
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: { unit: { include: { property: true } } },
  });
  if (!lease) return { error: "Lease not found." };
  if (lease.status === "ended") {
    return { error: "This lease has ended — create a new lease instead." };
  }

  const tz = lease.unit.property.timezone;
  const endRaw = str(fd, "endDate");
  const endDate = endRaw ? parseDateOnlyInZone(endRaw, tz) : null;
  if (endRaw && !endDate) return { error: "End date must be a valid date." };
  if (endDate && endDate <= lease.startDate) {
    return { error: "End date must be after the lease start date." };
  }
  const statusRaw = str(fd, "status");
  const status =
    statusRaw === "active" || statusRaw === "month_to_month"
      ? (statusRaw as LeaseStatus)
      : lease.status;

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.renewed",
      entityType: "Lease",
      entityId: lease.id,
      before: { endDate: lease.endDate, status: lease.status },
    },
    async (tx) => {
      const updated = await tx.lease.update({
        where: { id: lease.id },
        data: { endDate, status },
      });
      return { result: updated, after: { endDate, status } };
    },
  );

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath(`/units/${lease.unitId}`);
  revalidatePath("/leases");
  return { ok: true };
}

export async function addCoTenant(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("leases.manage");
  const leaseId = str(fd, "leaseId");
  const tenantId = str(fd, "tenantId");
  if (!leaseId || !tenantId) return { error: "Choose a tenant to add." };
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) return { error: "Lease not found." };
  if (lease.tenantId === tenantId) {
    return { error: "That tenant is already the primary tenant on this lease." };
  }

  try {
    await withAudit(
      {
        ...(await auditActor()),
        action: "lease.cotenant_added",
        entityType: "Lease",
        entityId: lease.id,
      },
      async (tx) => {
        const row = await tx.leaseTenant.create({ data: { leaseId, tenantId } });
        return { result: row, after: { tenantId } };
      },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "That tenant is already on this lease." };
    }
    throw e;
  }

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath(`/tenants/${tenantId}`);
  return { ok: true };
}

export async function removeCoTenant(fd: FormData): Promise<void> {
  await requireCapability("leases.manage");
  const id = str(fd, "leaseTenantId");
  if (!id) throw new Error("Missing co-tenant id.");
  const row = await prisma.leaseTenant.findUnique({
    where: { id },
    include: { lease: true },
  });
  if (!row) return;

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.cotenant_removed",
      entityType: "Lease",
      entityId: row.leaseId,
      before: { tenantId: row.tenantId },
    },
    async (tx) => {
      await tx.leaseTenant.delete({ where: { id } });
      return { result: undefined };
    },
  );

  revalidatePath(`/tenants/${row.lease.tenantId}`);
  revalidatePath(`/tenants/${row.tenantId}`);
}

export async function addLeaseDeposit(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("leases.manage");
  const leaseId = str(fd, "leaseId");
  const label = str(fd, "label");
  const amountRaw = str(fd, "amount");
  if (!leaseId || !label || !amountRaw) {
    return { error: "Deposit label and amount are required." };
  }
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) return { error: "Lease not found." };

  let amountCents: bigint;
  try {
    amountCents = toCents(amountRaw);
  } catch {
    return { error: "Deposit amount must be a valid amount (e.g. 500.00)." };
  }
  if (amountCents <= 0n) return { error: "Deposit amount must be positive." };
  // "Non-refundable" is a toggle: the whole deposit is either refundable or not.
  const nonRefundableCents =
    fd.get("nonRefundable") === "on" || fd.get("nonRefundable") === "true"
      ? amountCents
      : 0n;

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.deposit_added",
      entityType: "Lease",
      entityId: lease.id,
    },
    async (tx) => {
      const dep = await tx.leaseDeposit.create({
        data: {
          leaseId,
          label,
          amountCents,
          nonRefundableCents,
          notes: str(fd, "depositNotes") || null,
        },
      });
      return {
        result: dep,
        after: { label, amountCents, nonRefundableCents },
      };
    },
  );

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath("/leases");
  return { ok: true };
}

export async function removeLeaseDeposit(fd: FormData): Promise<void> {
  await requireCapability("leases.manage");
  const id = str(fd, "depositId");
  if (!id) throw new Error("Missing deposit id.");
  const dep = await prisma.leaseDeposit.findUnique({
    where: { id },
    include: { lease: true },
  });
  if (!dep) return;

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.deposit_removed",
      entityType: "Lease",
      entityId: dep.leaseId,
      before: {
        label: dep.label,
        amountCents: dep.amountCents,
        nonRefundableCents: dep.nonRefundableCents,
      },
    },
    async (tx) => {
      await tx.leaseDeposit.delete({ where: { id } });
      return { result: undefined };
    },
  );

  revalidatePath(`/tenants/${dep.lease.tenantId}`);
  revalidatePath("/leases");
}

export async function scheduleRentIncrease(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("leases.manage");
  const leaseId = str(fd, "leaseId");
  const amountRaw = str(fd, "newRentAmount");
  const dateRaw = str(fd, "effectiveDate");
  if (!leaseId || !amountRaw || !dateRaw) {
    return { error: "New rent amount and effective date are required." };
  }
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: { unit: { include: { property: true } } },
  });
  if (!lease) return { error: "Lease not found." };
  if (lease.status !== "active" && lease.status !== "month_to_month") {
    return { error: "Rent increases can only be scheduled on active leases." };
  }

  let newRent: bigint;
  try {
    newRent = toCents(amountRaw);
  } catch {
    return { error: "New rent must be a valid amount (e.g. 1300.00)." };
  }
  if (newRent <= 0n) return { error: "New rent must be greater than zero." };
  const tz = lease.unit.property.timezone;
  const effectiveDate = parseDateOnlyInZone(dateRaw, tz);
  if (!effectiveDate) return { error: "Effective date must be a valid date." };
  if (daysBetween(new Date(), effectiveDate, tz) < 0) {
    return { error: "Effective date must be today or later." };
  }
  // Already-charged periods are immutable (append-only ledger + idempotency
  // index), so an increase dated into a charged period could never apply to it.
  const effectiveKey = DateTime.fromJSDate(effectiveDate, { zone: tz }).toFormat(
    "yyyy-MM-dd",
  );
  const lastCharged = await prisma.ledgerEntry.findFirst({
    where: { leaseId: lease.id, entryType: "rent_charge" },
    orderBy: { periodKey: "desc" },
    select: { periodKey: true },
  });
  if (lastCharged?.periodKey && effectiveKey <= lastCharged.periodKey) {
    return {
      error: `Rent through the period due ${lastCharged.periodKey} has already been charged; choose a later effective date.`,
    };
  }

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.rent_increase_scheduled",
      entityType: "Lease",
      entityId: lease.id,
      before: {
        rentAmountCents: lease.rentAmountCents,
        scheduledRentAmountCents: lease.scheduledRentAmountCents,
        scheduledRentEffectiveDate: lease.scheduledRentEffectiveDate,
      },
    },
    async (tx) => {
      const updated = await tx.lease.update({
        where: { id: lease.id },
        data: {
          scheduledRentAmountCents: newRent,
          scheduledRentEffectiveDate: effectiveDate,
        },
      });
      return {
        result: updated,
        after: {
          scheduledRentAmountCents: newRent,
          scheduledRentEffectiveDate: effectiveDate,
        },
      };
    },
  );

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath(`/units/${lease.unitId}`);
  revalidatePath("/leases");
  return { ok: true };
}

export async function cancelRentIncrease(fd: FormData): Promise<void> {
  await requireCapability("leases.manage");
  const leaseId = str(fd, "leaseId");
  if (!leaseId) throw new Error("Missing lease id.");
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) throw new Error("Lease not found.");
  if (lease.scheduledRentAmountCents == null) return; // nothing to cancel

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.rent_increase_cancelled",
      entityType: "Lease",
      entityId: lease.id,
      before: {
        scheduledRentAmountCents: lease.scheduledRentAmountCents,
        scheduledRentEffectiveDate: lease.scheduledRentEffectiveDate,
      },
    },
    async (tx) => {
      const updated = await tx.lease.update({
        where: { id: lease.id },
        data: {
          scheduledRentAmountCents: null,
          scheduledRentEffectiveDate: null,
        },
      });
      return { result: updated, after: { scheduledRentAmountCents: null } };
    },
  );

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath(`/units/${lease.unitId}`);
  revalidatePath("/leases");
}

export async function terminateLease(fd: FormData): Promise<void> {
  await requireCapability("leases.manage");
  const leaseId = String(fd.get("leaseId") ?? "");
  if (!leaseId) throw new Error("Missing lease id.");
  const lease = await prisma.lease.update({
    where: { id: leaseId },
    data: { status: "ended", endDate: new Date() },
  });
  await prisma.unit.update({
    where: { id: lease.unitId },
    data: { occupancyStatus: "vacant" },
  });
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "lease.terminated",
    entityType: "Lease",
    entityId: lease.id,
    after: { status: "ended" },
  });
  revalidatePath("/leases");
  revalidatePath(`/tenants/${lease.tenantId}`);
}

/**
 * Guard failures for the archive/delete row actions land back on the leases
 * list as a ?error= banner instead of being thrown — a thrown server-action
 * error renders as the opaque production digest page (same pattern as
 * settings/users/actions.ts).
 */
function failToLeases(message: string): never {
  redirect(`/leases?error=${encodeURIComponent(message)}`);
}

/**
 * Archive a terminated lease: hides it from the default list without touching
 * any history. Only ended/eviction leases may be archived (an archived lease
 * can never be an active one).
 */
export async function archiveLeaseAction(fd: FormData): Promise<void> {
  await requireCapability("leases.manage");
  const leaseId = str(fd, "leaseId");
  if (!leaseId) failToLeases("Missing lease id.");
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) failToLeases("Lease not found.");
  if (lease.status !== "ended" && lease.status !== "eviction") {
    failToLeases("Only terminated leases (ended or eviction) can be archived.");
  }
  if (lease.isArchived) {
    revalidatePath("/leases");
    return; // already archived — nothing to do
  }

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.archived",
      entityType: "Lease",
      entityId: lease.id,
      before: { status: lease.status, isArchived: lease.isArchived },
    },
    async (tx) => {
      const updated = await tx.lease.update({
        where: { id: lease.id },
        data: { isArchived: true },
      });
      return { result: updated, after: { status: updated.status, isArchived: true } };
    },
  );

  revalidatePath("/leases");
  revalidatePath(`/tenants/${lease.tenantId}`);
}

/** Bring an archived lease back into the regular lists. */
export async function unarchiveLeaseAction(fd: FormData): Promise<void> {
  await requireCapability("leases.manage");
  const leaseId = str(fd, "leaseId");
  if (!leaseId) failToLeases("Missing lease id.");
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) failToLeases("Lease not found.");
  if (!lease.isArchived) {
    revalidatePath("/leases");
    return; // already unarchived — nothing to do
  }

  await withAudit(
    {
      ...(await auditActor()),
      action: "lease.unarchived",
      entityType: "Lease",
      entityId: lease.id,
      before: { status: lease.status, isArchived: lease.isArchived },
    },
    async (tx) => {
      const updated = await tx.lease.update({
        where: { id: lease.id },
        data: { isArchived: false },
      });
      return { result: updated, after: { status: updated.status, isArchived: false } };
    },
  );

  revalidatePath("/leases");
  revalidatePath(`/tenants/${lease.tenantId}`);
}

/**
 * SAFE delete for a terminated lease that was a MISTAKE: no payments and no
 * ledger activity beyond the system-minted charges (rent_charge/late_fee)
 * every active lease generates automatically. Anything operator-entered —
 * payments, adjustments (incl. opening balances), reversals — is financial
 * history and makes the lease archive-only. The audit row is written FIRST,
 * inside the same transaction, so the before-snapshot is captured while the
 * lease (and its cascading children) still exists; if the delete fails, the
 * audit row rolls back with it.
 */
export async function deleteLeaseAction(fd: FormData): Promise<void> {
  await requireCapability("leases.manage");
  const leaseId = str(fd, "leaseId");
  if (!leaseId) failToLeases("Missing lease id.");
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: { _count: { select: { payments: true, ledgerEntries: true } } },
  });
  if (!lease) failToLeases("Lease not found.");
  if (lease.status !== "ended" && lease.status !== "eviction") {
    failToLeases("Only terminated leases (ended or eviction) can be deleted.");
  }
  if (lease._count.payments > 0) {
    failToLeases(
      "This lease has recorded payments — archive it instead; payment history is never deleted.",
    );
  }
  const manualEntry = await prisma.ledgerEntry.findFirst({
    where: {
      leaseId: lease.id,
      entryType: { notIn: ["rent_charge", "late_fee"] },
    },
    select: { id: true },
  });
  if (manualEntry) {
    failToLeases(
      "This lease has ledger activity beyond auto-generated charges (e.g. an opening balance or adjustment) — archive it instead.",
    );
  }

  const actor = await auditActor();
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      ...actor,
      action: "lease.deleted",
      entityType: "Lease",
      entityId: lease.id,
      before: {
        tenantId: lease.tenantId,
        unitId: lease.unitId,
        startDate: lease.startDate,
        status: lease.status,
        rentAmountCents: lease.rentAmountCents,
        ledgerEntryCount: lease._count.ledgerEntries,
      },
    });
    // Reminder.leaseId / UploadedDocument.leaseId are loose string refs (no
    // FK), so the cascade won't touch them — null them out so they don't
    // dangle on a deleted lease.
    await tx.reminder.updateMany({
      where: { leaseId: lease.id },
      data: { leaseId: null },
    });
    await tx.uploadedDocument.updateMany({
      where: { leaseId: lease.id },
      data: { leaseId: null },
    });
    // Cascades remove LeaseTenant/LeaseDeposit/LedgerEntry (and the
    // ChargeAllocations hanging off those entries); PropertyExpense.leaseId
    // is SetNull automatically.
    await tx.lease.delete({ where: { id: lease.id } });
  });

  revalidatePath("/leases");
  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath(`/units/${lease.unitId}`);
}
