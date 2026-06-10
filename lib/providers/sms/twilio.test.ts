import { describe, it, expect } from "vitest";
import { TwilioSmsProvider } from "@/lib/providers/sms/twilio";
import { resetEnvCache } from "@/lib/config/env";

const OPTS = {
  accountSid: "AC00000000000000000000000000000000",
  authToken: "super-secret-token",
  fromNumber: "+15550001111",
  statusCallbackUrl: "https://app.example.com/api/sms/status",
};

const EXPECTED_AUTH = `Basic ${Buffer.from(
  `${OPTS.accountSid}:${OPTS.authToken}`,
).toString("base64")}`;

type RecordedCall = { url: string; init: RequestInit | undefined };

function fetchReturning(result: Response | Error) {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (result instanceof Error) throw result;
    return result;
  };
  return { impl, calls };
}

function twilioJson(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formParams(call: RecordedCall): URLSearchParams {
  return new URLSearchParams(String(call.init?.body));
}

function headersOf(call: RecordedCall): Record<string, string> {
  return (call.init?.headers ?? {}) as Record<string, string>;
}

function thrownMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected function to throw");
}

const ENV_KEYS = [
  "DATABASE_URL",
  "APP_URL",
  "SMS_ACCOUNT_SID",
  "SMS_AUTH_TOKEN",
  "SMS_FROM_NUMBER",
] as const;

async function withEnv(
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  resetEnvCache();
  try {
    await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnvCache();
  }
}

describe("TwilioSmsProvider constructor", () => {
  it("throws listing exactly the missing settings", async () => {
    await withEnv({}, () => {
      const message = thrownMessage(
        () => new TwilioSmsProvider({ fromNumber: OPTS.fromNumber }),
      );
      expect(message).toBe(
        "Twilio SMS provider is missing configuration: SMS_ACCOUNT_SID, SMS_AUTH_TOKEN",
      );
    });
  });

  it("throws listing all three when nothing is configured", async () => {
    await withEnv({}, () => {
      const message = thrownMessage(() => new TwilioSmsProvider());
      expect(message).toBe(
        "Twilio SMS provider is missing configuration: SMS_ACCOUNT_SID, SMS_AUTH_TOKEN, SMS_FROM_NUMBER",
      );
    });
  });

  it("falls back to env credentials and defaults StatusCallback for https APP_URL", async () => {
    await withEnv(
      {
        DATABASE_URL: "postgres://test/test",
        APP_URL: "https://rent.example.com",
        SMS_ACCOUNT_SID: "ACenv0000000000000000000000000000",
        SMS_AUTH_TOKEN: "env-token",
        SMS_FROM_NUMBER: "+15557772222",
      },
      async () => {
        const { impl, calls } = fetchReturning(
          twilioJson(201, { sid: "SMenv", status: "queued" }),
        );
        const provider = new TwilioSmsProvider({ fetchImpl: impl });
        const result = await provider.send({ to: "+15553334444", body: "hi" });

        expect(result.status).toBe("queued");
        const params = formParams(calls[0]);
        expect(params.get("From")).toBe("+15557772222");
        expect(params.get("StatusCallback")).toBe(
          "https://rent.example.com/api/sms/status",
        );
        expect(headersOf(calls[0]).Authorization).toBe(
          `Basic ${Buffer.from(
            "ACenv0000000000000000000000000000:env-token",
          ).toString("base64")}`,
        );
      },
    );
  });

  it("omits StatusCallback when APP_URL is not https", async () => {
    await withEnv(
      {
        DATABASE_URL: "postgres://test/test",
        APP_URL: "http://localhost:3000",
        SMS_ACCOUNT_SID: OPTS.accountSid,
        SMS_AUTH_TOKEN: OPTS.authToken,
        SMS_FROM_NUMBER: OPTS.fromNumber,
      },
      async () => {
        const { impl, calls } = fetchReturning(
          twilioJson(201, { sid: "SM1", status: "queued" }),
        );
        const provider = new TwilioSmsProvider({ fetchImpl: impl });
        await provider.send({ to: "+15553334444", body: "hi" });
        expect(formParams(calls[0]).has("StatusCallback")).toBe(false);
      },
    );
  });
});

