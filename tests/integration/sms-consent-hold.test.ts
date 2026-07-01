import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  runHeldConsentReminders,
  sendReminder,
  HELD_CONSENT_MAX_AGE_DAYS,
} from "@/lib/services/reminders";
import { invalidateAppSettingsCache } from "@/lib/services/app-settings";

/**
 * Integration test (real Postgres): auto-consent-on-first-contact. The first SMS
 * to a not-yet-consented tenant solicits consent (once, ever) and HOLDS the
 * triggering message; the worker sweep releases it on opt-in (normalized to
 * E.164) and expires it after the grace window. Uses the stub SMS provider.
 */

const P = `itest-consent-${Math.random().toString(36).slice(2, 8)}`;
const propertyId = `${P}-prop`;
const unitId = `${P}-unit`;
const tenantId = `${P}-tenant`;
const tenantId2 = `${P}-tenant2`;
const tenantId3 = `${P}-tenant3`;
const leaseId = `${P}-lease`;
const ACTOR = { actorType: "system" as const, actorId: null };
const NOW = new Date("2026-03-10T15:00:00Z");

beforeAll(async () => {
  // Stub provider = sends succeed with no credentials; auto-request on.
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      smsEnabled: true,
      autoRequestSmsConsent: true,
      smsProvider: "stub",
    },
    update: { smsEnabled: true, autoRequestSmsConsent: true, smsProvider: "stub" },
  });
  invalidateAppSettingsCache();

  await prisma.property.create({
    data: { id: propertyId, name: `${P} Property`, timezone: "America/Chicago" },
  });
  await prisma.unit.create({
    data: { id: unitId, propertyId, unitNumber: "1", serviceStatus: "in_service" },
  });
  // Bare 10-digit phone → exercises E.164 normalization at send time.
  await prisma.tenant.create({
    data: {
      id: tenantId,
      firstName: "Test",
      lastName: P,
      phone: "5551230001",
      smsConsent: false,
      reminderChannel: "sms",
    },
  });
  await prisma.tenant.create({
    data: {
      id: tenantId2,
      firstName: "Stale",
      lastName: P,
      phone: "5551230002",
      smsConsent: false,
      reminderChannel: "sms",
    },
  });
  // A tenant who explicitly opted OUT (replied STOP): smsConsent=false with an
  // opt-out ConsentRecord on file, never auto-requested.
  await prisma.tenant.create({
    data: {
      id: tenantId3,
      firstName: "OptedOut",
      lastName: P,
      phone: "5551230003",
      smsConsent: false,
      reminderChannel: "sms",
    },
  });
  await prisma.consentRecord.create({
    data: {
      channel: "sms",
      phone: "5551230003",
      tenantId: tenantId3,
      consent: false,
      source: "inbound_sms_keyword",
    },
  });
  await prisma.lease.create({
    data: {
      id: leaseId,
      tenantId,
      unitId,
      startDate: new Date("2026-01-01T06:00:00Z"),
      rentAmountCents: 120000n,
      dueDay: 1,
      status: "active",
    },
  });
});

