import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCapability, getDisplayRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { hasCapability } from "@/lib/auth/permissions";
import { getApplication } from "@/lib/services/applications";
import { listBackgroundChecks } from "@/lib/services/background-check";
import { formatCurrency, fromCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PageHeader } from "@/components/app/page-header";
import { FormDialog } from "@/components/app/form-dialog";
import { StatusForm, SendLinkForm } from "../applications-forms";
import {
  cancelBackgroundCheckAction,
  convertAction,
  declineAction,
  editApplicationAction,
  requestBackgroundCheckAction,
} from "../actions";
import type { BackgroundCheckStatus } from "@/lib/generated/prisma/enums";

export const runtime = "nodejs";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value || "—"}</div>
    </div>
  );
}

const BG_BADGE: Record<BackgroundCheckStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  },
  clear: {
    label: "Clear",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  },
  consider: {
    label: "Needs review",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  },
  canceled: {
    label: "Canceled",
    className: "bg-muted text-muted-foreground",
  },
};

function BackgroundCheckBadge({ status }: { status: BackgroundCheckStatus }) {
  const b = BG_BADGE[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${b.className}`}
    >
      {b.label}
    </span>
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
  const checks = canManage ? await listBackgroundChecks(app.id) : [];
  const hasPendingCheck = checks.some((c) => c.status === "pending");

  // Stored answers to operator-defined custom questions ([{ label, value }]).
  const customAnswers: { label: string; value: string }[] = Array.isArray(
    app.customAnswers,
  )
    ? (app.customAnswers as unknown[]).flatMap((a) =>
        a && typeof a === "object" && "label" in a && "value" in a
          ? [
              {
                label: String((a as { label: unknown }).label),
                value: String((a as { value: unknown }).value),
              },
            ]
          : [],
      )
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/applications", label: "Applications" }}
        title={`${app.firstName} ${app.lastName}`}
        description={
          <span className="capitalize">
            {app.status} · submitted{" "}
            {app.createdAt.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        }
      />

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
                app.unit ? (
                  <Link href={`/units/${app.unit.id}`} className="hover:underline">
                    {app.property?.name ?? ""} · Unit {app.unit.unitNumber}
                  </Link>
                ) : app.property ? (
                  <Link href={`/properties/${app.property.id}`} className="hover:underline">
                    {app.property.name}
                  </Link>
                ) : null
              }
            />
          </div>
          {app.message && (
            <div className="mt-4">
              <div className="text-xs text-muted-foreground">Applicant message</div>
              <p className="whitespace-pre-wrap text-sm">{app.message}</p>
            </div>
          )}
          {customAnswers.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs text-muted-foreground">
                Additional questions
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {customAnswers.map((a, i) => (
                  <div key={i} className="border-b py-1.5 text-sm">
                    <dt className="text-xs text-muted-foreground">{a.label}</dt>
                    <dd className="whitespace-pre-wrap font-medium">{a.value}</dd>
                  </div>
                ))}
              </dl>
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
                    variant="default"
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
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Background check</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Tenant screening for this applicant. Run, then track the result here.
              </p>
            </div>
            {!hasPendingCheck && (
              <form action={requestBackgroundCheckAction}>
                <input type="hidden" name="id" value={app.id} />
                <ConfirmSubmitButton
                  confirmMessage="Request a background check for this applicant?"
                  variant="outline"
                  size="sm"
                >
                  Request check
                </ConfirmSubmitButton>
              </form>
            )}
          </CardHeader>
          <CardContent>
            {checks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No background checks have been run yet.
              </p>
            ) : (
              <ul className="divide-y">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <BackgroundCheckBadge status={c.status} />
                        <span className="text-xs text-muted-foreground">
                          {c.provider} ·{" "}
                          {c.requestedAt.toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                      {c.summary && <p className="text-sm">{c.summary}</p>}
                      {c.reportUrl && (
                        <a
                          href={c.reportUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View provider report
                        </a>
                      )}
                    </div>
                    {c.status === "pending" && (
                      <form action={cancelBackgroundCheckAction}>
                        <input type="hidden" name="id" value={app.id} />
                        <input type="hidden" name="checkId" value={c.id} />
                        <ConfirmSubmitButton
                          confirmMessage="Cancel this pending background check?"
                          variant="outline"
                          size="sm"
                        >
                          Cancel
                        </ConfirmSubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
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
