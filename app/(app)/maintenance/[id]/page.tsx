import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { prisma } from "@/lib/db";
import {
  getDocumentDownloadUrl,
  listMaintenancePhotos,
} from "@/lib/services/documents";
import { priorityLabel } from "@/lib/maintenance/priority";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { addMaintenancePhotosAction } from "./actions";

export const runtime = "nodejs";
export const metadata = { title: "Maintenance job" };

interface Photo {
  id: string;
  url: string | null;
  fileName: string | null;
  note: string | null;
}

function PhotoGroup({ title, photos }: { title: string; photos: Photo[] }) {
  if (photos.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((p) =>
          p.url ? (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-md border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL */}
              <img
                src={p.url}
                alt={p.fileName ?? "Maintenance photo"}
                className="aspect-square w-full object-cover transition-opacity hover:opacity-90"
              />
            </a>
          ) : (
            <div
              key={p.id}
              className="flex aspect-square items-center justify-center rounded-md border bg-muted p-2 text-center text-xs text-muted-foreground"
            >
              Photo unavailable
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export default async function MaintenanceJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("maintenance.manage");
  const settings = await getAppSettings();
  if (!settings.modules.maintenance) redirect("/dashboard");

  const { id } = await params;
  const sp = await searchParams;
  const first = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const photoMsg = first("photo_msg");
  const error = first("error");

  const job = await prisma.maintenanceJob.findUnique({
    where: { id },
    include: { property: true, unit: true, vendor: true },
  });
  if (!job) notFound();

  const docs = await listMaintenancePhotos({ maintenanceJobId: id });
  const photos: Photo[] = await Promise.all(
    docs.map(async (d) => {
      let url: string | null = null;
      try {
        url = (await getDocumentDownloadUrl(d.id))?.url ?? null;
      } catch {
        url = null; // storage unavailable — render a placeholder, don't crash
      }
      return { id: d.id, url, fileName: d.fileName, note: d.notes };
    }),
  );
  const tenantPhotos = photos.filter((p) => p.note === "Tenant photo");
  const beforePhotos = photos.filter((p) => p.note === "Before");
  const afterPhotos = photos.filter((p) => p.note === "After");
  const otherPhotos = photos.filter(
    (p) => !["Tenant photo", "Before", "After"].includes(p.note ?? ""),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" render={<Link href="/maintenance" />}>
          ← Maintenance
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{job.title}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {job.status.replace(/_/g, " ")}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {priorityLabel(job.priority)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">Property</div>
              <div className="font-medium">{job.property.name}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Unit</div>
              <div className="font-medium">{job.unit?.unitNumber ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Due</div>
              <div className="font-medium">
                {job.dueDate ? job.dueDate.toLocaleDateString() : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Vendor</div>
              <div className="font-medium">{job.vendor?.name ?? "—"}</div>
            </div>
          </div>
          {job.details && (
            <p className="whitespace-pre-line border-t pt-2 text-muted-foreground">
              {job.details}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Photos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {photoMsg && (
            <Alert>
              <AlertDescription>{photoMsg}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No photos yet.</p>
          ) : (
            <div className="space-y-5">
              <PhotoGroup title="From the tenant" photos={tenantPhotos} />
              <PhotoGroup title="Before" photos={beforePhotos} />
              <PhotoGroup title="After" photos={afterPhotos} />
              <PhotoGroup title="Other" photos={otherPhotos} />
            </div>
          )}

          {/* Staff before/after upload */}
          <form
            action={addMaintenancePhotosAction}
            className="space-y-2 border-t pt-4"
          >
            <input type="hidden" name="jobId" value={job.id} />
            <Label htmlFor="staff-photos">Add photos</Label>
            <div className="flex flex-wrap items-end gap-2">
              <select
                name="stage"
                defaultValue="before"
                aria-label="Photo stage"
                className="h-9 rounded-md border px-2 text-sm"
              >
                <option value="before">Before</option>
                <option value="after">After</option>
                <option value="other">Other</option>
              </select>
              <input
                id="staff-photos"
                name="photos"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/70"
              />
              <Button type="submit" size="sm">
                Upload
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Up to 5 images (JPG/PNG/WebP, 10 MB each).
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
