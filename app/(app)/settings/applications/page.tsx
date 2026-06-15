import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { applyUrl } from "@/lib/services/applications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplicationsSettingsForm } from "./applications-settings-form";

export const runtime = "nodejs";

/**
 * Settings → Applications: configure the public rental-application form (which
 * fields show / are required). Gated by applications.manage + the module.
 */
export default async function ApplicationsSettingsPage() {
  await requireCapability("applications.manage");
  const settings = await getAppSettings();
  if (!settings.modules.applications) redirect("/settings");

  const url = await applyUrl();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Application form</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your public application form lives at{" "}
          <a href={url} target="_blank" rel="noreferrer" className="font-mono text-primary underline underline-offset-2">
            {url}
          </a>
          . Share it with prospects, or send it from a tenant&apos;s page.
        </p>
        <ApplicationsSettingsForm config={settings.applicationFields} />
      </CardContent>
    </Card>
  );
}
