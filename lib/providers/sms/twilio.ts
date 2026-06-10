import type {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from "@/lib/providers/sms/types";
import { getEnv } from "@/lib/config/env";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export interface TwilioSmsProviderOptions {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  statusCallbackUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Twilio send statuses that mean the message already left Twilio's queue. */
function mapSendStatus(status: unknown): "queued" | "sent" {
  return status === "sent" || status === "delivered" ? "sent" : "queued";
}

// getEnv() fails fast on keys unrelated to SMS (e.g. DATABASE_URL). When the
// provider is constructed with explicit options (tests, one-off scripts), a
// failed env parse just means "no env fallback available" — getSmsProvider()
// already surfaced any real env error before constructing this class.
function tryGetEnv(): ReturnType<typeof getEnv> | undefined {
  try {
    return getEnv();
  } catch {
    return undefined;
  }
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";

  private readonly accountSid: string;
  private readonly fromNumber: string;
  private readonly authHeader: string;
  private readonly statusCallbackUrl?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts?: TwilioSmsProviderOptions) {
    const needsEnv =
      !opts?.accountSid ||
      !opts?.authToken ||
      !opts?.fromNumber ||
      opts?.statusCallbackUrl === undefined;
    const env = needsEnv ? tryGetEnv() : undefined;

    const accountSid = opts?.accountSid ?? env?.SMS_ACCOUNT_SID;
    const authToken = opts?.authToken ?? env?.SMS_AUTH_TOKEN;
    const fromNumber = opts?.fromNumber ?? env?.SMS_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      const missing = [
        !accountSid && "SMS_ACCOUNT_SID",
        !authToken && "SMS_AUTH_TOKEN",
        !fromNumber && "SMS_FROM_NUMBER",
      ].filter(Boolean);
      throw new Error(
        `Twilio SMS provider is missing configuration: ${missing.join(", ")}`,
      );
    }

    this.accountSid = accountSid;
    this.fromNumber = fromNumber;
    this.authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
    // Twilio rejects plain-http callback URLs, so the default applies only to
    // https deployments; otherwise StatusCallback is omitted entirely.
    this.statusCallbackUrl =
      opts?.statusCallbackUrl ??
      (env?.APP_URL.startsWith("https://")
        ? `${env.APP_URL.replace(/\/+$/, "")}/api/sms/status`
        : undefined);
    this.fetchImpl = opts?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const params = new URLSearchParams({
      To: input.to,
      From: this.fromNumber,
      Body: input.body,
    });
    if (this.statusCallbackUrl) {
      params.set("StatusCallback", this.statusCallbackUrl);
    }

    try {
      const res = await this.fetchImpl(
        `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: this.authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        },
      );
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        return {
          provider: this.name,
          status: "failed",
          error:
            typeof body.message === "string"
              ? body.message
              : `HTTP ${res.status}`,
        };
      }
      return {
        provider: this.name,
        status: mapSendStatus(body.status),
        providerMessageId: typeof body.sid === "string" ? body.sid : undefined,
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
      `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(this.accountSid)}/Messages/${encodeURIComponent(providerMessageId)}.json`,
      { headers: { Authorization: this.authHeader } },
    );
    if (!res.ok) {
      throw new Error(`Twilio message status lookup failed: HTTP ${res.status}`);
    }
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return typeof body.status === "string" ? body.status : "unknown";
  }
}
