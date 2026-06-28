import { describe, it, expect } from "vitest";
import {
  resolveReminderDelivery,
  type ReminderDeliveryInput,
} from "@/lib/reminders/channel";

const base: ReminderDeliveryInput = {
  preferredChannel: "sms",
  smsConsent: true,
  phone: "+15551234567",
  emailConsent: true,
  email: "tenant@example.com",
  smsEnabled: true,
  emailEnabled: true,
};

describe("resolveReminderDelivery — SMS preference", () => {
  it("delivers via SMS when enabled + consented + has phone", () => {
    expect(resolveReminderDelivery(base)).toEqual({
      ok: true,
      channel: "sms",
      destination: "+15551234567",
    });
  });

  it("skips when SMS is disabled (master switch), never falls back to email", () => {
    expect(resolveReminderDelivery({ ...base, smsEnabled: false })).toEqual({
      ok: false,
      reason: "channel disabled",
    });
  });

  it("skips without SMS consent even if email consent exists", () => {
    expect(resolveReminderDelivery({ ...base, smsConsent: false })).toEqual({
      ok: false,
      reason: "no consent",
    });
  });

  it("skips with no phone number", () => {
    expect(resolveReminderDelivery({ ...base, phone: "  " })).toEqual({
      ok: false,
      reason: "no contact",
    });
  });
});

describe("resolveReminderDelivery — email preference", () => {
  const email = { ...base, preferredChannel: "email" as const };

  it("delivers via email when enabled + consented + has email", () => {
    expect(resolveReminderDelivery(email)).toEqual({
      ok: true,
      channel: "email",
      destination: "tenant@example.com",
    });
  });

  it("skips when email is disabled (master switch), never falls back to SMS", () => {
    expect(resolveReminderDelivery({ ...email, emailEnabled: false })).toEqual({
      ok: false,
      reason: "channel disabled",
    });
  });

  it("skips without email consent even though SMS is fully available", () => {
    expect(resolveReminderDelivery({ ...email, emailConsent: false })).toEqual({
      ok: false,
      reason: "no consent",
    });
  });

  it("skips with no email address", () => {
    expect(resolveReminderDelivery({ ...email, email: null })).toEqual({
      ok: false,
      reason: "no contact",
    });
  });

  it("trims the destination", () => {
    const r = resolveReminderDelivery({ ...email, email: "  a@b.co " });
    expect(r).toEqual({ ok: true, channel: "email", destination: "a@b.co" });
  });

  it("skips a suppressed mailbox (hard bounce / complaint) despite consent + address", () => {
    expect(resolveReminderDelivery({ ...email, emailSuppressed: true })).toEqual({
      ok: false,
      reason: "email suppressed",
    });
  });

  it("delivers normally when emailSuppressed is false/undefined", () => {
    expect(resolveReminderDelivery({ ...email, emailSuppressed: false })).toEqual({
      ok: true,
      channel: "email",
      destination: "tenant@example.com",
    });
  });

  it("does NOT suppress the SMS channel for an email-suppressed tenant", () => {
    // SMS-preferred tenant whose EMAIL bounced still gets SMS reminders.
    const r = resolveReminderDelivery({ ...base, emailSuppressed: true });
    expect(r).toEqual({ ok: true, channel: "sms", destination: "+15551234567" });
  });
});
