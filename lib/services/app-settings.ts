import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/config/env";
import { decryptSecret, encryptSecret } from "@/lib/auth/crypto";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { getSmsProvider } from "@/lib/providers/sms";
import { StubSmsProvider } from "@/lib/providers/sms/stub";
import { TelnyxSmsProvider } from "@/lib/providers/sms/telnyx";
import { TwilioSmsProvider } from "@/lib/providers/sms/twilio";
import type { SmsProvider } from "@/lib/providers/sms/types";
import { DEFAULT_TEMPLATES } from "@/lib/reminders/templates";
import type { PermissionMatrix } from "@/lib/auth/permissions";
import type { LateFeeType, ReminderType } from "@/lib/generated/prisma/enums";

/** AAD binding the encrypted Twilio token to its row/field (GCM transplant protection). */
export const SMS_TOKEN_AAD = "appsettings:smsAuthToken:singleton";

export interface ModuleFlags {
  /** Expenses, mortgages, profit/ROI (dashboard cards + /financials). */
  financials: boolean;
  /** Unit maintenance jobs + recurring monthly tasks (/maintenance). */
  maintenance: boolean;
}

/** Defaults when a module key has never been saved. */
const MODULE_DEFAULTS: ModuleFlags = { financials: true, maintenance: false };

function resolveModules(raw: unknown): ModuleFlags {
  const obj = (raw ?? {}) as Partial<Record<keyof ModuleFlags, unknown>>;
  return {
    financials:
      typeof obj.financials === "boolean" ? obj.financials : MODULE_DEFAULTS.financials,
    maintenance:
      typeof obj.maintenance === "boolean" ? obj.maintenance : MODULE_DEFAULTS.maintenance,
  };
}

export interface ResolvedAppSettings {
  /** White-label brand shown in the header, receipts, and reports. */
  businessName: string;
  businessLegalName: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  logoDocumentId: string | null;
  receiptFooter: string | null;
  defaultTimezone: string;
  defaultCurrency: string;
  /** Master switch for ALL SMS sends (manual, bulk, scheduled). */
  smsEnabled: boolean;
  /** Effective provider name after DB-over-env resolution. */
  smsProvider: "stub" | "twilio" | "telnyx";
  smsConfigSource: "db" | "env";
  smsFromNumber: string | null;
  smsHasAuthToken: boolean;
  dueSoonDays: number;
  dueSoonRemindersEnabled: boolean;
  overdueRemindersEnabled: boolean;
  /** DEFAULT_TEMPLATES merged with per-type DB overrides. */
  templates: Record<ReminderType, string>;
  /** Role→capability overrides vs. the default hierarchy ({} = defaults). */
  rolePermissions: PermissionMatrix;
  /** Optional feature modules; disabling hides UI but never deletes data. */
  modules: ModuleFlags;
  /** Org-wide charge defaults ("rates") — prefill new leases/units. */
  billing: {
    dueDay: number;
    graceDays: number;
    lateFeeType: LateFeeType;
    lateFeeAmountCents: bigint | null;
    lateFeeBps: number | null;
    lateFeeMaxCents: bigint | null;
    internetFeeCents: bigint;
  };
}

let cache: { value: ResolvedAppSettings; at: number } | null = null;
const TTL_MS = 30_000;

export function invalidateAppSettingsCache(): void {
  cache = null;
}

export async function getAppSettings(): Promise<ResolvedAppSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await resolve();
  cache = { value, at: Date.now() };
  return value;
}

async function resolve(): Promise<ResolvedAppSettings> {
  const env = getEnv();
  const row = await prisma.appSettings.findUnique({ where: { id: "singleton" } });

  const overrides = (row?.smsTemplates as Partial<Record<ReminderType, string>>) ?? {};
  const templates = { ...DEFAULT_TEMPLATES };
  for (const [key, body] of Object.entries(overrides)) {
    if (key in templates && typeof body === "string" && body.trim() !== "") {
      templates[key as ReminderType] = body;
    }
  }

  const dbSms =
    row?.smsProvider === "twilio" ||
    row?.smsProvider === "telnyx" ||
    row?.smsProvider === "stub";

  return {
    businessName: row?.businessName?.trim() || "Property Manager",
    businessLegalName: row?.businessLegalName ?? null,
    businessAddress: row?.businessAddress ?? null,
    businessPhone: row?.businessPhone ?? null,
    businessEmail: row?.businessEmail ?? null,
    logoDocumentId: row?.logoDocumentId ?? null,
    receiptFooter: row?.receiptFooter ?? null,
    defaultTimezone: row?.defaultTimezone || env.DEFAULT_TIMEZONE,
    defaultCurrency: row?.defaultCurrency || env.DEFAULT_CURRENCY,
    smsEnabled: row?.smsEnabled ?? true,
    smsProvider: dbSms
      ? (row!.smsProvider as "stub" | "twilio" | "telnyx")
      : env.SMS_PROVIDER,
    smsConfigSource: dbSms ? "db" : "env",
    smsFromNumber: row?.smsFromNumber ?? env.SMS_FROM_NUMBER ?? null,
    smsHasAuthToken: !!row?.smsAuthTokenCiphertext,
    dueSoonDays: row?.reminderDueSoonDays ?? env.REMINDER_DUE_SOON_DAYS,
    dueSoonRemindersEnabled: row?.dueSoonRemindersEnabled ?? true,
    overdueRemindersEnabled: row?.overdueRemindersEnabled ?? true,
    templates,
    rolePermissions: (row?.rolePermissions as PermissionMatrix) ?? {},
    modules: resolveModules(row?.modules),
    billing: {
      dueDay: row?.defaultDueDay ?? 1,
      graceDays: row?.defaultGraceDays ?? 5,
      lateFeeType: row?.defaultLateFeeType ?? "none",
      lateFeeAmountCents: row?.defaultLateFeeAmountCents ?? null,
      lateFeeBps: row?.defaultLateFeeBps ?? null,
      lateFeeMaxCents: row?.defaultLateFeeMaxCents ?? null,
      internetFeeCents: row?.defaultInternetFeeCents ?? 2500n,
    },
  };
}

