import "dotenv/config";
import cron from "node-cron";
import { runBilling } from "@/lib/services/billing";
import { runMaintenanceReminders } from "@/lib/services/maintenance-reminders";
import { runScheduledReminders } from "@/lib/services/reminders";
import {
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
const REMINDER_SCHEDULE = process.env.REMINDER_CRON ?? "0 9 * * *"; // 09:00 daily
const STAFF_DIGEST_SCHEDULE = process.env.STAFF_DIGEST_CRON ?? "0 9 * * 1"; // Mondays 09:00

async function runOnce(): Promise<void> {
  try {
    const res = await runBilling(new Date());
    console.log(
      `[worker] billing run: leases=${res.leasesProcessed} charges=${res.chargesCreated} lateFees=${res.lateFeesCreated} rentIncreases=${res.rentIncreasesApplied}`,
    );
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
}

async function main(): Promise<void> {
  console.log(
    `[worker] starting (billing="${SCHEDULE}", reminders="${REMINDER_SCHEDULE}", staffDigest="${STAFF_DIGEST_SCHEDULE}")`,
  );
  await runOnce(); // startup back-fill
  await runRemindersOnce(); // startup catch-up (idempotent, duplicates skip)
  cron.schedule(SCHEDULE, () => {
    void runOnce();
  });
  cron.schedule(REMINDER_SCHEDULE, () => {
    void runRemindersOnce();
  });
  // Cron-only (no startup run): the digest has no per-send idempotency row,
  // so running it at boot would re-email staff on every container restart.
  cron.schedule(STAFF_DIGEST_SCHEDULE, () => {
    void runStaffDigestOnce();
  });
}

void main();
