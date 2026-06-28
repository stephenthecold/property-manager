import { createProperty } from "../actions";
import { requireCapability } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { getAppSettings } from "@/lib/services/app-settings";
import { ActionForm } from "@/components/app/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

export default async function NewPropertyPage() {
  await requireCapability("properties.manage");
  const env = getEnv();
  const { modules } = await getAppSettings();
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Add property</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createProperty}
            submitLabel="Create property"
            submitSize="default"
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addressLine1">Address</Label>
              <Input id="addressLine1" name="addressLine1" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" name="city" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input id="state" name="state" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zip">ZIP</Label>
                <Input id="zip" name="zip" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone (IANA)</Label>
                <Input id="timezone" name="timezone" defaultValue={env.DEFAULT_TIMEZONE} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" name="currency" defaultValue={env.DEFAULT_CURRENCY} />
              </div>
            </div>
            {modules.portfolio && (
              <div className="space-y-2">
                <Label htmlFor="legalEntityName">Legal entity / LLC</Label>
                <Input
                  id="legalEntityName"
                  name="legalEntityName"
                  placeholder="Acme Holdings LLC"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" />
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
