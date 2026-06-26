import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDisplayRole, requireCapability } from "@/lib/auth/session";
import { hasCapability } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { formatCurrency, fromCents } from "@/lib/money";
import { getAppSettings } from "@/lib/services/app-settings";
import { getInboundEmail } from "@/lib/services/inbound-email";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import { listActiveVendors } from "@/lib/services/vendors";
import {
  parsePaymentEmail,
  paymentLineKey,
} from "@/lib/services/payment-email/parse";
import { suggestLeaseId } from "@/lib/services/payment-email/match";
import {
  emailPaymentIdempotencyKey,
  listActiveLeaseOptions,
  paymentsForEmail,
  recentPaymentsForAttach,
} from "@/lib/services/inbox-payment";
import {
  suggestFromOcrText,
  type OcrSuggestion,
} from "@/lib/providers/ocr/suggest";
import {
  archiveInboxAction,
  attachInboxPaymentAction,
  deleteInboxAction,
  markInboxReadAction,
  postInboxExpenseAction,
  recordInboxPaymentAction,
} from "../actions";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { FormDialog } from "@/components/app/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = ["utilities", "insurance", "maintenance", "taxes", "other"];

const FORM_ERRORS: Record<string, string> = {
  already_posted: "This email has already been posted as an expense.",
  category: "Choose an expense category.",
  amount: "Enter a valid positive amount (e.g. 125.00).",
  target: "Pick a property for the expense.",
  lease: "Selected lease not found.",
  unit: "Selected unit not found.",
  property: "Selected property not found.",
  date: "Date must be a valid date (YYYY-MM-DD).",
  vendor: "Selected vendor not found.",
};

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

