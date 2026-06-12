import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { fromCents } from "@/lib/money";
import { getEnv } from "@/lib/config/env";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import {
  suggestFromOcrText,
  type OcrSuggestion,
} from "@/lib/providers/ocr/suggest";
import {
  createPaymentFromDocumentAction,
  runOcrAction,
} from "@/app/(app)/documents/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export const runtime = "nodejs";

const METHODS = ["cash", "check", "money_order", "card", "ach", "online", "other"];

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function localDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const FORM_ERRORS: Record<string, string> = {
  lease: "Select a lease before posting the payment.",
  amount: "Enter a valid positive amount (e.g. 1200.00).",
};

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Documents can hold sensitive PII/financial scans — manager+ only.
  await requireCapability("documents.manage");
  const { id } = await params;
  const sp = await searchParams;
  const formError = FORM_ERRORS[String(sp.error ?? "")];
  const doc = await prisma.uploadedDocument.findUnique({ where: { id } });
  if (!doc) notFound();

  const ocrEnabled = getEnv().OCR_ENABLED;

  const tenant = doc.tenantId
    ? await prisma.tenant.findUnique({ where: { id: doc.tenantId } })
    : null;

  let download: { url: string; fileName: string | null; fileType: string | null } | null =
    null;
  try {
    download = await getDocumentDownloadUrl(doc.id);
  } catch {
    download = null; // storage not configured — show a hint instead of a link
  }

  const leases = await prisma.lease.findMany({
    where: { status: { in: ["active", "month_to_month"] } },
    include: { tenant: true, unit: { include: { property: true } } },
    orderBy: [{ startDate: "desc" }],
  });
  const defaultLeaseId = doc.tenantId
    ? leases.find((l) => l.tenantId === doc.tenantId)?.id
    : undefined;

  const suggestion: OcrSuggestion = doc.ocrText ? suggestFromOcrText(doc.ocrText) : {};
  const suggestedAmount = suggestion.amountCents
    ? fromCents(BigInt(suggestion.amountCents))
    : undefined;

  // Server-minted idempotency key: a double-submit of this rendered form reuses it.
  const idempotencyKey = randomUUID();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold">{doc.fileName ?? "Untitled file"}</h1>
        {download ? (
          <Button
            variant="outline"
            render={
              <a href={download.url} target="_blank" rel="noopener noreferrer" />
            }
          >
            Download / view file
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">
            File storage is not configured — download unavailable.
          </span>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">File name</TableCell>
                <TableCell>{doc.fileName ?? "—"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Document type</TableCell>
                <TableCell className="capitalize">
                  {doc.uploadType.replace(/_/g, " ")}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">File type</TableCell>
                <TableCell>{doc.fileType ?? "—"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Size</TableCell>
                <TableCell className="tabular-nums">{formatBytes(doc.fileSize)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Uploaded</TableCell>
                <TableCell>{doc.createdAt.toLocaleString()}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Notes</TableCell>
                <TableCell className="whitespace-normal">{doc.notes ?? "—"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Tenant</TableCell>
                <TableCell>
                  {doc.tenantId ? (
                    <Link
                      href={`/tenants/${doc.tenantId}`}
                      className="font-medium hover:underline"
                    >
                      {tenant ? `${tenant.firstName} ${tenant.lastName}` : "Tenant"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Payment</TableCell>
                <TableCell>
                  {doc.paymentId ? (
                    <Link href="/payments" className="font-medium hover:underline">
                      Linked payment
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Receipt</TableCell>
                <TableCell>
                  {doc.receiptId ? (
                    <Link
                      href={`/receipts/${doc.receiptId}`}
                      className="font-medium hover:underline"
                    >
                      Linked receipt
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OCR</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {doc.ocrText ? (
            <>
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                {doc.ocrText}
              </pre>
              <p className="text-sm text-muted-foreground">
                Confidence:{" "}
                {doc.ocrConfidence == null
                  ? "—"
                  : `${Math.round(doc.ocrConfidence * 100)}%`}
              </p>
            </>
          ) : ocrEnabled ? (
            <form action={runOcrAction}>
              <input type="hidden" name="documentId" value={doc.id} />
              <Button type="submit" variant="outline">
                Run OCR
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              OCR is disabled (set OCR_ENABLED=true).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create payment from this document</CardTitle>
        </CardHeader>
        <CardContent>
          {formError && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}
          {leases.length === 0 ? (
            <p className="text-muted-foreground">No active leases to post against.</p>
          ) : (
            <form action={createPaymentFromDocumentAction} className="space-y-4">
              <input type="hidden" name="documentId" value={doc.id} />
              <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
              <div className="space-y-2">
                <Label htmlFor="leaseId">Lease</Label>
                <select
                  id="leaseId"
                  name="leaseId"
                  defaultValue={defaultLeaseId ?? ""}
                  required
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="" disabled>
                    Select lease…
                  </option>
                  {leases.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.tenant.lastName}, {l.tenant.firstName} — {l.unit.property.name} ·{" "}
                      {l.unit.unitNumber}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    name="amount"
                    inputMode="decimal"
                    defaultValue={suggestedAmount}
                    placeholder="1200.00"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paymentDate">Payment date</Label>
                  <Input
                    id="paymentDate"
                    name="paymentDate"
                    type="date"
                    defaultValue={suggestion.paymentDate ?? localDateString(new Date())}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="method">Method</Label>
                  <select
                    id="method"
                    name="method"
                    className="h-9 w-full rounded-md border px-3 text-sm capitalize"
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="referenceNumber">Reference / check #</Label>
                  <Input
                    id="referenceNumber"
                    name="referenceNumber"
                    defaultValue={suggestion.referenceNumber}
                  />
                </div>
              </div>
              {(suggestedAmount || suggestion.paymentDate || suggestion.referenceNumber) && (
                <p className="text-xs text-muted-foreground">
                  Prefilled from OCR — review before posting.
                </p>
              )}
              <Button type="submit">Review &amp; post payment</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
