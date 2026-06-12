import { createTransport } from "nodemailer";
import type {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from "@/lib/providers/email/types";

/**
 * SMTP sender. Auth is either a plain password (app passwords included) or
 * OAuth2/XOAUTH2 — for Gmail the token endpoint defaults inside nodemailer;
 * Microsoft 365 needs tokenUrl set to
 * https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token.
 */

export type SmtpAuth =
  | { method: "password"; password: string }
  | {
      method: "oauth2";
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      /** OAuth2 token endpoint; omit for Gmail (nodemailer's default). */
      tokenUrl?: string | null;
    };

export interface SmtpConnectionOptions {
  host: string;
  /** 465 with secure=true (implicit TLS) or 587 with secure=false (STARTTLS). */
  port: number;
  secure: boolean;
  user: string;
  auth: SmtpAuth;
}

export interface SmtpEmailProviderOptions extends SmtpConnectionOptions {
  fromAddress: string;
  fromName?: string | null;
  /** Test seam: replaces nodemailer's transport construction. */
  transportFactory?: (options: SmtpTransportOptions) => MailTransport;
}

/** The slice of a nodemailer transporter this provider uses. */
export interface MailTransport {
  sendMail(mail: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{ messageId?: string }>;
}

export type SmtpTransportOptions = ReturnType<typeof smtpTransportOptions>;

/** Pure mapping from our config shape to nodemailer transport options. */
export function smtpTransportOptions(o: SmtpConnectionOptions) {
  if (o.auth.method === "password") {
    return {
      host: o.host,
      port: o.port,
      secure: o.secure,
      auth: { user: o.user, pass: o.auth.password },
    };
  }
  return {
    host: o.host,
    port: o.port,
    secure: o.secure,
    auth: {
      type: "OAuth2" as const,
      user: o.user,
      clientId: o.auth.clientId,
      clientSecret: o.auth.clientSecret,
      refreshToken: o.auth.refreshToken,
      // nodemailer calls the token endpoint "accessUrl" and defaults to Gmail's.
      ...(o.auth.tokenUrl ? { accessUrl: o.auth.tokenUrl } : {}),
    },
  };
}

/** RFC 5322 display-name + address ("Property Manager" <pm@example.com>). */
export function formatFromHeader(
  fromAddress: string,
  fromName?: string | null,
): string {
  const name = fromName?.trim();
  if (!name) return fromAddress;
  return `"${name.replace(/["\\]/g, "")}" <${fromAddress}>`;
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  private readonly transport: MailTransport;
  private readonly from: string;

  constructor(opts: SmtpEmailProviderOptions) {
    if (!opts.host || !opts.user || !opts.fromAddress) {
      const missing = [
        !opts.host && "host",
        !opts.user && "user",
        !opts.fromAddress && "from address",
      ].filter(Boolean);
      throw new Error(
        `SMTP email provider is missing configuration: ${missing.join(", ")}`,
      );
    }
    const factory =
      opts.transportFactory ??
      ((options: SmtpTransportOptions) => createTransport(options));
    this.transport = factory(smtpTransportOptions(opts));
    this.from = formatFromHeader(opts.fromAddress, opts.fromName);
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
      return {
        provider: this.name,
        status: "sent",
        providerMessageId: info.messageId,
      };
    } catch (e) {
      return {
        provider: this.name,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
