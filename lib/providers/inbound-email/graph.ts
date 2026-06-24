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
 * Microsoft Graph inbound provider — the going-forward alternative to IMAP for
 * Microsoft 365 (Microsoft is retiring the legacy protocols). Worker-only, same
 * contract as the IMAP provider: it lists UNREAD messages in the Inbox, parses
 * each, hands it to the recorder, and only then marks it read — a crash before
 * that leaves the message for the next poll (the recorder dedups on messageId,
 * so a re-fetch is harmless).
 *
 * Delegated access via the signed-in mailbox (`/me`); the token is minted from
 * the stored refresh token exactly like the IMAP OAuth path (reusing
 * fetchImapAccessToken — a generic refresh_token grant), just with a Graph scope.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// The message fields we ask Graph for (keep $select tight — no need for the rest).
const MESSAGE_SELECT =
  "id,internetMessageId,subject,from,toRecipients,receivedDateTime,body,bodyPreview,hasAttachments";

export interface GraphProviderConfig {
  /** Signed-in mailbox address — identity/logging only; polling uses `/me`. */
  mailbox: string;
  auth: ImapOauthConfig;
}

/** Subset of a Graph message resource we read. Treated as UNTRUSTED input. */
export interface GraphMessage {
  id: string;
  internetMessageId?: string | null;
  subject?: string | null;
  from?: { emailAddress?: { name?: string | null; address?: string | null } } | null;
  toRecipients?: Array<{
    emailAddress?: { name?: string | null; address?: string | null };
  }> | null;
  receivedDateTime?: string | null;
  body?: { contentType?: string | null; content?: string | null } | null;
  bodyPreview?: string | null;
  hasAttachments?: boolean;
}

interface GraphAttachment {
  "@odata.type"?: string;
  name?: string | null;
  contentType?: string | null;
  /** Present only on #microsoft.graph.fileAttachment (base64). */
  contentBytes?: string | null;
}

/** Graph message JSON -> our transport-neutral shape. PURE (no I/O). */
export function normalizeGraphMessage(
  msg: GraphMessage,
  attachments: InboundEmailAttachment[],
): ParsedInboundEmail {
  const fromAddr = msg.from?.emailAddress;
  const toAddress =
    (msg.toRecipients ?? [])
      .map((r) => r.emailAddress?.address)
      .filter((a): a is string => !!a)
      .join(", ") || null;
  const isHtml = (msg.body?.contentType ?? "").toLowerCase() === "html";
  const rawBody = msg.body?.content ?? "";
  const body = isHtml ? htmlToText(rawBody) : rawBody;
  // Graph's bodyPreview is a safe plain-text fallback when the body is empty.
  const text = body.trim().length > 0 ? body : (msg.bodyPreview ?? "");
  return {
    messageId: cleanMessageId(msg.internetMessageId),
    fromEmail: (fromAddr?.address ?? "").trim(),
    fromName: fromAddr?.name?.trim() || null,
    toAddress,
    subject: msg.subject ?? null,
    text: capBody(text),
    receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
    attachments: filterAttachments(attachments),
  };
}

/** Build an informative Error from a non-OK Graph response (extracts error.message). */
async function graphError(op: string, res: Response): Promise<Error> {
  const raw = await res.text().catch(() => "");
  let detail = raw.slice(0, 200);
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } };
    if (j.error?.message) detail = j.error.message;
  } catch {
    // non-JSON body — keep the raw snippet
  }
  return new Error(`Microsoft Graph ${op} failed (${res.status}): ${detail}`);
}

export class GraphInboundProvider implements InboundEmailProvider {
  readonly name = "graph";

  constructor(private readonly cfg: GraphProviderConfig) {}

  private async accessToken(): Promise<string> {
    const result = await fetchImapAccessToken(this.cfg.auth);
    // Persist a rotated refresh token (Microsoft rotates on each grant) so a
    // delegated connection keeps working long-term. Best-effort.
    if (
      result.refreshToken &&
      result.refreshToken !== this.cfg.auth.refreshToken &&
      this.cfg.auth.onRefreshToken
    ) {
      try {
        await this.cfg.auth.onRefreshToken(result.refreshToken);
      } catch (e) {
        console.error(
          "[inbox:graph] refresh-token persist failed:",
          e instanceof Error ? e.message : "unknown error",
        );
      }
    }
    return result.accessToken;
  }

  private async fetchAttachments(
    id: string,
    headers: Record<string, string>,
  ): Promise<InboundEmailAttachment[]> {
    const res = await fetch(
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/attachments`,
      { headers },
    );
    if (!res.ok) throw await graphError("fetch attachments", res);
    const json = (await res.json()) as { value?: GraphAttachment[] };
    // Only file attachments carry bytes; item/reference attachments are skipped.
    return (json.value ?? [])
      .filter((a) => typeof a.contentBytes === "string" && a.contentBytes.length > 0)
      .map((a) => ({
        filename: a.name?.trim() || "attachment",
        contentType: a.contentType ?? null,
        content: Buffer.from(a.contentBytes as string, "base64"),
      }));
  }

  async poll(
    opts: { limit: number },
    onMessage: (m: ParsedInboundEmail) => Promise<void>,
  ): Promise<InboundPollResult> {
    const headers = { authorization: `Bearer ${await this.accessToken()}` };

    // No $orderby: Graph rejects ordering by a property that isn't also in
    // $filter ("The restriction or sort order is too complex for this
    // operation"). The default order is fine — we process up to $top unread per
    // poll; anything beyond stays unread and is picked up on the next tick (the
    // @odata.nextLink page is intentionally not followed — same per-poll cap as
    // the IMAP provider's slice(0, limit)).
    const url = new URL(`${GRAPH_BASE}/me/mailFolders/inbox/messages`);
    url.searchParams.set("$filter", "isRead eq false");
    url.searchParams.set("$top", String(opts.limit));
    url.searchParams.set("$select", MESSAGE_SELECT);

    const listRes = await fetch(url, { headers });
    if (!listRes.ok) throw await graphError("list messages", listRes);
    const messages = ((await listRes.json()) as { value?: GraphMessage[] }).value ?? [];

    let fetched = 0;
    let processed = 0;
    let failed = 0;
    for (const msg of messages) {
      fetched++;
      try {
        const attachments = msg.hasAttachments
          ? await this.fetchAttachments(msg.id, headers)
          : [];
        await onMessage(normalizeGraphMessage(msg, attachments));
        // Mark read only AFTER a successful record (mirrors IMAP \Seen). A
        // failure here is non-fatal: dedup on messageId makes a re-fetch safe.
        const patch = await fetch(
          `${GRAPH_BASE}/me/messages/${encodeURIComponent(msg.id)}`,
          {
            method: "PATCH",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ isRead: true }),
          },
        );
        if (!patch.ok) {
          console.error(
            `[inbox:graph] could not mark message read (id=${msg.id}): ${patch.status}`,
          );
        }
        processed++;
      } catch (e) {
        failed++;
        console.error(
          `[inbox:graph] message id=${msg.id} failed:`,
          e instanceof Error ? e.message : "unknown error",
        );
      }
    }
    return { fetched, processed, failed };
  }
}
