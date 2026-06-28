import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { publicBaseUrl } from "@/lib/http/base-url";
import { BackLink } from "@/components/app/back-link";
import { PrintButton } from "@/components/app/print-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Printable opt-in invitation letter for a tenant (non-SMS invite channel).
 * Staff print + mail it; it directs the tenant to the public /sms-opt-in page.
 */
export default async function OptInLetterPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  await requireCapability("tenants.manage");
  const { tenantId } = await searchParams;
  if (!tenantId) notFound();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) notFound();

  const settings = await getAppSettings();
  const base = await publicBaseUrl();
  const link = `${base.replace(/\/+$/, "")}/sms-opt-in`;
  const biz = settings.businessName;
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8 text-sm leading-6 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <BackLink href="/sms-consents" label="Back" />
        <PrintButton />
      </div>

      <div className="space-y-1">
        <div className="text-lg font-semibold">{biz}</div>
        <div className="text-muted-foreground">{today}</div>
      </div>

      <div>
        <div>{tenant.firstName} {tenant.lastName}</div>
        {tenant.mailingAddress && (
          <div className="whitespace-pre-wrap text-muted-foreground">
            {tenant.mailingAddress}
          </div>
        )}
      </div>

      <p>Dear {tenant.firstName},</p>

      <p>
        {biz} offers optional text-message notifications for your tenancy —
        including rent reminders, overdue balance notices, tenant portal login
        links, maintenance scheduling, and maintenance updates. Staying up to
        date by text is convenient, but it is entirely optional and is{" "}
        <strong>not required</strong> to rent.
      </p>

      <p>
        To opt in, visit the secure page below from your phone or computer and
        check the SMS consent box:
      </p>

      <p className="rounded-md border p-3 text-center font-mono text-base">
        {link}
      </p>

      <p>
        Message frequency varies. Message and data rates may apply. You can opt
        out at any time by replying <strong>STOP</strong> to any message, or
        through your tenant portal. We never share your mobile number or SMS data
        with third parties for marketing.
      </p>

      <p>
        Sincerely,
        <br />
        {biz}
      </p>
    </div>
  );
}
