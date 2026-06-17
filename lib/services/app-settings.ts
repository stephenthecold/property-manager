import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/config/env";
import { decryptSecret, encryptSecret } from "@/lib/auth/crypto";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { getSmsProvider } from "@/lib/providers/sms";
import { StubSmsProvider } from "@/lib/providers/sms/stub";
import { TelnyxSmsProvider } from "@/lib/providers/sms/telnyx";
import { TwilioSmsProvider } from "@/lib/providers/sms/twilio";
import type { SmsProvider } from "@/lib/providers/sms/types";
import { StubEmailProvider } from "@/lib/providers/email/stub";
import { SmtpEmailProvider, type SmtpAuth } from "@/lib/providers/email/smtp";
import type { EmailProvider } from "@/lib/providers/email/types";
import { DEFAULT_EMAIL_SUBJECTS, DEFAULT_TEMPLATES } from "@/lib/reminders/templates";
import type { PermissionMatrix } from "@/lib/auth/permissions";
import {
  resolveFormConfig,
  type ApplicationFormConfig,
} from "@/lib/applications/form-config";
import {
  resolveCustomSections,
  type CustomSection,
} from "@/lib/applications/custom-questions";
import type { LateFeeType, ReminderType } from "@/lib/generated/prisma/enums";
import type { InputJsonValue } from "@/lib/generated/prisma/internal/prismaNamespace";

/** AAD binding the encrypted Twilio token to its row/field (GCM transplant protection). */
export const SMS_TOKEN_AAD = "appsettings:smsAuthToken:singleton";

/** AADs binding each encrypted email secret to its row/field. */
export const EMAIL_PASSWORD_AAD = "appsettings:emailPassword:singleton";
export const EMAIL_OAUTH_CLIENT_SECRET_AAD =
  "appsettings:emailOauthClientSecret:singleton";
export const EMAIL_OAUTH_REFRESH_TOKEN_AAD =
  "appsettings:emailOauthRefreshToken:singleton";

export interface ModuleFlags {
  /** Expenses, mortgages, profit/ROI (dashboard cards + /financials). */
  financials: boolean;
  /** Unit maintenance jobs + recurring monthly tasks (/maintenance). */
  maintenance: boolean;
  /** Tenant self-service portal (/portal, local tenant logins). */
  tenantPortal: boolean;
  /** Prospective-tenant rental applications (public /apply + staff /applications). */
  applications: boolean;
  /** Third-party payer portal (/payer-portal, local payer logins). */
  payerPortal: boolean;
}

/** Defaults when a module key has never been saved. */
const MODULE_DEFAULTS: ModuleFlags = {
  financials: true,
  maintenance: false,
  tenantPortal: false,
  applications: false,
  payerPortal: false,
};

