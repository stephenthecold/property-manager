/**
 * OAuth2 (XOAUTH2) access tokens for IMAP. Microsoft 365 disables IMAP Basic
 * Auth, so an O365 mailbox authenticates with a short-lived access token minted
 * here from the configured client. Two grants, chosen by what is configured:
 *   - a refresh token  -> refresh_token grant (delegated, IMAP.AccessAsUser.All)
 *   - no refresh token -> client_credentials grant (app-only, IMAP.AccessAsApp)
 * The default scope targets Outlook IMAP; other IdPs can override it.
 */

export const DEFAULT_IMAP_OAUTH_SCOPE = "https://outlook.office365.com/.default";

export interface ImapOauthConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope: string;
  /** When present, a delegated refresh-token grant is used instead of app-only. */
  refreshToken?: string | null;
}

/** Build the token-endpoint POST body. PURE — unit-tested without a network. */
export function buildImapTokenRequestBody(cfg: ImapOauthConfig): URLSearchParams {
  const body = new URLSearchParams();
  body.set("client_id", cfg.clientId);
  body.set("client_secret", cfg.clientSecret);
  body.set("scope", cfg.scope || DEFAULT_IMAP_OAUTH_SCOPE);
  if (cfg.refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", cfg.refreshToken);
  } else {
    body.set("grant_type", "client_credentials");
  }
  return body;
}

/** Fetch an access token from the OAuth2 token endpoint. Throws on failure. */
export async function fetchImapAccessToken(cfg: ImapOauthConfig): Promise<string> {
  if (!cfg.tokenUrl) {
    throw new Error("IMAP OAuth2 token URL is not set.");
  }
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: buildImapTokenRequestBody(cfg),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `IMAP OAuth2 token request failed (${res.status}): ${detail.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("IMAP OAuth2 token response had no access_token.");
  }
  return json.access_token;
}
