"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import {
  DASHBOARD_SECTION_IDS,
  sanitizeLayout,
  type DashboardLayout,
} from "@/lib/dashboard/layout";

/**
 * Persist the signed-in user's personal dashboard layout. Best-effort and
 * un-audited: it is a private UI preference scoped to the caller's own row,
 * touches no shared/financial data, and (deliberately) does NOT revalidate the
 * dashboard — the client holds the live state, so a save must not refetch.
 */
export async function saveDashboardLayout(
  input: DashboardLayout,
): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user?.id) return { ok: false };

  const layout = sanitizeLayout(input, DASHBOARD_SECTION_IDS);
  // Spread to a plain object literal for Prisma's Json input type (same as
  // saveModules in lib/services/app-settings.ts).
  const layoutJson = { order: layout.order, collapsed: layout.collapsed };
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { dashboardLayout: layoutJson },
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
