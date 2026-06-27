import { getSigningPageData, signingKindLabel } from "@/lib/services/esign";
import type { AgreementChangeSummary } from "@/lib/lease/agreement-format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AgreementText } from "@/components/app/agreement-text";
import { SignForm } from "./sign-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public tenant signing page — NO session ("/sign" is a PUBLIC_PREFIX). The
 * token in the URL is the only credential: invalid or unknown tokens get one
 * neutral message that reveals nothing about any lease or tenant. Valid
 * tokens render the SNAPSHOT document text frozen at send time (never the
 * live agreement).
 */

function NeutralInvalid() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center px-4">
      <Card className="w-full">
        <CardContent className="py-10 text-center">
          <div className="text-lg font-semibold">
            This signing link is invalid or has expired.
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            If you were expecting to sign an agreement, contact your property
            manager for a new link.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBanner({ state }: { state: string }) {
  const text =
    state === "canceled"
      ? "This signing request was canceled by the property manager. No signature is needed."
      : state === "completed"
        ? "This agreement is fully signed. Your property manager will send you the final copy."
        : state === "already_signed"
          ? "You have already signed this agreement. You'll receive the final copy once all parties have signed."
          : state === "expired"
            ? "This signing link has expired. Ask your property manager to send a new one."
            : null;
  if (!text) return null;
  return (
    <div className="rounded-lg border bg-muted/40 p-4 text-sm">{text}</div>
  );
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Renewal only: a heads-up that wording/terms differ from the tenant's last
 * signed agreement, with the affected clause headings. Shown above the full
 * agreement so they review before signing.
 */
function ChangesNotice({ changes }: { changes: AgreementChangeSummary }) {
  const items = [
    ...changes.changed.map((heading) => ({ kind: "Changed", heading })),
    ...changes.added.map((heading) => ({ kind: "New", heading })),
    ...changes.removed.map((heading) => ({ kind: "Removed", heading })),
  ];
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-950/40">
      <div className="font-semibold text-amber-900 dark:text-amber-200">
        Some terms changed since your last lease
      </div>
      <p className="mt-1 text-amber-800 dark:text-amber-200/80">
        Please review the full agreement below before signing.
        {items.length > 0 &&
          " These sections differ from your previous agreement:"}
      </p>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {items.map((it) => (
            <li
              key={`${it.kind}-${it.heading}`}
              className="text-amber-900 dark:text-amber-200"
            >
              <span className="font-medium">{it.kind}:</span> {it.heading}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getSigningPageData(token);

  if (data.state === "invalid") return <NeutralInvalid />;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {/* Branded header */}
      <div className="space-y-1 text-center">
        <div className="text-lg font-semibold">{data.businessName}</div>
        <h1 className="text-2xl font-semibold tracking-wide">
          {data.kind === "renewal" ? "Lease renewal" : "Lease agreement"} — ready
          for your signature
        </h1>
        <p className="text-sm text-muted-foreground">
          Prepared for {data.signer.name}
          {data.state === "open" && ` · link expires ${fmt(data.expiresAtISO)}`}
        </p>
      </div>

      <StatusBanner state={data.state} />

      {/* Signing status of every party (names + signed/pending only) */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Signatures
          </h2>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{data.landlordName ?? "Landlord"} (landlord)</span>
            {data.landlordSignedAtISO ? (
              <Badge>Signed</Badge>
            ) : (
              <Badge variant="outline">Pending</Badge>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{data.signer.name} (you)</span>
            {data.signer.signedAtISO || data.state === "completed" ? (
              <Badge>Signed</Badge>
            ) : (
              <Badge variant="outline">Pending</Badge>
            )}
          </div>
          {data.others.map((o) => (
            <div
              key={o.name}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>{o.name}</span>
              {o.signed || data.state === "completed" ? (
                <Badge>Signed</Badge>
              ) : (
                <Badge variant="outline">Pending</Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {data.changes && <ChangesNotice changes={data.changes} />}

      {/* The frozen agreement text exactly as it was sent */}
      <Card>
        <CardContent className="py-6">
          <AgreementText
            text={data.documentText}
            mode="pending"
            landlordName={data.landlordName ?? "Landlord"}
            tenantNames={[data.signer.name, ...data.others.map((o) => o.name)]}
          />
        </CardContent>
      </Card>

      {data.state === "open" && (
        <Card>
          <CardContent className="py-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Your signature
            </h2>
            <SignForm
              token={token}
              signerName={data.signer.name}
              needsInitials={data.needsInitials}
            />
          </CardContent>
        </Card>
      )}

      <p className="pb-4 text-center text-xs text-muted-foreground">
        {data.businessName} · {signingKindLabel(data.kind)} · electronic signing
      </p>
    </div>
  );
}
