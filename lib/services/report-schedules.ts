import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { getAppSettings, resolveEmailProvider } from "@/lib/services/app-settings";
import {
  asOfStamp,
  defaultReportTimezone,
  isSchedulableReportType,
  loadReport,
  reportTitle,
  type ReportParams,
} from "@/lib/services/report-registry";
import {
  FORMAT_META,
  isExportFormat,
  renderReportPdf,
  renderReportXlsx,
  type ExportFormat,
} from "@/lib/services/report-render";
import { toCsv } from "@/lib/services/reports";
import {
  dueReportSchedules,
  isReportCadence,
  reportPeriodForCadence,
  type ReportCadence,
} from "@/lib/reports/schedule";
import type { EmailProvider, EmailAttachment } from "@/lib/providers/email/types";

/**
 * ReportSchedule CRUD + the worker delivery sweep. The "is it due?" decision is
 * the pure helper lib/reports/schedule.ts; this module only bridges Prisma ↔
 * that function and the format renderers. Pure delivery config — never the
 * ledger. Every create/delete is audited; the sweep writes one audit row per
 * delivery attempt.
 */

/**
 * Reports whose output depends on a date range — for these a scheduled delivery
 * passes the cadence's completed prior period (reportPeriodForCadence). Every
 * other registry report is a point-in-time snapshot and ignores from/to.
 */
const REPORT_TYPES_WITH_PERIOD = new Set<string>(["income", "payment-methods"]);

/** A single valid recipient: structurally an email, trimmed, case preserved. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedRecipients {
  /** Canonical comma-joined string ready to store (deduped, order-preserving). */
  joined: string;
  emails: string[];
}

/**
 * Parse a free-text recipient list (comma/semicolon/newline separated) into a
 * validated, de-duplicated address list. Throws on no valid addresses or any
 * malformed token so a typo never silently drops a recipient.
 */
export function parseRecipientEmails(raw: string): ParsedRecipients {
  const tokens = raw
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
  if (tokens.length === 0) {
    throw new Error("Enter at least one recipient email.");
  }
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const t of tokens) {
    if (!EMAIL_RE.test(t)) {
      throw new Error(`"${t}" is not a valid email address.`);
    }
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(t);
  }
  if (emails.length > 50) {
    throw new Error("Too many recipients (max 50).");
  }
  return { joined: emails.join(", "), emails };
}

/** Split a stored recipientEmails string back into addresses for sending. */
export function splitRecipients(stored: string): string[] {
  return stored
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

export interface ReportScheduleView {
  id: string;
  reportType: string;
  reportTitle: string;
  format: ExportFormat;
  cadence: ReportCadence;
  recipientEmails: string;
  lastSentAt: Date | null;
  createdAt: Date;
}

function toView(row: {
  id: string;
  reportType: string;
  format: string;
  cadence: string;
  recipientEmails: string;
  lastSentAt: Date | null;
  createdAt: Date;
}): ReportScheduleView {
  return {
    id: row.id,
    reportType: row.reportType,
    reportTitle: reportTitle(row.reportType),
    // Stored values are validated on write; fall back defensively for display.
    format: isExportFormat(row.format) ? row.format : "csv",
    cadence: isReportCadence(row.cadence) ? row.cadence : "weekly",
    recipientEmails: row.recipientEmails,
    lastSentAt: row.lastSentAt,
    createdAt: row.createdAt,
  };
}

/** All schedules, newest first. */
export async function listReportSchedules(): Promise<ReportScheduleView[]> {
  const rows = await prisma.reportSchedule.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toView);
}

export interface CreateReportScheduleInput {
  reportType: string;
  format: string;
  cadence: string;
  /** Raw recipient text from the form (validated here). */
  recipientEmailsRaw: string;
  actor: AuditContext;
}

/**
 * Create a schedule after validating every field. Returns { error } for a bad
 * input (rendered inline by the form) rather than throwing.
 */
export async function createReportSchedule(
  input: CreateReportScheduleInput,
): Promise<{ ok: true; id: string } | { error: string }> {
  if (!isSchedulableReportType(input.reportType)) {
    return { error: "Choose a valid report." };
  }
  if (!isExportFormat(input.format)) {
    return { error: "Choose a valid format (CSV, PDF, or Excel)." };
  }
  if (!isReportCadence(input.cadence)) {
    return { error: "Choose a cadence (weekly or monthly)." };
  }
  let recipients: ParsedRecipients;
  try {
    recipients = parseRecipientEmails(input.recipientEmailsRaw);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid recipients." };
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.reportSchedule.create({
      data: {
        reportType: input.reportType,
        format: input.format,
        cadence: input.cadence,
        recipientEmails: recipients.joined,
        createdBy: input.actor.actorId ?? null,
      },
    });
    await writeAudit(tx, {
      ...input.actor,
      action: "report_schedule.created",
      entityType: "ReportSchedule",
      entityId: row.id,
      after: {
        reportType: input.reportType,
        format: input.format,
        cadence: input.cadence,
        recipientCount: recipients.emails.length,
      },
    });
    return row;
  });
  return { ok: true, id: created.id };
}

/** Delete a schedule (audited). No-op-safe if it was already removed. */
export async function deleteReportSchedule(
  id: string,
  actor: AuditContext,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.reportSchedule.findUnique({ where: { id } });
    if (!row) return;
    await tx.reportSchedule.delete({ where: { id } });
    await writeAudit(tx, {
      ...actor,
      action: "report_schedule.deleted",
      entityType: "ReportSchedule",
      entityId: id,
      before: {
        reportType: row.reportType,
        format: row.format,
        cadence: row.cadence,
      },
    });
  });
}