/**
 * Effective SMS provider: DB-configured Twilio (decrypted token) or stub wins
 * over the env-selected provider, mirroring how AuthSettings overrides OIDC env.
 */
export async function resolveSmsProvider(): Promise<SmsProvider> {
  const row = await prisma.appSettings.findUnique({ where: { id: "singleton" } });

  if (row?.smsProvider === "stub") return new StubSmsProvider();
  const hasToken =
    !!row?.smsAuthTokenCiphertext &&
    !!row?.smsAuthTokenNonce &&
    !!row?.smsAuthTokenTag;
  const dbToken = () =>
    decryptSecret(
      {
        ciphertext: row!.smsAuthTokenCiphertext!,
        nonce: row!.smsAuthTokenNonce!,
        tag: row!.smsAuthTokenTag!,
      },
      SMS_TOKEN_AAD,
    );
  if (
    row?.smsProvider === "twilio" &&
    row.smsAccountSid &&
    row.smsFromNumber &&
    hasToken
  ) {
    return new TwilioSmsProvider({
      accountSid: row.smsAccountSid,
      authToken: dbToken(),
      fromNumber: row.smsFromNumber,
    });
  }
  // Telnyx authenticates with the API key alone (stored in the same encrypted
  // token fields); no account SID.
  if (row?.smsProvider === "telnyx" && row.smsFromNumber && hasToken) {
    return new TelnyxSmsProvider({
      apiKey: dbToken(),
      fromNumber: row.smsFromNumber,
    });
  }

  return getSmsProvider();
}

export interface BillingDefaultsInput {
  dueDay: number;
  graceDays: number;
  lateFeeType: LateFeeType;
  lateFeeAmountCents: bigint | null;
  lateFeeBps: number | null;
  lateFeeMaxCents: bigint | null;
  internetFeeCents: bigint;
}

export async function saveBillingDefaults(
  input: BillingDefaultsInput,
  actor: AuditContext,
): Promise<void> {
  const data = {
    defaultDueDay: input.dueDay,
    defaultGraceDays: input.graceDays,
    defaultLateFeeType: input.lateFeeType,
    defaultLateFeeAmountCents: input.lateFeeAmountCents,
    defaultLateFeeBps: input.lateFeeBps,
    defaultLateFeeMaxCents: input.lateFeeMaxCents,
    defaultInternetFeeCents: input.internetFeeCents,
    updatedBy: actor.actorId ?? null,
  };
  await prisma.$transaction(async (tx) => {
    const before = await tx.appSettings.findUnique({ where: { id: "singleton" } });
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.billing.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      before: before
        ? {
            defaultDueDay: before.defaultDueDay,
            defaultGraceDays: before.defaultGraceDays,
            defaultLateFeeType: before.defaultLateFeeType,
            defaultLateFeeAmountCents: before.defaultLateFeeAmountCents,
            defaultLateFeeBps: before.defaultLateFeeBps,
            defaultLateFeeMaxCents: before.defaultLateFeeMaxCents,
            defaultInternetFeeCents: before.defaultInternetFeeCents,
          }
        : undefined,
      after: { ...data, updatedBy: undefined },
    });
  });
  invalidateAppSettingsCache();
}

/** Guard for module-scoped actions: throws when the module is switched off. */
export async function assertModuleEnabled(name: keyof ModuleFlags): Promise<void> {
  const { modules } = await getAppSettings();
  if (!modules[name]) {
    throw new Error(`The ${name} module is disabled (Settings → Modules).`);
  }
}