function resolveModules(raw: unknown): ModuleFlags {
  const obj = (raw ?? {}) as Partial<Record<keyof ModuleFlags, unknown>>;
  return {
    financials:
      typeof obj.financials === "boolean" ? obj.financials : MODULE_DEFAULTS.financials,
    maintenance:
      typeof obj.maintenance === "boolean" ? obj.maintenance : MODULE_DEFAULTS.maintenance,
    tenantPortal:
      typeof obj.tenantPortal === "boolean"
        ? obj.tenantPortal
        : MODULE_DEFAULTS.tenantPortal,
    applications:
      typeof obj.applications === "boolean"
        ? obj.applications
        : MODULE_DEFAULTS.applications,
    payerPortal:
      typeof obj.payerPortal === "boolean"
        ? obj.payerPortal
        : MODULE_DEFAULTS.payerPortal,
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
  /** Receipt-number prefix; null/blank -> "RCT" (sanitized at use). */
  receiptPrefix: string | null;
  /** Tenant-facing copy; null -> the shipped default text. */
  portalWelcomeText: string | null;
  applyIntroText: string | null;
  /** NON-SECRET file-storage overrides (DB-over-env); null -> the env value. */
  storageProvider: string | null;
  s3Bucket: string | null;
  s3Region: string | null;
  s3Endpoint: string | null;
  s3ForcePathStyle: boolean | null;
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
  /** Master switch for ALL email sends. Config is DB-only (no env fallback). */
  emailEnabled: boolean;
  /** null = not configured; "stub" logs only; "smtp" sends. */
  emailProvider: "stub" | "smtp" | null;
  emailFromAddress: string | null;
  emailFromName: string | null;
  emailSmtpHost: string | null;
  emailSmtpPort: number | null;
  emailSmtpSecure: boolean;
  emailSmtpUser: string | null;
  emailAuthMethod: "password" | "oauth2" | null;
  emailOauthClientId: string | null;
  emailOauthTokenUrl: string | null;
  /** Presence-only flags — never the secrets themselves. */
  emailHasPassword: boolean;
  emailHasOauthClientSecret: boolean;
  emailHasOauthRefreshToken: boolean;
  /** DEFAULT_TEMPLATES merged with per-type DB overrides. */
  templates: Record<ReminderType, string>;
  /** DEFAULT_EMAIL_SUBJECTS merged with per-type DB overrides (email channel). */
  emailSubjects: Record<ReminderType, string>;
  /** Custom lease-agreement clause text; null = the shipped default
   *  (DEFAULT_LEASE_AGREEMENT_TEXT in lib/config/lease-agreement.ts). */
  leaseAgreementText: string | null;
  /** Saved landlord signature, auto-applied to outgoing e-sign requests. */
  landlordSignatureName: string | null;
  /** Storage key of the drawn landlord signature PNG (optional). */
  landlordSignatureImageKey: string | null;
  /** Storage key of the landlord initials PNG; null → typed initials derived
   *  from landlordSignatureName at {{landlord_initials}} markers. */
  landlordInitialsImageKey: string | null;
  /** Org Cash App cashtag ("$Example") for notices and the tenant portal. */
  cashAppCashtag: string | null;
  /** 10DLC / A2P compliance links. Privacy/terms render at /privacy & /terms
   *  when the *Text is set, unless a *Url override points elsewhere. (The
   *  sample embedded link is derived from APP_URL, not stored.) */
  privacyPolicyText: string | null;
  privacyPolicyUrl: string | null;
  termsText: string | null;
  termsUrl: string | null;
  /** Role→capability overrides vs. the default hierarchy ({} = defaults). */
  rolePermissions: PermissionMatrix;
  /** Optional feature modules; disabling hides UI but never deletes data. */
  modules: ModuleFlags;
  /** Public application form: per-field hidden/optional/required config. */
  applicationFields: ApplicationFormConfig;
  /** Operator-defined custom question sections on the public application form. */
  applicationCustomSections: CustomSection[];
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

  const subjectOverrides = (row?.emailSubjects as Partial<Record<ReminderType, string>>) ?? {};
  const emailSubjects = { ...DEFAULT_EMAIL_SUBJECTS };
  for (const [key, subject] of Object.entries(subjectOverrides)) {
    if (key in emailSubjects && typeof subject === "string" && subject.trim() !== "") {
      emailSubjects[key as ReminderType] = subject;
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
    receiptPrefix: row?.receiptPrefix ?? null,
    portalWelcomeText: row?.portalWelcomeText ?? null,
    applyIntroText: row?.applyIntroText ?? null,
    storageProvider: row?.storageProvider ?? null,
    s3Bucket: row?.s3Bucket ?? null,
    s3Region: row?.s3Region ?? null,
    s3Endpoint: row?.s3Endpoint ?? null,
    s3ForcePathStyle: row?.s3ForcePathStyle ?? null,
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
    emailEnabled: row?.emailEnabled ?? false,
    emailProvider:
      row?.emailProvider === "stub" || row?.emailProvider === "smtp"
        ? row.emailProvider
        : null,
    emailFromAddress: row?.emailFromAddress ?? null,
    emailFromName: row?.emailFromName ?? null,
    emailSmtpHost: row?.emailSmtpHost ?? null,
    emailSmtpPort: row?.emailSmtpPort ?? null,
    emailSmtpSecure: row?.emailSmtpSecure ?? true,
    emailSmtpUser: row?.emailSmtpUser ?? null,
    emailAuthMethod:
      row?.emailAuthMethod === "password" || row?.emailAuthMethod === "oauth2"
        ? row.emailAuthMethod
        : null,
    emailOauthClientId: row?.emailOauthClientId ?? null,
    emailOauthTokenUrl: row?.emailOauthTokenUrl ?? null,
    emailHasPassword: !!row?.emailPasswordCiphertext,
    emailHasOauthClientSecret: !!row?.emailOauthClientSecretCiphertext,
    emailHasOauthRefreshToken: !!row?.emailOauthRefreshTokenCiphertext,
    templates,
    emailSubjects,
    leaseAgreementText: row?.leaseAgreementText ?? null,
    landlordSignatureName: row?.landlordSignatureName ?? null,
    landlordSignatureImageKey: row?.landlordSignatureImageKey ?? null,
    landlordInitialsImageKey: row?.landlordInitialsImageKey ?? null,
    cashAppCashtag: row?.cashAppCashtag ?? null,
    privacyPolicyText: row?.privacyPolicyText ?? null,
    privacyPolicyUrl: row?.privacyPolicyUrl ?? null,
    termsText: row?.termsText ?? null,
    termsUrl: row?.termsUrl ?? null,
    rolePermissions: (row?.rolePermissions as PermissionMatrix) ?? {},
    modules: resolveModules(row?.modules),
    applicationFields: resolveFormConfig(row?.applicationFields),
    applicationCustomSections: resolveCustomSections(row?.applicationCustomSections),
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

/**
 * The effective Twilio auth token for verifying inbound/status webhooks —
 * DB-configured (decrypted) when AppSettings selects Twilio, else the env token
 * when the env provider is Twilio. null when Twilio is not the effective
 * provider (so webhook routes can fail closed: no legitimate caller).
 */
export async function getEffectiveTwilioAuthToken(): Promise<string | null> {
  const row = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (
    row?.smsProvider === "twilio" &&
    row.smsAuthTokenCiphertext &&
    row.smsAuthTokenNonce &&
    row.smsAuthTokenTag
  ) {
    return decryptSecret(
      {
        ciphertext: row.smsAuthTokenCiphertext,
        nonce: row.smsAuthTokenNonce,
        tag: row.smsAuthTokenTag,
      },
      SMS_TOKEN_AAD,
    );
  }
  // env fallback (when SMS isn't DB-configured). Mirrors resolveSmsProvider.
  const env = getEnv();
  if (env.SMS_PROVIDER === "twilio" && env.SMS_AUTH_TOKEN) {
    return env.SMS_AUTH_TOKEN;
  }
  return null;
}

/**
 * Effective email provider, from DB config only (email has no env fallback).
 * Throws with an operator-actionable message when unconfigured/incomplete —
 * callers surface it as a returned error, mirroring SMS sends.
 */
export async function resolveEmailProvider(): Promise<EmailProvider> {
  const row = await prisma.appSettings.findUnique({ where: { id: "singleton" } });

  if (row?.emailProvider === "stub") return new StubEmailProvider();
  if (row?.emailProvider !== "smtp") {
    throw new Error("Email is not configured (Settings → Messaging).");
  }

  const host = row.emailSmtpHost;
  const user = row.emailSmtpUser;
  const fromAddress = row.emailFromAddress;
  if (!host || !user || !fromAddress) {
    throw new Error(
      "Email (SMTP) configuration is incomplete — host, user, and from address are required.",
    );
  }

  let auth: SmtpAuth;
  if (row.emailAuthMethod === "oauth2") {
    if (
      !row.emailOauthClientId ||
      !row.emailOauthClientSecretCiphertext ||
      !row.emailOauthClientSecretNonce ||
      !row.emailOauthClientSecretTag ||
      !row.emailOauthRefreshTokenCiphertext ||
      !row.emailOauthRefreshTokenNonce ||
      !row.emailOauthRefreshTokenTag
    ) {
      throw new Error(
        "Email OAuth2 configuration is incomplete — client ID, client secret, and refresh token are required.",
      );
    }
    auth = {
      method: "oauth2",
      clientId: row.emailOauthClientId,
      clientSecret: decryptSecret(
        {
          ciphertext: row.emailOauthClientSecretCiphertext,
          nonce: row.emailOauthClientSecretNonce,
          tag: row.emailOauthClientSecretTag,
        },
        EMAIL_OAUTH_CLIENT_SECRET_AAD,
      ),
      refreshToken: decryptSecret(
        {
          ciphertext: row.emailOauthRefreshTokenCiphertext,
          nonce: row.emailOauthRefreshTokenNonce,
          tag: row.emailOauthRefreshTokenTag,
        },
        EMAIL_OAUTH_REFRESH_TOKEN_AAD,
      ),
      tokenUrl: row.emailOauthTokenUrl,
    };
  } else {
    if (
      !row.emailPasswordCiphertext ||
      !row.emailPasswordNonce ||
      !row.emailPasswordTag
    ) {
      throw new Error("Email (SMTP) password is not set.");
    }
    auth = {
      method: "password",
      password: decryptSecret(
        {
          ciphertext: row.emailPasswordCiphertext,
          nonce: row.emailPasswordNonce,
          tag: row.emailPasswordTag,
        },
        EMAIL_PASSWORD_AAD,
      ),
    };
  }

  const secure = row.emailSmtpSecure;
  return new SmtpEmailProvider({
    host,
    port: row.emailSmtpPort ?? (secure ? 465 : 587),
    secure,
    user,
    fromAddress,
    fromName: row.emailFromName,
    auth,
  });
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

/** Persist the public application-form field config (clamped to known fields). */
export async function saveApplicationFields(
  config: ApplicationFormConfig,
  actor: AuditContext,
): Promise<void> {
  const clamped = resolveFormConfig(config);
  const json = { ...clamped };
  await prisma.$transaction(async (tx) => {
    const before = await tx.appSettings.findUnique({ where: { id: "singleton" } });
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", applicationFields: json, updatedBy: actor.actorId ?? null },
      update: { applicationFields: json, updatedBy: actor.actorId ?? null },
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.application_fields.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      before: { applicationFields: resolveFormConfig(before?.applicationFields) },
      after: { applicationFields: clamped },
    });
  });
  invalidateAppSettingsCache();
}

/** Persist the operator-defined custom application question sections. */
export async function saveApplicationCustomSections(
  sections: unknown,
  actor: AuditContext,
): Promise<CustomSection[]> {
  const clamped = resolveCustomSections(sections);
  // The sanitized array is plain JSON; store it as-is.
  const json = clamped as unknown as InputJsonValue;
  await prisma.$transaction(async (tx) => {
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", applicationCustomSections: json, updatedBy: actor.actorId ?? null },
      update: { applicationCustomSections: json, updatedBy: actor.actorId ?? null },
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.application_custom_sections.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      after: { sectionCount: clamped.length },
    });
  });
  invalidateAppSettingsCache();
  return clamped;
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

/**
 * Persist the lease-agreement clause text. `null` reverts to the shipped
 * default (lib/config/lease-agreement.ts).
 */
export async function saveLeaseAgreementText(
  text: string | null,
  actor: AuditContext,
): Promise<void> {
  const data = { leaseAgreementText: text, updatedBy: actor.actorId ?? null };
  await prisma.$transaction(async (tx) => {
    const before = await tx.appSettings.findUnique({ where: { id: "singleton" } });
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.lease_agreement.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      before: before
        ? { leaseAgreementText: before.leaseAgreementText }
        : undefined,
      after: { leaseAgreementText: text },
    });
  });
  invalidateAppSettingsCache();
}

