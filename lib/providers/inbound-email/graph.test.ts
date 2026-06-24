import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GraphInboundProvider,
  normalizeGraphMessage,
  type GraphMessage,
} from "@/lib/providers/inbound-email/graph";
import type { ParsedInboundEmail } from "@/lib/providers/inbound-email/types";

const baseMsg: GraphMessage = {
  id: "AAA",
  internetMessageId: "<abc@ex.com>",
  subject: "Invoice 42",
  from: { emailAddress: { name: "Acme Billing", address: "billing@acme.com" } },
  toRecipients: [{ emailAddress: { address: "info@newedge.com" } }],
  receivedDateTime: "2026-06-24T10:00:00Z",
  body: { contentType: "text", content: "Please pay $50." },
  hasAttachments: false,
};

describe("normalizeGraphMessage", () => {
  it("maps core fields and strips the Message-ID brackets", () => {
    const p = normalizeGraphMessage(baseMsg, []);
    expect(p.messageId).toBe("abc@ex.com");
    expect(p.fromEmail).toBe("billing@acme.com");
    expect(p.fromName).toBe("Acme Billing");
    expect(p.toAddress).toBe("info@newedge.com");
    expect(p.subject).toBe("Invoice 42");
    expect(p.text).toBe("Please pay $50.");
    expect(p.receivedAt.toISOString()).toBe("2026-06-24T10:00:00.000Z");
  });

  it("converts an HTML body to text and never keeps raw HTML/script", () => {
    const p = normalizeGraphMessage(
      {
        ...baseMsg,
        body: {
          contentType: "html",
          content: "<p>Hi <b>there</b></p><script>alert(1)</script>",
        },
      },
      [],
    );
    expect(p.text).toContain("Hi");
    expect(p.text).toContain("there");
    expect(p.text).not.toContain("<");
    expect(p.text).not.toContain("alert"); // <script> stripped
  });

  it("falls back to bodyPreview when the body is empty", () => {
    const p = normalizeGraphMessage(
      { ...baseMsg, body: { contentType: "html", content: "" }, bodyPreview: "Preview." },
      [],
    );
    expect(p.text).toBe("Preview.");
  });

  it("keeps only safe attachments (delegates to filterAttachments)", () => {
    const pdf = {
      filename: "inv.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.4 test"),
    };
    const exe = {
      filename: "x.exe",
      contentType: "application/octet-stream",
      content: Buffer.from("MZ"),
    };
    const p = normalizeGraphMessage(baseMsg, [pdf, exe]);
    expect(p.attachments.map((a) => a.filename)).toEqual(["inv.pdf"]);
  });

  it("tolerates a missing Message-ID / sender / recipients", () => {
    const p = normalizeGraphMessage({ id: "X" }, []);
    expect(p.messageId).toBeNull();
    expect(p.fromEmail).toBe("");
    expect(p.fromName).toBeNull();
    expect(p.toAddress).toBeNull();
  });
});

