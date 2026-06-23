import { NextResponse } from "next/server";
import { authorizeApiCapability } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { isInboxOauthProvider } from "@/lib/providers/inbound-email/oauth-connect";
import {
  beginInboxOauth,
  INBOX_OAUTH_COOKIE_PATH,
  INBOX_OAUTH_STATE_COOKIE,
} from "@/lib/services/inbox-oauth";

export const runtime = "nodejs";

/**
 * Start the inbox mailbox OAuth "Connect" redirect. Admin-only (messaging.
 * settings). Sets a short-lived, encrypted state+PKCE cookie and 302s to the
 * IdP. The callback verifies that cookie.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const auth = await authorizeApiCapability("messaging.settings");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status },
    );
  }
  const { provider } = await params;
  const settingsUrl = new URL("/settings/inbox", getEnv().APP_URL);
  if (!isInboxOauthProvider(provider)) {
    settingsUrl.searchParams.set("error", "Unknown mailbox provider.");
    return NextResponse.redirect(settingsUrl);
  }
  try {
    const { redirectUrl, cookie } = await beginInboxOauth(provider);
    const res = NextResponse.redirect(redirectUrl);
    res.cookies.set(INBOX_OAUTH_STATE_COOKIE, cookie, {
      httpOnly: true,
      secure: getEnv().APP_URL.startsWith("https://"),
      sameSite: "lax",
      path: INBOX_OAUTH_COOKIE_PATH,
      maxAge: 600,
    });
    return res;
  } catch (e) {
    settingsUrl.searchParams.set(
      "error",
      e instanceof Error ? e.message : "Could not start Connect.",
    );
    return NextResponse.redirect(settingsUrl);
  }
}
