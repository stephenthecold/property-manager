import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import { withAudit, type AuditContext } from "@/lib/audit/audit";
import { loadLeaseAccounting } from "@/lib/services/accounting";
import { netBalanceCents } from "@/lib/accounting";
import { getAppSettings } from "@/lib/services/app-settings";
import {
  buildNoticeVars,
  renderDefaultNotice,
} from "@/lib/notices/templates";
import { renderTemplate } from "@/lib/reminders/templates";
import type { NoticeStatus, NoticeType } from "@/lib/generated/prisma/enums";

/**
 * Bridges Notice rows to the pure notice templates. A notice is an OPERATING
 * record (never a ledger entry) and its subject/body are SNAPSHOTTED at create.
 * Every mutation is audited; drafts are editable, served/void notices are not.
 */

type LeaseForNotice = {
  id: string;
  tenantId: string;
  rentAmountCents: bigint;
  scheduledRentAmountCents: bigint | null;
  tenant: { firstName: string; lastName: string };
  unit: { unitNumber: string; property: { name: string; currency: string; timezone: string } };
};

function fmtDate(d: Date, tz: string): string {
  return DateTime.fromJSDate(d, { zone: tz }).toLocaleString(DateTime.DATE_FULL);
}

/** Build the template vars for a lease (+ optional effective date). */
async function varsForLease(
  lease: LeaseForNotice,
  effectiveDate: Date | null,
  now: Date,
) {
  const settings = await getAppSettings();
  const tz = lease.unit.property.timezone;
  const currency = lease.unit.property.currency;
  const accounting = await loadLeaseAccounting(lease.id);
  const balance = netBalanceCents(accounting.entries);
  return buildNoticeVars({
    tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
    propertyName: lease.unit.property.name,
    unitLabel: lease.unit.unitNumber,
    landlordName: settings.landlordSignatureName || settings.businessName,
    balanceFormatted: formatCurrency(balance, currency),
    currentRentFormatted: formatCurrency(lease.rentAmountCents, currency),
    newRentFormatted: formatCurrency(
      lease.scheduledRentAmountCents ?? lease.rentAmountCents,
      currency,
    ),
    effectiveDateFormatted: effectiveDate ? fmtDate(effectiveDate, tz) : undefined,
    dateFormatted: fmtDate(now, tz),
  });
}

const leaseSelect = {
  id: true,
  tenantId: true,
  rentAmountCents: true,
  scheduledRentAmountCents: true,
  tenant: { select: { firstName: true, lastName: true } },
  unit: {
    select: {
      unitNumber: true,
      property: { select: { name: true, currency: true, timezone: true } },
    },
  },
} as const;

/** Rendered default subject + body for a lease + type (prefills the create form). */
export async function previewNotice(
  leaseId: string,
  type: NoticeType,
  effectiveDate: Date | null,
  now = new Date(),
): Promise<{ subject: string; body: string } | null> {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: leaseSelect,
  });
  if (!lease) return null;
  return renderDefaultNotice(type, await varsForLease(lease, effectiveDate, now));
}

export async function createNotice(input: {
  leaseId: string;
  type: NoticeType;
  effectiveDate: Date | null;
  /** Optional overrides; blank → the rendered default template. */
  subject?: string | null;
  body?: string | null;
  actor: AuditContext;
  now?: Date;
}): Promise<{ id: string } | { error: string }> {
  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: leaseSelect,
  });
  if (!lease) return { error: "Lease not found." };

  const vars = await varsForLease(lease, input.effectiveDate, input.now ?? new Date());
  const def = renderDefaultNotice(input.type, vars);
  // A custom body still gets {{var}} substitution so staff can use placeholders.
  const subject = input.subject?.trim()
    ? renderTemplate(input.subject, vars)
    : def.subject;
  const body = input.body?.trim() ? renderTemplate(input.body, vars) : def.body;

  const notice = await withAudit(
    {
      ...input.actor,
      action: "notice.created",
      entityType: "Notice",
      entityId: "(new)",
    },
    async (tx) => {
      const created = await tx.notice.create({
        data: {
          leaseId: lease.id,
          tenantId: lease.tenantId,
          type: input.type,
          status: "draft",
          subject,
          body,
          effectiveDate: input.effectiveDate,
          createdBy: input.actor.actorId ?? null,
        },
      });
      return {
        result: created,
        entityId: created.id,
        after: { leaseId: lease.id, type: input.type },
      };
    },
  );
  return { id: notice.id };
}

