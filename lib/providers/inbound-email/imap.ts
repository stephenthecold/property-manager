import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type {
  InboundEmailAttachment,
  InboundEmailProvider,
  InboundPollResult,
  ParsedInboundEmail,
} from "@/lib/providers/inbound-email/types";
import {
  capBody,
  cleanMessageId,
  filterAttachments,
  htmlToText,
} from "@/lib/providers/inbound-email/parse";
import {
  fetchImapAccessToken,
  type ImapOauthConfig,
} from "@/lib/providers/inbound-email/imap-token";

/**
 * IMAP inbound provider (imapflow + mailparser). Worker-only. Searches the
 * mailbox for UNSEEN messages, parses each, hands it to the recorder, and only
 * then marks it \Seen — a crash before that leaves the message for the next
 * poll (the recorder dedups on messageId, so a re-fetch is harmless).
 */

export type ImapAuth =
  | { method: "password"; password: string }
  | ({ method: "oauth2" } & ImapOauthConfig);

export interface ImapProviderConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  folder: string;
  auth: ImapAuth;
}

/** mailparser ParsedMail -> our transport-neutral shape. PURE-ish (no I/O). */
export function normalizeParsedMail(parsed: ParsedMail): ParsedInboundEmail {
  const fromAddr = parsed.from?.value?.[0];
  const toAddress = parsed.to
    ? Array.isArray(parsed.to)
      ? parsed.to.map((t) => t.text).join(", ")
      : parsed.to.text
    : null;
  const html = typeof parsed.html === "string" ? parsed.html : null;
  const text =
    parsed.text && parsed.text.trim().length > 0 ? parsed.text : htmlToText(html);
  const attachments: InboundEmailAttachment[] = (parsed.attachments ?? [])
    .filter((a) => a.content)
    .map((a) => ({
      filename: a.filename ?? "attachment",
      contentType: a.contentType ?? null,
      content: a.content as Buffer,
    }));
  return {
    messageId: cleanMessageId(parsed.messageId),
    fromEmail: (fromAddr?.address ?? "").trim(),
    fromName: fromAddr?.name?.trim() || null,
    toAddress: toAddress || null,
    subject: parsed.subject ?? null,
    text: capBody(text),
    receivedAt: parsed.date ?? new Date(),
    attachments: filterAttachments(attachments),
  };
}

export class ImapInboundProvider implements InboundEmailProvider {
  readonly name = "imap";

  constructor(private readonly cfg: ImapProviderConfig) {}

  private async authConfig(): Promise<{
    user: string;
    pass?: string;
    accessToken?: string;
  }> {
    if (this.cfg.auth.method === "password") {
      return { user: this.cfg.user, pass: this.cfg.auth.password };
    }
    const result = await fetchImapAccessToken(this.cfg.auth);
    // Persist a rotated refresh token (Microsoft rotates on each grant) so a
    // delegated "Connect" mailbox keeps working long-term. Best-effort.
    if (
      result.refreshToken &&
      result.refreshToken !== this.cfg.auth.refreshToken &&
      this.cfg.auth.onRefreshToken
    ) {
      try {
        await this.cfg.auth.onRefreshToken(result.refreshToken);
      } catch (e) {
        console.error(
          "[inbox:imap] refresh-token persist failed:",
          e instanceof Error ? e.message : "unknown error",
        );
      }
    }
    return { user: this.cfg.user, accessToken: result.accessToken };
  }

  async poll(
    opts: { limit: number },
    onMessage: (m: ParsedInboundEmail) => Promise<void>,
  ): Promise<InboundPollResult> {
    const client = new ImapFlow({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.secure,
      auth: await this.authConfig(),
      logger: false,
    });

    let fetched = 0;
    let processed = 0;
    let failed = 0;

    await client.connect();
    try {
      const lock = await client.getMailboxLock(this.cfg.folder || "INBOX");
      try {
        const uids = (await client.search({ seen: false }, { uid: true })) || [];
        for (const uid of uids.slice(0, opts.limit)) {
          fetched++;
          try {
            const msg = await client.fetchOne(
              String(uid),
              { source: true },
              { uid: true },
            );
            if (!msg || !msg.source) {
              failed++;
              continue;
            }
            const parsed = normalizeParsedMail(await simpleParser(msg.source));
            await onMessage(parsed);
            // Mark \Seen only AFTER a successful record.
            await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
            processed++;
          } catch (e) {
            failed++;
            console.error(
              `[inbox:imap] message uid=${uid} failed:`,
              e instanceof Error ? e.message : "unknown error",
            );
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }

    return { fetched, processed, failed };
  }
}
