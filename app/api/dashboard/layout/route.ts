import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { DASHBOARD_SECTION_IDS, sanitizeLayout } from "@/lib/dashboard/layout";

export const runtime = "nodejs";

/**
 * Persist the signed-in user's personal dashboard layout. Deliberately an API
 * route (not a Server Action): a Server Action invalidates the router cache and
 * forces an RSC refetch of the dashboard on every collapse/reorder, which was
 * surfacing as "This page couldn't load". A plain fetch touches nothing but the
 * caller's own User row — a private UI preference, un-audited.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user?.id) return NextResponse.json({ ok: false }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const layout = sanitizeLayout(body, DASHBOARD_SECTION_IDS);
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { dashboardLayout: { order: layout.order, collapsed: layout.collapsed } },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