/**
 * Persist the saved landlord signature (typed name + optional drawn-PNG
 * storage key) and optional initials image. For both keys `undefined` keeps
 * the stored value and `null` clears it. Passing `name: null` clears the
 * signature entirely. Managers+ (esign.manage) apply these marks when
 * sending e-sign requests.
 */
export async function saveLandlordSignature(
  name: string | null,
  imageKey: string | null | undefined,
  actor: AuditContext,
  initialsImageKey?: string | null,
): Promise<void> {
  const data = {
    landlordSignatureName: name,
    ...(imageKey !== undefined ? { landlordSignatureImageKey: imageKey } : {}),
    ...(initialsImageKey !== undefined
      ? { landlordInitialsImageKey: initialsImageKey }
      : {}),
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
      action: "settings.landlord_signature.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      before: before
        ? {
            landlordSignatureName: before.landlordSignatureName,
            landlordSignatureImageKey: before.landlordSignatureImageKey,
            landlordInitialsImageKey: before.landlordInitialsImageKey,
          }
        : undefined,
      after: {
        landlordSignatureName: name,
        landlordSignatureImageKey:
          imageKey !== undefined
            ? imageKey
            : (before?.landlordSignatureImageKey ?? null),
        landlordInitialsImageKey:
          initialsImageKey !== undefined
            ? initialsImageKey
            : (before?.landlordInitialsImageKey ?? null),
      },
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
  receiptPrefix: string | null;
  portalWelcomeText: string | null;
  applyIntroText: string | null;
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
    receiptPrefix: input.receiptPrefix,
    portalWelcomeText: input.portalWelcomeText,
    applyIntroText: input.applyIntroText,
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

export interface StorageConfigInput {
  storageProvider: string | null; // "stub" | "local" | "s3" | null (-> env)
  s3Bucket: string | null;
  s3Region: string | null;
  s3Endpoint: string | null;
  s3ForcePathStyle: boolean | null;
}

/**
 * Persist NON-SECRET storage overrides (provider + S3 bucket/region/endpoint/
 * path-style). Secrets stay in env and are never written here. null on a field
 * clears the override (falls back to env).
 */
export async function saveStorageConfig(
  input: StorageConfigInput,
  actor: AuditContext,
): Promise<void> {
  const provider = input.storageProvider;
  if (provider != null && !["stub", "local", "s3"].includes(provider)) {
    throw new Error("Storage provider must be stub, local, or s3.");
  }
  const data = {
    storageProvider: provider,
    s3Bucket: input.s3Bucket,
    s3Region: input.s3Region,
    s3Endpoint: input.s3Endpoint,
    s3ForcePathStyle: input.s3ForcePathStyle,
    updatedBy: actor.actorId ?? null,
  };
  await prisma.$transaction(async (tx) => {
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.storage.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      // S3 bucket/endpoint are config, not secrets — safe to audit.
      after: {
        storageProvider: provider,
        s3Bucket: input.s3Bucket,
        s3Endpoint: input.s3Endpoint,
      },
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

export interface EmailSettingsInput {
  emailEnabled: boolean;
  /** null = not configured; "stub" logs only; "smtp" sends. */
  emailProvider: "stub" | "smtp" | null;
  emailFromAddress: string | null;
  emailFromName: string | null;
  emailSmtpHost: string | null;
  emailSmtpPort: number | null;
  emailSmtpSecure: boolean;
  emailSmtpUser: string | null;
  emailAuthMethod: "password" | "oauth2" | null;
  emailOauthClientId: string | null;
  emailOauthTokenUrl: string | null;
  /** undefined = keep the stored secret; "" clears it; a string replaces it. */
  emailPassword?: string;
  emailOauthClientSecret?: string;
  emailOauthRefreshToken?: string;
  /** Per-type email subject overrides; empty/missing fall back to defaults. */
  emailSubjects: Partial<Record<ReminderType, string>>;
}

/** Ciphertext/nonce/tag column updates for one optional encrypted secret. */
function encryptedTripletData(
  value: string | undefined,
  aad: string,
  cols: { ciphertext: string; nonce: string; tag: string },
): Record<string, string | null> {
  if (value === undefined) return {};
  if (value === "") {
    return { [cols.ciphertext]: null, [cols.nonce]: null, [cols.tag]: null };
  }
  const enc = encryptSecret(value, aad);
  return {
    [cols.ciphertext]: enc.ciphertext,
    [cols.nonce]: enc.nonce,
    [cols.tag]: enc.tag,
  };
}

export async function saveEmailSettings(
  input: EmailSettingsInput,
  actor: AuditContext,
): Promise<void> {
  // Keep only non-empty, known-type subject overrides (defaults fill the rest).
  const cleanSubjects: Partial<Record<ReminderType, string>> = {};
  for (const [key, subject] of Object.entries(input.emailSubjects)) {
    if (key in DEFAULT_EMAIL_SUBJECTS && typeof subject === "string" && subject.trim() !== "") {
      cleanSubjects[key as ReminderType] = subject.trim();
    }
  }
  const data = {
    emailEnabled: input.emailEnabled,
    emailProvider: input.emailProvider,
    emailFromAddress: input.emailFromAddress,
    emailFromName: input.emailFromName,
    emailSubjects: cleanSubjects as unknown as InputJsonValue,
    emailSmtpHost: input.emailSmtpHost,
    emailSmtpPort: input.emailSmtpPort,
    emailSmtpSecure: input.emailSmtpSecure,
    emailSmtpUser: input.emailSmtpUser,
    emailAuthMethod: input.emailAuthMethod,
    emailOauthClientId: input.emailOauthClientId,
    emailOauthTokenUrl: input.emailOauthTokenUrl,
    ...encryptedTripletData(input.emailPassword, EMAIL_PASSWORD_AAD, {
      ciphertext: "emailPasswordCiphertext",
      nonce: "emailPasswordNonce",
      tag: "emailPasswordTag",
    }),
    ...encryptedTripletData(
      input.emailOauthClientSecret,
      EMAIL_OAUTH_CLIENT_SECRET_AAD,
      {
        ciphertext: "emailOauthClientSecretCiphertext",
        nonce: "emailOauthClientSecretNonce",
        tag: "emailOauthClientSecretTag",
      },
    ),
    ...encryptedTripletData(
      input.emailOauthRefreshToken,
      EMAIL_OAUTH_REFRESH_TOKEN_AAD,
      {
        ciphertext: "emailOauthRefreshTokenCiphertext",
        nonce: "emailOauthRefreshTokenNonce",
        tag: "emailOauthRefreshTokenTag",
      },
    ),
    updatedBy: actor.actorId ?? null,
  };
  await prisma.$transaction(async (tx) => {
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    // Never audit secrets — only whether each one changed this save.
    await writeAudit(tx, {
      ...actor,
      action: "settings.email.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      after: {
        emailEnabled: input.emailEnabled,
        emailProvider: input.emailProvider,
        emailFromAddress: input.emailFromAddress,
        emailSmtpHost: input.emailSmtpHost,
        emailSmtpPort: input.emailSmtpPort,
        emailSmtpSecure: input.emailSmtpSecure,
        emailAuthMethod: input.emailAuthMethod,
        passwordChanged: input.emailPassword !== undefined,
        oauthClientSecretChanged: input.emailOauthClientSecret !== undefined,
        oauthRefreshTokenChanged: input.emailOauthRefreshToken !== undefined,
      },
    });
  });
  invalidateAppSettingsCache();
}

/** Persist the org Cash App cashtag (canonical "$Tag" or null to clear). */
export async function saveCashAppCashtag(
  cashtag: string | null,
  actor: AuditContext,
): Promise<void> {
  const data = { cashAppCashtag: cashtag, updatedBy: actor.actorId ?? null };
  await prisma.$transaction(async (tx) => {
    const before = await tx.appSettings.findUnique({ where: { id: "singleton" } });
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.payment_methods.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      before: before ? { cashAppCashtag: before.cashAppCashtag } : undefined,
      after: { cashAppCashtag: cashtag },
    });
  });
  invalidateAppSettingsCache();
}

export interface ComplianceLinksInput {
  /** Hosted policy text (rendered at /privacy & /terms); null clears it. */
  privacyPolicyText: string | null;
  termsText: string | null;
  /** External-page overrides (win over hosted text); null clears them. */
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
}

/** Persist the 10DLC / A2P compliance links (privacy, terms, sample link). */
export async function saveComplianceLinks(
  input: ComplianceLinksInput,
  actor: AuditContext,
): Promise<void> {
  const data = { ...input, updatedBy: actor.actorId ?? null };
  await prisma.$transaction(async (tx) => {
    const before = await tx.appSettings.findUnique({ where: { id: "singleton" } });
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.compliance.updated",
      entityType: "AppSettings",
      entityId: "singleton",
      before: before
        ? {
            privacyPolicyUrl: before.privacyPolicyUrl,
            termsUrl: before.termsUrl,
            privacyPolicyHosted: !!before.privacyPolicyText,
            termsHosted: !!before.termsText,
          }
        : undefined,
      after: {
        privacyPolicyUrl: input.privacyPolicyUrl,
        termsUrl: input.termsUrl,
        privacyPolicyHosted: !!input.privacyPolicyText,
        termsHosted: !!input.termsText,
      },
    });
  });
  invalidateAppSettingsCache();
}
