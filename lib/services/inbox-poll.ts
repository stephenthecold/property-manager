import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/auth/crypto";
import {
  INBOX_OAUTH_CLIENT_SECRET_AAD,
  INBOX_OAUTH_REFRESH_TOKEN_AAD,
  INBOX_PASSWORD_AAD,
} from "@/lib/services/app-settings";
import { recordInboundEmail } from "@/lib/services/inbound-email";
import { persistRotatedInboxRefreshToken } from "@/lib/services/inbox-oauth";
import type { InboundEmailProvider } from "@/lib/providers/inbound-email/types";
import { ImapInboundProvider } from "@/lib/providers/inbound-email/imap";
import { StubInboundProvider } from "@/lib/providers/inbound-email/stub";
import { DEFAULT_IMAP_OAUTH_SCOPE } from "@/lib/providers/inbound-email/imap-token";

/**
 * Inbound-mailbox polling. WORKER-ONLY: this module imports the IMAP client +
 * MIME parser, so it must never be pulled into an app route (the inbox UI reads
 * from lib/services/inbound-email.ts instead). Secrets are decrypted here, at
 * poll time, and never leave the worker.
 */

/**
 * Resolve the configured inbound-email provider from AppSettings, or null when
 * the mailbox module/poll is off or the config is incomplete (the poll then
 * no-ops rather than throwing).
 */
export async function resolveInboxProvider(): Promise<InboundEmailProvider | null> {
  const row = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (!row?.inboxEnabled) return null;
  // Honor the module flag too (the UI hides when off; the poll respects it).
  const modules = (row.modules ?? {}) as Record<string, unknown>;
  if (modules.mailbox !== true) return null;

  if (row.inboxProvider === "stub") return new StubInboundProvider();
  if (row.inboxProvider !== "imap") return null;

  const host = row.inboxImapHost;
  const user = row.inboxImapUser;
  if (!host || !user) return null;
  const common = {
    host,
    user,
    port: row.inboxImapPort ?? 993,
    secure: row.inboxImapSecure,
    folder: row.inboxFolder?.trim() || "INBOX",
  };

  if (row.inboxAuthMethod === "oauth2") {
    if (
      !row.inboxOauthClientId ||
      !row.inboxOauthTokenUrl ||
      !row.inboxOauthClientSecretCiphertext ||
      !row.inboxOauthClientSecretNonce ||
      !row.inboxOauthClientSecretTag
    ) {
      return null;
    }
    const clientSecret = decryptSecret(
      {
        ciphertext: row.inboxOauthClientSecretCiphertext,
        nonce: row.inboxOauthClientSecretNonce,
        tag: row.inboxOauthClientSecretTag,
      },
      INBOX_OAUTH_CLIENT_SECRET_AAD,
    );
    const refreshToken =
      row.inboxOauthRefreshTokenCiphertext &&
      row.inboxOauthRefreshTokenNonce &&
      row.inboxOauthRefreshTokenTag
        ? decryptSecret(
            {
              ciphertext: row.inboxOauthRefreshTokenCiphertext,
              nonce: row.inboxOauthRefreshTokenNonce,
              tag: row.inboxOauthRefreshTokenTag,
            },
            INBOX_OAUTH_REFRESH_TOKEN_AAD,
          )
        : null;
    return new ImapInboundProvider({
      ...common,
      auth: {
        method: "oauth2",
        clientId: row.inboxOauthClientId,
        clientSecret,
        tokenUrl: row.inboxOauthTokenUrl,
        scope: row.inboxOauthScope?.trim() || DEFAULT_IMAP_OAUTH_SCOPE,
        refreshToken,
        // Persist a rotated refresh token (Microsoft rotates each grant) so a
        // delegated "Connect" mailbox keeps working without re-consent.
        onRefreshToken: persistRotatedInboxRefreshToken,
      },
    });
  }

  // Password auth (self-hosted / Gmail app password).
  if (
    !row.inboxPasswordCiphertext ||
    !row.inboxPasswordNonce ||
    !row.inboxPasswordTag
  ) {
    return null;
  }
  const password = decryptSecret(
    {
      ciphertext: row.inboxPasswordCiphertext,
      nonce: row.inboxPasswordNonce,
      tag: row.inboxPasswordTag,
    },
    INBOX_PASSWORD_AAD,
  );
  return new ImapInboundProvider({
    ...common,
    auth: { method: "password", password },
  });
}

export interface InboxPollSummary {
  skipped: boolean;
  fetched: number;
  processed: number;
  failed: number;
}

/** One inbox poll: fetch new mail and record it. Safe to run on a schedule. */
export async function runInboxPollOnce(): Promise<InboxPollSummary> {
  const provider = await resolveInboxProvider();
  if (!provider) return { skipped: true, fetched: 0, processed: 0, failed: 0 };
  const res = await provider.poll({ limit: 50 }, async (m) => {
    await recordInboundEmail(m);
  });
  return { skipped: false, ...res };
}
