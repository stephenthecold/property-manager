import { getAppSettings } from "@/lib/services/app-settings";
import { Card, CardContent } from "@/components/ui/card";
import { SmsOptInForm } from "./opt-in-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public SMS opt-in page (no session — "/sms-opt-in" is a PUBLIC_PREFIX). Lets
 * tenants and applicants opt in to tenancy-related SMS notifications with the
 * full, separate, un-prechecked consent language.
 */
export default async function SmsOptInPage() {
  const settings = await getAppSettings();
  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div className="space-y-1 text-center">
        <div className="text-lg font-semibold">{settings.businessName}</div>
        <h1 className="text-2xl font-semibold tracking-wide">
          SMS / text notifications
        </h1>
        <p className="text-sm text-muted-foreground">
          Opt in to receive tenancy-related text messages — rent reminders,
          account notices, portal login links, and maintenance updates. SMS
          consent is optional and is never required to rent.
        </p>
      </div>
      <Card>
        <CardContent className="py-6">
          <SmsOptInForm businessName={settings.businessName} />
        </CardContent>
      </Card>
    </div>
  );
}
