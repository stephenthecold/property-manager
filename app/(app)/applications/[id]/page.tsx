import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCapability, getDisplayRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { hasCapability } from "@/lib/auth/permissions";
import { getApplication } from "@/lib/services/applications";
import { formatCurrency, fromCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { FormDialog } from "@/components/app/form-dialog";
import { StatusForm, SendLinkForm } from "../applications-forms";
import { convertAction, declineAction, editApplicationAction } from "../actions";

export const runtime = "nodejs";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value || "—"}</div>
    </div>
  );
}

export default async function ApplicationDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability("applications.view");
  const [{ actingRole }, settings] = await Promise.all([
    getDisplayRole(),
    getAppSettings(),
  ]);
  if (!settings.modules.applications) redirect("/dashboard");

  const { id } = await params;
  const app = await getApplication(id);
  if (!app) notFound();

  const canManage = hasCapability(actingRole, "applications.manage", settings.rolePermissions);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/applications" className="text-sm text-muted-foreground hover:underline">
          ← All applications
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          {app.firstName} {app.lastName}
        </h1>
        <p className="text-sm text-muted-foreground capitalize">
          {app.status} · submitted{" "}
          {app.createdAt.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Applicant</CardTitle>
          {canManage && (
            <FormDialog
              trigger="Edit applicant"
              title="Edit applicant"
              wide
              action={editApplicationAction}
              submitLabel="Save"
            >
              <input type="hidden" name="id" value={app.id} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input id="firstName" name="firstName" defaultValue={app.firstName} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" name="lastName" defaultValue={app.lastName} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" defaultValue={app.email ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" name="phone" type="tel" defaultValue={app.phone ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desiredMoveInDate">Desired move-in</Label>
                  <Input
                    id="desiredMoveInDate"
                    name="desiredMoveInDate"
                    type="date"
                    defaultValue={
                      app.desiredMoveInDate
                        ? app.desiredMoveInDate.toISOString().slice(0, 10)
                        : ""
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="monthlyIncome">Monthly income</Label>
                  <Input
                    id="monthlyIncome"
                    name="monthlyIncome"
                    inputMode="decimal"
                    defaultValue={
                      app.monthlyIncomeCents != null ? fromCents(app.monthlyIncomeCents) : ""
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="currentAddress">Current address</Label>
                  <Input id="currentAddress" name="currentAddress" defaultValue={app.currentAddress ?? ""} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="employer">Employer</Label>
                  <Input id="employer" name="employer" defaultValue={app.employer ?? ""} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Message / notes</Label>
                <textarea
                  id="message"
                  name="message"
                  defaultValue={app.message ?? ""}
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-md border p-2 text-sm"
                />
              </div>
            </FormDialog>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field label="Email" value={app.email} />
            <Field label="Phone" value={app.phone} />
            <Field label="Current address" value={app.currentAddress} />
            <Field
              label="Desired move-in"
              value={
                app.desiredMoveInDate
                  ? app.desiredMoveInDate.toLocaleDateString("en-US", { timeZone: "UTC" })
                  : null
              }
            />
            <Field
              label="Monthly income"
              value={
                app.monthlyIncomeCents != null
                  ? formatCurrency(app.monthlyIncomeCents)
                  : null
              }
            />
            <Field label="Employer" value={app.employer} />
            <Field
              label="Interest"
              value={
                app.unit
                  ? `${app.property?.name ?? ""} · Unit ${app.unit.unitNumber}`
                  : (app.property?.name ?? null)
              }
            />
          </div>
          {app.message && (
            <div className="mt-4">
              <div className="text-xs text-muted-foreground">Applicant message</div>
              <p className="whitespace-pre-wrap text-sm">{app.message}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Review</CardTitle>
            {app.convertedTenantId ? (
              <Button variant="outline" size="sm" render={<Link href={`/tenants/${app.convertedTenantId}`} />}>
                View tenant
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <form action={convertAction}>
                  <input type="hidden" name="id" value={app.id} />
                  <ConfirmSubmitButton
                    confirmMessage="Create a tenant record from this applicant?"
                    size="sm"
                  >
                    Convert to tenant
                  </ConfirmSubmitButton>
                </form>
                {app.status !== "declined" && (
                  <form action={declineAction}>
                    <input type="hidden" name="id" value={app.id} />
                    <ConfirmSubmitButton
                      confirmMessage="Deny this application?"
                      variant="outline"
                      size="sm"
                    >
                      Deny
                    </ConfirmSubmitButton>
                  </form>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <StatusForm
              id={app.id}
              currentStatus={app.status}
              reviewerNotes={app.reviewerNotes ?? ""}
              canConvert={!app.convertedTenantId}
            />
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send this applicant the apply link</CardTitle>
          </CardHeader>
          <CardContent>
            <SendLinkForm unitId={app.unit?.id ?? null} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
