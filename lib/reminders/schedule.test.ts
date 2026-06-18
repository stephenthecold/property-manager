import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_CRON,
  reminderCron,
  sanitizeReminderSendHour,
} from "@/lib/reminders/schedule";

describe("sanitizeReminderSendHour", () => {
  it("accepts whole hours 0–23", () => {
    expect(sanitizeReminderSendHour(0)).toBe(0);
    expect(sanitizeReminderSendHour(9)).toBe(9);
    expect(sanitizeReminderSendHour(23)).toBe(23);
  });

  it("rejects out-of-range, fractional, and missing values", () => {
    for (const bad of [-1, 24, 9.5, NaN, null, undefined]) {
      expect(sanitizeReminderSendHour(bad as number)).toBeNull();
    }
  });
});

describe("reminderCron", () => {
  it("a saved hour wins over env (DB-over-env) and builds a daily cron", () => {
    expect(reminderCron(7, "30 4 * * 1")).toBe("0 7 * * *");
    expect(reminderCron(0, undefined)).toBe("0 0 * * *");
  });

  it("falls back to the env cron when no valid hour is saved", () => {
    expect(reminderCron(null, "30 4 * * 1")).toBe("30 4 * * 1");
    expect(reminderCron(99, "  15 6 * * *  ")).toBe("15 6 * * *");
  });

  it("falls back to the 09:00 default when neither is set", () => {
    expect(reminderCron(null, undefined)).toBe(DEFAULT_REMINDER_CRON);
    expect(reminderCron(null, "   ")).toBe(DEFAULT_REMINDER_CRON);
  });
});
