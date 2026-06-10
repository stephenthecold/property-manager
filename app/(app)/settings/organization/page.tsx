import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import { OrganizationForm } from "./organization-form";

export const runtime = "nodejs";

export default async function OrganizationSettingsPage() {
  await requireRole("owner");
  const env = getEnv();
  const row = await prisma.appSettings.findUnique({ where: { id: "singleton" } });

  let logoUrl: string | null = null;
  if (row?.logoDocumentId) {
    try {
      logoUrl = (await getDocumentDownloadUrl(row.logoDocumentId))?.url ?? null;
    } catch {
      logoUrl = null; // storage not configured — form still works
    }
  }

  return (
    <div className="w-full max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Organization</h2>
        <p className="text-sm text-muted-foreground">
          White-label the app and printable documents with your business identity.
        </p>
      </div>
      <OrganizationForm
        initial={{
          businessName: row?.businessName ?? "",
          businessLegalName: row?.businessLegalName ?? "",
          businessAddress: row?.businessAddress ?? "",
          businessPhone: row?.businessPhone ?? "",
          businessEmail: row?.businessEmail ?? "",
          receiptFooter: row?.receiptFooter ?? "",
          defaultTimezone: row?.defaultTimezone ?? env.DEFAULT_TIMEZONE,
          defaultCurrency: row?.defaultCurrency ?? env.DEFAULT_CURRENCY,
          logoUrl,
        }}
      />
    </div>
  );
}
