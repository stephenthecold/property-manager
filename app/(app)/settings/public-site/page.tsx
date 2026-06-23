import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicSiteForm } from "./public-site-form";

export const runtime = "nodejs";

export default async function PublicSiteSettingsPage() {
  await requireCapability("organization.settings");
  const s = await getAppSettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Public site</CardTitle>
      </CardHeader>
      <CardContent>
        <PublicSiteForm
          initial={{
            publicSiteUrl: s.publicSiteUrl ?? "",
            publicSiteTagline: s.publicSiteTagline ?? "",
            publicSiteIntro: s.publicSiteIntro ?? "",
            publicSiteAreas: s.publicSiteAreas ?? "",
            publicSiteHours: s.publicSiteHours ?? "",
            publicSiteAmenities: s.publicSiteAmenities ?? "",
            showAvailability: s.publicSiteShowAvailability,
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
