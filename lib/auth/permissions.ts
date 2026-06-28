import type { Role } from "@/lib/generated/prisma/enums";
import { roleAtLeast } from "@/lib/auth/rbac";

/**
 * Capability-based permissions layered over the role hierarchy. Each capability
 * gates a group of mutations/sensitive views. An owner/admin can re-assign
 * capabilities per role via Settings → Permissions; the DEFAULT matrix exactly
 * reproduces the original role hierarchy, so an un-customized install behaves
 * identically to before this feature existed.
 *
 * Safety: `owner` always has every capability, and a few capabilities are
 * locked on for the roles that must keep them (so a bad matrix can never lock an
 * admin out of fixing it). These floors are NOT editable in the UI.
 */

export const CAPABILITIES = [
  "properties.manage",
  "tenants.manage",
  "leases.manage",
  "payments.manage",
  "payers.manage",
  "documents.manage",
  "reminders.send",
  "reports.view",
  "reports.schedule",
  "financials.view",
  "financials.manage",
  "maintenance.manage",
  "esign.manage",
  "portal.manage",
  "portal.impersonate",
  "applications.view",
  "applications.manage",
  "notices.manage",
  "inspections.manage",
  "vendors.manage",
  "mailbox.manage",
  "billing.settings",
  "messaging.settings",
  "organization.settings",
  "auth.settings",
  "users.manage",
  "audit.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Minimum role each capability was granted to in the original hierarchy. */
const MIN_ROLE: Record<Capability, Role> = {
  "properties.manage": "manager",
  "tenants.manage": "manager",
  "leases.manage": "manager",
  "payments.manage": "manager",
  // Non-tenant payer directory (HUD/housing authorities, …). Operational, like
  // tenants.manage — the staff who manage tenants manage the payers too.
  "payers.manage": "manager",
  "documents.manage": "manager",
  "reminders.send": "manager",
  "reports.view": "manager",
  // Scheduling recurring emailed reports to arbitrary recipients sets up
  // automated outbound mail — admin-only, like the other delivery/settings caps.
  "reports.schedule": "admin",
  // Financial totals/profit are confidential: finance+ by default (NOT manager).
  "financials.view": "finance",
  "financials.manage": "finance",
  "maintenance.manage": "manager",
  // E-signing: managers and up may send agreements and apply the landlord side.
  "esign.manage": "manager",
  // Tenant portal: invite/disable tenant logins, work the request queue.
  "portal.manage": "manager",
  // Impersonation is powerful (you become the tenant) — admin-only by default.
  "portal.impersonate": "admin",
  // Rental applications: review the queue; manage = act on / convert.
  "applications.view": "manager",
  "applications.manage": "manager",
  // Formal landlord notices to tenants — manager+ (operational), like leases.
  "notices.manage": "manager",
  // Property inspections + deposit disposition — manager+ (operational).
  "inspections.manage": "manager",
  // Vendor directory — manager+ (operational).
  "vendors.manage": "manager",
  // Email inbox: triage captured mail, post emailed invoices — manager+
  // (operational), like documents.manage. Posting the expense itself still
  // requires financials.manage.
  "mailbox.manage": "manager",
  "billing.settings": "finance",
  "messaging.settings": "admin",
  "organization.settings": "admin",
  "auth.settings": "admin",
  "users.manage": "admin",
  "audit.view": "admin",
};

/** UI grouping + human labels for the permissions editor. */
export const CAPABILITY_META: Record<
  Capability,
  { label: string; group: "Operations" | "Settings"; description: string }
> = {
  "properties.manage": { label: "Manage properties, buildings & units", group: "Operations", description: "Create and edit properties, buildings, and units." },
  "tenants.manage": { label: "Manage tenants", group: "Operations", description: "Create and edit tenant records." },
  "leases.manage": { label: "Manage leases", group: "Operations", description: "Create, edit, renew, terminate leases; co-tenants, deposits, rent increases." },
  "payments.manage": { label: "Record & void payments", group: "Operations", description: "Record payments and void them (reversals)." },
  "payers.manage": { label: "Manage non-tenant payers", group: "Operations", description: "Maintain the directory of third-party payers (HUD/housing authorities, employers, guarantors) who pay on a tenant's behalf." },
  "documents.manage": { label: "Manage documents", group: "Operations", description: "Upload documents, run OCR, and view document detail." },
  "reminders.send": { label: "Send reminders", group: "Operations", description: "Send individual and bulk SMS reminders." },
  "reports.view": { label: "View & export reports", group: "Operations", description: "View the Reports page and export financial reports (CSV, PDF, Excel)." },
  "reports.schedule": { label: "Schedule report email delivery", group: "Settings", description: "Create and manage recurring (weekly/monthly) emailed report deliveries to chosen recipients." },
  "financials.view": { label: "View financial totals & profit", group: "Operations", description: "See expected/collected totals on the dashboard and the Financials (ROI) page." },
  "financials.manage": { label: "Manage financials", group: "Operations", description: "Log property expenses and edit building mortgage terms." },
  "maintenance.manage": { label: "Maintenance jobs & tasks", group: "Operations", description: "Track unit maintenance jobs and monthly recurring tasks." },
  "esign.manage": { label: "E-sign lease agreements", group: "Operations", description: "Send agreements for e-signature, apply the landlord signature, resend or cancel signing requests." },
  "portal.manage": { label: "Tenant portal & requests", group: "Operations", description: "Invite tenants to the portal, enable/disable their logins, and work the tenant request queue." },
  "portal.impersonate": { label: "Impersonate a tenant (debug)", group: "Operations", description: "Open the tenant portal AS a tenant, and create trial login links, for debugging and smoke testing. Sessions are short-lived, audited, and banner-marked." },
  "applications.view": { label: "View rental applications", group: "Operations", description: "See the rental-application queue and submission details." },
  "applications.manage": { label: "Manage rental applications", group: "Operations", description: "Change application status, email/text the apply link, and convert an applicant into a tenant." },
  "notices.manage": { label: "Manage notices", group: "Operations", description: "Create, serve, void, and print formal landlord notices (late rent, lease violation, notice to quit, non-renewal, rent increase)." },
  "inspections.manage": { label: "Manage inspections", group: "Operations", description: "Schedule and record property inspections and itemize move-out deposit dispositions." },
  "vendors.manage": { label: "Manage vendors", group: "Operations", description: "Maintain the directory of contractors and service providers." },
  "mailbox.manage": { label: "Email inbox", group: "Operations", description: "Read captured inbound email, mark/archive messages, and post emailed invoices/receipts as expenses (posting also requires the financials capability)." },
  "billing.settings": { label: "Billing defaults", group: "Settings", description: "Edit org-wide charge/late-fee/internet rate defaults." },
  "messaging.settings": { label: "Messaging settings", group: "Settings", description: "Configure the SMS provider and reminder templates." },
  "organization.settings": { label: "Organization settings", group: "Settings", description: "Edit business identity, branding, and storage configuration." },
  "auth.settings": { label: "Authentication settings", group: "Settings", description: "Configure OIDC/SSO and break-glass." },
  "users.manage": { label: "Manage users & permissions", group: "Settings", description: "Assign roles, activate/deactivate users, edit this permission matrix." },
  "audit.view": { label: "View audit log", group: "Settings", description: "Read the append-only audit trail." },
};

/** Roles shown (and editable) in the matrix, lowest → highest. Owner is implicit (all). */
export const EDITABLE_ROLES: readonly Role[] = ["viewer", "manager", "finance", "admin"] as const;

/**
 * Capabilities locked ON for a role regardless of the matrix, to prevent an
 * admin from removing their own ability to recover. Owner is handled separately
 * (always all). Admins must always be able to manage users/permissions and auth.
 */
const LOCKED_ON: Partial<Record<Role, ReadonlySet<Capability>>> = {
  admin: new Set<Capability>(["users.manage", "auth.settings"]),
};

export type PermissionMatrix = Partial<Record<Role, Partial<Record<Capability, boolean>>>>;

/** The grant in the original hierarchy (used as the default when un-customized). */
export function defaultGrant(role: Role, cap: Capability): boolean {
  return roleAtLeast(role, MIN_ROLE[cap]);
}

/** Whether a capability is fixed (not editable) for a role in the UI. */
export function isLocked(role: Role, cap: Capability): boolean {
  if (role === "owner") return true;
  return LOCKED_ON[role]?.has(cap) ?? false;
}

/**
 * Authoritative check: does `role` have `cap`, given an optional saved matrix?
 * owner → always; locked floors → always; else the matrix override, else the
 * hierarchy default.
 */
export function hasCapability(
  role: Role,
  cap: Capability,
  matrix: PermissionMatrix | null | undefined,
): boolean {
  if (role === "owner") return true;
  if (isLocked(role, cap)) return true;
  const override = matrix?.[role]?.[cap];
  if (typeof override === "boolean") return override;
  return defaultGrant(role, cap);
}

/** Full effective matrix (every role × capability) for rendering the editor. */
export function resolveMatrix(
  matrix: PermissionMatrix | null | undefined,
): Record<Role, Record<Capability, boolean>> {
  const roles: Role[] = ["viewer", "manager", "finance", "admin", "owner"];
  const out = {} as Record<Role, Record<Capability, boolean>>;
  for (const role of roles) {
    out[role] = {} as Record<Capability, boolean>;
    for (const cap of CAPABILITIES) out[role][cap] = hasCapability(role, cap, matrix);
  }
  return out;
}

/**
 * Sanitize a posted matrix down to only the entries that DIFFER from the
 * default (keeps storage minimal and self-healing if MIN_ROLE changes), and
 * never persists locked or owner entries.
 */
export function diffFromDefault(
  full: Partial<Record<Role, Partial<Record<Capability, boolean>>>>,
): PermissionMatrix {
  const out: PermissionMatrix = {};
  for (const role of EDITABLE_ROLES) {
    const row = full[role];
    if (!row) continue;
    for (const cap of CAPABILITIES) {
      if (isLocked(role, cap)) continue;
      const v = row[cap];
      if (typeof v !== "boolean") continue;
      if (v === defaultGrant(role, cap)) continue;
      (out[role] ??= {})[cap] = v;
    }
  }
  return out;
}
