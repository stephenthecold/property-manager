import "dotenv/config";
import { prisma } from "@/lib/db";
import {
  sendReminder,
  runHeldConsentReminders,
} from "@/lib/services/reminders";
import { setSmsConsentByPhone } from "@/lib/services/sms-consent";
import { invalidateAppSettingsCache } from "@/lib/services/app-settings";

/**
 * Self-cleaning demo of the SMS first-contact consent flow, end to end, against
 * the local DB. Lets an operator WATCH: auto-request-on-first-contact → hold the
 * triggering message → tenant replies YES → the held message is released → tenant
 * replies STOP → opted back out. Proves the whole dance never touches the ledger.
 *
 * SAFETY: forces the STUB SMS provider for the duration (so NO real texts are
 * sent) and restores the prior provider/switches afterward. Creates a single
 * throwaway tenant and deletes it (plus its reminders + consent records) in a
 * finally, so there is zero residue. Run repeatedly: `npm run demo:consent`.
 *
 * Math.random/Date.now are fine here — this is a one-shot operator script, NOT a
 * clock-injected workflow module.
 */

function log(msg: string): void {
  console.log(`[demo] ${msg}`);
}

async function main(): Promise<void> {
  // This temporarily forces the global stub SMS provider, so refuse to run
  // against a production database — a crash mid-run could otherwise leave a live
  // system with SMS disabled. Override deliberately with ALLOW_PROD_DEMO=1.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_DEMO !== "1") {
    console.error(
      "[demo] refusing to run with NODE_ENV=production (it briefly forces the " +
        "stub SMS provider). Set ALLOW_PROD_DEMO=1 to override.",
    );
    process.exitCode = 1;
    return;
  }

  const shortid = Math.random().toString(36).slice(2, 8);
  const tenantId = `demo-consent-${shortid}`;
  const phone = "+15005550006"; // fake E.164 (Twilio magic "valid" test number)

  // Snapshot the three SMS settings we're about to override, so finally can put
  // them back exactly as they were (null row → treat as unset defaults).
  const priorSettings = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
    select: { smsProvider: true, smsEnabled: true, autoRequestSmsConsent: true },
  });

  let tenantCreated = false;

  try {
    // --- SAFETY: force the stub provider so nothing real is sent -------------
    log(
      "SAFETY: temporarily forcing smsProvider=stub (smsEnabled + autoRequestSmsConsent on). " +
        "No real texts are sent; the original settings are restored at the end.",
    );
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        smsProvider: "stub",
        smsEnabled: true,
        autoRequestSmsConsent: true,
      },
      update: {
        smsProvider: "stub",
        smsEnabled: true,
        autoRequestSmsConsent: true,
      },
    });
    invalidateAppSettingsCache();

    // --- Throwaway tenant, not opted in, SMS-preferring ----------------------
    await prisma.tenant.create({
      data: {
        id: tenantId,
        firstName: "[demo]",
        lastName: `Consent ${shortid}`,
        phone,
        smsConsent: false,
        reminderChannel: "sms",
      },
    });
    tenantCreated = true;
    log(`created throwaway tenant ${tenantId} (phone ${phone}, smsConsent=false)`);

    // --- (a) AUTO-REQUEST + HOLD --------------------------------------------
    const send = await sendReminder({
      tenantId,
      reminderType: "manual",
      messageBody: "Your rent reminder (demo).",
      periodKey: `demo-${shortid}`,
      actor: { actorType: "system", actorId: null },
      now: new Date(),
    });
    log(
      `(a) sendReminder -> status=${send.status} error=${JSON.stringify(send.error)} ` +
        `(expected skipped + "held")`,
    );
    const heldReminder = send.reminderId
      ? await prisma.reminder.findUnique({ where: { id: send.reminderId } })
      : null;
    const afterRequest = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { smsConsentRequestedAt: true },
    });
    log(
      `    held Reminder status=${heldReminder?.status ?? "<none>"} ` +
        `(expected held_for_consent); tenant.smsConsentRequestedAt=${
          afterRequest?.smsConsentRequestedAt?.toISOString() ?? "<null>"
        } (now set)`,
    );

    // --- (b) TENANT REPLIES YES ---------------------------------------------
    const matchedYes = await setSmsConsentByPhone(phone, true, {
      actorType: "system",
      actorEmail: "demo (inbound YES)",
    });
    const afterYes = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { smsConsent: true },
    });
    log(
      `(b) inbound YES -> tenants matched=${matchedYes}; tenant.smsConsent=${afterYes?.smsConsent} (now true)`,
    );

    // --- (c) RELEASE the held message ---------------------------------------
    const release = await runHeldConsentReminders(new Date());
    const releasedReminder = send.reminderId
      ? await prisma.reminder.findUnique({ where: { id: send.reminderId } })
      : null;
    log(
      `(c) runHeldConsentReminders -> released=${release.released} failed=${release.failed} ` +
        `skipped=${release.skipped}; held reminder status=${
          releasedReminder?.status ?? "<none>"
        } (expected sent)`,
    );

    // --- (d) TENANT REPLIES STOP --------------------------------------------
    const matchedStop = await setSmsConsentByPhone(phone, false, {
      actorType: "system",
      actorEmail: "demo (inbound STOP)",
    });
    const afterStop = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { smsConsent: true },
    });
    log(
      `(d) inbound STOP -> tenants matched=${matchedStop}; tenant.smsConsent=${afterStop?.smsConsent} (now false)`,
    );

    // --- (e) LEDGER PROOF ----------------------------------------------------
    const ledgerCount = await prisma.ledgerEntry.count({ where: { tenantId } });
    log(
      `(e) ledger entries for this tenant: ${ledgerCount} (MUST be 0 — consent never touches the ledger)`,
    );
    if (ledgerCount !== 0) {
      throw new Error(
        `ledger invariant violated: expected 0 ledger entries, got ${ledgerCount}`,
      );
    }

    log("flow complete — all steps observed.");
    process.exitCode = 0;
  } catch (e) {
    console.error("[demo] FAILED:", e);
    process.exitCode = 1;
  } finally {
    // --- CLEANUP (best-effort each; a failure here never masks the result) ---
    let consentDeleted = 0;
    if (tenantCreated) {
      try {
        await prisma.reminder.deleteMany({ where: { tenantId } });
      } catch (e) {
        console.error("[demo] cleanup: failed to delete reminders:", e);
      }
      try {
        const res = await prisma.consentRecord.deleteMany({ where: { tenantId } });
        consentDeleted = res.count;
      } catch (e) {
        console.error("[demo] cleanup: failed to delete consent records:", e);
      }
      try {
        await prisma.tenant.delete({ where: { id: tenantId } });
      } catch (e) {
        console.error("[demo] cleanup: failed to delete tenant:", e);
      }
    }

    // Restore the three SMS settings to their pre-demo values.
    try {
      await prisma.appSettings.update({
        where: { id: "singleton" },
        data: {
          smsProvider: priorSettings?.smsProvider ?? null,
          smsEnabled: priorSettings?.smsEnabled ?? true,
          autoRequestSmsConsent: priorSettings?.autoRequestSmsConsent ?? true,
        },
      });
      log(
        `restored AppSettings (smsProvider=${
          priorSettings?.smsProvider ?? "<null>"
        }, smsEnabled=${priorSettings?.smsEnabled ?? true}, autoRequestSmsConsent=${
          priorSettings?.autoRequestSmsConsent ?? true
        }).`,
      );
    } catch (e) {
      console.error("[demo] cleanup: failed to restore AppSettings:", e);
    }
    invalidateAppSettingsCache();

    log(
      `cleaned up — no residue (deleted tenant + ${consentDeleted} ConsentRecord row(s) + its reminders).`,
    );
    await prisma.$disconnect();
  }
}

void main();