export default async function InboxDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("mailbox.manage");
  const app = await getAppSettings();
  if (!app.modules.mailbox) redirect("/dashboard");

  const { id } = await params;
  const sp = await searchParams;
  const formError = FORM_ERRORS[String(sp.error ?? "")];

  const data = await getInboundEmail(id);
  if (!data) notFound();
  const { email, attachments } = data;

  // These four reads are mutually independent — run them in one batch:
  // per-attachment signed download URLs, the sender→vendor match, the property
  // list, and the active-vendor list.
  const [attachmentLinks, vendorMatch, properties, vendors] = await Promise.all([
    Promise.all(
      attachments.map(async (a) => {
        let url: string | null = null;
        try {
          url = (await getDocumentDownloadUrl(a.id))?.url ?? null;
        } catch {
          url = null; // storage not configured — show a hint instead of a link
        }
        return { doc: a, url };
      }),
    ),
    email.fromEmail
      ? prisma.vendor.findFirst({
          where: {
            isActive: true,
            email: { equals: email.fromEmail, mode: "insensitive" },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
    prisma.property.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    listActiveVendors(),
  ]);

  // OCR prefill from the first attachment we managed to read.
  const ocrText = attachments.find((a) => a.ocrText)?.ocrText ?? null;
  const suggestion: OcrSuggestion = ocrText ? suggestFromOcrText(ocrText) : {};
  const suggestedAmount = suggestion.amountCents
    ? fromCents(BigInt(suggestion.amountCents))
    : undefined;

  const posted = email.status === "posted";

  // Payment capture: parse the email for payment lines and, if any (and the
  // viewer can record payments), gather what the "Record as payment" card needs.
  const { actingRole } = await getDisplayRole();
  const canRecordPayment = hasCapability(
    actingRole,
    "payments.manage",
    app.rolePermissions,
  );
  const parsedPayments = parsePaymentEmail({
    fromEmail: email.fromEmail,
    subject: email.subject,
    body: email.body,
  });
  const showPaymentCard = canRecordPayment && parsedPayments.lines.length > 0;

  const [leaseOptions, linkedPayments, attachablePayments] = showPaymentCard
    ? await Promise.all([
        listActiveLeaseOptions(),
        paymentsForEmail(email.id),
        recentPaymentsForAttach(),
      ])
    : [[], [], []];

  // Per parsed line: a stable row key, whether it's already recorded (a payment
  // with the matching idempotency key), and a best-effort suggested lease.
  const paymentLines = parsedPayments.lines.map((line, i) => {
    const rowKey = paymentLineKey(line, i);
    const recorded = linkedPayments.find(
      (p) => p.idempotencyKey === emailPaymentIdempotencyKey(email.id, rowKey),
    );
    return {
      line,
      rowKey,
      recorded,
      suggestedLeaseId: suggestLeaseId(line.payerName, leaseOptions),
      defaultNote: [
        parsedPayments.provider !== "unknown" ? parsedPayments.provider : null,
        line.payerName ? `from ${line.payerName}` : null,
        line.memo,
        line.reference ? `ref ${line.reference}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
  // Payments ATTACHED (not recorded-from) this email — different idempotency key.
  const attachedPayments = linkedPayments.filter(
    (p) => !p.idempotencyKey.startsWith(`inbound_email:${email.id}:`),
  );
  const emailDateDefault = email.receivedAt.toLocaleDateString("en-CA");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/inbox" className="text-sm text-muted-foreground hover:underline">
            ← Email inbox
          </Link>
          <h1 className="text-2xl font-semibold">
            {email.subject || "(no subject)"}
          </h1>
          <p className="text-sm text-muted-foreground">
            From{" "}
            <span className="font-medium text-foreground">
              {email.fromName ? `${email.fromName} · ` : ""}
              {email.fromEmail}
            </span>{" "}
            · {email.receivedAt.toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!email.readAt && (
            <form action={markInboxReadAction}>
              <input type="hidden" name="id" value={email.id} />
              <Button type="submit" variant="ghost" size="sm">
                Mark read
              </Button>
            </form>
          )}
          {!posted && (
            <form action={archiveInboxAction}>
              <input type="hidden" name="id" value={email.id} />
              <input
                type="hidden"
                name="archived"
                value={email.status === "archived" ? "false" : "true"}
              />
              <Button type="submit" variant="outline" size="sm">
                {email.status === "archived" ? "Unarchive" : "Archive"}
              </Button>
            </form>
          )}
          {!posted && (
            <form action={deleteInboxAction}>
              <input type="hidden" name="id" value={email.id} />
              <ConfirmSubmitButton
                size="sm"
                confirmMessage="Delete this message and its attachments permanently? This can't be undone."
              >
                Delete
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Message</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Tenant match</TableCell>
                <TableCell>
                  {email.tenant ? (
                    <Link
                      href={`/tenants/${email.tenant.id}`}
                      className="font-medium hover:underline"
                    >
                      {email.tenant.firstName} {email.tenant.lastName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">
                      No tenant matched this sender
                    </span>
                  )}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Status</TableCell>
                <TableCell className="capitalize">{email.status}</TableCell>
              </TableRow>
              {email.toAddress && (
                <TableRow>
                  <TableCell className="font-medium">To</TableCell>
                  <TableCell className="break-words">{email.toAddress}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div>
            <p className="mb-1 text-sm font-medium">Body</p>
            <pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap break-words">
              {email.body || "(empty)"}
            </pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Attachments{" "}
            {attachments.length > 0 && (
              <span className="text-muted-foreground">({attachments.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attachments.</p>
          ) : (
            <ul className="space-y-2">
              {attachmentLinks.map(({ doc, url }) => (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {doc.fileName ?? "attachment"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {doc.fileType ?? "unknown"} · {formatBytes(doc.fileSize)}
                      {doc.ocrText ? " · OCR read" : ""}
                    </span>
                  </span>
                  {url ? (
                    <Button
                      variant="outline"
                      size="xs"
                      render={
                        <a href={url} target="_blank" rel="noopener noreferrer" />
                      }
                    >
                      Download
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      storage not configured
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {showPaymentCard && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record as payment</CardTitle>
            <p className="text-xs text-muted-foreground">
              Parsed from this {parsedPayments.provider} email — review and confirm
              the tenant before recording. Nothing posts to a ledger until you do.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {paymentLines.map(
              ({ line, rowKey, recorded, suggestedLeaseId, defaultNote }) => (
                <div
                  key={rowKey}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="text-sm">
                    <span className="font-medium">
                      {formatCurrency(line.amountCents, "USD")}
                    </span>
                    {line.payerName && (
                      <span className="text-muted-foreground"> · {line.payerName}</span>
                    )}
                    {line.memo && (
                      <span className="text-muted-foreground"> · {line.memo}</span>
                    )}
                    {line.reference && (
                      <span className="block font-mono text-xs text-muted-foreground">
                        {line.reference}
                      </span>
                    )}
                  </div>
                  {recorded ? (
                    <span className="flex items-center gap-2 text-sm">
                      <Badge
                        variant="outline"
                        className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      >
                        Recorded
                      </Badge>
                      <Link
                        href={`/tenants/${recorded.lease.tenant.id}`}
                        className="text-muted-foreground hover:underline"
                      >
                        {recorded.lease.tenant.firstName}{" "}
                        {recorded.lease.tenant.lastName}
                      </Link>
                    </span>
                  ) : (
                    <FormDialog
                      trigger="Record payment"
                      title="Record payment"
                      wide
                      action={recordInboxPaymentAction}
                      submitLabel="Record payment"
                    >
                      <input type="hidden" name="inboundEmailId" value={email.id} />
                      <input type="hidden" name="rowKey" value={rowKey} />
                      <div className="space-y-2">
                        <Label htmlFor={`lease-${rowKey}`}>Tenant / lease</Label>
                        <select
                          id={`lease-${rowKey}`}
                          name="leaseId"
                          required
                          defaultValue={suggestedLeaseId ?? ""}
                          className="h-9 w-full rounded-md border px-3 text-sm"
                        >
                          <option value="" disabled>
                            Select tenant…
                          </option>
                          {leaseOptions.map((o) => (
                            <option key={o.leaseId} value={o.leaseId}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {suggestedLeaseId && (
                          <p className="text-xs text-muted-foreground">
                            Suggested from “{line.payerName}” — confirm it&apos;s right.
                          </p>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-2">
                          <Label htmlFor={`amount-${rowKey}`}>Amount</Label>
                          <Input
                            id={`amount-${rowKey}`}
                            name="amount"
                            inputMode="decimal"
                            defaultValue={fromCents(line.amountCents)}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`date-${rowKey}`}>Date</Label>
                          <Input
                            id={`date-${rowKey}`}
                            name="paymentDate"
                            type="date"
                            defaultValue={
                              line.paymentDate
                                ? line.paymentDate.toLocaleDateString("en-CA")
                                : emailDateDefault
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`method-${rowKey}`}>Method</Label>
                          <select
                            id={`method-${rowKey}`}
                            name="method"
                            defaultValue={parsedPayments.method}
                            className="h-9 w-full rounded-md border px-3 text-sm"
                          >
                            {[
                              "online",
                              "cash_app",
                              "ach",
                              "card",
                              "check",
                              "money_order",
                              "cash",
                              "other",
                            ].map((m) => (
                              <option key={m} value={m}>
                                {m.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`ref-${rowKey}`}>Reference</Label>
                        <Input
                          id={`ref-${rowKey}`}
                          name="referenceNumber"
                          defaultValue={line.reference ?? ""}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`notes-${rowKey}`}>Notes</Label>
                        <Input
                          id={`notes-${rowKey}`}
                          name="notes"
                          defaultValue={defaultNote}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Records a tenant payment (money in) and applies it to the
                        oldest open charges. Re-recording the same line is a no-op.
                      </p>
                    </FormDialog>
                  )}
                </div>
              ),
            )}

            {attachedPayments.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Attached to{" "}
                {attachedPayments
                  .map(
                    (p) =>
                      `${p.lease.tenant.firstName} ${p.lease.tenant.lastName} (${formatCurrency(p.amountCents, "USD")})`,
                  )
                  .join(", ")}
                .
              </p>
            )}

            <div className="border-t pt-3">
              <FormDialog
                trigger="Attach to an existing payment"
                triggerVariant="ghost"
                title="Attach to an existing payment"
                action={attachInboxPaymentAction}
                submitLabel="Attach"
              >
                <input type="hidden" name="inboundEmailId" value={email.id} />
                <p className="text-sm text-muted-foreground">
                  Already recorded this in Payments? Link this email to it as
                  documentation — no new payment is created.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="attach-payment">Payment</Label>
                  <select
                    id="attach-payment"
                    name="paymentId"
                    required
                    defaultValue=""
                    className="h-9 w-full rounded-md border px-3 text-sm"
                  >
                    <option value="" disabled>
                      Select a recent payment…
                    </option>
                    {attachablePayments.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.lease.tenant.firstName} {p.lease.tenant.lastName} —{" "}
                        {formatCurrency(p.amountCents, "USD")} ·{" "}
                        {p.paymentDate.toLocaleDateString("en-US")}
                      </option>
                    ))}
                  </select>
                </div>
              </FormDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {posted ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posted as expense</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This email was posted to Financials as a property expense
              {email.handledAt
                ? ` on ${email.handledAt.toLocaleString()}`
                : ""}
              . The ledger and tenant balances are untouched.
            </p>
            <Button variant="outline" size="sm" render={<Link href="/financials" />}>
              View in Financials
            </Button>
          </CardContent>
        </Card>
      ) : !app.modules.financials ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Post as expense</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Enable the Financials module (Settings → Modules) to post emailed
              invoices as expenses.
            </p>
          </CardContent>
        </Card>
      ) : properties.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Post as expense</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Add a property before posting an expense.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Post as expense</CardTitle>
          </CardHeader>
          <CardContent>
            {formError && (
              <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}
            <form action={postInboxExpenseAction} className="space-y-4">
              <input type="hidden" name="inboundEmailId" value={email.id} />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="propertyId">Property</Label>
                  <select
                    id="propertyId"
                    name="propertyId"
                    required
                    defaultValue=""
                    className="h-9 w-full rounded-md border px-3 text-sm"
                  >
                    <option value="" disabled>
                      Select property…
                    </option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <select
                    id="category"
                    name="category"
                    defaultValue="maintenance"
                    className="h-9 w-full rounded-md border px-3 text-sm capitalize"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    name="amount"
                    inputMode="decimal"
                    defaultValue={suggestedAmount}
                    placeholder="125.00"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incurredOn">Date</Label>
                  <Input
                    id="incurredOn"
                    name="incurredOn"
                    type="date"
                    defaultValue={suggestion.paymentDate ?? localDateString(new Date())}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendorId">Vendor (optional)</Label>
                  <select
                    id="vendorId"
                    name="vendorId"
                    defaultValue={vendorMatch?.id ?? ""}
                    className="h-9 w-full rounded-md border px-3 text-sm"
                  >
                    <option value="">— none —</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  name="description"
                  defaultValue={email.subject ?? ""}
                  placeholder="What was this expense for?"
                />
              </div>
              {(suggestedAmount || suggestion.paymentDate || vendorMatch) && (
                <p className="text-xs text-muted-foreground">
                  Prefilled from the email{ocrText ? " / OCR" : ""} — review before
                  posting. This records a Financials expense (money out); it never
                  touches a tenant&apos;s ledger balance.
                </p>
              )}
              <Button type="submit">Review &amp; post expense</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
