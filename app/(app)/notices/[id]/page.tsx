import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { getNoticeForPrint } from "@/lib/services/notices";
import { noticeTypeLabel } from "@/lib/notices/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NoticePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability("notices.manage");
  const settings = await getAppSettings();
  if (!settings.modules.notices) redirect("/dashboard");

  const { id } = await params;
  const notice = await getNoticeForPrint(id);
  if (!notice) notFound();

  const tz = notice.lease.unit.property.timezone;
  const fmt = (d: Date) =>
    DateTime.fromJSDate(d, { zone: tz }).toLocaleString(DateTime.DATE_FULL);
  const property = notice.lease.unit.property;

  return (
    <div className="mx-auto max-w-2xl space-y-6 bg-white p-8 text-black print:p-0 dark:bg-white">
      <div className="print-hidden">
        <Link href="/notices" className="text-sm text-blue-700 underline">
          ← Back to notices
        </Link>
      </div>

      <header className="border-b pb-4">
        <div className="text-lg font-semibold">{settings.businessName}</div>
        {settings.businessAddress && (
          <div className="text-sm whitespace-pre-line text-gray-600">
            {settings.businessAddress}
          </div>
        )}
      </header>

      <div className="text-sm text-gray-600">
        <div>
          Property: {property.name}
          {property.addressLine1 ? ` — ${property.addressLine1}` : ""}
          {property.addressLine2 ? `, ${property.addressLine2}` : ""}
        </div>
        <div>Unit: {notice.lease.unit.unitNumber}</div>
        <div>
          To: {notice.lease.tenant.firstName} {notice.lease.tenant.lastName}
        </div>
        <div>
          Type: {noticeTypeLabel(notice.type)}
          {notice.status === "void" ? " — VOID" : ""}
        </div>
      </div>

      <h1 className="text-center text-xl font-bold uppercase">{notice.subject}</h1>

      <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
        {notice.body}
      </div>

      <footer className="border-t pt-4 text-xs text-gray-500">
        {notice.servedAt ? (
          <div>
            Served {fmt(notice.servedAt)}
            {notice.servedMethod ? ` by ${notice.servedMethod}` : ""}.
          </div>
        ) : (
          <div>Draft — not yet served.</div>
        )}
        <div className="mt-2 print-hidden text-gray-500">
          Use your browser&apos;s Print (Ctrl/Cmd-P) to print or save as PDF.
        </div>
      </footer>
    </div>
  );
}
