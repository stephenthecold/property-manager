import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { listDocuments } from "@/lib/services/documents";
import type { UploadType } from "@/lib/generated/prisma/enums";
import { UploadDocumentDialog } from "@/components/app/upload-document-dialog";
import { DataTable } from "@/components/app/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const runtime = "nodejs";

const UPLOAD_TYPES = [
  "receipt_photo",
  "lease",
  "lease_template",
  "tenant_document",
  "other",
] as const;

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("documents.manage");
  const sp = await searchParams;
  const rawType = typeof sp.uploadType === "string" ? sp.uploadType : "";
  const uploadType = (UPLOAD_TYPES as readonly string[]).includes(rawType)
    ? (rawType as UploadType)
    : undefined;
  const tenantId =
    typeof sp.tenantId === "string" && sp.tenantId.trim() ? sp.tenantId.trim() : undefined;

  const documents = await listDocuments({ uploadType, tenantId });

  const tenantIds = [
    ...new Set(documents.map((d) => d.tenantId).filter((x): x is string => !!x)),
  ];
  const tenants = tenantIds.length
    ? await prisma.tenant.findMany({ where: { id: { in: tenantIds } } })
    : [];
  const tenantName = new Map(
    tenants.map((t) => [t.id, `${t.firstName} ${t.lastName}`]),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <UploadDocumentDialog tenantId={tenantId} trigger="Upload document" />
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="uploadType">Document type</Label>
          <select
            id="uploadType"
            name="uploadType"
            defaultValue={uploadType ?? ""}
            className="h-9 w-48 rounded-md border px-3 text-sm capitalize"
          >
            <option value="">All types</option>
            {UPLOAD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        {tenantId && <input type="hidden" name="tenantId" value={tenantId} />}
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <DataTable
        emptyMessage="No documents yet."
        columns={[
          { key: "uploaded", label: "Uploaded" },
          { key: "file", label: "File" },
          { key: "type", label: "Type", className: "hidden sm:table-cell" },
          {
            key: "size",
            label: "Size",
            numeric: true,
            className: "hidden md:table-cell",
          },
          { key: "linked", label: "Linked to", className: "hidden md:table-cell" },
          { key: "ocr", label: "OCR", sortable: false, className: "hidden lg:table-cell" },
        ]}
        rows={documents.map((d) => ({
          key: d.id,
          sortValues: [
            d.createdAt.toISOString(),
            d.fileName ?? "Untitled file",
            d.uploadType,
            d.fileSize,
            d.tenantId ? (tenantName.get(d.tenantId) ?? "Tenant") : null,
            null,
          ],
          cells: [
            d.createdAt.toLocaleDateString(),
            <Link
              key="f"
              href={`/documents/${d.id}`}
              className="font-medium hover:underline"
            >
              {d.fileName ?? "Untitled file"}
            </Link>,
            <span key="t" className="capitalize">
              {d.uploadType.replace(/_/g, " ")}
            </span>,
            <span key="z" className="tabular-nums">
              {formatBytes(d.fileSize)}
            </span>,
            d.tenantId || d.paymentId || d.receiptId ? (
              <span key="l" className="flex gap-2">
                {d.tenantId && (
                  <Link
                    href={`/tenants/${d.tenantId}`}
                    className="font-medium hover:underline"
                  >
                    {tenantName.get(d.tenantId) ?? "Tenant"}
                  </Link>
                )}
                {d.paymentId && (
                  <Link href="/payments" className="font-medium hover:underline">
                    Payment
                  </Link>
                )}
                {d.receiptId && (
                  <Link
                    href={`/receipts/${d.receiptId}`}
                    className="font-medium hover:underline"
                  >
                    Receipt
                  </Link>
                )}
              </span>
            ) : (
              <span key="l" className="text-muted-foreground">
                —
              </span>
            ),
            d.ocrText ? (
              <Badge
                key="o"
                variant="outline"
                className="border-sky-200 bg-sky-100 font-medium text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
              >
                OCR
              </Badge>
            ) : (
              <span key="o" className="text-muted-foreground">
                —
              </span>
            ),
          ],
        }))}
      />
    </div>
  );
}
