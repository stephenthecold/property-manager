import { prisma } from "@/lib/db";

/**
 * On-demand inbox-poll signal (Settings → "Poll now").
 *
 * The web app CANNOT run a poll itself — the IMAP client + MIME parser are
 * worker-only (see lib/services/inbox-poll.ts), and importing them into an app
 * route is forbidden. So the button emits a Postgres NOTIFY on this channel and
 * the worker, which LISTENs on it, runs a poll immediately instead of waiting
 * for the next 5-minute tick. This module is app-safe: it only talks to the DB.
 */
export const INBOX_POLL_CHANNEL = "inbox_poll_now";

/**
 * Ask the worker to poll the inbox right now. Best-effort: if no worker is
 * listening, Postgres simply drops the NOTIFY, so this resolves either way — the
 * caller can't tell whether a worker picked it up (the health panel's next poll
 * time is the real feedback).
 */
export async function requestInboxPollNow(): Promise<void> {
  // The channel is a fixed identifier (never user input), so inlining it in the
  // statement is safe; NOTIFY can't be parameterized anyway.
  await prisma.$executeRawUnsafe(`NOTIFY ${INBOX_POLL_CHANNEL}`);
}
