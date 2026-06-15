import { NextResponse } from "next/server";
import { clientIpFromXff } from "@/lib/http/client-ip";
import { consumeTrialToken } from "@/lib/services/impersonation";

export const runtime = "nodejs";

/**
 * Consume a single-use trial-login link: validate the token, mint an
 * impersonation portal session (cookie set inside consumeTrialToken), and
 * redirect into the portal. Public (under the /portal PUBLIC_PREFIX) — the
 * unguessable single-use token is the only credential. Invalid/expired/used
 * tokens bounce to the login with a neutral notice.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  try {
    const result = await consumeTrialToken(
      token,
      clientIpFromXff(req.headers.get("x-forwarded-for")),
      req.headers.get("user-agent"),
    );
    const dest = result.ok ? "/portal" : "/portal/login?error=trial";
    return NextResponse.redirect(new URL(dest, req.url));
  } catch {
    return NextResponse.redirect(new URL("/portal/login?error=trial", req.url));
  }
}
