"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/audit";
import { prisma } from "@/lib/db";
import { markInboundRead } from "@/lib/services/inbound-messages";

/**
 * Mark one inbound message read from the staff inbox. Capability-gated
 * (tenants.manage — inbound SMS is tenant PII, same gate as the SMS consent
 * page) and audited.
 */
export async function markInboundReadAction(fd: FormData): Promise<void> {
  await requireCapability("tenants.manage");
  const id = String(fd.get("id") ?? "");
  if (!id) return;
  await markInboundRead(id);
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "inbound_message.marked_read",
    entityType: "InboundMessage",
    entityId: id,
  });
  revalidatePath("/messages");
}
