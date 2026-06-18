import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/services/app-settings";
import { BrandColorStyle } from "@/components/app/brand-color-style";
import { brandedPageMetadata } from "@/lib/config/metadata";
import { Card, CardContent } from "@/components/ui/card";
import { ApplyForm } from "./apply-form";
import type { Metadata } from "next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return brandedPageMetadata(
    (await getAppSettings()).businessName,
    "Rental application",
  );
}

/**
 * Public rental-application form — NO session ("/apply" is a PUBLIC_PREFIX).
 * Module-gated: when the applications module is off, show a neutral notice
 * instead of the form (the submit action re-checks at the service layer). A
 * staff-shared ?unit=<id> link pins the application to that unit.
 */
export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const settings = await getAppSettings();

  if (!settings.modules.applications) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center px-4">
        <Card className="w-full">
          <CardContent className="py-10 text-center">
            <div className="text-lg font-semibold">
              {settings.businessName} is not accepting online applications right now.
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Please contact the property manager directly.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const unitParam = typeof sp.unit === "string" ? sp.unit : null;
  let unitId: string | null = null;
  let unitLabel: string | null = null;
  if (unitParam) {
    const unit = await prisma.unit.findUnique({
      where: { id: unitParam },
      select: { id: true, unitNumber: true, property: { select: { name: true } } },
    });
    if (unit) {
      unitId = unit.id;
      unitLabel = `${unit.property.name} · Unit ${unit.unitNumber}`;
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <BrandColorStyle color={settings.brandColor} />
      <div className="space-y-1 text-center">
        <div className="text-lg font-semibold">{settings.businessName}</div>
        <h1 className="text-2xl font-semibold tracking-wide">Rental application</h1>
        {unitLabel && (
          <p className="text-sm text-muted-foreground">Applying for {unitLabel}</p>
        )}
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {settings.applyIntroText ||
            "Tell us about yourself and we will be in touch."}
        </p>
      </div>
      <Card>
        <CardContent className="py-6">
          <ApplyForm
            unitId={unitId}
            businessName={settings.businessName}
            config={settings.applicationFields}
            customSections={settings.applicationCustomSections}
            confirmationText={settings.applyConfirmationText ?? undefined}
          />
        </CardContent>
      </Card>
    </div>
  );
}
