import { prisma } from "@/lib/db";
import { withAudit, writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  assertModuleEnabled,
  getAppSettings,
  resolveEmailProvider,
  resolveSmsProvider,
} from "@/lib/services/app-settings";
import { getEnv } from "@/lib/config/env";
import type { RentalApplicationStatus } from "@/lib/generated/prisma/enums";

/**
 * Rental applications (module "applications"). Prospective-tenant intake from
 * the PUBLIC /apply form, plus staff review/convert. Operating records only —
 * never ledger entries, never linked to balances.
 */

function appBaseUrl(): string {
  return getEnv().APP_URL.replace(/\/+$/, "");
}

/** Public apply URL, optionally pinned to a specific unit (staff-shared link). */
export function applyUrl(unitId?: string | null): string {
  const base = `${appBaseUrl()}/apply`;
  return unitId ? `${base}?unit=${encodeURIComponent(unitId)}` : base;
}

export interface SubmitApplicationInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  currentAddress: string | null;
  desiredMoveInDate: Date | null;
  monthlyIncomeCents: bigint | null;
  employer: string | null;
  message: string | null;
  /** From a staff-shared apply link (?unit=…); validated before use. */
  unitId: string | null;
}

/** Public submission. Resolves the unit/property from a shared link if valid. */
export async function submitApplication(
  input: SubmitApplicationInput,
): Promise<{ id: string }> {
  await assertModuleEnabled("applications");

  let unitId: string | null = null;
  let propertyId: string | null = null;
  if (input.unitId) {
    const unit = await prisma.unit.findUnique({
      where: { id: input.unitId },
      select: { id: true, propertyId: true },
    });
    if (unit) {
      unitId = unit.id;
      propertyId = unit.propertyId;
    }
  }

  const created = await withAudit(
    {
      actorType: "system",
      actorEmail: "applicant (public /apply)",
      action: "application.submitted",
      entityType: "RentalApplication",
    },
    async (tx) => {
      const app = await tx.rentalApplication.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          currentAddress: input.currentAddress,
          desiredMoveInDate: input.desiredMoveInDate,
          monthlyIncomeCents: input.monthlyIncomeCents,
          employer: input.employer,
          message: input.message,
          unitId,
          propertyId,
        },
      });
      return {
        result: app,
        entityId: app.id,
        after: {
          firstName: app.firstName,
          lastName: app.lastName,
          unitId,
          propertyId,
        },
      };
    },
  );
  return { id: created.id };
}

export async function listApplications() {
  return prisma.rentalApplication.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      property: { select: { name: true } },
      unit: { select: { unitNumber: true } },
    },
  });
}

export async function getApplication(id: string) {
  return prisma.rentalApplication.findUnique({
    where: { id },
    include: {
      property: { select: { id: true, name: true } },
      unit: { select: { id: true, unitNumber: true } },
    },
  });
}

/** Change status (+ optional reviewer notes). Audited. */
export async function setApplicationStatus(
  id: string,
  status: RentalApplicationStatus,
  reviewerNotes: string | null,
  actor: AuditContext,
): Promise<void> {
  await assertModuleEnabled("applications");
  const before = await prisma.rentalApplication.findUnique({ where: { id } });
  if (!before) throw new Error("Application not found.");

  await withAudit(
    {
      ...actor,
      action: "application.status_changed",
      entityType: "RentalApplication",
      entityId: id,
      before: { status: before.status, reviewerNotes: before.reviewerNotes },
    },
    async (tx) => {
      const updated = await tx.rentalApplication.update({
        where: { id },
        data: {
          status,
          reviewerNotes,
          handledBy: actor.actorId ?? null,
          handledAt: new Date(),
        },
      });
      return {
        result: updated,
        after: { status: updated.status, reviewerNotes: updated.reviewerNotes },
      };
    },
  );
}

/** Create a Tenant from an application and mark it approved+converted. Audited. */
export async function convertApplicationToTenant(
  id: string,
  actor: AuditContext,
): Promise<{ tenantId: string }> {
  await assertModuleEnabled("applications");
  const app = await prisma.rentalApplication.findUnique({ where: { id } });
  if (!app) throw new Error("Application not found.");
  if (app.convertedTenantId) {
    throw new Error("This application has already been converted to a tenant.");
  }

  return withAudit(
    {
      ...actor,
      action: "application.converted",
      entityType: "RentalApplication",
      entityId: id,
      before: { status: app.status },
    },
    async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phone: app.phone,
          mailingAddress: app.currentAddress,
        },
      });
      await writeAudit(tx, {
        ...actor,
        action: "tenant.created",
        entityType: "Tenant",
        entityId: tenant.id,
        after: { firstName: tenant.firstName, lastName: tenant.lastName, fromApplication: id },
      });
      await tx.rentalApplication.update({
        where: { id },
        data: {
          status: "approved",
          convertedTenantId: tenant.id,
          handledBy: actor.actorId ?? null,
          handledAt: new Date(),
        },
      });
      return {
        result: { tenantId: tenant.id },
        after: { status: "approved", convertedTenantId: tenant.id },
      };
    },
  );
}

export interface SendApplyLinkResult {
  emailed: boolean;
  texted: boolean;
  errors: string[];
}

/** Email and/or text the public apply link to a prospect. Audited. */
export async function sendApplyLink(
  input: { email: string | null; phone: string | null; unitId: string | null },
  actor: AuditContext,
): Promise<SendApplyLinkResult> {
  await assertModuleEnabled("applications");
  const settings = await getAppSettings();
  const url = applyUrl(input.unitId);
  const result: SendApplyLinkResult = { emailed: false, texted: false, errors: [] };

  if (input.email) {
    try {
      const provider = await resolveEmailProvider();
      const r = await provider.send({
        to: input.email,
        subject: `Apply to rent with ${settings.businessName}`,
        text: `You've been invited to apply for a rental with ${settings.businessName}.\n\nStart your application here:\n${url}`,
      });
      if (r.status === "failed") result.errors.push(`Email: ${r.error ?? "failed"}`);
      else result.emailed = true;
    } catch (e) {
      result.errors.push(`Email: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  if (input.phone) {
    try {
      const provider = await resolveSmsProvider();
      const r = await provider.send({
        to: input.phone,
        body: `${settings.businessName}: apply to rent here: ${url}`,
      });
      if (r.status === "failed") result.errors.push(`SMS: ${r.error ?? "failed"}`);
      else result.texted = true;
    } catch (e) {
      result.errors.push(`SMS: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  await writeAudit(prisma, {
    ...actor,
    action: "application.link_sent",
    entityType: "RentalApplication",
    after: {
      emailed: result.emailed,
      texted: result.texted,
      unitId: input.unitId,
      // mask recipients
      emailMasked: input.email ? `${input.email[0]}***@${input.email.split("@")[1] ?? ""}` : null,
      phoneLast4: input.phone ? input.phone.slice(-4) : null,
    },
  });

  return result;
}
