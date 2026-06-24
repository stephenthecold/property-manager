/**
 * Inbox poll health verdict — a pure read over the worker-written poll status
 * (lib/services/inbox-poll.ts persists it after each poll), so Settings → Email
 * inbox can tell the operator whether mail polling is actually running, and why
 * not. DB-free + clock-injected, so it's unit-tested.
 *
 * "never" / "stale" are the signals that the WORKER process isn't running — the
 * single most common reason inbound email never arrives (the web app alone does
 * no polling).
 */

export type InboxHealthState = "off" | "never" | "error" | "stale" | "ok";

export interface InboxHealthInput {
  /** modules.mailbox — the Email inbox module flag. */
  moduleEnabled: boolean;
  /** AppSettings.inboxEnabled — the polling master switch. */
  inboxEnabled: boolean;
  /** Last poll ATTEMPT (success or failure); null until the worker has run. */
  lastPolledAt: Date | null;
  /** Last error message, cleared on a successful poll. */
  lastError: string | null;
  now: Date;
  /** A poll runs every ~5 min; treat a longer silence as "stopped". */
  staleAfterMs?: number;
}

export interface InboxHealthReport {
  state: InboxHealthState;
  tone: "ok" | "warn" | "error" | "muted";
  headline: string;
  detail: string;
}

/** Default staleness window: 20 min — more than three 5-minute poll intervals. */
export const DEFAULT_INBOX_STALE_MS = 20 * 60_000;

export function inboxHealth(i: InboxHealthInput): InboxHealthReport {
  const staleAfter = i.staleAfterMs ?? DEFAULT_INBOX_STALE_MS;

  if (!i.moduleEnabled || !i.inboxEnabled) {
    return {
      state: "off",
      tone: "muted",
      headline: "Mail polling is off",
      detail:
        "Turn on the Email inbox module and connect a mailbox to start capturing email.",
    };
  }
  if (i.lastPolledAt === null) {
    return {
      state: "never",
      tone: "warn",
      headline: "No poll has run yet",
      detail:
        "If this doesn't change within ~5 minutes, the background worker isn't running — it does the polling, and the web app alone won't. Start the worker service.",
    };
  }
  const stale = i.now.getTime() - i.lastPolledAt.getTime() > staleAfter;
  if (i.lastError) {
    // A stale lastPolledAt alongside an error means the worker died WHILE
    // failing — surface that too, so the error message doesn't hide a dead worker.
    return {
      state: "error",
      tone: "error",
      headline: "The last poll failed",
      detail: stale
        ? `${i.lastError} — and no poll has run recently, so also check that the worker is running.`
        : i.lastError,
    };
  }
  if (stale) {
    return {
      state: "stale",
      tone: "warn",
      headline: "Polling looks stopped",
      detail:
        "No poll has run recently — the background worker may have stopped. Check that the worker service is running.",
    };
  }
  return {
    state: "ok",
    tone: "ok",
    headline: "Polling is healthy",
    detail:
      "The worker is checking the mailbox on schedule (about every 5 minutes).",
  };
}
