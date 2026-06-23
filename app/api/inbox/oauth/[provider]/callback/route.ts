import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authorizeApiCapability } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { isInboxOauthProvider } from "@/lib/providers/inbound-email/oauth-connect";
import {
  completeInboxOauth,
  INBOX_OAUTH_COOKIE_PATH,
  INBOX_OAUTH_STATE_COOKIE,
} from "@/lib/services/inbox-oauth";

export const runtime = "nodejs";

/**
 * OAuth redirect callback for the inbox mailbox Connect flow. Admin-only.
 * Verifies the state cookie (CSRF) + PKCE inside completeInboxOauth, exchanges
 * the code for tokens, stores the refresh token, and bounces back to Settings
 * with a connected/error banner. Always clears the state cookie.
 */
export async function GET(
  req: Request,
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
  const finish = (res = NextResponse.redirect(settingsUrl)) => {
    res.cookies.set(INBOX_OAUTH_STATE_COOKIE, "", {
      path: INBOX_OAUTH_COOKIE_PATH,
      maxAge: 0,
    });
    return res;
  };

  if (!isInboxOauthProvider(provider)) {
    settingsUrl.searchParams.set("error", "Unknown mailbox provider.");
    return finish();
  }

  const url = new URL(req.url);
  const idpError =
    url.searchParams.get("error_description") || url.searchParams.get("error");
  if (idpError) {
    settingsUrl.searchParams.set("error", idpError.slice(0, 200));
    return finish();
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    settingsUrl.searchParams.set("error", "Missing code/state from the provider.");
    return finish();
  }

  const cookieValue = (await cookies()).get(INBOX_OAUTH_STATE_COOKIE)?.value;
  const result = await completeInboxOauth({
    provider,
    code,
    state,
    cookieValue,
    actor: {
      actorType: "user",
      actorId: auth.dbUser.id,
      actorEmail: auth.dbUser.email,
    },
  });
  if (result.ok) {
    settingsUrl.searchParams.set("connected", provider);
  } else {
    settingsUrl.searchParams.set("error", result.error);
  }
  return finish();
}
