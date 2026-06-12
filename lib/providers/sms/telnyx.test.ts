import { describe, it, expect } from "vitest";
import { TelnyxSmsProvider } from "@/lib/providers/sms/telnyx";
import { resetEnvCache } from "@/lib/config/env";

const OPTS = {
  apiKey: "KEY0123456789SECRET",
  fromNumber: "+15550001111",
};

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

function telnyxJson(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonBody(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
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

describe("TelnyxSmsProvider constructor", () => {
  it("throws listing exactly the missing settings", async () => {
    await withEnv({}, () => {
      const message = thrownMessage(
        () => new TelnyxSmsProvider({ fromNumber: OPTS.fromNumber }),
      );
      expect(message).toBe(
        "Telnyx SMS provider is missing configuration: SMS_AUTH_TOKEN (Telnyx API key)",
      );
    });
  });

  it("throws listing both when nothing is configured", async () => {
    await withEnv({}, () => {
      const message = thrownMessage(() => new TelnyxSmsProvider());
      expect(message).toBe(
        "Telnyx SMS provider is missing configuration: SMS_AUTH_TOKEN (Telnyx API key), SMS_FROM_NUMBER",
      );
    });
  });

  it("falls back to env credentials", async () => {
    await withEnv(
      {
        DATABASE_URL: "postgres://test/test",
        APP_URL: "https://rent.example.com",
        SMS_AUTH_TOKEN: "KEYenv",
        SMS_FROM_NUMBER: "+15557772222",
      },
      async () => {
        const { impl, calls } = fetchReturning(
          telnyxJson(200, {
            data: { id: "msg-env", to: [{ status: "queued" }] },
          }),
        );
        const provider = new TelnyxSmsProvider({ fetchImpl: impl });
        const result = await provider.send({ to: "+15553334444", body: "hi" });

        expect(result.status).toBe("queued");
        expect(jsonBody(calls[0]).from).toBe("+15557772222");
        expect(headersOf(calls[0]).Authorization).toBe("Bearer KEYenv");
      },
    );
  });
});

describe("TelnyxSmsProvider.send", () => {
  it("posts JSON with bearer auth and returns queued on 200", async () => {
    const { impl, calls } = fetchReturning(
      telnyxJson(200, {
        data: { id: "40385f64-5717", to: [{ status: "queued" }] },
      }),
    );
    const provider = new TelnyxSmsProvider({ ...OPTS, fetchImpl: impl });

    const result = await provider.send({
      to: "+15553334444",
      body: "Rent is due June 1",
    });

    expect(result).toEqual({
      provider: "telnyx",
      status: "queued",
      providerMessageId: "40385f64-5717",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.telnyx.com/v2/messages");
    expect(calls[0].init?.method).toBe("POST");
    const headers = headersOf(calls[0]);
    expect(headers.Authorization).toBe(`Bearer ${OPTS.apiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");

    expect(jsonBody(calls[0])).toEqual({
      from: OPTS.fromNumber,
      to: "+15553334444",
      text: "Rent is due June 1",
    });
  });

  it.each([
    ["queued", "queued"],
    ["sending", "queued"],
    ["sent", "sent"],
    ["delivered", "sent"],
    ["something-new", "queued"],
  ] as const)("maps telnyx status %s to %s", async (telnyxStatus, expected) => {
    const { impl } = fetchReturning(
      telnyxJson(200, { data: { id: "m1", to: [{ status: telnyxStatus }] } }),
    );
    const provider = new TelnyxSmsProvider({ ...OPTS, fetchImpl: impl });
    const result = await provider.send({ to: "+15553334444", body: "hi" });
    expect(result.status).toBe(expected);
  });

  it("returns failed with the API detail on a 422 response", async () => {
    const { impl } = fetchReturning(
      telnyxJson(422, {
        errors: [
          {
            code: "10015",
            title: "Bad Request",
            detail: "The to phone number is invalid.",
          },
        ],
      }),
    );
    const provider = new TelnyxSmsProvider({ ...OPTS, fetchImpl: impl });
    const result = await provider.send({ to: "bogus", body: "hi" });
    expect(result).toEqual({
      provider: "telnyx",
      status: "failed",
      error: "The to phone number is invalid.",
    });
  });

  it("returns failed with HTTP code when the error body is not JSON", async () => {
    const { impl } = fetchReturning(new Response("Bad Gateway", { status: 502 }));
    const provider = new TelnyxSmsProvider({ ...OPTS, fetchImpl: impl });
    const result = await provider.send({ to: "+15553334444", body: "hi" });
    expect(result).toEqual({
      provider: "telnyx",
      status: "failed",
      error: "HTTP 502",
    });
  });

  it("returns failed instead of throwing on network errors", async () => {
    const { impl } = fetchReturning(new Error("fetch failed: ECONNREFUSED"));
    const provider = new TelnyxSmsProvider({ ...OPTS, fetchImpl: impl });
    const result = await provider.send({ to: "+15553334444", body: "hi" });
    expect(result).toEqual({
      provider: "telnyx",
      status: "failed",
      error: "fetch failed: ECONNREFUSED",
    });
    expect(result.error).not.toContain(OPTS.apiKey);
  });
});

describe("TelnyxSmsProvider.getStatus", () => {
  it("fetches the message resource and returns its recipient status", async () => {
    const { impl, calls } = fetchReturning(
      telnyxJson(200, { data: { id: "m1", to: [{ status: "delivered" }] } }),
    );
    const provider = new TelnyxSmsProvider({ ...OPTS, fetchImpl: impl });

    await expect(provider.getStatus("m1")).resolves.toBe("delivered");
    expect(calls[0].url).toBe("https://api.telnyx.com/v2/messages/m1");
    expect(calls[0].init?.method).toBeUndefined();
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${OPTS.apiKey}`);
  });

  it("throws on a non-2xx response", async () => {
    const { impl } = fetchReturning(
      telnyxJson(404, { errors: [{ title: "Resource not found" }] }),
    );
    const provider = new TelnyxSmsProvider({ ...OPTS, fetchImpl: impl });
    await expect(provider.getStatus("missing")).rejects.toThrow("HTTP 404");
  });
});
