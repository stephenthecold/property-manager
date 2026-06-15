"use server";

import { redirect } from "next/navigation";
import { destroyPortalSession } from "@/lib/portal/session";

/**
 * Exit an impersonation session: drop the portal cookie and return the staff
 * member to the dashboard (their staff session is untouched). Kept in its own
 * file so the banner can use it without pulling in the tenant-side actions.
 */
export async function exitImpersonationAction(): Promise<void> {
  await destroyPortalSession();
  redirect("/dashboard");
}
