import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Container healthcheck (docker-compose `app.healthcheck` and external
 * monitors). Unauthenticated by design (allow-listed in auth.config.ts), so
 * the response carries NOTHING beyond a boolean — no version, no settings,
 * no timings that could fingerprint the deployment.
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Bounded DB ping: a hung pool must fail the check, not wedge it.
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db ping timeout")), 3000),
      ),
    ]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
