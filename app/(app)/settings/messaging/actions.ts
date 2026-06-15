"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit/audit";
import { prisma } from "@/lib/db";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  getAppSettings,
  resolveEmailProvider,
  resolveSmsProvider,
  saveComplianceLinks,
  saveEmailSettings,
  saveMessagingSettings,
} from "@/lib/services/app-settings";
import { isValidComplianceUrl } from "@/lib/config/compliance";
import type { ReminderType } from "@/lib/generated/prisma/enums";

export interface MessagingState {
  ok?: boolean;
  error?: string;
  message?: string;
}

const TEMPLATE_TYPES: ReminderType[] = [
  "rent_due_soon",
  "rent_overdue",
  "partial_balance",
  "payment_receipt",
];

const str = (fd: FormData, key: string): string | null =>
  String(fd.get(key) ?? "").trim() || null;

export async function saveMessagingAction(
  _prev: MessagingState,
  fd: FormData,
): Promise<MessagingState> {
  await requireCapability("messaging.settings");

  const providerRaw = String(fd.get("smsProvider") ?? "");
  const smsProvider =
    providerRaw === "stub" || providerRaw === "twilio" || providerRaw === "telnyx"
      ? providerRaw
      : null;

  const tokenRaw = String(fd.get("smsAuthToken") ?? "");
  const accountSid = str(fd, "smsAccountSid");
  const fromNumber = str(fd, "smsFromNumber");

  if (smsProvider === "twilio") {
    if (!accountSid || !fromNumber) {
      return { error: "Twilio requires an Account SID and a From number." };
    }
    const hasStored = (await getAppSettings()).smsHasAuthToken;
    if (!tokenRaw && !hasStored) {
      return { error: "Twilio requires an auth token." };
    }
  }
  if (smsProvider === "telnyx") {
    if (!fromNumber) {
      return { error: "Telnyx requires a From number." };
    }
    const hasStored = (await getAppSettings()).smsHasAuthToken;
    if (!tokenRaw && !hasStored) {
      return { error: "Telnyx requires an API key." };
    }
  }

  const daysRaw = String(fd.get("reminderDueSoonDays") ?? "").trim();
  let reminderDueSoonDays: number | null = null;
  if (daysRaw !== "") {
    const n = Number(daysRaw);
    if (!Number.isInteger(n) || n < 0 || n > 28) {
      return { error: "Due-soon days must be a whole number between 0 and 28." };
    }
    reminderDueSoonDays = n;
  }

  const smsTemplates: Partial<Record<ReminderType, string>> = {};
  for (const t of TEMPLATE_TYPES) {
    const body = String(fd.get(`tpl_${t}`) ?? "").trim();
    if (body) smsTemplates[t] = body;
  }

  try {
    await saveMessagingSettings(
      {
        smsEnabled: fd.get("smsEnabled") === "on",
        smsProvider,
        smsAccountSid: accountSid,
        // Blank keeps the stored token; switching provider away from twilio
        // leaves it stored but unused.
        smsAuthToken: tokenRaw === "" ? undefined : tokenRaw,
        smsFromNumber: fromNumber,
        reminderDueSoonDays,
        dueSoonRemindersEnabled: fd.get("dueSoonRemindersEnabled") === "on",
        overdueRemindersEnabled: fd.get("overdueRemindersEnabled") === "on",
        smsTemplates,
      },
      await auditActor(),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save settings." };
  }

  revalidatePath("/settings/messaging");
  return { ok: true, message: "Messaging settings saved." };
}

export async function saveComplianceAction(
  _prev: MessagingState,
  fd: FormData,
): Promise<MessagingState> {
  await requireCapability("messaging.settings");

  const privacyPolicyUrl = str(fd, "privacyPolicyUrl");
  const termsUrl = str(fd, "termsUrl");

  if (privacyPolicyUrl && !isValidComplianceUrl(privacyPolicyUrl)) {
    return { error: "The privacy policy URL must be an http(s):// link." };
  }
  if (termsUrl && !isValidComplianceUrl(termsUrl)) {
    return { error: "The terms & conditions URL must be an http(s):// link." };
  }

  try {
    await saveComplianceLinks(
      {
        privacyPolicyText: str(fd, "privacyPolicyText"),
        termsText: str(fd, "termsText"),
        privacyPolicyUrl,
        termsUrl,
      },
      await auditActor(),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save settings." };
  }

  // The hosted policy pages and the portal footer read these.
  revalidatePath("/settings/messaging");
  revalidatePath("/privacy");
  revalidatePath("/terms");
  revalidatePath("/portal");
  return { ok: true, message: "Compliance links saved." };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveEmailAction(
  _prev: MessagingState,
  fd: FormData,
): Promise<MessagingState> {
  await requireCapability("messaging.settings");

  const providerRaw = String(fd.get("emailProvider") ?? "");
  const emailProvider =
    providerRaw === "stub" || providerRaw === "smtp" ? providerRaw : null;

  const fromAddress = str(fd, "emailFromAddress");
  const host = str(fd, "emailSmtpHost");
  const user = str(fd, "emailSmtpUser");
  const portRaw = str(fd, "emailSmtpPort");
  const authMethodRaw = str(fd, "emailAuthMethod");
  const authMethod =
    authMethodRaw === "oauth2" ? ("oauth2" as const) : ("password" as const);
  const tokenUrl = str(fd, "emailOauthTokenUrl");
  const clientId = str(fd, "emailOauthClientId");

  // Blank secret = keep what's stored (mirrors the SMS token semantics).
  const password = String(fd.get("emailPassword") ?? "");
  const clientSecret = String(fd.get("emailOauthClientSecret") ?? "");
  const refreshToken = String(fd.get("emailOauthRefreshToken") ?? "");

  let port: number | null = null;
  if (portRaw) {
    const n = Number(portRaw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return { error: "SMTP port must be a number between 1 and 65535." };
    }
    port = n;
  }
  if (fromAddress && !EMAIL_RE.test(fromAddress)) {
    return { error: "Enter a valid from address." };
  }
  if (tokenUrl && !/^https:\/\//.test(tokenUrl)) {
    return { error: "The OAuth2 token URL must be an https:// URL." };
  }

  if (emailProvider === "smtp") {
    if (!host || !user || !fromAddress) {
      return { error: "SMTP requires a host, a user, and a from address." };
    }
    const settings = await getAppSettings();
    if (authMethod === "password" && !password && !settings.emailHasPassword) {
      return { error: "SMTP password auth requires a password." };
    }
    if (authMethod === "oauth2") {
      if (!clientId) {
        return { error: "OAuth2 requires a client ID." };
      }
      if (!clientSecret && !settings.emailHasOauthClientSecret) {
        return { error: "OAuth2 requires a client secret." };
      }
      if (!refreshToken && !settings.emailHasOauthRefreshToken) {
        return { error: "OAuth2 requires a refresh token." };
      }
    }
  }

  try {
    await saveEmailSettings(
      {
        emailEnabled: fd.get("emailEnabled") === "on",
        emailProvider,
        emailFromAddress: fromAddress,
        emailFromName: str(fd, "emailFromName"),
        emailSmtpHost: host,
        emailSmtpPort: port,
        emailSmtpSecure: fd.get("emailSmtpSecure") === "on",
        emailSmtpUser: user,
        emailAuthMethod: emailProvider === "smtp" ? authMethod : null,
        emailOauthClientId: clientId,
        emailOauthTokenUrl: tokenUrl,
        emailPassword: password === "" ? undefined : password,
        emailOauthClientSecret: clientSecret === "" ? undefined : clientSecret,
        emailOauthRefreshToken: refreshToken === "" ? undefined : refreshToken,
      },
      await auditActor(),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save settings." };
  }

  revalidatePath("/settings/messaging");
  return { ok: true, message: "Email settings saved." };
}

export async function sendTestEmailAction(
  _prev: MessagingState,
  fd: FormData,
): Promise<MessagingState> {
  await requireCapability("messaging.settings");
  const to = String(fd.get("testEmail") ?? "").trim();
  if (!to || !EMAIL_RE.test(to)) {
    return { error: "Enter a valid email address for the test message." };
  }

  const settings = await getAppSettings();
  if (!settings.emailEnabled) {
    return { error: "Email sending is disabled — enable it above and save first." };
  }

  const actor = await auditActor();
  try {
    const provider = await resolveEmailProvider();
    const result = await provider.send({
      to,
      subject: `Test message from ${settings.businessName}`,
      text: `This is a test message from ${settings.businessName}. Email is configured correctly.`,
    });
    await writeAudit(prisma, {
      ...actor,
      action: "settings.email_test",
      entityType: "AppSettings",
      entityId: "singleton",
      after: {
        provider: result.provider,
        status: result.status,
        // Never audit the full address — mask the local part.
        toMasked: `${to[0]}***@${to.split("@")[1] ?? ""}`,
      },
    });
    if (result.status === "failed") {
      return { error: `Test send failed: ${result.error ?? "unknown error"}` };
    }
    return {
      ok: true,
      message:
        result.provider === "stub"
          ? "Test accepted by the stub provider (no real email is sent — check the server log)."
          : `Test message sent via ${result.provider}.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Test send failed." };
  }
}

export async function sendTestSmsAction(
  _prev: MessagingState,
  fd: FormData,
): Promise<MessagingState> {
  await requireCapability("messaging.settings");
  const to = String(fd.get("testPhone") ?? "").trim();
  if (!to) return { error: "Enter a phone number for the test message." };

  const settings = await getAppSettings();
  if (!settings.smsEnabled) {
    return { error: "SMS sending is disabled — enable it above and save first." };
  }

  const actor = await auditActor();
  try {
    const provider = await resolveSmsProvider();
    const result = await provider.send({
      to,
      body: `Test message from ${settings.businessName}. SMS is configured correctly.`,
    });
    await writeAudit(prisma, {
      ...actor,
      action: "settings.sms_test",
      entityType: "AppSettings",
      entityId: "singleton",
      after: {
        provider: result.provider,
        status: result.status,
        toLast4: to.slice(-4),
      },
    });
    if (result.status === "failed") {
      return { error: `Test send failed: ${result.error ?? "unknown error"}` };
    }
    return {
      ok: true,
      message:
        result.provider === "stub"
          ? "Test accepted by the stub provider (no real SMS is sent — check the server log)."
          : `Test message ${result.status} via ${result.provider}.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Test send failed." };
  }
}