describe("GraphInboundProvider.poll", () => {
  afterEach(() => vi.unstubAllGlobals());

  const auth = {
    clientId: "cid",
    clientSecret: "sec",
    tokenUrl: "https://login.test/token",
    scope: "https://graph.microsoft.com/Mail.ReadWrite offline_access",
    refreshToken: "rt-old",
  };

  it("lists unread, records each, fetches attachments only when present, and marks read", async () => {
    const calls: { method: string; url: string }[] = [];
    const listJson = {
      value: [
        {
          id: "M1",
          internetMessageId: "<m1@x>",
          from: { emailAddress: { address: "a@x.com" } },
          receivedDateTime: "2026-06-24T10:00:00Z",
          body: { contentType: "text", content: "hello" },
          hasAttachments: true,
        },
        {
          id: "M2",
          internetMessageId: "<m2@x>",
          from: { emailAddress: { address: "b@x.com" } },
          receivedDateTime: "2026-06-24T11:00:00Z",
          body: { contentType: "text", content: "world" },
          hasAttachments: false,
        },
      ],
    };
    const attJson = {
      value: [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: "inv.pdf",
          contentType: "application/pdf",
          contentBytes: Buffer.from("%PDF-1.4 invoice").toString("base64"),
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        const url = typeof input === "string" ? input : String(input);
        calls.push({ method: init?.method ?? "GET", url });
        if (url.includes("/token"))
          return new Response(
            JSON.stringify({ access_token: "at", refresh_token: "rt-new" }),
            { status: 200 },
          );
        if (url.includes("/me/mailFolders/inbox/messages"))
          return new Response(JSON.stringify(listJson), { status: 200 });
        if (url.includes("/attachments"))
          return new Response(JSON.stringify(attJson), { status: 200 });
        return new Response("{}", { status: 200 }); // PATCH mark-read
      }),
    );

    const recorded: ParsedInboundEmail[] = [];
    const res = await new GraphInboundProvider({ mailbox: "info@x.com", auth }).poll(
      { limit: 50 },
      async (m) => {
        recorded.push(m);
      },
    );

    expect(res).toEqual({ fetched: 2, processed: 2, failed: 0 });
    expect(recorded.map((m) => m.messageId)).toEqual(["m1@x", "m2@x"]);
    expect(recorded[0].attachments).toHaveLength(1);
    expect(recorded[1].attachments).toHaveLength(0);
    // M2 has no attachments → no attachment fetch for it.
    expect(calls.some((c) => c.url.includes("/me/messages/M2/attachments"))).toBe(false);
    // Each recorded message is marked read (PATCH) after success.
    expect(calls.filter((c) => c.method === "PATCH").length).toBe(2);

    // Regression: Graph 400s ("restriction or sort order is too complex") if
    // $orderby names a property that isn't in $filter — so the list query must
    // carry the unread filter and must NOT use $orderby.
    const listCall = calls.find((c) =>
      c.url.includes("/me/mailFolders/inbox/messages"),
    );
    expect(listCall?.url).toContain("isRead");
    expect(listCall?.url.toLowerCase()).not.toContain("orderby");
  });

  it("isolates a per-message record failure: counts it failed and does NOT mark it read", async () => {
    const calls: { method: string; url: string }[] = [];
    const listJson = {
      value: [
        {
          id: "BAD",
          internetMessageId: "<bad@x>",
          from: { emailAddress: { address: "a@x.com" } },
          receivedDateTime: "2026-06-24T10:00:00Z",
          body: { contentType: "text", content: "x" },
          hasAttachments: false,
        },
        {
          id: "OK",
          internetMessageId: "<ok@x>",
          from: { emailAddress: { address: "b@x.com" } },
          receivedDateTime: "2026-06-24T11:00:00Z",
          body: { contentType: "text", content: "y" },
          hasAttachments: false,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        const url = typeof input === "string" ? input : String(input);
        calls.push({ method: init?.method ?? "GET", url });
        if (url.includes("/token"))
          return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
        if (url.includes("/me/mailFolders/inbox/messages"))
          return new Response(JSON.stringify(listJson), { status: 200 });
        return new Response("{}", { status: 200 });
      }),
    );
    const res = await new GraphInboundProvider({ mailbox: "m", auth }).poll(
      { limit: 50 },
      async (m) => {
        if (m.messageId === "bad@x") throw new Error("record failed");
      },
    );
    expect(res).toEqual({ fetched: 2, processed: 1, failed: 1 });
    // The failed message must NOT be marked read (so it retries next poll).
    expect(
      calls.some((c) => c.method === "PATCH" && c.url.includes("/messages/BAD")),
    ).toBe(false);
    expect(
      calls.some((c) => c.method === "PATCH" && c.url.includes("/messages/OK")),
    ).toBe(true);
  });

  it("counts a message processed even when marking it read fails (dedup covers re-fetch)", async () => {
    const listJson = {
      value: [
        {
          id: "M1",
          internetMessageId: "<m1@x>",
          from: { emailAddress: { address: "a@x.com" } },
          receivedDateTime: "2026-06-24T10:00:00Z",
          body: { contentType: "text", content: "x" },
          hasAttachments: false,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/token"))
          return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
        if (url.includes("/me/mailFolders/inbox/messages"))
          return new Response(JSON.stringify(listJson), { status: 200 });
        if (init?.method === "PATCH") return new Response("forbidden", { status: 403 });
        return new Response("{}", { status: 200 });
      }),
    );
    const recorded: string[] = [];
    const res = await new GraphInboundProvider({ mailbox: "m", auth }).poll(
      { limit: 50 },
      async (m) => void recorded.push(m.messageId ?? ""),
    );
    expect(recorded).toEqual(["m1@x"]);
    expect(res).toEqual({ fetched: 1, processed: 1, failed: 0 });
  });

  it("persists a rotated refresh token", async () => {
    const persisted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/token"))
          return new Response(
            JSON.stringify({ access_token: "at", refresh_token: "rt-rotated" }),
            { status: 200 },
          );
        if (url.includes("/me/mailFolders/inbox/messages"))
          return new Response(JSON.stringify({ value: [] }), { status: 200 });
        return new Response("{}", { status: 200 });
      }),
    );
    await new GraphInboundProvider({
      mailbox: "info@x.com",
      auth: { ...auth, onRefreshToken: async (t) => void persisted.push(t) },
    }).poll({ limit: 50 }, async () => {});
    expect(persisted).toEqual(["rt-rotated"]);
  });

  it("throws an informative error when Graph denies the request (so the panel can show why)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("/token"))
          return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
        return new Response(
          JSON.stringify({
            error: { code: "ErrorAccessDenied", message: "Access is denied." },
          }),
          { status: 403 },
        );
      }),
    );
    await expect(
      new GraphInboundProvider({ mailbox: "info@x.com", auth }).poll(
        { limit: 50 },
        async () => {},
      ),
    ).rejects.toThrow(/Microsoft Graph list messages failed \(403\): Access is denied\./);
  });
});
