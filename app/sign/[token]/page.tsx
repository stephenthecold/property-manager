import { getSigningPageData, signingKindLabel } from "@/lib/services/esign";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

      {/* The frozen agreement text exactly as it was sent */}
      <Card>
        <CardContent className="py-6">
          <div className="whitespace-pre-wrap text-sm leading-6">
            {data.documentText}
          </div>
        </CardContent>
      </Card>

      {data.state === "open" && (
        <Card>
          <CardContent className="py-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Your signature
            </h2>
            <SignForm token={token} signerName={data.signer.name} />
          </CardContent>
        </Card>
      )}

      <p className="pb-4 text-center text-xs text-muted-foreground">
        {data.businessName} · {signingKindLabel(data.kind)} · electronic signing
      </p>
    </div>
  );
}
