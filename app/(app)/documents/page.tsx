import Link from "next/link";
import { prisma } from "@/lib/db";
import { listDocuments } from "@/lib/services/documents";
import type { UploadType } from "@/lib/generated/prisma/enums";
import { UploadDocumentDialog } from "@/components/app/upload-document-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";

const UPLOAD_TYPES = ["receipt_photo", "lease", "tenant_document", "other"] as const;

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

      <form method="GET" className="flex items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="uploadType">Document type</Label>
          <select
            id="uploadType"
            name="uploadType"
            defaultValue={uploadType ?? ""}
            className="h-9 w-48 rounded-md border bg-transparent px-3 text-sm capitalize"
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Uploaded</TableHead>
            <TableHead>File</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Linked to</TableHead>
            <TableHead>OCR</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((d) => (
            <TableRow key={d.id}>
              <TableCell>{d.createdAt.toLocaleDateString()}</TableCell>
              <TableCell>
                <Link href={`/documents/${d.id}`} className="font-medium hover:underline">
                  {d.fileName ?? "Untitled file"}
                </Link>
              </TableCell>
              <TableCell className="capitalize">
                {d.uploadType.replace(/_/g, " ")}
              </TableCell>
              <TableCell className="tabular-nums">{formatBytes(d.fileSize)}</TableCell>
              <TableCell>
                {d.tenantId || d.paymentId || d.receiptId ? (
                  <span className="flex gap-2">
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
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {d.ocrText ? (
                  <Badge variant="outline">OCR</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {documents.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No documents yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
