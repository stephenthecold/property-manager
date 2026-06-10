import "dotenv/config";
import cron from "node-cron";
import { runBilling } from "@/lib/services/billing";
import { runScheduledReminders } from "@/lib/services/reminders";

/**
 * Dedicated billing worker: a daily idempotent run that generates due rent
 * charges and assesses late fees. Runs once at startup to back-fill any periods
 * missed during downtime (the partial unique indexes make this safe to repeat).
 * A second daily run sends scheduled SMS reminders (due-soon + overdue), also
 * idempotent via the partial unique on (leaseId, reminderType, periodKey).
 */

const SCHEDULE = process.env.BILLING_CRON ?? "0 1 * * *"; // 01:00 daily
const REMINDER_SCHEDULE = process.env.REMINDER_CRON ?? "0 9 * * *"; // 09:00 daily

async function runOnce(): Promise<void> {
  try {
    const res = await runBilling(new Date());
    console.log(
      `[worker] billing run: leases=${res.leasesProcessed} charges=${res.chargesCreated} lateFees=${res.lateFeesCreated}`,
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
}

async function main(): Promise<void> {
  console.log(
    `[worker] starting (billing="${SCHEDULE}", reminders="${REMINDER_SCHEDULE}")`,
  );
  await runOnce(); // startup back-fill
  await runRemindersOnce(); // startup catch-up (idempotent, duplicates skip)
  cron.schedule(SCHEDULE, () => {
    void runOnce();
  });
  cron.schedule(REMINDER_SCHEDULE, () => {
    void runRemindersOnce();
  });
}

void main();
