import type {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from "@/lib/providers/sms/types";
import { getEnv } from "@/lib/config/env";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

export interface TelnyxSmsProviderOptions {
  /** Telnyx API key (the "KEY..." v2 key). Env fallback: SMS_AUTH_TOKEN. */
  apiKey?: string;
  fromNumber?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Telnyx v2 Messages API. Configuration maps onto the shared SMS env vars:
 * SMS_AUTH_TOKEN holds the API key and SMS_FROM_NUMBER the sender;
 * SMS_ACCOUNT_SID is unused (Telnyx authenticates with the key alone).
 *
 * Inbound + delivery-status webhooks are handled at /api/sms/inbound (Telnyx
 * posts both message.received and message.sent/finalized to that one URL),
 * verified with Ed25519 against the account PUBLIC key (Settings → Messaging).
 * Rows advance to delivered/failed with the carrier error; getStatus() also
 * supports on-demand lookups.
 */
export class TelnyxSmsProvider implements SmsProvider {
  readonly name = "telnyx";

  private readonly fromNumber: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts?: TelnyxSmsProviderOptions) {
    let env: ReturnType<typeof getEnv> | undefined;
    if (!opts?.apiKey || !opts?.fromNumber) {
      // Same rationale as TwilioSmsProvider: explicit options must not require
      // a fully valid env (tests, scripts) — a failed parse means "no fallback".
      try {
        env = getEnv();
      } catch {
        env = undefined;
      }
    }

    const apiKey = opts?.apiKey ?? env?.SMS_AUTH_TOKEN;
    const fromNumber = opts?.fromNumber ?? env?.SMS_FROM_NUMBER;
    if (!apiKey || !fromNumber) {
      const missing = [
        !apiKey && "SMS_AUTH_TOKEN (Telnyx API key)",
        !fromNumber && "SMS_FROM_NUMBER",
      ].filter(Boolean);
      throw new Error(
        `Telnyx SMS provider is missing configuration: ${missing.join(", ")}`,
      );
    }

    this.fromNumber = fromNumber;
    this.authHeader = `Bearer ${apiKey}`;
    this.fetchImpl = opts?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    try {
      const res = await this.fetchImpl(`${TELNYX_API_BASE}/messages`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.fromNumber,
          to: input.to,
          text: input.body,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { id?: unknown; to?: { status?: unknown }[] };
        errors?: { title?: unknown; detail?: unknown }[];
      };
      if (!res.ok) {
        const err = body.errors?.[0];
        const detail =
          typeof err?.detail === "string"
            ? err.detail
            : typeof err?.title === "string"
              ? err.title
              : `HTTP ${res.status}`;
        return { provider: this.name, status: "failed", error: detail };
      }
      const recipientStatus = body.data?.to?.[0]?.status;
      return {
        provider: this.name,
        status:
          recipientStatus === "sent" || recipientStatus === "delivered"
            ? "sent"
            : "queued",
        providerMessageId:
          typeof body.data?.id === "string" ? body.data.id : undefined,
      };
    } catch (e) {
      return {
        provider: this.name,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async getStatus(providerMessageId: string): Promise<string> {
    const res = await this.fetchImpl(
      `${TELNYX_API_BASE}/messages/${encodeURIComponent(providerMessageId)}`,
      { headers: { Authorization: this.authHeader } },
    );
    if (!res.ok) {
      throw new Error(`Telnyx message status lookup failed: HTTP ${res.status}`);
    }
    const body = (await res.json().catch(() => ({}))) as {
      data?: { to?: { status?: unknown }[] };
    };
    const status = body.data?.to?.[0]?.status;
    return typeof status === "string" ? status : "unknown";
  }
}
