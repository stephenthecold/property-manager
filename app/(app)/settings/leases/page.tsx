import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { listDocuments } from "@/lib/services/documents";
import { getFileStorage } from "@/lib/providers/storage";
import {
  DEFAULT_LEASE_AGREEMENT_TEXT,
  LEASE_AGREEMENT_PLACEHOLDERS,
} from "@/lib/config/lease-agreement";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LandlordSignatureForm,
  LeaseAgreementTextForm,
  LeaseTemplateUploadForm,
} from "./lease-settings-forms";

export const runtime = "nodejs";

export default async function LeaseSettingsPage() {
  await requireCapability("organization.settings");

  const [app, templates] = await Promise.all([
    getAppSettings(),
    listDocuments({ uploadType: "lease_template" }),
  ]);
  const currentTemplate = templates[0] ?? null;

  let signatureUrl: string | null = null;
  let initialsUrl: string | null = null;
  try {
    if (app.landlordSignatureImageKey) {
      signatureUrl = await (await getFileStorage()).getSignedUrl(
        app.landlordSignatureImageKey,
      );
    }
    if (app.landlordInitialsImageKey) {
      initialsUrl = await (await getFileStorage()).getSignedUrl(
        app.landlordInitialsImageKey,
      );
    }
  } catch {
    // storage unavailable — the card still renders without previews
    signatureUrl = null;
    initialsUrl = null;
  }

  return (
    <div className="w-full max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Leases</h2>
        <p className="text-sm text-muted-foreground">
          Customize the built-in printable lease agreement and optionally upload
          a fill-your-own Word template. Open any lease&apos;s agreement at
          Leases → agreement to print or generate a .docx.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Printable agreement text</CardTitle>
        </CardHeader>
        <CardContent>
          <LeaseAgreementTextForm
            initialText={app.leaseAgreementText ?? DEFAULT_LEASE_AGREEMENT_TEXT}
            defaultText={DEFAULT_LEASE_AGREEMENT_TEXT}
            hasOverride={app.leaseAgreementText !== null}
            placeholders={LEASE_AGREEMENT_PLACEHOLDERS}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">.docx template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentTemplate ? (
            <p className="text-sm">
              Current template:{" "}
              <span className="font-medium">
                {currentTemplate.fileName ?? "Untitled .docx"}
              </span>{" "}
              <span className="text-muted-foreground">
                (uploaded {currentTemplate.createdAt.toLocaleDateString()})
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No template uploaded yet. The most recent upload becomes the
              active template.
            </p>
          )}
          <LeaseTemplateUploadForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Landlord signature</CardTitle>
        </CardHeader>
        <CardContent>
          <LandlordSignatureForm
            currentName={app.landlordSignatureName}
            signatureUrl={signatureUrl}
            initialsUrl={initialsUrl}
          />
        </CardContent>
      </Card>
    </div>
  );
}
