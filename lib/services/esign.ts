import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { publicBaseUrl } from "@/lib/http/base-url";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  hashSigningToken,
  isTokenFormatValid,
  mintSigningToken,
} from "@/lib/esign/token";
import {
  looksLikePng,
  renderSignedArtifactHtml,
  type ArtifactSigner,
} from "@/lib/esign/artifact";
import {
  documentNeedsInitials,
  markerPassthroughVars,
} from "@/lib/esign/markers";
import { buildAgreementVars } from "@/lib/services/lease-agreement";
import { renderTemplate } from "@/lib/reminders/templates";
import { DEFAULT_LEASE_AGREEMENT_TEXT } from "@/lib/config/lease-agreement";
import {
  getAppSettings,
  resolveEmailProvider,
} from "@/lib/services/app-settings";
import { sendReminder } from "@/lib/services/reminders";
import { createUploadedDocument } from "@/lib/services/documents";
import { getFileStorage } from "@/lib/providers/storage";

/**
 * Built-in e-signing service (provider-seam friendly: everything below talks
 * to OUR SigningRequest/SigningSigner rows; an external provider would slot in
 * behind the same create/cancel/complete surface). A request freezes the
 * agreement TEXT at send time (documentText + sha256), so what was signed is
 * immutable even when the lease or template changes later. Each tenant signer
 * gets a 256-bit link token stored only as a sha-256 hash; the raw token
 * exists only in the sent SMS/email link. The landlord side is the saved
 * AppSettings signature, applied at send time by a manager+ (esign.manage).
 */

export type SigningKind = "lease" | "renewal";

const KIND_LABEL: Record<SigningKind, string> = {
  lease: "lease agreement",
  renewal: "lease renewal agreement",
};

