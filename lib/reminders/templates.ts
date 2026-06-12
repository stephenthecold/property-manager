import type { ReminderType } from "@/lib/generated/prisma/enums";

/**
 * Pure SMS template rendering. Single-pass `{{var}}` substitution — values are
 * inserted literally and never re-expanded, so tenant-supplied text containing
 * `{{...}}` cannot inject other variables. Unknown keys render as "".
 */

export type TemplateVars = Record<string, string>;

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_match, key: string) => vars[key] ?? "",
  );
}

export function buildReminderVars(i: {
  tenantFirstName: string;
  tenantLastName: string;
  propertyName: string;
  unitLabel: string;
  amountDueFormatted: string;
  dueDateFormatted: string;
  balanceFormatted: string;
  /** Canonical "$Cashtag" (AppSettings.cashAppCashtag); empty vars when null. */
  cashAppTag?: string | null;
}): TemplateVars {
  return {
    tenant_name: `${i.tenantFirstName} ${i.tenantLastName}`.trim(),
    first_name: i.tenantFirstName,
    property: i.propertyName,
    unit: i.unitLabel,
    amount_due: i.amountDueFormatted,
    due_date: i.dueDateFormatted,
    balance: i.balanceFormatted,
    cash_app_tag: i.cashAppTag ?? "",
    cash_app_link: i.cashAppTag ? `https://cash.app/${i.cashAppTag}` : "",
  };
}

/** Vars for the maintenance template (no money fields — schedule context only). */
export function buildMaintenanceVars(i: {
  tenantFirstName: string;
  tenantLastName: string;
  propertyName: string;
  unitLabel: string;
  maintenanceTitle: string;
  maintenanceDateFormatted: string;
}): TemplateVars {
  return {
    tenant_name: `${i.tenantFirstName} ${i.tenantLastName}`.trim(),
    first_name: i.tenantFirstName,
    property: i.propertyName,
    unit: i.unitLabel,
    maintenance_title: i.maintenanceTitle,
    maintenance_date: i.maintenanceDateFormatted,
  };
}

// `manual` is intentionally empty: the UI supplies the body for manual sends.
export const DEFAULT_TEMPLATES: Record<ReminderType, string> = {
  rent_due_soon:
    "Hi {{first_name}}, a reminder that rent of {{amount_due}} for {{property}} {{unit}} is due {{due_date}}. Thank you!",
  rent_overdue:
    "Hi {{first_name}}, rent for {{property}} {{unit}} was due {{due_date}} and is past due. Balance: {{balance}}. Please pay as soon as possible.",
  partial_balance:
    "Hi {{first_name}}, thank you for your payment toward {{property}} {{unit}}. A balance of {{balance}} remains for the period due {{due_date}}.",
  payment_receipt:
    "Hi {{first_name}}, we received your payment for {{property}} {{unit}}. Remaining balance: {{balance}}. Thank you!",
  manual: "",
  maintenance:
    "Hi {{first_name}}, scheduled maintenance at {{property}} {{unit}}: {{maintenance_title}} on {{maintenance_date}}. Please plan for access. Thank you!",
};