describe("TwilioSmsProvider.send", () => {
  it("posts form-encoded params with basic auth and returns queued on 201", async () => {
    const { impl, calls } = fetchReturning(
      twilioJson(201, { sid: "SM123", status: "queued" }),
    );
    const provider = new TwilioSmsProvider({ ...OPTS, fetchImpl: impl });

    const result = await provider.send({
      to: "+15553334444",
      body: "Rent is due June 1",
    });

    expect(result).toEqual({
      provider: "twilio",
      status: "queued",
      providerMessageId: "SM123",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${OPTS.accountSid}/Messages.json`,
    );
    expect(calls[0].init?.method).toBe("POST");
    const headers = headersOf(calls[0]);
    expect(headers.Authorization).toBe(EXPECTED_AUTH);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const params = formParams(calls[0]);
    expect(params.get("To")).toBe("+15553334444");
    expect(params.get("From")).toBe(OPTS.fromNumber);
    expect(params.get("Body")).toBe("Rent is due June 1");
    expect(params.get("StatusCallback")).toBe(OPTS.statusCallbackUrl);
  });

  it.each([
    ["queued", "queued"],
    ["accepted", "queued"],
    ["sending", "queued"],
    ["sent", "sent"],
    ["delivered", "sent"],
    ["something-new", "queued"],
  ] as const)("maps twilio status %s to %s", async (twilioStatus, expected) => {
    const { impl } = fetchReturning(
      twilioJson(201, { sid: "SM1", status: twilioStatus }),
    );
    const provider = new TwilioSmsProvider({ ...OPTS, fetchImpl: impl });
    const result = await provider.send({ to: "+15553334444", body: "hi" });
    expect(result.status).toBe(expected);
  });

  it("returns failed with the API message on a 400 response", async () => {
    const { impl } = fetchReturning(
      twilioJson(400, {
        code: 21211,
        message: "The 'To' number is invalid.",
        status: 400,
      }),
    );
    const provider = new TwilioSmsProvider({ ...OPTS, fetchImpl: impl });
    const result = await provider.send({ to: "bogus", body: "hi" });
    expect(result).toEqual({
      provider: "twilio",
      status: "failed",
      error: "The 'To' number is invalid.",
    });
  });

  it("returns failed with HTTP code when the error body is not JSON", async () => {
    const { impl } = fetchReturning(new Response("Bad Gateway", { status: 502 }));
    const provider = new TwilioSmsProvider({ ...OPTS, fetchImpl: impl });
    const result = await provider.send({ to: "+15553334444", body: "hi" });
    expect(result).toEqual({
      provider: "twilio",
      status: "failed",
      error: "HTTP 502",
    });
  });

  it("returns failed instead of throwing on network errors", async () => {
    const { impl } = fetchReturning(new Error("fetch failed: ECONNREFUSED"));
    const provider = new TwilioSmsProvider({ ...OPTS, fetchImpl: impl });
    const result = await provider.send({ to: "+15553334444", body: "hi" });
    expect(result).toEqual({
      provider: "twilio",
      status: "failed",
      error: "fetch failed: ECONNREFUSED",
    });
    expect(result.error).not.toContain(OPTS.authToken);
  });
});

describe("TwilioSmsProvider.getStatus", () => {
  it("fetches the message resource and returns its status", async () => {
    const { impl, calls } = fetchReturning(
      twilioJson(200, { sid: "SM123", status: "delivered" }),
    );
    const provider = new TwilioSmsProvider({ ...OPTS, fetchImpl: impl });

    await expect(provider.getStatus("SM123")).resolves.toBe("delivered");
    expect(calls[0].url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${OPTS.accountSid}/Messages/SM123.json`,
    );
    expect(calls[0].init?.method).toBeUndefined();
    expect(headersOf(calls[0]).Authorization).toBe(EXPECTED_AUTH);
  });

  it("throws on a non-2xx response", async () => {
    const { impl } = fetchReturning(
      twilioJson(404, { code: 20404, message: "Not found", status: 404 }),
    );
    const provider = new TwilioSmsProvider({ ...OPTS, fetchImpl: impl });
    await expect(provider.getStatus("SM404")).rejects.toThrow("HTTP 404");
  });
});
