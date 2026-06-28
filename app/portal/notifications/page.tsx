import Link from "next/link";
import { requirePortalSession } from "@/lib/portal/session";
import { getAppSettings } from "@/lib/services/app-settings";
import {
  loadReminderPrefMap,
  PORTAL_REMINDER_TYPES,
} from "@/lib/services/reminder-prefs";
import { resolveEffectiveChannel } from "@/lib/reminders/pref";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReminderPrefForm } from "../portal-forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tenant self-serve notification preferences: per reminder type, choose the
 * delivery channel (SMS / Email / Off), overriding the single global channel.
 * requirePortalSession() is the only gate (/portal is a staff-middleware
 * PUBLIC_PREFIX) and every read/write is scoped to THIS tenant's id. SMS/Email
 * are offered only where the tenant has consented + has contact info; the save
 * action re-enforces that gate. Internal types (manual/maintenance) are not
 * shown — only the automated reminders a tenant actually receives.
 */

const TYPE_META: Record<
  (typeof PORTAL_REMINDER_TYPES)[number],
  { label: string; description: string }
> = {
  rent_due_soon: {
    label: "Rent due soon",
    description: "A heads-up a few days before rent is due.",
  },
  rent_overdue: {
    label: "Rent overdue",
    description: "When rent is past its due date.",
  },
  partial_balance: {
    label: "Partial balance",
    description: "When a balance remains after a payment.",
  },
  payment_receipt: {
    label: "Payment receipts",
    description: "A confirmation when we receive your payment.",
  },
};

export default async function PortalNotificationsPage() {
  const { tenant } = await requirePortalSession();
  const settings = await getAppSettings();

  const prefMap = await loadReminderPrefMap(tenant.id);

  // A channel is offerable only when the tenant has consented to it, has the
  // matching contact info, AND the org master switch for it is on.
  const smsAvailable =
    settings.smsEnabled && tenant.smsConsent && !!tenant.phone?.trim();
  const emailAvailable =
    settings.emailEnabled && tenant.emailConsent && !!tenant.email?.trim();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Notification preferences</h1>
        <Button variant="ghost" size="sm" render={<Link href="/portal" />}>
          Back to portal
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How you hear from us</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Choose how you&apos;d like to receive each kind of reminder. Pick{" "}
            <span className="font-medium text-foreground">Off</span> to stop a
            reminder entirely. Your default channel is{" "}
            <span className="font-medium text-foreground uppercase">
              {tenant.reminderChannel}
            </span>
            .
          </p>
          {!smsAvailable && !emailAvailable && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              You haven&apos;t enabled any delivery channel yet. Turn on text
              messages on the portal home page (or ask your property manager
              about email) to receive reminders.
            </p>
          )}
          <div>
            {PORTAL_REMINDER_TYPES.map((rt) => {
              // Effective stored channel = per-type override, else global.
              const effective =
                resolveEffectiveChannel({
                  globalChannel: tenant.reminderChannel,
                  override: prefMap.get(rt),
                }) ?? "off";
              return (
                <ReminderPrefForm
                  key={rt}
                  reminderType={rt}
                  label={TYPE_META[rt].label}
                  description={TYPE_META[rt].description}
                  current={effective}
                  smsAvailable={smsAvailable}
                  emailAvailable={emailAvailable}
                />
              );
            })}
          </div>
          <p className="border-t pt-3 text-xs text-muted-foreground">
            Reminders still require that channel&apos;s consent. Manage text-message
            consent on the{" "}
            <Link href="/portal" className="underline underline-offset-2">
              portal home page
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
