import "server-only";
import { cookies } from "next/headers";
import { isRole } from "@/lib/auth/rbac";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * "View as role" impersonation cookie. Only the cookie's PRESENCE is stored
 * here — `effectiveRole` in rbac.ts enforces that it can only lower an
 * admin+ user's privileges, so a forged cookie can never escalate.
 */
export const VIEW_AS_COOKIE = "pm-view-as-role";

export async function getViewAsRole(): Promise<Role | null> {
  const store = await cookies();
  const raw = store.get(VIEW_AS_COOKIE)?.value ?? "";
  return isRole(raw) ? raw : null;
}
