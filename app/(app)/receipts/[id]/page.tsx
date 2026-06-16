import Link from "next/link";
import { notFound } from "next/navigation";
import { getReceiptWithContext } from "@/lib/services/receipts";
import { getAppSettings } from "@/lib/services/app-settings";
import { getDocumentDownloadUrl, listDocuments } from "@/lib/services/documents";
import { getFileStorage } from "@/lib/providers/storage";
import { getDisplayRole } from "@/lib/auth/session";
import { hasCapability } from "@/lib/auth/permissions";
import { formatCurrency } from "@/lib/money";
import { markSentAction } from "@/app/(app)/receipts/actions";
import { EmailReceiptButton } from "./email-receipt-button";
import { PrintButton } from "@/components/app/print-button";
import { ChangeHistory } from "@/components/app/change-history";
import { UploadDocumentDialog } from "@/components/app/upload-document-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

function detail(label: string, value: string, capitalize = false) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-medium tabular-nums${capitalize ? " capitalize" : ""}`}>
        {value}
      </div>
    </div>
  );
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [ctx, app, { actingRole }] = await Promise.all([
    getReceiptWithContext(id),
    getAppSettings(),
    getDisplayRole(),
  ]);
  if (!ctx) notFound();
  const { receipt, payment, tenant, unit, property } = ctx;
  const canAttach = hasCapability(actingRole, "documents.manage", app.rolePermissions);

  // Attached paper-receipt photos (camera uploads): signed, short-lived URLs.
  const photoDocs = await listDocuments({ receiptId: receipt.id });
  const storage = await getFileStorage();
  const photos = await Promise.all(
    photoDocs.map(async (d) => ({
      id: d.id,
      fileName: d.fileName,
      isImage: (d.fileType ?? "").startsWith("image/"),
      url: await storage.getSignedUrl(d.fileUrl),
      createdAt: d.createdAt,
    })),
  );

  let logoUrl: string | null = null;
  if (app.logoDocumentId) {
    try {
      logoUrl = (await getDocumentDownloadUrl(app.logoDocumentId))?.url ?? null;
    } catch {
      logoUrl = null;
    }
  }
  const businessContact = [app.businessPhone, app.businessEmail]
    .filter(Boolean)
    .join(" · ");

  const currency = property?.currency ?? "USD";
  const voided = payment?.status === "voided";
  const addressParts = [
    property?.addressLine1,
    property?.addressLine2,
    [property?.city, property?.state, property?.zip].filter(Boolean).join(", "),
  ].filter(Boolean) as string[];
  const paidDate = receipt.paymentDate ?? payment?.paymentDate ?? null;
  const method = receipt.paymentMethod ?? payment?.method ?? null;
  const reference = payment?.referenceNumber ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="print-hidden flex flex-wrap items-center gap-2">
        <PrintButton />
        <EmailReceiptButton
          receiptId={receipt.id}
          tenantEmail={tenant?.email?.trim() || null}
        />
        <form action={markSentAction} className="flex items-center gap-2">
          <input type="hidden" name="receiptId" value={receipt.id} />
          <select
            name="method"
            defaultValue="sms"
            className="h-9 rounded-md border px-3 text-sm capitalize"
          >
            <option value="sms">sms</option>
            <option value="email">email</option>
            <option value="printed">printed</option>
          </select>
          <Button type="submit" variant="outline">
            Mark sent
          </Button>
        </form>
        <Button variant="ghost" render={<Link href="/payments" />}>
          Back to payments
        </Button>
        {receipt.sentAt && (
          <span className="text-sm text-muted-foreground">
            Sent via {receipt.sentMethod} on {receipt.sentAt.toLocaleDateString()}
          </span>
        )}
      </div>

      <Card>
        <CardContent className="space-y-6 py-6">
          {voided && (
            <div className="rounded-md border border-destructive bg-destructive/10 px-4 py-2 text-center text-lg font-bold tracking-widest text-destructive">
              VOIDED
            </div>
          )}

          <div className="space-y-1 text-center">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL
              <img
                src={logoUrl}
                alt={app.businessName}
                className="mx-auto mb-2 max-h-14 object-contain"
              />
            )}
            <div className="text-lg font-semibold">{app.businessName}</div>
            {app.businessAddress && (
              <div className="whitespace-pre-line text-xs text-muted-foreground">
                {app.businessAddress}
              </div>
            )}
            {businessContact && (
              <div className="text-xs text-muted-foreground">{businessContact}</div>
            )}
          </div>

          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-wide">RENT RECEIPT</h1>
            <p className="text-sm text-muted-foreground">{receipt.receiptNumber}</p>
          </div>

          <div className="space-y-0.5 text-center text-sm">
            <div className="font-medium">{property?.name ?? "—"}</div>
            {addressParts.map((line) => (
              <div key={line} className="text-muted-foreground">
                {line}
              </div>
            ))}
          </div>

          <div className="space-y-1 text-center">
            <div className="text-4xl font-bold tabular-nums">
              {formatCurrency(receipt.amountCents, currency)}
            </div>
            <div className="text-sm text-muted-foreground">Amount received</div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            {detail("Date paid", paidDate ? paidDate.toLocaleDateString() : "—")}
            {detail(
              "Tenant",
              tenant ? `${tenant.firstName} ${tenant.lastName}` : "—",
            )}
            {detail("Unit", unit ? unit.unitNumber : "—")}
            {detail(
              "Payment method",
              method ? method.replace(/_/g, " ") : "—",
              true,
            )}
            {reference && detail("Reference number", reference)}
            {detail(
              "Balance after payment",
              receipt.balanceAfterCents != null
                ? formatCurrency(receipt.balanceAfterCents, currency)
                : "—",
            )}
          </div>

          <div className="space-y-2 border-t pt-4 text-center text-xs text-muted-foreground">
            {app.receiptFooter && (
              <div className="whitespace-pre-line">{app.receiptFooter}</div>
            )}
            <div>
              Receipt {receipt.receiptNumber} — {app.businessName}
              {app.businessLegalName ? ` (${app.businessLegalName})` : ""}
            </div>
          </div>
        </CardContent>
      </Card>

      {(photos.length > 0 || canAttach) && (
        <Card className="print-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Receipt photos</CardTitle>
            {canAttach && (
              <UploadDocumentDialog
                receiptId={receipt.id}
                tenantId={receipt.tenantId ?? undefined}
                paymentId={receipt.paymentId ?? undefined}
                trigger="Attach photo"
              />
            )}
          </CardHeader>
          <CardContent>
            {photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No photos attached. Use “Attach photo” to add a picture of the
                paper receipt, check, or money order.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {photos.map((p) =>
                  p.isImage ? (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL */}
                      <img
                        src={p.url}
                        alt={p.fileName ?? "Receipt photo"}
                        className="h-32 w-32 rounded-md border object-cover"
                      />
                    </a>
                  ) : (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-32 w-32 items-center justify-center rounded-md border p-2 text-center text-xs text-muted-foreground hover:bg-muted/30"
                    >
                      {p.fileName ?? "Attachment"}
                    </a>
                  ),
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ChangeHistory
        refs={[
          { entityType: "Receipt", entityId: receipt.id },
          ...(payment ? [{ entityType: "Payment", entityId: payment.id }] : []),
        ]}
      />
    </div>
  );
}
