import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Role hierarchy, lowest -> highest. `finance` is a CFO-style role: everything
 * a manager can do plus billing-rate settings, but below admin so it cannot
 * touch operational settings (auth/messaging/org) or user management.
 */
export const ROLE_ORDER: readonly Role[] = [
  "viewer",
  "manager",
  "finance",
  "admin",
  "owner",
] as const;

export function roleRank(role: Role): number {
  const idx = ROLE_ORDER.indexOf(role);
  return idx < 0 ? -1 : idx;
}

export function roleAtLeast(role: Role, min: Role): boolean {
  return roleRank(role) >= roleRank(min);
}

export const LOWEST_ROLE: Role = "viewer";

/** True if `value` is a member of the Role enum. */
export function isRole(value: string): value is Role {
  return (ROLE_ORDER as readonly string[]).includes(value);
}

/**
 * The role a user is currently ACTING as. Admin+ users may "view as" a lower
 * role to verify what that role can see and do; the impersonated role only
 * ever lowers privileges, never raises them, and non-admins cannot use it.
 */
export function effectiveRole(realRole: Role, viewAs: Role | null): Role {
  if (!viewAs) return realRole;
  if (!roleAtLeast(realRole, "admin")) return realRole;
  return roleRank(viewAs) < roleRank(realRole) ? viewAs : realRole;
}

/**
 * Resolve a role from verified Authentik group claims via the configured mapping.
 * `owner` is never granted from a group unless `allowOwnerFromGroup` is set.
 * Returns the highest mapped role, or null if no group maps.
 */
export function resolveRoleFromGroups(
  groups: readonly string[] | undefined,
  groupMappings: Record<string, Role>,
  allowOwnerFromGroup: boolean,
): Role | null {
  if (!groups || groups.length === 0) return null;
  let best: Role | null = null;
  for (const g of groups) {
    const mapped = groupMappings[g];
    if (!mapped) continue;
    if (mapped === "owner" && !allowOwnerFromGroup) continue;
    if (best === null || roleRank(mapped) > roleRank(best)) best = mapped;
  }
  return best;
}
