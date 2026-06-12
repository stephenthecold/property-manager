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
  "documents.manage",
  "reminders.send",
  "reports.view",
  "financials.view",
  "financials.manage",
  "maintenance.manage",
  "esign.manage",
  "portal.manage",
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
  "documents.manage": "manager",
  "reminders.send": "manager",
  "reports.view": "manager",
  // Financial totals/profit are confidential: finance+ by default (NOT manager).
  "financials.view": "finance",
  "financials.manage": "finance",
  "maintenance.manage": "manager",
  // E-signing: managers and up may send agreements and apply the landlord side.
  "esign.manage": "manager",
  // Tenant portal: invite/disable tenant logins, work the request queue.
  "portal.manage": "manager",
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
  "documents.manage": { label: "Manage documents", group: "Operations", description: "Upload documents, run OCR, and view document detail." },
  "reminders.send": { label: "Send reminders", group: "Operations", description: "Send individual and bulk SMS reminders." },
  "reports.view": { label: "View & export reports", group: "Operations", description: "View the Reports page and export financial CSVs." },
  "financials.view": { label: "View financial totals & profit", group: "Operations", description: "See expected/collected totals on the dashboard and the Financials (ROI) page." },
  "financials.manage": { label: "Manage financials", group: "Operations", description: "Log property expenses and edit building mortgage terms." },
  "maintenance.manage": { label: "Maintenance jobs & tasks", group: "Operations", description: "Track unit maintenance jobs and monthly recurring tasks." },
  "esign.manage": { label: "E-sign lease agreements", group: "Operations", description: "Send agreements for e-signature, apply the landlord signature, resend or cancel signing requests." },
  "portal.manage": { label: "Tenant portal & requests", group: "Operations", description: "Invite tenants to the portal, enable/disable their logins, and work the tenant request queue." },
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
