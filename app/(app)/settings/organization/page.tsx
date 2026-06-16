import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import { getStorageStatus } from "@/lib/services/storage-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrganizationForm } from "./organization-form";

export const runtime = "nodejs";

const HEALTH_BADGE = {
  ok: "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  warn: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  error: "border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
} as const;

export default async function OrganizationSettingsPage() {
  await requireCapability("organization.settings");
  const env = getEnv();
  const [row, storage] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: "singleton" } }),
    getStorageStatus(),
  ]);

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
      <Card>
        <CardContent>
          <OrganizationForm
            initial={{
              businessName: row?.businessName ?? "",
              businessLegalName: row?.businessLegalName ?? "",
              businessAddress: row?.businessAddress ?? "",
              businessPhone: row?.businessPhone ?? "",
              businessEmail: row?.businessEmail ?? "",
              receiptFooter: row?.receiptFooter ?? "",
              receiptPrefix: row?.receiptPrefix ?? "",
              portalWelcomeText: row?.portalWelcomeText ?? "",
              applyIntroText: row?.applyIntroText ?? "",
              defaultTimezone: row?.defaultTimezone ?? env.DEFAULT_TIMEZONE,
              defaultCurrency: row?.defaultCurrency ?? env.DEFAULT_CURRENCY,
              logoUrl,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">File storage</CardTitle>
          <Badge variant="outline" className={`font-medium ${HEALTH_BADGE[storage.health.level]}`}>
            {storage.ready ? "Ready" : storage.provider === "stub" ? "Disabled" : "Needs attention"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{storage.health.message}</p>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {storage.fields.map((f) => (
              <div key={f.label} className="flex justify-between gap-4 border-b py-1.5 text-sm">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="text-right font-medium break-all">{f.value}</dd>
              </div>
            ))}
            {storage.secrets.map((s) => (
              <div key={s.label} className="flex justify-between gap-4 border-b py-1.5 text-sm">
                <dt className="text-muted-foreground">{s.label}</dt>
                <dd>
                  {s.set ? (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-100 font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      Set
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-red-200 bg-red-100 font-medium text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
                      Not set
                    </Badge>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <p className="text-xs text-muted-foreground">
            Storage is configured with environment variables (<code>STORAGE_PROVIDER</code> and the{" "}
            <code>S3_*</code> / <code>LOCAL_STORAGE_DIR</code> settings — see{" "}
            <code>.env.example</code>). To use a <strong>network share</strong>, mount it on the host
            (NFS/SMB) and point <code>LOCAL_STORAGE_DIR</code> at the mount; set{" "}
            <code>STORAGE_ENCRYPT=true</code> so files on the share are encrypted at rest (see{" "}
            <code>docs/DEPLOYMENT.md</code>). Secret keys are read from the environment and never
            shown or stored here. Change them on the host and restart the app to apply.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
