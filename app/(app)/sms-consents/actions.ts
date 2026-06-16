"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/audit";
import {
  getAppSettings,
  resolveEmailProvider,
} from "@/lib/services/app-settings";
import { publicBaseUrl } from "@/lib/http/base-url";
import type { FormState } from "@/lib/forms";

/**
 * Invite a current tenant to opt in to SMS by EMAIL ONLY (never SMS — inviting
 * a non-consenting tenant by text would itself be a violation). The email links
 * to the public /sms-opt-in page. Audited.
 */
export async function sendOptInInviteEmailAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("tenants.manage");
  const tenantId = String(fd.get("tenantId") ?? "");
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { error: "Tenant not found." };
  if (!tenant.email) return { error: "This tenant has no email address on file." };

  const settings = await getAppSettings();
  if (!settings.emailEnabled) {
    return { error: "Email is disabled in Settings → Messaging — enable it to send invites." };
  }

  const base = await publicBaseUrl();
  const link = `${base.replace(/\/+$/, "")}/sms-opt-in`;
  const biz = settings.businessName;
  const body =
    `Hi ${tenant.firstName},\n\n` +
    `${biz} can text you tenancy reminders and account notices (rent reminders, ` +
    `overdue balance notices, portal login links, and maintenance updates) if you opt in. ` +
    `It's optional and not required to rent.\n\n` +
    `To opt in, visit:\n${link}\n\n` +
    `You can opt out at any time by replying STOP to any message.\n\n` +
    `— ${biz}`;

  try {
    const result = await (await resolveEmailProvider()).send({
      to: tenant.email,
      subject: `Opt in to text notifications from ${biz}`,
      text: body,
    });
    if (result.status === "failed") {
      return { error: `Email failed: ${result.error ?? "unknown error"}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to send invite." };
  }

  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "tenant.sms_optin_invited",
    entityType: "Tenant",
    entityId: tenant.id,
    after: { method: "email" },
  });
  revalidatePath("/sms-consents");
  return { ok: true };
}