// --- Worker delivery sweep ----------------------------------------------------

export interface ReportDeliveryResult {
  /** Schedules that were due this run. */
  due: number;
  /** Schedules whose report was emailed to at least one recipient. */
  sent: number;
  /** Schedules skipped (email off / unconfigured / render or send failure). */
  skipped: number;
  reason?: string;
}

/** Build the attachment for a due schedule by rendering the report once. */
async function renderAttachment(
  type: string,
  format: ExportFormat,
  params: ReportParams,
  businessName: string,
  headerText: string | null,
  now: Date,
): Promise<EmailAttachment> {
  const data = await loadReport(type, params, now);
  if (!data) throw new Error(`unknown report type: ${type}`);
  const title = reportTitle(type);
  const meta = FORMAT_META[format];
  const filename = `${type}-${asOfStamp(now).slice(0, 10)}.${meta.ext}`;
  const htmlOpts = { title, businessName, headerText, now };

  let content: Buffer;
  if (format === "csv") {
    content = Buffer.from(toCsv([...data.headers], data.rows), "utf-8");
  } else if (format === "pdf") {
    content = await renderReportPdf(data, htmlOpts);
  } else {
    content = await renderReportXlsx(data, htmlOpts);
  }
  return { filename, content, contentType: meta.mime };
}

/**
 * Worker sweep: find schedules due at `now` (pure cadence math), render each
 * report in its format, email it to every recipient, and stamp lastSentAt. One
 * failing schedule never blocks the rest. Cadence boundaries (ISO week / calendar
 * month) mean a daily worker — and restarts — can't double-send within a period,
 * since the first send moves lastSentAt into the current period.
 */
export async function runReportScheduleDelivery(
  now: Date,
): Promise<ReportDeliveryResult> {
  const settings = await getAppSettings();
  if (!settings.emailEnabled) {
    return { due: 0, sent: 0, skipped: 0, reason: "email disabled" };
  }

  const all = await prisma.reportSchedule.findMany();
  const tz = defaultReportTimezone();
  const due = dueReportSchedules(
    all.map((r) => ({
      ...r,
      cadence: isReportCadence(r.cadence) ? r.cadence : "weekly",
    })),
    tz,
    now,
  );
  if (due.length === 0) {
    return { due: 0, sent: 0, skipped: 0, reason: "nothing due" };
  }

  let provider: EmailProvider;
  try {
    provider = await resolveEmailProvider();
  } catch (e) {
    // Unconfigured/incomplete email: nothing can be delivered this run.
    return {
      due: due.length,
      sent: 0,
      skipped: due.length,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  let sent = 0;
  let skipped = 0;
  for (const schedule of due) {
    const format: ExportFormat = isExportFormat(schedule.format)
      ? schedule.format
      : "csv";
    const recipients = splitRecipients(schedule.recipientEmails);
    if (recipients.length === 0) {
      skipped++;
      continue;
    }
    try {
      // Date-ranged reports (income, payments-by-method) summarize the COMPLETED
      // prior period for the cadence; date-free reports ignore these params.
      const cadence = isReportCadence(schedule.cadence) ? schedule.cadence : "weekly";
      const period = reportPeriodForCadence(cadence, now, tz);
      const params: ReportParams = REPORT_TYPES_WITH_PERIOD.has(schedule.reportType)
        ? { from: period.from, to: period.to }
        : {};
      const attachment = await renderAttachment(
        schedule.reportType,
        format,
        params,
        settings.businessName,
        settings.reportHeaderText,
        now,
      );
      const title = reportTitle(schedule.reportType);
      const subject = `${settings.businessName} — ${title} (${schedule.cadence})`;
      const text =
        `Attached is your ${schedule.cadence} ${title} report ` +
        `(${format.toUpperCase()}), generated ${asOfStamp(now)}.\n\n` +
        `This is an automated delivery from ${settings.businessName}.`;

      let anyDelivered = false;
      for (const to of recipients) {
        try {
          const res = await provider.send({
            to,
            subject,
            text,
            attachments: [attachment],
          });
          if (res.status !== "failed") anyDelivered = true;
        } catch (e) {
          console.error(
            `[report-delivery] send to ${to} failed:`,
            e instanceof Error ? e.message : e,
          );
        }
      }

      if (anyDelivered) {
        // Stamp lastSentAt into the current period (so this schedule won't fire
        // again until the next ISO week / calendar month) and write the delivery
        // audit row in ONE transaction — they commit or roll back together, per
        // the in-transaction audit invariant.
        await prisma.$transaction(async (tx) => {
          await tx.reportSchedule.update({
            where: { id: schedule.id },
            data: { lastSentAt: now },
          });
          await writeAudit(tx, {
            actorType: "system",
            actorId: null,
            action: "report_schedule.delivered",
            entityType: "ReportSchedule",
            entityId: schedule.id,
            after: {
              reportType: schedule.reportType,
              format,
              cadence: schedule.cadence,
              recipientCount: recipients.length,
            },
          });
        });
        sent++;
      } else {
        skipped++;
      }
    } catch (e) {
      // Render failure (e.g. Chromium unavailable) — skip, leave lastSentAt so a
      // later run retries; never block other schedules.
      skipped++;
      console.error(
        `[report-delivery] schedule ${schedule.id} (${schedule.reportType}/${format}) failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  return { due: due.length, sent, skipped };
}