afterAll(async () => {
  const ids = [tenantId, tenantId2, tenantId3];
  await prisma.reminder.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.consentRecord.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.lease.deleteMany({ where: { id: leaseId } });
  await prisma.property.deleteMany({ where: { id: propertyId } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  // Leave the shared AppSettings singleton but drop the stub-provider override.
  await prisma.appSettings.updateMany({
    where: { id: "singleton" },
    data: { smsProvider: null },
  });
  await prisma.$disconnect();
});

describe("auto SMS consent on first contact", () => {
  it("solicits consent once and HOLDS the first message (normalized to E.164)", async () => {
    const r = await sendReminder({
      tenantId,
      leaseId,
      reminderType: "rent_due_soon",
      periodKey: "2026-03-01",
      messageBody: "Your rent is due soon.",
      actor: ACTOR,
      now: NOW,
    });
    expect(r.status).toBe("skipped");
    expect(r.error).toContain("held");
    expect(r.reminderId).toBeTruthy();

    // The one-time request marker is stamped.
    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t?.smsConsentRequestedAt).not.toBeNull();

    // The held row carries the deferred message + the normalized destination.
    const held = await prisma.reminder.findUnique({ where: { id: r.reminderId! } });
    expect(held?.status).toBe("held_for_consent");
    expect(held?.messageBody).toBe("Your rent is due soon.");
    expect(held?.destinationPhone).toBe("+15551230001");

    // The solicitation itself is audited (not stored as a ConsentRecord).
    const requested = await prisma.auditLog.count({
      where: { action: "tenant.sms_consent_requested", entityId: tenantId },
    });
    expect(requested).toBeGreaterThanOrEqual(1);
    const consentRecords = await prisma.consentRecord.count({ where: { tenantId } });
    expect(consentRecords).toBe(0);
  });

  it("never solicits a tenant with a prior opt-out on record (STOP)", async () => {
    const auditBefore = await prisma.auditLog.count({
      where: { action: "tenant.sms_consent_requested", entityId: tenantId3 },
    });
    const r = await sendReminder({
      tenantId: tenantId3,
      leaseId,
      reminderType: "rent_due_soon",
      periodKey: "2026-03-01",
      messageBody: "Your rent is due soon.",
      actor: ACTOR,
      now: NOW,
    });
    expect(r.status).toBe("skipped");
    expect(r.error).toContain("opted out");
    // No message held, no solicitation sent, and the request marker stays null.
    const held = await prisma.reminder.findFirst({
      where: { tenantId: tenantId3, status: "held_for_consent" },
    });
    expect(held).toBeNull();
    const t = await prisma.tenant.findUnique({ where: { id: tenantId3 } });
    expect(t?.smsConsentRequestedAt).toBeNull();
    const auditAfter = await prisma.auditLog.count({
      where: { action: "tenant.sms_consent_requested", entityId: tenantId3 },
    });
    expect(auditAfter).toBe(auditBefore);
  });

  it("does not re-solicit or hold a second message before opt-in", async () => {
    const r = await sendReminder({
      tenantId,
      leaseId,
      reminderType: "rent_due_soon",
      periodKey: "2026-04-01",
      messageBody: "Rent due soon (April).",
      actor: ACTOR,
      now: NOW,
    });
    expect(r.status).toBe("skipped");
    expect(r.error).toContain("no");
    expect(r.error).not.toContain("held");
    // No held row for the second period.
    const held = await prisma.reminder.findFirst({
      where: { tenantId, periodKey: "2026-04-01", status: "held_for_consent" },
    });
    expect(held).toBeNull();
  });

  it("releases the held message once the tenant opts in", async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { smsConsent: true } });

    const res = await runHeldConsentReminders(NOW);
    expect(res.released).toBe(1);
    expect(res.failed).toBe(0);

    const held = await prisma.reminder.findFirst({
      where: { tenantId, periodKey: "2026-03-01" },
    });
    expect(held?.status).toBe("sent");
    expect(held?.sentAt).not.toBeNull();
    expect(held?.provider).toBe("stub");
    expect(held?.destinationPhone).toBe("+15551230001");
  });

  it("does not re-send a released message (idempotency slot stays occupied)", async () => {
    const r = await sendReminder({
      tenantId,
      leaseId,
      reminderType: "rent_due_soon",
      periodKey: "2026-03-01",
      messageBody: "Your rent is due soon.",
      actor: ACTOR,
      now: NOW,
    });
    expect(r.status).toBe("skipped");
    expect(r.error).toBe("duplicate");
    const rows = await prisma.reminder.count({
      where: { tenantId, periodKey: "2026-03-01" },
    });
    expect(rows).toBe(1);
  });

  it("expires a held message older than the grace window", async () => {
    const old = new Date(
      NOW.getTime() - (HELD_CONSENT_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    const stale = await prisma.reminder.create({
      data: {
        tenantId: tenantId2,
        reminderType: "manual",
        channel: "sms",
        destinationPhone: "+15551230002",
        messageBody: "Stale held message.",
        status: "held_for_consent",
        createdAt: old,
      },
    });

    const res = await runHeldConsentReminders(NOW);
    expect(res.expired).toBeGreaterThanOrEqual(1);

    const row = await prisma.reminder.findUnique({ where: { id: stale.id } });
    expect(row?.status).toBe("failed");
    expect(row?.failedReason).toContain("consent");
  });
});
