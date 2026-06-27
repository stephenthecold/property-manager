import "dotenv/config";
import cron from "node-cron";
import pg from "pg";
import { runBilling } from "@/lib/services/billing";
import { getAppSettings } from "@/lib/services/app-settings";
import { reminderCron } from "@/lib/reminders/schedule";
import { runMaintenanceReminders } from "@/lib/services/maintenance-reminders";
import { runScheduledReminders } from "@/lib/services/reminders";
import { runInboxPollOnce } from "@/lib/services/inbox-poll";
import { INBOX_POLL_CHANNEL } from "@/lib/services/inbox-poll-signal";
import {
  runWeeklyLeaseExpirationDigest,
  runWeeklyMaintenanceDigest,
  runWeeklyStaffDigest,
} from "@/lib/services/staff-digest";

/**
 * Dedicated billing worker: a daily idempotent run that generates due rent
 * charges and assesses late fees. Runs once at startup to back-fill any periods
 * missed during downtime (the partial unique indexes make this safe to repeat).
 * A second daily run sends scheduled SMS reminders (due-soon + overdue), also
 * idempotent via the partial unique on (leaseId, reminderType, periodKey).
 */

const SCHEDULE = process.env.BILLING_CRON ?? "0 1 * * *"; // 01:00 daily
const STAFF_DIGEST_SCHEDULE = process.env.STAFF_DIGEST_CRON ?? "0 9 * * 1"; // Mondays 09:00
const INBOX_POLL_SCHEDULE = process.env.INBOX_POLL_CRON ?? "*/5 * * * *"; // every 5 min
// Reminder schedule is resolved at startup: Settings → Messaging "send hour"
// (DB) wins, else REMINDER_CRON env, else 09:00 daily (lib/reminders/schedule).

async function runOnce(): Promise<void> {
  try {
    const res = await runBilling(new Date());
    console.log(
      `[worker] billing run: leases=${res.leasesProcessed} charges=${res.chargesCreated} lateFees=${res.lateFeesCreated} failed=${res.failed} rentIncreases=${res.rentIncreasesApplied}`,
    );
    if (res.failed > 0) {
      console.error(
        `[worker] billing run: ${res.failed} lease(s) failed and were skipped — investigate (they will retry next run).`,
      );
    }
  } catch (e) {
    console.error("[worker] billing run failed:", e);
  }
}

async function runRemindersOnce(): Promise<void> {
  try {
    const res = await runScheduledReminders(new Date());
    console.log(
      `[worker] reminder run: dueSoon=${res.dueSoon} overdue=${res.overdue} failed=${res.failed} skipped=${res.skipped}`,
    );
  } catch (e) {
    console.error("[worker] reminder run failed:", e);
  }
  // Maintenance notices share the reminder cadence and idempotency model, so
  // a failure in one sweep never blocks the other.
  try {
    const res = await runMaintenanceReminders(new Date());
    console.log(
      `[worker] maintenance reminders: sent=${res.sent} failed=${res.failed} skipped=${res.skipped}`,
    );
  } catch (e) {
    console.error("[worker] maintenance reminder run failed:", e);
  }
}

// Guards against overlapping polls: node-cron does not serialize runs, and two
// concurrent refresh_token grants would race Microsoft's single-use refresh-token
// rotation and could invalidate the stored token.
let inboxPolling = false;

async function runInboxOnce(): Promise<void> {
  // Inbound-email capture (module "mailbox"). No-ops unless a mailbox is
  // configured; a failure here never disrupts billing or reminders.
  if (inboxPolling) {
    console.log("[worker] inbox poll still running — skipping this tick");
    return;
  }
  inboxPolling = true;
  try {
    const res = await runInboxPollOnce();
    if (!res.skipped) {
      console.log(
        `[worker] inbox poll: fetched=${res.fetched} processed=${res.processed} failed=${res.failed}`,
      );
    }
  } catch (e) {
    console.error("[worker] inbox poll failed:", e);
  } finally {
    inboxPolling = false;
  }
}

