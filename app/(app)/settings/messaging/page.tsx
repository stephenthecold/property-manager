import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { DEFAULT_TEMPLATES } from "@/lib/reminders/templates";
import type { ReminderType } from "@/lib/generated/prisma/enums";
import { MessagingForm } from "./messaging-form";
import { Card, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";

const TEMPLATE_LABELS: Array<{ type: ReminderType; label: string }> = [
  { type: "rent_due_soon", label: "Rent due soon" },
  { type: "rent_overdue", label: "Rent overdue" },
  { type: "partial_balance", label: "Partial balance" },
  { type: "payment_receipt", label: "Payment receipt" },
];

export default async function MessagingSettingsPage() {
  await requireCapability("messaging.settings");
  const env = getEnv();
  const row = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  const overrides =
    (row?.smsTemplates as Partial<Record<ReminderType, string>>) ?? {};

  return (
    <div className="w-full max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Messaging</h2>
        <p className="text-sm text-muted-foreground">
          SMS provider, scheduled-reminder behavior, and message templates.
          Tenants without SMS consent are never messaged, regardless of these
          settings.
        </p>
      </div>
      <Card>
        <CardContent>
          <MessagingForm
            initial={{
              smsEnabled: row?.smsEnabled ?? true,
              smsProvider: row?.smsProvider ?? "",
              smsAccountSid: row?.smsAccountSid ?? "",
              hasAuthToken: !!row?.smsAuthTokenCiphertext,
              smsFromNumber: row?.smsFromNumber ?? "",
              reminderDueSoonDays:
                row?.reminderDueSoonDays != null ? String(row.reminderDueSoonDays) : "",
              envDueSoonDays: env.REMINDER_DUE_SOON_DAYS,
              envProvider: env.SMS_PROVIDER,
              dueSoonRemindersEnabled: row?.dueSoonRemindersEnabled ?? true,
              overdueRemindersEnabled: row?.overdueRemindersEnabled ?? true,
              templates: TEMPLATE_LABELS.map(({ type, label }) => ({
                type,
                label,
                value: overrides[type] ?? "",
                defaultBody: DEFAULT_TEMPLATES[type],
              })),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
