import { describe, expect, it } from "vitest";
import { parseTelnyxWebhook } from "./telnyx-webhook";

describe("parseTelnyxWebhook", () => {
  it("parses message.received into an inbound event", () => {
    const body = {
      data: {
        record_type: "event",
        event_type: "message.received",
        id: "6a09cded-hook-4f1a-9d2e-000000000001",
        occurred_at: "2026-07-01T12:00:00.000Z",
        payload: {
          record_type: "message",
          direction: "inbound",
          id: "40017c1a-msg-4a2b-8f3c-inbound00001",
          type: "SMS",
          from: { phone_number: "+15551230001", carrier: "T-Mobile USA" },
          to: [
            {
              phone_number: "+15559990000",
              status: "webhook_delivered",
            },
          ],
          text: "I'll pay the rent tomorrow, thanks",
          received_at: "2026-07-01T12:00:00.000Z",
          errors: [],
        },
      },
      meta: { attempt: 1 },
    };

    expect(parseTelnyxWebhook(body)).toEqual({
      kind: "inbound",
      from: "+15551230001",
      text: "I'll pay the rent tomorrow, thanks",
      providerMessageId: "40017c1a-msg-4a2b-8f3c-inbound00001",
    });
  });

  it("keeps an empty inbound text (MMS with no body) as \"\"", () => {
    const body = {
      data: {
        event_type: "message.received",
        payload: {
          id: "inbound-empty-text-0002",
          from: { phone_number: "+15551230002" },
          text: "",
        },
      },
    };

    expect(parseTelnyxWebhook(body)).toEqual({
      kind: "inbound",
      from: "+15551230002",
      text: "",
      providerMessageId: "inbound-empty-text-0002",
    });
  });

  it("parses message.finalized (delivered) into a delivered status with no error", () => {
    const body = {
      data: {
        record_type: "event",
        event_type: "message.finalized",
        id: "6a09cded-hook-4f1a-9d2e-000000000010",
        payload: {
          record_type: "message",
          direction: "outbound",
          id: "40017c1a-msg-4a2b-8f3c-delivered001",
          type: "SMS",
          from: { phone_number: "+15559990000" },
          to: [
            {
              phone_number: "+15551230001",
              status: "delivered",
              carrier: "Verizon",
            },
          ],
          text: "Your rent of $1,200 is due on the 1st.",
          completed_at: "2026-07-01T12:01:05.000Z",
          errors: [],
        },
      },
    };

    expect(parseTelnyxWebhook(body)).toEqual({
      kind: "status",
      providerMessageId: "40017c1a-msg-4a2b-8f3c-delivered001",
      status: "delivered",
      errorCode: null,
      errorMessage: null,
    });
  });

  it("parses message.finalized (delivery_failed) with an errors array into a failed status", () => {
    const body = {
      data: {
        record_type: "event",
        event_type: "message.finalized",
        id: "6a09cded-hook-4f1a-9d2e-000000000011",
        payload: {
          record_type: "message",
          direction: "outbound",
          id: "40017c1a-msg-4a2b-8f3c-failed000001",
          type: "SMS",
          from: { phone_number: "+15559990000" },
          to: [
            {
              phone_number: "+15551230009",
              status: "delivery_failed",
              carrier: "AT&T",
            },
          ],
          text: "Your rent is past due.",
          errors: [
            {
              code: "40008",
              title: "Delivery failed",
              detail: "The message could not be delivered to the handset.",
            },
          ],
        },
      },
    };

    expect(parseTelnyxWebhook(body)).toEqual({
      kind: "status",
      providerMessageId: "40017c1a-msg-4a2b-8f3c-failed000001",
      status: "failed",
      errorCode: "40008",
      errorMessage:
        "Delivery failed: The message could not be delivered to the handset.",
    });
  });

  it("maps sending_failed and expired to failed", () => {
    const failedBody = {
      data: {
        event_type: "message.sent",
        payload: {
          id: "sending-failed-0003",
          to: [{ phone_number: "+15551230003", status: "sending_failed" }],
          errors: [{ code: "40300", title: "Rejected" }],
        },
      },
    };
    expect(parseTelnyxWebhook(failedBody)).toEqual({
      kind: "status",
      providerMessageId: "sending-failed-0003",
      status: "failed",
      errorCode: "40300",
      errorMessage: "Rejected",
    });

    const expiredBody = {
      data: {
        event_type: "message.finalized",
        payload: {
          id: "expired-0004",
          to: [{ phone_number: "+15551230004", status: "expired" }],
        },
      },
    };
    expect(parseTelnyxWebhook(expiredBody)).toEqual({
      kind: "status",
      providerMessageId: "expired-0004",
      status: "failed",
      errorCode: null,
      errorMessage: null,
    });
  });

  it("parses message.sent into a sent status", () => {
    const body = {
      data: {
        record_type: "event",
        event_type: "message.sent",
        id: "6a09cded-hook-4f1a-9d2e-000000000020",
        payload: {
          record_type: "message",
          direction: "outbound",
          id: "40017c1a-msg-4a2b-8f3c-sent00000001",
          type: "SMS",
          from: { phone_number: "+15559990000" },
          to: [{ phone_number: "+15551230001", status: "sent" }],
          text: "A maintenance tech is scheduled for tomorrow 9-11am.",
          sent_at: "2026-07-01T12:00:30.000Z",
          errors: [],
        },
      },
    };

    expect(parseTelnyxWebhook(body)).toEqual({
      kind: "status",
      providerMessageId: "40017c1a-msg-4a2b-8f3c-sent00000001",
      status: "sent",
      errorCode: null,
      errorMessage: null,
    });
  });

  it("maps queued and sending to queued", () => {
    for (const raw of ["queued", "sending"]) {
      const body = {
        data: {
          event_type: "message.sent",
          payload: {
            id: `queued-${raw}`,
            to: [{ phone_number: "+15551230005", status: raw }],
          },
        },
      };
      expect(parseTelnyxWebhook(body)).toEqual({
        kind: "status",
        providerMessageId: `queued-${raw}`,
        status: "queued",
        errorCode: null,
        errorMessage: null,
      });
    }
  });

  it("uses only title or only detail when the other is absent", () => {
    const titleOnly = {
      data: {
        event_type: "message.finalized",
        payload: {
          id: "err-title-only",
          to: [{ phone_number: "+15551230006", status: "delivery_failed" }],
          errors: [{ code: "40001", title: "Unroutable" }],
        },
      },
    };
    expect(parseTelnyxWebhook(titleOnly)).toMatchObject({
      kind: "status",
      errorCode: "40001",
      errorMessage: "Unroutable",
    });

    const detailOnly = {
      data: {
        event_type: "message.finalized",
        payload: {
          id: "err-detail-only",
          to: [{ phone_number: "+15551230007", status: "delivery_failed" }],
          errors: [{ code: "40002", detail: "Carrier rejected the message." }],
        },
      },
    };
    expect(parseTelnyxWebhook(detailOnly)).toMatchObject({
      kind: "status",
      errorCode: "40002",
      errorMessage: "Carrier rejected the message.",
    });
  });

  it("uses only the FIRST recipient's status", () => {
    const body = {
      data: {
        event_type: "message.finalized",
        payload: {
          id: "multi-recipient-0008",
          to: [
            { phone_number: "+15551230010", status: "delivered" },
            { phone_number: "+15551230011", status: "delivery_failed" },
          ],
        },
      },
    };
    expect(parseTelnyxWebhook(body)).toMatchObject({
      status: "delivered",
    });
  });

  it("ignores an unknown event_type", () => {
    const body = {
      data: {
        event_type: "message.updated",
        payload: {
          id: "unknown-event-0009",
          to: [{ phone_number: "+15551230012", status: "delivered" }],
        },
      },
    };
    expect(parseTelnyxWebhook(body)).toEqual({ kind: "ignored" });
  });

  it("ignores a status event with an unmapped raw status string", () => {
    const body = {
      data: {
        event_type: "message.finalized",
        payload: {
          id: "weird-status-0010",
          to: [{ phone_number: "+15551230013", status: "gonzo_status" }],
        },
      },
    };
    expect(parseTelnyxWebhook(body)).toEqual({ kind: "ignored" });
  });

  it("ignores malformed and missing-field bodies without throwing", () => {
    const cases: unknown[] = [
      null,
      undefined,
      "not an object",
      42,
      true,
      [],
      {},
      { data: null },
      { data: {} },
      { data: { event_type: "message.received" } }, // no payload
      { data: { event_type: "message.received", payload: null } },
      // inbound missing id
      {
        data: {
          event_type: "message.received",
          payload: { from: { phone_number: "+15551230014" }, text: "hi" },
        },
      },
      // inbound missing from
      {
        data: {
          event_type: "message.received",
          payload: { id: "no-from-0011", text: "hi" },
        },
      },
      // inbound with from present but no phone_number
      {
        data: {
          event_type: "message.received",
          payload: { id: "no-phone-0012", from: {}, text: "hi" },
        },
      },
      // status missing id
      {
        data: {
          event_type: "message.finalized",
          payload: { to: [{ phone_number: "+15551230015", status: "delivered" }] },
        },
      },
      // status with empty to[]
      {
        data: {
          event_type: "message.finalized",
          payload: { id: "empty-to-0013", to: [] },
        },
      },
      // status with to not an array
      {
        data: {
          event_type: "message.finalized",
          payload: { id: "bad-to-0014", to: { phone_number: "+1", status: "delivered" } },
        },
      },
      // status first recipient missing status
      {
        data: {
          event_type: "message.sent",
          payload: { id: "no-status-0015", to: [{ phone_number: "+15551230016" }] },
        },
      },
      // event_type not a string
      { data: { event_type: 123, payload: { id: "x", to: [] } } },
    ];

    for (const body of cases) {
      expect(parseTelnyxWebhook(body)).toEqual({ kind: "ignored" });
    }
  });

  it("coerces a numeric error code to a string", () => {
    const body = {
      data: {
        event_type: "message.finalized",
        payload: {
          id: "numeric-code-0016",
          to: [{ phone_number: "+15551230017", status: "delivery_failed" }],
          errors: [{ code: 40008, title: "Delivery failed" }],
        },
      },
    };
    expect(parseTelnyxWebhook(body)).toMatchObject({
      kind: "status",
      errorCode: "40008",
      errorMessage: "Delivery failed",
    });
  });
});
