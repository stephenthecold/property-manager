import { prisma } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/enums";
import { writeAudit } from "@/lib/audit/audit";
import { toCents } from "@/lib/money";
import {
  getAppSettings,
  resolveEmailProvider,
} from "@/lib/services/app-settings";
import { getOverdue } from "@/lib/services/reports";
import {
  formatOverdueDigest,
  isoWeekKey,
  type OverdueDigestRow,
} from "@/lib/reminders/digest";
import type { EmailProvider } from "@/lib/providers/email/types";

/**
 * Weekly staff overdue-rent digest (worker, STAFF_DIGEST_CRON — Mondays by
 * default). Emails every active owner/admin/finance/manager user the list of
 * overdue leases (tenant, unit, balance, aging) via the configured email
 * provider. Cron-only (never runs at worker startup) so restarts cannot
 * double-send.
 */

export interface StaffDigestResult {
  sent: number;
  skipped: number;
  reason?: string;
}

/** Roles that receive the digest; viewers are read-only and excluded. */
const STAFF_ROLES: Role[] = ["owner", "admin", "finance", "manager"];

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runWeeklyStaffDigest(
  now: Date,
): Promise<StaffDigestResult> {
  const settings = await getAppSettings();
  if (!settings.emailEnabled) {
    return { sent: 0, skipped: 0, reason: "email disabled" };
  }

  // Overdue rows come from the same report the rent-roll screen/CSV uses —
  // never re-derive balance math here.
  const rows = await getOverdue(now);
  if (rows.length === 0) {
    return { sent: 0, skipped: 0, reason: "nothing overdue" };
  }

  const recipients = (
    await prisma.user.findMany({
      where: { isActive: true, role: { in: STAFF_ROLES } },
      select: { email: true },
      orderBy: { email: "asc" },
    })
  ).filter((u) => u.email.trim() !== "");
  if (recipients.length === 0) {
    return { sent: 0, skipped: 0, reason: "no staff recipients" };
  }

  let provider: EmailProvider;
  try {
    provider = await resolveEmailProvider();
  } catch (e) {
    // Unconfigured/incomplete email: every would-be recipient is skipped.
    return { sent: 0, skipped: recipients.length, reason: errorMessage(e) };
  }

  // Shape report rows (display strings) into the pure formatter's input.
  // toCents is the one sanctioned parser back to integer cents.
  const digestRows: OverdueDigestRow[] = rows.map((r) => ({
    tenantName: r.tenant,
    propertyName: r.property,
    unitLabel: r.unit,
    pastDueCents: toCents(r.pastDue),
    balanceCents: toCents(r.balance),
    currency: settings.defaultCurrency,
    daysSinceLastPayment: r.lastPaidDays === "" ? null : Number(r.lastPaidDays),
  }));
  const digest = formatOverdueDigest({
    businessName: settings.businessName,
    now,
    rows: digestRows,
  });
  if (!digest) {
    // Defensive: rows.length > 0 above means this cannot happen.
    return { sent: 0, skipped: 0, reason: "nothing overdue" };
  }

  // Same digest to every recipient, sequentially; one failure never blocks
  // the rest of the staff list.
  let sent = 0;
  let skipped = 0;
  for (const recipient of recipients) {
    try {
      const res = await provider.send({
        to: recipient.email,
        subject: digest.subject,
        text: digest.text,
      });
      if (res.status === "failed") skipped++;
      else sent++;
    } catch (e) {
      skipped++;
      console.error(`[staff-digest] send failed:`, errorMessage(e));
    }
  }

  // ONE audit row per weekly run, keyed by ISO week. Aggregates only — no
  // recipient addresses, no per-tenant balances. BigInt cents go in as string.
  await writeAudit(prisma, {
    actorType: "system",
    actorId: null,
    action: "digest.staff_overdue_sent",
    entityType: "StaffDigest",
    entityId: isoWeekKey(now),
    after: {
      recipients: sent,
      overdueCount: rows.length,
      totalPastDueCents: digest.totalPastDueCents.toString(),
    },
  });

  return { sent, skipped };
}
