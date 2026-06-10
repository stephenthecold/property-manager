import "dotenv/config";
import cron from "node-cron";
import { runBilling } from "@/lib/services/billing";

/**
 * Dedicated billing worker: a daily idempotent run that generates due rent
 * charges and assesses late fees. Runs once at startup to back-fill any periods
 * missed during downtime (the partial unique indexes make this safe to repeat).
 */

const SCHEDULE = process.env.BILLING_CRON ?? "0 1 * * *"; // 01:00 daily

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

async function main(): Promise<void> {
  console.log(`[worker] starting (schedule="${SCHEDULE}")`);
  await runOnce(); // startup back-fill
  cron.schedule(SCHEDULE, () => {
    void runOnce();
  });
}

void main();
