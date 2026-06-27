import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { DEFAULT_TEMPLATES } from "@/lib/reminders/templates";
import type { ReminderType } from "@/lib/generated/prisma/enums";
import { MessagingForm } from "./messaging-form";
import { EmailForm } from "./email-form";
import { ComplianceForm } from "./compliance-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

const TEMPLATE_LABELS: Array<{ type: ReminderType; label: string }> = [
  { type: "rent_due_soon", label: "Rent due soon" },
  { type: "rent_overdue", label: "Rent overdue" },
  { type: "partial_balance", label: "Partial balance" },
  { type: "payment_receipt", label: "Payment receipt" },
  { type: "maintenance", label: "Maintenance notice" },
];

export default async function MessagingSettingsPage() {
  await requireCapability("messaging.settings");
  const env = getEnv();
  const row = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  const overrides =
    (row?.smsTemplates as Partial<Record<ReminderType, string>>) ?? {};
  const subjectOverrides =
    (row?.emailSubjects as Partial<Record<ReminderType, string>>) ?? {};

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Messaging</h2>
        <p className="text-sm text-muted-foreground">
          SMS and email providers, scheduled-reminder behavior, and message
          templates. Tenants without SMS consent are never texted, regardless
          of these settings.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SMS</CardTitle>
        </CardHeader>
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
              reminderSendHour:
                row?.reminderSendHour != null ? String(row.reminderSendHour) : "",
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compliance links (10DLC / A2P)</CardTitle>
        </CardHeader>
        <CardContent>
          <ComplianceForm
            initial={{
              privacyPolicyText: row?.privacyPolicyText ?? "",
              privacyPolicyUrl: row?.privacyPolicyUrl ?? "",
              termsText: row?.termsText ?? "",
              termsUrl: row?.termsUrl ?? "",
              baseUrl: env.APP_URL,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email</CardTitle>
        </CardHeader>
        <CardContent>
          <EmailForm
            initial={{
              emailEnabled: row?.emailEnabled ?? false,
              emailProvider: row?.emailProvider ?? "",
              emailFromAddress: row?.emailFromAddress ?? "",
              emailFromName: row?.emailFromName ?? "",
              emailSmtpHost: row?.emailSmtpHost ?? "",
              emailSmtpPort:
                row?.emailSmtpPort != null ? String(row.emailSmtpPort) : "",
              emailSmtpSecure: row?.emailSmtpSecure ?? true,
              emailSmtpUser: row?.emailSmtpUser ?? "",
              emailAuthMethod: row?.emailAuthMethod ?? "password",
              emailOauthClientId: row?.emailOauthClientId ?? "",
              emailOauthTokenUrl: row?.emailOauthTokenUrl ?? "",
              hasPassword: !!row?.emailPasswordCiphertext,
              hasOauthClientSecret: !!row?.emailOauthClientSecretCiphertext,
              hasOauthRefreshToken: !!row?.emailOauthRefreshTokenCiphertext,
              subjects: TEMPLATE_LABELS.map(({ type, label }) => ({
                type,
                label,
                value: subjectOverrides[type] ?? "",
              })),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