// On-demand inbox poll: the Settings "Poll now" button emits a Postgres NOTIFY,
// and we LISTEN here so a poll runs immediately instead of waiting for the next
// 5-minute tick. Uses a dedicated pg connection (the Prisma adapter doesn't
// expose LISTEN) and reconnects on drop so the button keeps working for the
// life of the worker. A listener failure only disables on-demand polling — the
// scheduled cron poll and billing/reminders are untouched.
function listenForInboxPolls(): void {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[worker] DATABASE_URL unset — on-demand inbox polling disabled");
    return;
  }
  // One pending reconnect at a time, and never more than one live client.
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const reconnect = () => {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, 5000);
  };
  const connect = async (): Promise<void> => {
    const client = new pg.Client({ connectionString });
    // Idempotent teardown: 'error' and 'end' can both fire for one drop, and a
    // failed connect can emit 'error' before rejecting — collapse them to a
    // single cleanup + reconnect, and tear down the old client so connections
    // and listeners don't accumulate while the DB flaps.
    let closed = false;
    const onClosed = (e?: unknown) => {
      if (closed) return;
      closed = true;
      if (e) {
        console.error(
          "[worker] inbox-poll listener connection lost:",
          e instanceof Error ? e.message : e,
        );
      }
      client.removeAllListeners();
      client.end().catch(() => {});
      reconnect();
    };
    client.on("notification", (msg) => {
      if (msg.channel === INBOX_POLL_CHANNEL) {
        console.log("[worker] inbox poll requested (NOTIFY) — running now");
        void runInboxOnce();
      }
    });
    client.on("error", onClosed);
    client.on("end", () => onClosed());
    try {
      await client.connect();
      await client.query(`LISTEN ${INBOX_POLL_CHANNEL}`);
      console.log(`[worker] on-demand inbox polling ready (LISTEN ${INBOX_POLL_CHANNEL})`);
    } catch (e) {
      onClosed(e);
    }
  };
  void connect();
}

async function runStaffDigestOnce(): Promise<void> {
  try {
    const res = await runWeeklyStaffDigest(new Date());
    console.log(
      `[worker] staff digest: sent=${res.sent} skipped=${res.skipped}${res.reason ? ` (${res.reason})` : ""}`,
    );
  } catch (e) {
    console.error("[worker] staff digest failed:", e);
  }
  // The maintenance digest shares the Monday cadence; a failure in one digest
  // never blocks the other.
  try {
    const res = await runWeeklyMaintenanceDigest(new Date());
    console.log(
      `[worker] maintenance digest: sent=${res.sent} skipped=${res.skipped}${res.reason ? ` (${res.reason})` : ""}`,
    );
  } catch (e) {
    console.error("[worker] maintenance digest failed:", e);
  }
  // The lease-expiration digest shares the same Monday cadence and per-week
  // idempotency; isolated so a failure never blocks the other digests.
  try {
    const res = await runWeeklyLeaseExpirationDigest(new Date());
    console.log(
      `[worker] lease-expiration digest: sent=${res.sent} skipped=${res.skipped}${res.reason ? ` (${res.reason})` : ""}`,
    );
  } catch (e) {
    console.error("[worker] lease-expiration digest failed:", e);
  }
}

async function main(): Promise<void> {
  // DB-over-env: the saved send hour wins over REMINDER_CRON. Read once at
  // startup; changing it in Settings takes effect on the next worker restart.
  // A settings-read failure (e.g. DB not ready yet) must not stop the worker
  // from scheduling — fall back to the env/default cron.
  let reminderSendHour: number | null = null;
  try {
    reminderSendHour = (await getAppSettings()).reminderSendHour;
  } catch (e) {
    console.error(
      "[worker] could not read reminder send hour from settings; using env/default:",
      e,
    );
  }
  const reminderSchedule = reminderCron(reminderSendHour, process.env.REMINDER_CRON);
  console.log(
    `[worker] starting (billing="${SCHEDULE}", reminders="${reminderSchedule}", staffDigest="${STAFF_DIGEST_SCHEDULE}", inbox="${INBOX_POLL_SCHEDULE}")`,
  );
  await runOnce(); // startup back-fill
  await runRemindersOnce(); // startup catch-up (idempotent, duplicates skip)
  await runInboxOnce(); // startup catch-up (idempotent on messageId)
  cron.schedule(SCHEDULE, () => {
    void runOnce();
  });
  cron.schedule(reminderSchedule, () => {
    void runRemindersOnce();
  });
  cron.schedule(INBOX_POLL_SCHEDULE, () => {
    void runInboxOnce();
  });
  listenForInboxPolls(); // on-demand polls from the Settings "Poll now" button
  // Cron-only (no startup run): the digest has no per-send idempotency row,
  // so running it at boot would re-email staff on every container restart.
  cron.schedule(STAFF_DIGEST_SCHEDULE, () => {
    void runStaffDigestOnce();
  });
}

void main();
