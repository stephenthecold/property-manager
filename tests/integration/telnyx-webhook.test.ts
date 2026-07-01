import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { invalidateAppSettingsCache } from "@/lib/services/app-settings";
import { POST } from "@/app/api/sms/inbound/route";

/**
 * Integration test (real Postgres): the Telnyx SMS webhook route end-to-end —
 * Ed25519 signature verification, inbound STOP → consent flip, delivery receipt
 * → reminder status/failedReason, and fail-closed on a forged signature or when
 * Telnyx isn't the effective provider. Exercises the security-critical glue that
 * unit tests can't (route dispatch + auth + provider gating).
 */

const P = `itest-telnyx-${Math.random().toString(36).slice(2, 8)}`;
const tenantId = `${P}-tenant`;
const phone = "+15551239009";

// A throwaway Ed25519 keypair standing in for the Telnyx account key.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
const publicKeyBase64 = spki.subarray(spki.length - 32).toString("base64");

function signedRequest(bodyObj: unknown, opts?: { key?: typeof privateKey; ts?: number }) {
  const body = JSON.stringify(bodyObj);
  const ts = String(opts?.ts ?? Math.floor(Date.now() / 1000));
  const signature = crypto
    .sign(null, Buffer.from(`${ts}|${body}`, "ascii"), opts?.key ?? privateKey)
    .toString("base64");
  return new Request("http://localhost/api/sms/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "telnyx-signature-ed25519": signature,
      "telnyx-timestamp": ts,
    },
    body,
  });
}

async function setProvider(smsProvider: string, key: string | null) {
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", smsProvider, telnyxPublicKey: key, smsEnabled: true },
    update: { smsProvider, telnyxPublicKey: key, smsEnabled: true },
  });
  invalidateAppSettingsCache();
}

beforeAll(async () => {
  await setProvider("telnyx", publicKeyBase64);
  await prisma.tenant.create({
    data: { id: tenantId, firstName: "Telnyx", lastName: P, phone, smsConsent: true },
  });
});

afterAll(async () => {
  await prisma.reminder.deleteMany({ where: { tenantId } });
  await prisma.consentRecord.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.appSettings.updateMany({
    where: { id: "singleton" },
    data: { smsProvider: null, telnyxPublicKey: null },
  });
  await prisma.$disconnect();
});

describe("Telnyx inbound webhook", () => {
  it("records an opt-out from a signed STOP (message.received)", async () => {
    const req = signedRequest({
      data: {
        event_type: "message.received",
        payload: {
          id: `${P}-in-1`,
          from: { phone_number: phone },
          to: [{ phone_number: "+15550000000" }],
          text: "STOP",
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t?.smsConsent).toBe(false);
    const optOut = await prisma.consentRecord.count({
      where: { tenantId, channel: "sms", consent: false },
    });
    expect(optOut).toBeGreaterThanOrEqual(1);
  });

  it("captures a non-keyword reply to the inbox", async () => {
    const req = signedRequest({
      data: {
        event_type: "message.received",
        payload: {
          id: `${P}-in-2`,
          from: { phone_number: phone },
          to: [{ phone_number: "+15550000000" }],
          text: "When is rent due?",
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const inbound = await prisma.inboundMessage.count({
      where: { providerSid: `${P}-in-2` },
    });
    expect(inbound).toBe(1);
  });

  it("advances a reminder to failed with the carrier error (message.finalized)", async () => {
    await prisma.reminder.create({
      data: {
        tenantId,
        reminderType: "manual",
        channel: "sms",
        destinationPhone: phone,
        messageBody: "hi",
        status: "sent",
        provider: "telnyx",
        providerMessageId: `${P}-msg-1`,
      },
    });
    const req = signedRequest({
      data: {
        event_type: "message.finalized",
        payload: {
          id: `${P}-msg-1`,
          to: [{ phone_number: phone, status: "delivery_failed" }],
          errors: [{ code: "40010", title: "Delivery failed", detail: "Unreachable" }],
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const r = await prisma.reminder.findFirst({
      where: { providerMessageId: `${P}-msg-1` },
    });
    expect(r?.status).toBe("failed");
    expect(r?.failedReason).toContain("40010");
  });

  it("rejects a forged signature (403) and mutates nothing", async () => {
    // Re-opt-in first so we can prove the forged STOP does NOT flip it back.
    await prisma.tenant.update({ where: { id: tenantId }, data: { smsConsent: true } });
    const otherKey = crypto.generateKeyPairSync("ed25519").privateKey;
    const req = signedRequest(
      {
        data: {
          event_type: "message.received",
          payload: {
            id: `${P}-forged`,
            from: { phone_number: phone },
            to: [{ phone_number: "+15550000000" }],
            text: "STOP",
          },
        },
      },
      { key: otherKey }, // signed with the WRONG key
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t?.smsConsent).toBe(true); // unchanged
  });

  it("fails closed (no 403, no mutation) when Telnyx isn't the effective provider", async () => {
    await setProvider("twilio", null); // Telnyx not effective → no public key
    const req = signedRequest({
      data: {
        event_type: "message.received",
        payload: {
          id: `${P}-wrongprov`,
          from: { phone_number: phone },
          to: [{ phone_number: "+15550000000" }],
          text: "STOP",
        },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200); // ack, no retry-storm
    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t?.smsConsent).toBe(true); // unchanged — nothing processed
    await setProvider("telnyx", publicKeyBase64); // restore for any later runs
  });
});
