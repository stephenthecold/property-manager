import { createTenant } from "../actions";
import { requireRole } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

export default async function NewTenantPage() {
  await requireRole("manager");
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Add tenant</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createTenant} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" name="firstName" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" name="lastName" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mailingAddress">Mailing address</Label>
              <Input id="mailingAddress" name="mailingAddress" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="emergencyContactName">Emergency contact</Label>
                <Input id="emergencyContactName" name="emergencyContactName" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContactPhone">Emergency phone</Label>
                <Input id="emergencyContactPhone" name="emergencyContactPhone" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="smsConsent" className="size-4" />
              Tenant consents to SMS reminders
            </label>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" />
            </div>
            <Button type="submit">Create tenant</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
