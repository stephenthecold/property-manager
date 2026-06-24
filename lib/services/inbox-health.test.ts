import { describe, expect, it } from "vitest";
import {
  inboxHealth,
  DEFAULT_INBOX_STALE_MS,
  type InboxHealthInput,
} from "@/lib/services/inbox-health";

const NOW = new Date("2026-06-24T12:00:00Z");
const base: InboxHealthInput = {
  moduleEnabled: true,
  inboxEnabled: true,
  lastPolledAt: NOW,
  lastError: null,
  now: NOW,
};

describe("inboxHealth", () => {
  it("is off when the module or master switch is off", () => {
    expect(inboxHealth({ ...base, moduleEnabled: false }).state).toBe("off");
    expect(inboxHealth({ ...base, inboxEnabled: false }).state).toBe("off");
  });

  it("is 'never' when no poll has run (worker likely not running)", () => {
    const r = inboxHealth({ ...base, lastPolledAt: null });
    expect(r.state).toBe("never");
    expect(r.tone).toBe("warn");
  });

  it("is 'error' when the last poll failed, surfacing the message", () => {
    const r = inboxHealth({ ...base, lastError: "IMAP login failed" });
    expect(r.state).toBe("error");
    expect(r.detail).toContain("IMAP login failed");
    // A recent error shouldn't nag about the worker — it's clearly running.
    expect(r.detail).not.toContain("worker");
  });

  it("is 'stale' when the last poll is older than the threshold", () => {
    const old = new Date(NOW.getTime() - DEFAULT_INBOX_STALE_MS - 1);
    expect(inboxHealth({ ...base, lastPolledAt: old }).state).toBe("stale");
  });

  it("is 'ok' on a recent, error-free poll", () => {
    const recent = new Date(NOW.getTime() - 60_000);
    expect(inboxHealth({ ...base, lastPolledAt: recent }).state).toBe("ok");
  });

  it("prioritizes a recorded error over staleness, but flags the dead worker", () => {
    const old = new Date(NOW.getTime() - DEFAULT_INBOX_STALE_MS - 1);
    const r = inboxHealth({ ...base, lastPolledAt: old, lastError: "boom" });
    expect(r.state).toBe("error");
    expect(r.detail).toContain("boom");
    expect(r.detail).toContain("worker");
  });

  it("off wins even when an error is on record", () => {
    expect(
      inboxHealth({ ...base, moduleEnabled: false, lastError: "boom" }).state,
    ).toBe("off");
  });
});
