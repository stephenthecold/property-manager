import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCapability, getDisplayRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { hasCapability } from "@/lib/auth/permissions";
import { getApplication } from "@/lib/services/applications";
import { formatCurrency } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { StatusForm, SendLinkForm } from "../applications-forms";
import { convertAction } from "../actions";

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
        <CardHeader>
          <CardTitle className="text-base">Applicant</CardTitle>
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
              <form action={convertAction}>
                <input type="hidden" name="id" value={app.id} />
                <ConfirmSubmitButton
                  confirmMessage="Create a tenant record from this applicant?"
                  size="sm"
                >
                  Convert to tenant
                </ConfirmSubmitButton>
              </form>
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