export async function updateNoticeDraft(input: {
  id: string;
  subject: string;
  body: string;
  effectiveDate: Date | null;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const notice = await prisma.notice.findUnique({ where: { id: input.id } });
  if (!notice) return { ok: false, error: "Notice not found." };
  if (notice.status !== "draft") {
    return { ok: false, error: "Only a draft notice can be edited." };
  }
  await withAudit(
    {
      ...input.actor,
      action: "notice.updated",
      entityType: "Notice",
      entityId: notice.id,
    },
    async (tx) => {
      await tx.notice.update({
        where: { id: notice.id },
        data: {
          subject: input.subject,
          body: input.body,
          effectiveDate: input.effectiveDate,
        },
      });
      return { result: undefined, after: { subject: input.subject } };
    },
  );
  return { ok: true };
}

export async function markNoticeServed(input: {
  id: string;
  servedMethod: string;
  servedAt: Date;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const notice = await prisma.notice.findUnique({ where: { id: input.id } });
  if (!notice) return { ok: false, error: "Notice not found." };
  if (notice.status === "void") {
    return { ok: false, error: "A void notice can't be served." };
  }
  await withAudit(
    {
      ...input.actor,
      action: "notice.served",
      entityType: "Notice",
      entityId: notice.id,
    },
    async (tx) => {
      await tx.notice.update({
        where: { id: notice.id },
        data: { status: "served", servedMethod: input.servedMethod, servedAt: input.servedAt },
      });
      return {
        result: undefined,
        after: {
          servedMethod: input.servedMethod,
          servedAt: input.servedAt.toISOString(),
        },
      };
    },
  );
  return { ok: true };
}

export async function voidNotice(input: {
  id: string;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const notice = await prisma.notice.findUnique({ where: { id: input.id } });
  if (!notice || notice.status === "void") return { ok: true };
  await withAudit(
    {
      ...input.actor,
      action: "notice.voided",
      entityType: "Notice",
      entityId: notice.id,
      before: { status: notice.status },
    },
    async (tx) => {
      await tx.notice.update({ where: { id: notice.id }, data: { status: "void" } });
      return { result: undefined };
    },
  );
  return { ok: true };
}

export async function listNotices(filter: {
  status?: NoticeStatus;
  type?: NoticeType;
} = {}) {
  return prisma.notice.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      lease: {
        select: {
          tenantId: true,
          tenant: { select: { firstName: true, lastName: true } },
          unit: { select: { unitNumber: true, property: { select: { name: true } } } },
        },
      },
    },
  });
}

/**
 * Tenant-portal read: the formal notices SERVED to a single tenant, newest
 * first. Scoped to the addressed tenant id (`tenantId`) AND `status: "served"`
 * with a non-null `servedAt` — so drafts and void notices are never exposed,
 * and another tenant's notices are unreachable. Read-only; no body mutation.
 */
export async function listServedNoticesForTenant(tenantId: string) {
  return prisma.notice.findMany({
    where: { tenantId, status: "served", servedAt: { not: null } },
    orderBy: { servedAt: "desc" },
    take: 200,
    select: {
      id: true,
      type: true,
      subject: true,
      body: true,
      servedAt: true,
    },
  });
}

/** Count of served notices for a tenant (portal home link badge). */
export async function countServedNoticesForTenant(tenantId: string): Promise<number> {
  return prisma.notice.count({
    where: { tenantId, status: "served", servedAt: { not: null } },
  });
}

export async function getNoticeForPrint(id: string) {
  return prisma.notice.findUnique({
    where: { id },
    include: {
      lease: {
        select: {
          tenant: { select: { firstName: true, lastName: true } },
          unit: {
            select: {
              unitNumber: true,
              property: {
                select: {
                  name: true,
                  addressLine1: true,
                  addressLine2: true,
                  timezone: true,
                },
              },
            },
          },
        },
      },
    },
  });
}
