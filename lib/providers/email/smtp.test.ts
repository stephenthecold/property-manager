import { describe, it, expect } from "vitest";
import {
  formatFromHeader,
  SmtpEmailProvider,
  smtpTransportOptions,
  type MailTransport,
} from "@/lib/providers/email/smtp";

const BASE = {
  host: "smtp.example.com",
  port: 465,
  secure: true,
  user: "rent@example.com",
};

const FROM = { fromAddress: "rent@example.com", fromName: "Acme Rentals" };

function fakeTransport(result: { messageId?: string } | Error) {
  const sent: Array<Record<string, string>> = [];
  const transport: MailTransport = {
    async sendMail(mail) {
      sent.push(mail as unknown as Record<string, string>);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { transport, sent };
}

describe("smtpTransportOptions", () => {
  it("maps password auth to user/pass", () => {
    expect(
      smtpTransportOptions({
        ...BASE,
        auth: { method: "password", password: "app-password" },
      }),
    ).toEqual({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "rent@example.com", pass: "app-password" },
    });
  });

  it("maps oauth2 auth to XOAUTH2 with nodemailer's Gmail default token URL", () => {
    const options = smtpTransportOptions({
      ...BASE,
      auth: {
        method: "oauth2",
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
      },
    });
    expect(options.auth).toEqual({
      type: "OAuth2",
      user: "rent@example.com",
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
    });
    expect("accessUrl" in options.auth).toBe(false);
  });

  it("passes a custom token URL through as accessUrl (Microsoft 365)", () => {
    const options = smtpTransportOptions({
      ...BASE,
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: {
        method: "oauth2",
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "refresh-token",
        tokenUrl: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
      },
    });
    expect(options).toMatchObject({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: {
        type: "OAuth2",
        accessUrl: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
      },
    });
  });
});

describe("formatFromHeader", () => {
  it("returns the bare address without a name", () => {
    expect(formatFromHeader("rent@example.com")).toBe("rent@example.com");
    expect(formatFromHeader("rent@example.com", "  ")).toBe("rent@example.com");
  });

  it("quotes the display name and strips quote/backslash characters", () => {
    expect(formatFromHeader("rent@example.com", 'Acme "Rentals"\\')).toBe(
      '"Acme Rentals" <rent@example.com>',
    );
  });
});

describe("SmtpEmailProvider", () => {
  it("throws listing exactly the missing configuration", () => {
    expect(
      () =>
        new SmtpEmailProvider({
          ...BASE,
          host: "",
          fromAddress: "",
          fromName: null,
          auth: { method: "password", password: "x" },
        }),
    ).toThrow("SMTP email provider is missing configuration: host, from address");
  });

  it("sends with the formatted from header and returns the message id", async () => {
    const { transport, sent } = fakeTransport({ messageId: "<id-1@example>" });
    const provider = new SmtpEmailProvider({
      ...BASE,
      ...FROM,
      auth: { method: "password", password: "pw" },
      transportFactory: () => transport,
    });

    const result = await provider.send({
      to: "tenant@example.com",
      subject: "Rent receipt",
      text: "Amount received: $1,250.00",
    });

    expect(result).toEqual({
      provider: "smtp",
      status: "sent",
      providerMessageId: "<id-1@example>",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      from: '"Acme Rentals" <rent@example.com>',
      to: "tenant@example.com",
      subject: "Rent receipt",
      text: "Amount received: $1,250.00",
    });
  });

  it("returns failed instead of throwing when the transport errors", async () => {
    const { transport } = fakeTransport(
      new Error("Invalid login: 535 Authentication failed"),
    );
    const provider = new SmtpEmailProvider({
      ...BASE,
      ...FROM,
      auth: { method: "password", password: "wrong" },
      transportFactory: () => transport,
    });

    const result = await provider.send({
      to: "tenant@example.com",
      subject: "Rent receipt",
      text: "body",
    });

    expect(result).toEqual({
      provider: "smtp",
      status: "failed",
      error: "Invalid login: 535 Authentication failed",
    });
  });
});
