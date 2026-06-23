import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  buildCodeExchangeBody,
  decodeIdTokenEmail,
  generatePkce,
  isInboxOauthProvider,
  OAUTH_PROVIDERS,
} from "@/lib/providers/inbound-email/oauth-connect";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("isInboxOauthProvider", () => {
  it("accepts only the two known providers", () => {
    expect(isInboxOauthProvider("microsoft")).toBe(true);
    expect(isInboxOauthProvider("google")).toBe(true);
    expect(isInboxOauthProvider("yahoo")).toBe(false);
  });
});

describe("generatePkce", () => {
  it("produces a verifier whose S256 hash is the challenge", () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(base64url(createHash("sha256").update(verifier).digest()));
    // base64url: no +, /, or = padding
    expect(challenge).not.toMatch(/[+/=]/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe("buildAuthorizeUrl", () => {
  it("targets the Microsoft tenant endpoint with PKCE + response_mode", () => {
    const url = new URL(
      buildAuthorizeUrl({
        provider: "microsoft",
        tenant: "contoso.onmicrosoft.com",
        clientId: "cid",
        redirectUri: "https://app.example.com/api/inbox/oauth/microsoft/callback",
        scope: OAUTH_PROVIDERS.microsoft.defaultScope,
        state: "st",
        codeChallenge: "ch",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toContain("IMAP.AccessAsUser.All");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("response_mode")).toBe("query");
    // Microsoft must NOT get Google-only params.
    expect(url.searchParams.get("access_type")).toBeNull();
  });

  it("adds Google's offline-access + forced-consent params", () => {
    const url = new URL(
      buildAuthorizeUrl({
        provider: "google",
        tenant: null,
        clientId: "cid",
        redirectUri: "https://app.example.com/api/inbox/oauth/google/callback",
        scope: OAUTH_PROVIDERS.google.defaultScope,
        state: "st",
        codeChallenge: "ch",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("https://mail.google.com/");
  });
});

describe("provider scopes", () => {
  it("runtime imapScope omits OIDC scopes (Microsoft rejects mixing them on refresh)", () => {
    expect(OAUTH_PROVIDERS.microsoft.imapScope).toContain("IMAP.AccessAsUser.All");
    expect(OAUTH_PROVIDERS.microsoft.imapScope).not.toContain("openid");
    expect(OAUTH_PROVIDERS.microsoft.imapScope).not.toContain("email");
    expect(OAUTH_PROVIDERS.google.imapScope).toBe("https://mail.google.com/");
    // The AUTHORIZE scope still requests the id_token claims.
    expect(OAUTH_PROVIDERS.microsoft.defaultScope).toContain("openid");
  });
});

describe("buildCodeExchangeBody", () => {
  it("is an authorization_code grant carrying the PKCE verifier", () => {
    const body = buildCodeExchangeBody({
      clientId: "cid",
      clientSecret: "sec",
      code: "abc",
      redirectUri: "https://app.example.com/cb",
      codeVerifier: "ver",
    });
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("abc");
    expect(body.get("code_verifier")).toBe("ver");
    expect(body.get("client_secret")).toBe("sec");
  });
});

describe("decodeIdTokenEmail", () => {
  function idToken(claims: Record<string, unknown>): string {
    const payload = base64url(Buffer.from(JSON.stringify(claims), "utf8"));
    return `header.${payload}.sig`;
  }
  it("reads email, then preferred_username, then upn — lowercased", () => {
    expect(decodeIdTokenEmail(idToken({ email: "Person@Example.com" }))).toBe(
      "person@example.com",
    );
    expect(decodeIdTokenEmail(idToken({ preferred_username: "u@d.com" }))).toBe("u@d.com");
    expect(decodeIdTokenEmail(idToken({ upn: "u@d.com" }))).toBe("u@d.com");
  });
  it("returns null for missing/garbage/non-email", () => {
    expect(decodeIdTokenEmail(null)).toBeNull();
    expect(decodeIdTokenEmail("not-a-jwt")).toBeNull();
    expect(decodeIdTokenEmail(idToken({ sub: "123" }))).toBeNull();
  });
});
