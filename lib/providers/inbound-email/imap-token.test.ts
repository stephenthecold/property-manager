import { describe, expect, it } from "vitest";
import {
  buildImapTokenRequestBody,
  DEFAULT_IMAP_OAUTH_SCOPE,
} from "@/lib/providers/inbound-email/imap-token";

describe("buildImapTokenRequestBody", () => {
  it("uses the client_credentials (app-only) grant when no refresh token is set", () => {
    const body = buildImapTokenRequestBody({
      clientId: "cid",
      clientSecret: "sec",
      tokenUrl: "https://login.microsoftonline.com/t/oauth2/v2.0/token",
      scope: "",
    });
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("sec");
    // Blank scope falls back to the Outlook IMAP default.
    expect(body.get("scope")).toBe(DEFAULT_IMAP_OAUTH_SCOPE);
    expect(body.get("refresh_token")).toBeNull();
  });

  it("uses the refresh_token (delegated) grant when a refresh token is present", () => {
    const body = buildImapTokenRequestBody({
      clientId: "cid",
      clientSecret: "sec",
      tokenUrl: "https://login.microsoftonline.com/t/oauth2/v2.0/token",
      scope: "https://outlook.office365.com/IMAP.AccessAsUser.All offline_access",
      refreshToken: "rt",
    });
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt");
    expect(body.get("scope")).toContain("IMAP.AccessAsUser.All");
  });
});
