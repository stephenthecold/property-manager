"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { withAudit } from "@/lib/audit/audit";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import type { FormState } from "@/lib/forms";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/**
 * Add a rent-split line to a lease (e.g. a tenant portion + a HAP subsidy from a
 * housing authority). Rent shares are an expectation overlay — never a ledger
 * entry — so they're plain config managed by leases.manage.
 */
export async function addRentShareAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { dbUser } = await requireCapability("leases.manage");
  const leaseId = str(fd, "leaseId");
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    include: { unit: { include: { property: { select: { timezone: true } } } } },
  });
  if (!lease) return { error: "Lease not found." };

  const label = str(fd, "label");
  if (!label) return { error: "Enter a label (e.g. 'HAP subsidy')." };
  if (label.length > 100) return { error: "Label is too long." };

  let amountCents: bigint;
  try {
    amountCents = toCents(str(fd, "amount"));
  } catch {
    return { error: "Enter a valid amount (e.g. 800.00)." };
  }
  if (amountCents <= 0n) return { error: "Amount must be positive." };

  // Blank payer = the tenant's portion; a value must be a real, active payer.
  const payerIdRaw = str(fd, "payerId");
  let payerId: string | null = null;
  if (payerIdRaw) {
    const payer = await prisma.payer.findUnique({ where: { id: payerIdRaw } });
    if (!payer || !payer.isActive) return { error: "Select a valid payer." };
    payerId = payer.id;
  }

  const tz = lease.unit.property.timezone;
  const effRaw = str(fd, "effectiveDate");
  const effectiveDate = effRaw ? parseDateOnlyInZone(effRaw, tz) : new Date();
  if (effRaw && !effectiveDate) return { error: "Enter a valid effective date." };
  const endRaw = str(fd, "endDate");
  const endDate = endRaw ? parseDateOnlyInZone(endRaw, tz) : null;
  if (endRaw && !endDate) return { error: "Enter a valid end date." };

  await withAudit(
    {
      ...(await auditActor()),
      action: "rent_share.added",
      entityType: "RentShare",
      entityId: "(new)",
    },
    async (tx) => {
      const created = await tx.rentShare.create({
        data: {
          leaseId,
          payerId,
          label,
          amountCents,
          effectiveDate: effectiveDate!,
          endDate,
          createdBy: dbUser.id,
        },
      });
      return {
        result: created,
        entityId: created.id,
        after: { leaseId, payerId, label, amountCents: amountCents.toString() },
      };
    },
  );

  revalidatePath(`/tenants/${lease.tenantId}`);
  revalidatePath("/payers");
  return { ok: true };
}

export async function removeRentShareAction(fd: FormData): Promise<void> {
  await requireCapability("leases.manage");
  const id = str(fd, "rentShareId");
  if (!id) throw new Error("Missing rent-share id.");
  const share = await prisma.rentShare.findUnique({
    where: { id },
    include: { lease: { select: { tenantId: true } } },
  });
  if (!share) return;

  await withAudit(
    {
      ...(await auditActor()),
      action: "rent_share.removed",
      entityType: "RentShare",
      entityId: id,
      before: {
        leaseId: share.leaseId,
        payerId: share.payerId,
        label: share.label,
        amountCents: share.amountCents.toString(),
      },
    },
    async (tx) => {
      await tx.rentShare.delete({ where: { id } });
      return { result: undefined };
    },
  );

  revalidatePath(`/tenants/${share.lease.tenantId}`);
  revalidatePath("/payers");
}