/** Persist the module flags. Disabling hides UI only — data is retained. */
export async function saveModules(
  modules: ModuleFlags,
  actor: AuditContext,
): Promise<void> {
  const modulesJson = { ...modules }; // plain object for Prisma's Json input type
  await prisma.$transaction(async (tx) => {
    const before = await tx.appSettings.findUnique({ where: { id: "singleton" } });
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", modules: modulesJson, updatedBy: actor.actorId ?? null },
      update: { modules: modulesJson, updatedBy: actor.actorId ?? null },
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.modules.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      before: { modules: resolveModules(before?.modules) },
      after: { modules },
    });
  });
  invalidateAppSettingsCache();
}

/** Persist the role→capability override matrix (already diffed to non-defaults). */
export async function saveRolePermissions(
  matrix: PermissionMatrix,
  actor: AuditContext,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.appSettings.findUnique({ where: { id: "singleton" } });
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", rolePermissions: matrix, updatedBy: actor.actorId ?? null },
      update: { rolePermissions: matrix, updatedBy: actor.actorId ?? null },
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.permissions.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      before: { rolePermissions: (before?.rolePermissions as PermissionMatrix) ?? {} },
      after: { rolePermissions: matrix },
    });
  });
  invalidateAppSettingsCache();
}

export interface OrganizationSettingsInput {
  businessName: string | null;
  businessLegalName: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  logoDocumentId?: string | null; // undefined = leave unchanged
  receiptFooter: string | null;
  defaultTimezone: string | null;
  defaultCurrency: string | null;
}

export async function saveOrganizationSettings(
  input: OrganizationSettingsInput,
  actor: AuditContext,
): Promise<void> {
  const data = {
    businessName: input.businessName,
    businessLegalName: input.businessLegalName,
    businessAddress: input.businessAddress,
    businessPhone: input.businessPhone,
    businessEmail: input.businessEmail,
    ...(input.logoDocumentId !== undefined
      ? { logoDocumentId: input.logoDocumentId }
      : {}),
    receiptFooter: input.receiptFooter,
    defaultTimezone: input.defaultTimezone,
    defaultCurrency: input.defaultCurrency,
    updatedBy: actor.actorId ?? null,
  };
  await prisma.$transaction(async (tx) => {
    const before = await tx.appSettings.findUnique({ where: { id: "singleton" } });
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.organization.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      before: before
        ? { businessName: before.businessName, logoDocumentId: before.logoDocumentId }
        : undefined,
      after: { ...data, updatedBy: undefined },
    });
  });
  invalidateAppSettingsCache();
}

export interface MessagingSettingsInput {
  smsEnabled: boolean;
  /** null = use env config; "stub" | "twilio" | "telnyx" = DB config. */
  smsProvider: "stub" | "twilio" | "telnyx" | null;
  smsAccountSid: string | null;
  /** undefined = keep the stored token; a string replaces it (Twilio auth token / Telnyx API key). */
  smsAuthToken?: string;
  smsFromNumber: string | null;
  reminderDueSoonDays: number | null;
  dueSoonRemindersEnabled: boolean;
  overdueRemindersEnabled: boolean;
  /** Per-type overrides; empty/missing values fall back to defaults. */
  smsTemplates: Partial<Record<ReminderType, string>>;
}

export async function saveMessagingSettings(
  input: MessagingSettingsInput,
  actor: AuditContext,
): Promise<void> {
  const tokenFields =
    input.smsAuthToken !== undefined
      ? input.smsAuthToken === ""
        ? {
            smsAuthTokenCiphertext: null,
            smsAuthTokenNonce: null,
            smsAuthTokenTag: null,
          }
        : (() => {
            const enc = encryptSecret(input.smsAuthToken, SMS_TOKEN_AAD);
            return {
              smsAuthTokenCiphertext: enc.ciphertext,
              smsAuthTokenNonce: enc.nonce,
              smsAuthTokenTag: enc.tag,
            };
          })()
      : {};

  const data = {
    smsEnabled: input.smsEnabled,
    smsProvider: input.smsProvider,
    smsAccountSid: input.smsAccountSid,
    smsFromNumber: input.smsFromNumber,
    reminderDueSoonDays: input.reminderDueSoonDays,
    dueSoonRemindersEnabled: input.dueSoonRemindersEnabled,
    overdueRemindersEnabled: input.overdueRemindersEnabled,
    smsTemplates: input.smsTemplates,
    ...tokenFields,
    updatedBy: actor.actorId ?? null,
  };
  await prisma.$transaction(async (tx) => {
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    // Never audit the token itself — only whether one is now stored.
    await writeAudit(tx, {
      ...actor,
      action: "settings.messaging.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      after: {
        smsEnabled: input.smsEnabled,
        smsProvider: input.smsProvider,
        smsFromNumber: input.smsFromNumber,
        reminderDueSoonDays: input.reminderDueSoonDays,
        dueSoonRemindersEnabled: input.dueSoonRemindersEnabled,
        overdueRemindersEnabled: input.overdueRemindersEnabled,
        tokenChanged: input.smsAuthToken !== undefined,
      },
    });
  });
  invalidateAppSettingsCache();
}
