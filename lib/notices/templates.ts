import type { NoticeType } from "@/lib/generated/prisma/enums";
import { renderTemplate, type TemplateVars } from "@/lib/reminders/templates";

/**
 * Pure notice content: types, labels, and per-type default subject/body
 * templates with `{{var}}` placeholders (rendered via the injection-safe
 * single-pass renderer shared with reminders). DB-free and unit-tested. The
 * default bodies are STARTING POINTS — an operator must review them against
 * local/state requirements before serving. Rendered text is snapshotted on the
 * Notice at create, so what was served stays immutable.
 */

export const NOTICE_TYPES: NoticeType[] = [
  "late_rent",
  "lease_violation",
  "notice_to_quit",
  "non_renewal",
  "rent_increase",
  "general",
];

const LABELS: Record<NoticeType, string> = {
  late_rent: "Late rent / pay-or-quit",
  lease_violation: "Lease violation / cure-or-quit",
  notice_to_quit: "Notice to quit / termination",
  non_renewal: "Non-renewal of lease",
  rent_increase: "Rent increase",
  general: "General notice",
};

const DEFAULT_SUBJECTS: Record<NoticeType, string> = {
  late_rent: "Notice to Pay Rent or Vacate",
  lease_violation: "Notice to Cure Lease Violation or Vacate",
  notice_to_quit: "Notice to Vacate",
  non_renewal: "Notice of Non-Renewal of Lease",
  rent_increase: "Notice of Rent Increase",
  general: "Notice",
};

const DEFAULT_BODIES: Record<NoticeType, string> = {
  late_rent: `To {{tenant_name}}, tenant at {{property}}, Unit {{unit}}:

Our records show a past-due balance of {{balance}} on your rent account. You are hereby notified to pay the full amount due on or before {{effective_date}}, or to vacate and surrender the premises.

If you have already paid, please disregard this notice.

{{landlord_name}}
Dated: {{date}}`,
  lease_violation: `To {{tenant_name}}, tenant at {{property}}, Unit {{unit}}:

You are in violation of your lease as described below. You are hereby notified to cure this violation on or before {{effective_date}}, or to vacate and surrender the premises.

Violation:
[describe the violation]

{{landlord_name}}
Dated: {{date}}`,
  notice_to_quit: `To {{tenant_name}}, tenant at {{property}}, Unit {{unit}}:

You are hereby notified to vacate and surrender possession of the premises on or before {{effective_date}}.

{{landlord_name}}
Dated: {{date}}`,
  non_renewal: `To {{tenant_name}}, tenant at {{property}}, Unit {{unit}}:

This is notice that your lease will NOT be renewed and will end on {{effective_date}}. Please make arrangements to vacate and surrender the premises on or before that date.

{{landlord_name}}
Dated: {{date}}`,
  rent_increase: `To {{tenant_name}}, tenant at {{property}}, Unit {{unit}}:

This is notice that, effective {{effective_date}}, the monthly rent for your unit will change. The current monthly rent is {{current_rent}}; the new monthly rent will be {{new_rent}}.

{{landlord_name}}
Dated: {{date}}`,
  general: `To {{tenant_name}}, tenant at {{property}}, Unit {{unit}}:

[notice text]

{{landlord_name}}
Dated: {{date}}`,
};

export function isNoticeType(value: string): value is NoticeType {
  return (NOTICE_TYPES as readonly string[]).includes(value);
}

export function parseNoticeType(
  raw: string | null | undefined,
  fallback: NoticeType = "general",
): NoticeType {
  return raw != null && isNoticeType(raw) ? raw : fallback;
}

export function noticeTypeLabel(t: NoticeType): string {
  return LABELS[t];
}

export function defaultNoticeSubject(t: NoticeType): string {
  return DEFAULT_SUBJECTS[t];
}

export function defaultNoticeBody(t: NoticeType): string {
  return DEFAULT_BODIES[t];
}

export interface NoticeVarInput {
  tenantName: string;
  propertyName: string;
  unitLabel: string;
  landlordName: string;
  /** Pre-formatted; blank if not applicable. */
  balanceFormatted?: string;
  currentRentFormatted?: string;
  newRentFormatted?: string;
  effectiveDateFormatted?: string;
  dateFormatted: string;
}

export function buildNoticeVars(i: NoticeVarInput): TemplateVars {
  return {
    tenant_name: i.tenantName,
    property: i.propertyName,
    unit: i.unitLabel,
    landlord_name: i.landlordName,
    balance: i.balanceFormatted ?? "",
    current_rent: i.currentRentFormatted ?? "",
    new_rent: i.newRentFormatted ?? "",
    effective_date: i.effectiveDateFormatted ?? "________",
    date: i.dateFormatted,
  };
}

/** Render a type's default subject + body against the lease/tenant vars. */
export function renderDefaultNotice(
  type: NoticeType,
  vars: TemplateVars,
): { subject: string; body: string } {
  return {
    subject: renderTemplate(DEFAULT_SUBJECTS[type], vars),
    body: renderTemplate(DEFAULT_BODIES[type], vars),
  };
}