export function signingKindLabel(kind: string): string {
  return KIND_LABEL[(kind === "renewal" ? "renewal" : "lease") as SigningKind];
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function slugPart(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

// ---------------------------------------------------------------------------
// Sending links (SMS + email; each channel best-effort)
// ---------------------------------------------------------------------------

export interface SignerSendStatus {
  signerId: string;
  name: string;
  sms: "sent" | "skipped" | "failed";
  email: "sent" | "skipped" | "failed";
  /** At least one channel succeeded (lastSentAt was recorded). */
  delivered: boolean;
}

interface SendLinkInput {
  signerId: string;
  tenantId: string;
  leaseId: string;
  name: string;
  email: string | null;
  token: string;
  kind: SigningKind;
  expiresAt: Date;
  timezone: string;
  actor: AuditContext;
}

/**
 * Send one signer their tokenized link via SMS (consent + phone enforced by
 * sendReminder) and email (when configured + enabled). Individual channel
 * failures are swallowed; lastSentAt is recorded when anything got through.
 */
async function sendSignerLink(i: SendLinkInput): Promise<SignerSendStatus> {
  const app = await getAppSettings();
  const link = `${await publicBaseUrl()}/sign/${i.token}`;
  const kindLabel = signingKindLabel(i.kind);
  const expires = DateTime.fromJSDate(i.expiresAt, { zone: i.timezone })
    .setLocale("en-US")
    .toLocaleString(DateTime.DATE_FULL);

  let sms: SignerSendStatus["sms"] = "skipped";
  try {
    const r = await sendReminder({
      tenantId: i.tenantId,
      leaseId: i.leaseId,
      reminderType: "manual",
      messageBody: `${app.businessName}: your ${kindLabel} is ready to sign. Sign here: ${link} (expires ${expires}).`,
      actor: i.actor,
    });
    sms = r.status === "sent" ? "sent" : r.status === "failed" ? "failed" : "skipped";
  } catch (e) {
    console.error(`[esign] SMS send failed for signer ${i.signerId}:`, e);
    sms = "failed";
  }

  let email: SignerSendStatus["email"] = "skipped";
  if (i.email && app.emailEnabled) {
    try {
      const r = await (await resolveEmailProvider()).send({
        to: i.email,
        subject: "Your lease is ready to sign",
        text:
          `Hi ${i.name},\n\n` +
          `${app.businessName} has sent you a ${kindLabel} to review and sign electronically.\n\n` +
          `Sign here: ${link}\n\n` +
          `This link expires on ${expires} and is unique to you — please don't forward it.`,
      });
      email = r.status === "sent" ? "sent" : "failed";
    } catch (e) {
      console.error(`[esign] email send failed for signer ${i.signerId}:`, e);
      email = "failed";
    }
  }

  const delivered = sms === "sent" || email === "sent";
  if (delivered) {
    await prisma.signingSigner.update({
      where: { id: i.signerId },
      data: { lastSentAt: new Date() },
    });
  }
  return { signerId: i.signerId, name: i.name, sms, email, delivered };
}

// ---------------------------------------------------------------------------
// Create / resend / cancel (staff side)
// ---------------------------------------------------------------------------

export type CreateSigningRequestResult =
  | { ok: true; requestId: string; sends: SignerSendStatus[] }
  | { ok: false; error: string };

export async function createSigningRequest(i: {
  leaseId: string;
  kind: SigningKind;
  actor: AuditContext;
  expiresInDays?: number;
  now?: Date;
}): Promise<CreateSigningRequestResult> {
  const now = i.now ?? new Date();
  const expiresInDays = i.expiresInDays ?? 14;

  const ctx = await buildAgreementVars(i.leaseId);
  if (!ctx) return { ok: false, error: "Lease not found." };
  const { lease, app, vars } = ctx;

  // The landlord side is the SAVED signature — refuse to send without one so
  // a completed artifact always carries both parties.
  if (!app.landlordSignatureName) {
    return {
      ok: false,
      error:
        "No landlord signature is saved yet — set it up under Settings → Leases first.",
    };
  }

  const existing = await prisma.signingRequest.findFirst({
    where: { leaseId: i.leaseId, status: "sent", expiresAt: { gt: now } },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      error:
        "A signing request is already in progress for this lease — cancel it before sending a new one.",
    };
  }

  // Freeze the agreement exactly as the printable page renders it today.
  // Signature/initial markers survive substitution (passthrough vars) so the
  // signing page and final artifact can stamp marks at every occurrence.
  const documentText = renderTemplate(app.leaseAgreementText ?? DEFAULT_LEASE_AGREEMENT_TEXT, {
    ...markerPassthroughVars(),
    ...vars,
  });
  const documentSha256 = sha256Hex(documentText);

  // One signer per tenant (primary + co-tenants), de-duplicated. Raw tokens
  // live only in this scope; rows persist hashes.
  const seen = new Set<string>();
  const tenants = [lease.tenant, ...lease.coTenants.map((ct) => ct.tenant)].filter(
    (t) => !seen.has(t.id) && seen.add(t.id),
  );
  const minted = tenants.map((t) => ({ tenant: t, ...mintSigningToken() }));
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

  const request = await prisma.$transaction(async (tx) => {
    const req = await tx.signingRequest.create({
      data: {
        leaseId: i.leaseId,
        kind: i.kind,
        status: "sent",
        documentText,
        documentSha256,
        landlordName: app.landlordSignatureName,
        landlordSignatureKey: app.landlordSignatureImageKey,
        landlordInitialsKey: app.landlordInitialsImageKey,
        landlordSignedAt: now,
        expiresAt,
        sentAt: now,
        createdBy: i.actor.actorId ?? null,
        signers: {
          create: minted.map((m) => ({
            tenantId: m.tenant.id,
            name: `${m.tenant.firstName} ${m.tenant.lastName}`.trim(),
            email: m.tenant.email ?? null,
            phone: m.tenant.phone ?? null,
            tokenHash: m.tokenHash,
          })),
        },
      },
      include: { signers: true },
    });
    // Never put tokens or hashes in the audit payload.
    await writeAudit(tx, {
      ...i.actor,
      action: "esign.request_created",
      entityType: "SigningRequest",
      entityId: req.id,
      after: {
        leaseId: i.leaseId,
        kind: i.kind,
        documentSha256,
        signerCount: req.signers.length,
        expiresAt: expiresAt.toISOString(),
        landlordSignatureApplied: true,
      },
    });
    return req;
  });

  // Outside the tx: best-effort delivery per signer/channel.
  const byHash = new Map(minted.map((m) => [m.tokenHash, m]));
  const sends: SignerSendStatus[] = [];
  for (const signer of request.signers) {
    const m = byHash.get(signer.tokenHash);
    if (!m) continue; // unreachable — created from `minted` above
    sends.push(
      await sendSignerLink({
        signerId: signer.id,
        tenantId: signer.tenantId,
        leaseId: i.leaseId,
        name: signer.name,
        email: signer.email,
        token: m.token,
        kind: i.kind,
        expiresAt,
        timezone: lease.unit.property.timezone,
        actor: i.actor,
      }),
    );
  }

  return { ok: true, requestId: request.id, sends };
}

export type ResendResult =
  | { ok: true; send: SignerSendStatus }
  | { ok: false; error: string };

/** Re-mint the signer's token (old link dies), then resend on both channels. */
export async function resendSignerLink(i: {
  signerId: string;
  actor: AuditContext;
  now?: Date;
}): Promise<ResendResult> {
  const now = i.now ?? new Date();
  const signer = await prisma.signingSigner.findUnique({
    where: { id: i.signerId },
    include: { request: true },
  });
  if (!signer) return { ok: false, error: "Signer not found." };
  if (signer.request.status !== "sent") {
    return { ok: false, error: "This signing request is no longer active." };
  }
  if (signer.request.expiresAt <= now) {
    return {
      ok: false,
      error: "This signing request has expired — cancel it and send a new one.",
    };
  }
  if (signer.signedAt) {
    return { ok: false, error: `${signer.name} has already signed.` };
  }

  const { token, tokenHash } = mintSigningToken();
  await prisma.$transaction(async (tx) => {
    await tx.signingSigner.update({
      where: { id: signer.id },
      data: { tokenHash },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "esign.link_resent",
      entityType: "SigningSigner",
      entityId: signer.id,
      after: { requestId: signer.requestId, name: signer.name },
    });
  });

  const lease = await prisma.lease.findUnique({
    where: { id: signer.request.leaseId },
    include: { unit: { include: { property: true } } },
  });

  const send = await sendSignerLink({
    signerId: signer.id,
    tenantId: signer.tenantId,
    leaseId: signer.request.leaseId,
    name: signer.name,
    email: signer.email,
    token,
    kind: signer.request.kind === "renewal" ? "renewal" : "lease",
    expiresAt: signer.request.expiresAt,
    timezone: lease?.unit.property.timezone ?? "America/New_York",
    actor: i.actor,
  });
  return { ok: true, send };
}

export type CancelResult = { ok: true } | { ok: false; error: string };

export async function cancelSigningRequest(i: {
  requestId: string;
  actor: AuditContext;
  now?: Date;
}): Promise<CancelResult> {
  const now = i.now ?? new Date();
  const request = await prisma.signingRequest.findUnique({
    where: { id: i.requestId },
  });
  if (!request) return { ok: false, error: "Signing request not found." };
  if (request.status === "completed") {
    return { ok: false, error: "This request is already completed." };
  }
  if (request.status === "canceled") {
    return { ok: false, error: "This request is already canceled." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.signingRequest.update({
      where: { id: request.id },
      data: { status: "canceled", canceledAt: now },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "esign.request_canceled",
      entityType: "SigningRequest",
      entityId: request.id,
      after: { leaseId: request.leaseId, canceledAt: now.toISOString() },
    });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Completion (artifact generation)
// ---------------------------------------------------------------------------

/** storage object -> embedded data URL (best effort; null when unreadable). */
async function loadPngDataUrl(key: string | null): Promise<string | undefined> {
  if (!key) return undefined;
  try {
    const buf = await getFileStorage().get(key);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch (e) {
    console.error(`[esign] could not load signature image ${key}:`, e);
    return undefined;
  }
}

/**
 * When every signer has signed: mark the request completed, render the final
 * self-contained HTML artifact (escaped agreement text + signature blocks +
 * evidence footer) and attach it to the lease as an UploadedDocument. Artifact
 * generation is best-effort — a storage outage never blocks completion.
 */
export async function completeIfAllSigned(
  requestId: string,
  now: Date,
): Promise<{ completed: boolean }> {
  const request = await prisma.signingRequest.findUnique({
    where: { id: requestId },
    include: { signers: { orderBy: { createdAt: "asc" } } },
  });
  if (!request || request.status !== "sent") return { completed: false };
  if (request.signers.some((s) => !s.signedAt)) return { completed: false };

  const lease = await prisma.lease.findUnique({
    where: { id: request.leaseId },
    include: { tenant: true, unit: { include: { property: true } } },
  });

  let signedDocumentId: string | null = null;
  if (lease) {
    try {
      const app = await getAppSettings();
      const signers: ArtifactSigner[] = [];
      for (const s of request.signers) {
        signers.push({
          name: s.name,
          signedAtISO: s.signedAt!.toISOString(),
          kind: s.signatureKind === "drawn" ? "drawn" : "typed",
          signatureText: s.signatureText ?? undefined,
          signatureImageDataUrl:
            s.signatureKind === "drawn"
              ? await loadPngDataUrl(s.signatureImageKey)
              : undefined,
          initialsKind: s.initialsKind === "drawn" ? "drawn" : s.initialsKind === "typed" ? "typed" : undefined,
          initialsText: s.initialsText ?? undefined,
          initialsImageDataUrl:
            s.initialsKind === "drawn"
              ? await loadPngDataUrl(s.initialsImageKey)
              : undefined,
          ip: s.signerIp ?? undefined,
        });
      }
      const html = renderSignedArtifactHtml({
        documentText: request.documentText,
        documentSha256: request.documentSha256,
        businessName: app.businessName,
        leaseLabel: `${lease.unit.property.name} — Unit ${lease.unit.unitNumber} — ${lease.tenant.firstName} ${lease.tenant.lastName}`.trim(),
        landlord: {
          name: request.landlordName ?? app.businessName,
          signedAtISO: (request.landlordSignedAt ?? request.sentAt).toISOString(),
          signatureImageDataUrl: await loadPngDataUrl(request.landlordSignatureKey),
          initialsImageDataUrl: await loadPngDataUrl(request.landlordInitialsKey),
        },
        signers,
        completedAtISO: now.toISOString(),
      });
      const fileName = `lease-signed-${slugPart(lease.unit.unitNumber, "unit")}-${slugPart(
        lease.tenant.lastName,
        "tenant",
      )}.html`;
      ({ documentId: signedDocumentId } = await createUploadedDocument({
        body: Buffer.from(html, "utf8"),
        fileName,
        contentType: "text/html",
        uploadType: "lease",
        leaseId: lease.id,
        tenantId: lease.tenantId,
        notes: "E-signed agreement",
        actor: { actorType: "system" },
      }));
    } catch (e) {
      console.error(
        `[esign] signed-artifact generation failed for request ${requestId}:`,
        e,
      );
      signedDocumentId = null;
    }
  }

  return prisma.$transaction(async (tx) => {
    // Guard on status "sent" so two concurrent final signers can't both
    // complete (the loser's just-uploaded artifact, if any, stays unlinked).
    const res = await tx.signingRequest.updateMany({
      where: { id: request.id, status: "sent" },
      data: { status: "completed", completedAt: now, signedDocumentId },
    });
    if (res.count === 0) return { completed: false };
    await writeAudit(tx, {
      actorType: "system",
      action: "esign.completed",
      entityType: "SigningRequest",
      entityId: request.id,
      after: {
        leaseId: request.leaseId,
        signedDocumentId,
        signerCount: request.signers.length,
      },
    });
    return { completed: true };
  });
}

// ---------------------------------------------------------------------------
// Tenant-side signing (token-authenticated; no session)
// ---------------------------------------------------------------------------

export type SignErrorCode =
  | "invalid"
  | "expired"
  | "canceled"
  | "already_signed"
  | "consent_required"
  | "invalid_signature"
  | "storage_unavailable";

export type RecordSignatureResult =
  | { ok: true; completed: boolean }
  | { ok: false; code: SignErrorCode };

const MAX_TYPED_LENGTH = 120;
const MAX_INITIALS_LENGTH = 8;
const MAX_DRAWN_BYTES = 150 * 1024;
// Base64 inflates ~4/3, plus the data: prefix — anything bigger can't decode
// to <= 150KB, so reject before allocating.
const MAX_DRAWN_DATAURL_LENGTH = Math.ceil((MAX_DRAWN_BYTES * 4) / 3) + 64;

/** Decode + validate a drawn-mark PNG data URL; null = invalid. */
function decodeDrawnPng(dataUrl: string): Buffer | null {
  if (dataUrl.length > MAX_DRAWN_DATAURL_LENGTH) return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) return null;
  const body = Buffer.from(match[1], "base64");
  if (body.byteLength === 0 || body.byteLength > MAX_DRAWN_BYTES) return null;
  if (!looksLikePng(body)) return null;
  return body;
}

/**
 * Record one signer's signature, authenticated ONLY by the link token. Every
 * guard returns a typed code (never throws) so the public page can render the
 * terminal state. The audit row carries no signature contents. When the frozen
 * document contains {{tenant_initials}} markers, initials are required too.
 */
export async function recordSignature(i: {
  token: string;
  kind: "typed" | "drawn";
  signatureText?: string;
  signatureImagePngDataUrl?: string;
  initialsKind?: "typed" | "drawn";
  initialsText?: string;
  initialsImagePngDataUrl?: string;
  consent: boolean;
  ip: string | null;
  userAgent: string | null;
  now?: Date;
}): Promise<RecordSignatureResult> {
  const now = i.now ?? new Date();
  if (!isTokenFormatValid(i.token)) return { ok: false, code: "invalid" };

  const signer = await prisma.signingSigner.findUnique({
    where: { tokenHash: hashSigningToken(i.token) },
    include: { request: true },
  });
  if (!signer) return { ok: false, code: "invalid" };

  const { request } = signer;
  if (request.status === "canceled") return { ok: false, code: "canceled" };
  if (signer.signedAt || request.status === "completed") {
    return { ok: false, code: "already_signed" };
  }
  if (request.expiresAt <= now) return { ok: false, code: "expired" };
  if (!i.consent) return { ok: false, code: "consent_required" };

  // The lease must still exist (it may have been deleted since the send).
  const lease = await prisma.lease.findUnique({
    where: { id: request.leaseId },
    select: { id: true },
  });
  if (!lease) return { ok: false, code: "invalid" };

  let signatureText: string | null = null;
  let signatureImageKey: string | null = null;
  let signatureBody: Buffer | null = null;
  if (i.kind === "typed") {
    const text = i.signatureText?.trim() ?? "";
    if (text.length === 0 || text.length > MAX_TYPED_LENGTH) {
      return { ok: false, code: "invalid_signature" };
    }
    signatureText = text;
  } else {
    signatureBody = decodeDrawnPng(i.signatureImagePngDataUrl ?? "");
    if (!signatureBody) return { ok: false, code: "invalid_signature" };
    signatureImageKey = `signatures/${signer.id}.png`;
  }

  // Initials, required only when the frozen document has initials markers.
  // Validate BEFORE storing anything so a bad mark can't half-commit.
  const needsInitials = documentNeedsInitials(request.documentText);
  let initialsKind: "typed" | "drawn" | null = null;
  let initialsText: string | null = null;
  let initialsImageKey: string | null = null;
  let initialsBody: Buffer | null = null;
  if (needsInitials) {
    if (i.initialsKind === "drawn") {
      initialsBody = decodeDrawnPng(i.initialsImagePngDataUrl ?? "");
      if (!initialsBody) return { ok: false, code: "invalid_signature" };
      initialsKind = "drawn";
      initialsImageKey = `signatures/${signer.id}-initials.png`;
    } else {
      const text = i.initialsText?.trim() ?? "";
      if (text.length === 0 || text.length > MAX_INITIALS_LENGTH) {
        return { ok: false, code: "invalid_signature" };
      }
      initialsKind = "typed";
      initialsText = text;
    }
  }

  try {
    if (signatureImageKey && signatureBody) {
      await getFileStorage().put({
        key: signatureImageKey,
        body: signatureBody,
        contentType: "image/png",
      });
    }
    if (initialsImageKey && initialsBody) {
      await getFileStorage().put({
        key: initialsImageKey,
        body: initialsBody,
        contentType: "image/png",
      });
    }
  } catch (e) {
    console.error(`[esign] drawn-mark store failed for ${signer.id}:`, e);
    return { ok: false, code: "storage_unavailable" };
  }

  const won = await prisma.$transaction(async (tx) => {
    // Guard on signedAt IS NULL so a double-submit can't overwrite or
    // double-audit the signature.
    const res = await tx.signingSigner.updateMany({
      where: { id: signer.id, signedAt: null },
      data: {
        signedAt: now,
        signatureKind: i.kind,
        signatureText,
        signatureImageKey,
        initialsKind,
        initialsText,
        initialsImageKey,
        consentAt: now,
        signerIp: i.ip,
        signerUserAgent: i.userAgent,
      },
    });
    if (res.count === 0) return false;
    // No signature contents in the audit — just who signed which request.
    await writeAudit(tx, {
      actorType: "system",
      action: "esign.signed",
      entityType: "SigningSigner",
      entityId: signer.id,
      ip: i.ip,
      userAgent: i.userAgent,
      after: { requestId: request.id, name: signer.name, kind: i.kind },
    });
    return true;
  });
  if (!won) return { ok: false, code: "already_signed" };

  let completed = false;
  try {
    ({ completed } = await completeIfAllSigned(request.id, now));
  } catch (e) {
    // The signature is recorded — completion can be retried by the next signer
    // page load; never surface this to the tenant as a failure.
    console.error(`[esign] completion check failed for ${request.id}:`, e);
  }
  return { ok: true, completed };
}

// ---------------------------------------------------------------------------
// Read models (public page + staff panel)
// ---------------------------------------------------------------------------

export type SigningPageState =
  | "open"
  | "expired"
  | "canceled"
  | "completed"
  | "already_signed";

export type SigningPageData =
  | { state: "invalid" }
  | {
      state: SigningPageState;
      businessName: string;
      kind: SigningKind;
      documentText: string;
      /** The frozen document has {{tenant_initials}} markers → capture initials too. */
      needsInitials: boolean;
      landlordName: string | null;
      landlordSignedAtISO: string | null;
      expiresAtISO: string;
      signer: { id: string; name: string; signedAtISO: string | null };
      /** The OTHER signers — names + signed/pending only, nothing else. */
      others: { name: string; signed: boolean }[];
    };

/**
 * Everything the public /sign/[token] page may show. Invalid/unknown tokens
 * collapse to { state: "invalid" } — never reveal lease or tenant data on a
 * bad token. All values are serializable (ISO strings, no Dates/bigints).
 */
export async function getSigningPageData(
  token: string,
  now: Date = new Date(),
): Promise<SigningPageData> {
  if (!isTokenFormatValid(token)) return { state: "invalid" };

  const signer = await prisma.signingSigner.findUnique({
    where: { tokenHash: hashSigningToken(token) },
    include: {
      request: { include: { signers: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!signer) return { state: "invalid" };

  const { request } = signer;
  const state: SigningPageState =
    request.status === "canceled"
      ? "canceled"
      : request.status === "completed"
        ? "completed"
        : signer.signedAt
          ? "already_signed"
          : request.expiresAt <= now
            ? "expired"
            : "open";

  const { businessName } = await getAppSettings();
  return {
    state,
    businessName,
    kind: request.kind === "renewal" ? "renewal" : "lease",
    documentText: request.documentText,
    needsInitials: documentNeedsInitials(request.documentText),
    landlordName: request.landlordName,
    landlordSignedAtISO: request.landlordSignedAt?.toISOString() ?? null,
    expiresAtISO: request.expiresAt.toISOString(),
    signer: {
      id: signer.id,
      name: signer.name,
      signedAtISO: signer.signedAt?.toISOString() ?? null,
    },
    others: request.signers
      .filter((s) => s.id !== signer.id)
      .map((s) => ({ name: s.name, signed: !!s.signedAt })),
  };
}

export interface LeaseSigningOverview {
  /** Sent and not yet expired — the request the panel manages. */
  active: {
    id: string;
    kind: string;
    sentAt: Date;
    expiresAt: Date;
    signers: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      signedAt: Date | null;
      lastSentAt: Date | null;
    }[];
  } | null;
  /** Latest completed request (signed artifact link). */
  completed: {
    id: string;
    kind: string;
    completedAt: Date | null;
    signedDocumentId: string | null;
  } | null;
  /** Latest sent-but-expired request (informational; cancellable). */
  expired: { id: string; expiresAt: Date } | null;
}

/** Staff-panel read model for one lease (server-page consumption only). */
export async function getLeaseSigningOverview(
  leaseId: string,
  now: Date = new Date(),
): Promise<LeaseSigningOverview> {
  const [active, completed] = await Promise.all([
    prisma.signingRequest.findFirst({
      where: { leaseId, status: "sent", expiresAt: { gt: now } },
      orderBy: { sentAt: "desc" },
      include: { signers: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.signingRequest.findFirst({
      where: { leaseId, status: "completed" },
      orderBy: { completedAt: "desc" },
    }),
  ]);
  const expired = active
    ? null
    : await prisma.signingRequest.findFirst({
        where: { leaseId, status: "sent", expiresAt: { lte: now } },
        orderBy: { sentAt: "desc" },
        select: { id: true, expiresAt: true },
      });

  return {
    active: active
      ? {
          id: active.id,
          kind: active.kind,
          sentAt: active.sentAt,
          expiresAt: active.expiresAt,
          signers: active.signers.map((s) => ({
            id: s.id,
            name: s.name,
            email: s.email,
            phone: s.phone,
            signedAt: s.signedAt,
            lastSentAt: s.lastSentAt,
          })),
        }
      : null,
    completed: completed
      ? {
          id: completed.id,
          kind: completed.kind,
          completedAt: completed.completedAt,
          signedDocumentId: completed.signedDocumentId,
        }
      : null,
    expired,
  };
}
