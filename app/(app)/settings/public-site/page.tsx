import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { publicSiteReadiness } from "@/lib/services/public-site-readiness";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicSiteForm } from "./public-site-form";
import { PublicSiteReadiness } from "./readiness-panel";

export const runtime = "nodejs";

export default async function PublicSiteSettingsPage() {
  await requireCapability("organization.settings");
  const s = await getAppSettings();
  const readiness = publicSiteReadiness({
    moduleEnabled: s.modules.publicSite,
    businessName: s.businessName,
    businessPhone: s.businessPhone,
    businessEmail: s.businessEmail,
    businessAddress: s.businessAddress,
    publicSiteIntro: s.publicSiteIntro,
    publicSiteUrl: s.publicSiteUrl,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Public site</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <PublicSiteReadiness report={readiness} />
        <PublicSiteForm
          initial={{
            publicSiteUrl: s.publicSiteUrl ?? "",
            publicSiteTagline: s.publicSiteTagline ?? "",
            publicSiteIntro: s.publicSiteIntro ?? "",
            publicSiteAreas: s.publicSiteAreas ?? "",
            publicSiteHours: s.publicSiteHours ?? "",
            publicSiteAmenities: s.publicSiteAmenities ?? "",
            showAvailability: s.publicSiteShowAvailability,
            showVacancies: s.showVacancies,
            heroDocumentId: s.publicSiteHeroDocumentId,
            gallery: s.publicSiteGallery.map((g) => g.id),
            enabled: s.modules.publicSite,
            businessName: s.businessName,
          }}
        />
      </CardContent>
    </Card>
  );
}
