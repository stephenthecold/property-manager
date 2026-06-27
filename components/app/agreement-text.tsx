import type { ReactNode } from "react";
import { initialsFromName, type SignatureMarker } from "@/lib/esign/markers";
import { parseAgreementBlocks } from "@/lib/lease/agreement-format";

/**
 * Marker-aware agreement renderer (server component, themable). The frozen or
 * live agreement text is split into structured blocks (numbered clauses get a
 * bolded run-in heading, paragraphs are spaced) by parseAgreementBlocks, which
 * falls back to a single continuous block for unstructured custom templates.
 * Inline signature/initial markers become:
 *  - mode="wet"    → ruled signature/initial lines for printing & pen signing
 *  - mode="pending"→ dashed "will appear here" placeholders on the /sign page
 * When the org has a saved landlord signature, the {{landlord_signature}} /
 * {{landlord_initials}} markers are stamped with it (drawn image or cursive
 * typed name) instead of a blank line — the landlord has pre-signed.
 * The signed ARTIFACT renders real marks separately (lib/esign/artifact.ts).
 */

/** Cursive stack matching the signed-artifact typed signature. */
export const SIGNATURE_FONT =
  '"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive';

export interface AppliedLandlordSignature {
  name: string;
  imageDataUrl?: string;
  initialsImageDataUrl?: string;
  /** Date the saved signature counts as applied (formatted, property tz). */
  date: string;
}

export interface AgreementTextProps {
  text: string;
  mode: "wet" | "pending";
  landlordName: string;
  /** Primary tenant first, then co-tenants — one signature line each. */
  tenantNames: string[];
  /** Saved landlord signature, stamped at the landlord markers when present. */
  landlordSignature?: AppliedLandlordSignature | null;
}

function signatureImage(src: string, alt: string, className: string) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- inline data URL, no remote fetch
    <img src={src} alt={alt} className={className} />
  );
}

function WetSignatureLine({
  name,
  role,
  mark,
  date,
}: {
  name: string;
  role: string;
  /** Stamped signature; omitted → an empty ruled line to sign by hand. */
  mark?: ReactNode;
  date?: string;
}) {
  return (
    <span className="my-4 block break-inside-avoid">
      <span className="flex items-end gap-8">
        <span className="inline-flex h-9 w-64 items-end overflow-hidden border-b border-foreground">
          {mark ?? <span aria-hidden>&nbsp;</span>}
        </span>
        <span className="text-xs text-muted-foreground">
          Date: {date ?? "____________"}
        </span>
      </span>
      <span className="block text-xs text-muted-foreground">
        {name} — {role}
      </span>
    </span>
  );
}

function WetInitials({ names }: { names: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-3 align-baseline">
      {names.map((n) => (
        <span key={n} className="inline-flex items-baseline gap-1 text-xs text-muted-foreground">
          <span className="inline-block w-12 border-b border-foreground" aria-hidden>
            &nbsp;
          </span>
          {n}
        </span>
      ))}
    </span>
  );
}

/** The saved landlord signature as a drawn image or cursive typed name. */
function landlordSignatureMark(sig: AppliedLandlordSignature): ReactNode {
  if (sig.imageDataUrl) {
    return signatureImage(
      sig.imageDataUrl,
      `${sig.name} signature`,
      "max-h-8 object-contain object-left",
    );
  }
  return (
    <span
      className="pb-0.5 text-2xl leading-none italic"
      style={{ fontFamily: SIGNATURE_FONT }}
    >
      {sig.name}
    </span>
  );
}

/** The saved landlord initials as a drawn image or cursive derived letters. */
function landlordInitialsMark(sig: AppliedLandlordSignature): ReactNode {
  if (sig.initialsImageDataUrl) {
    return (
      <span className="inline-flex items-baseline align-baseline">
        {signatureImage(
          sig.initialsImageDataUrl,
          `${sig.name} initials`,
          "max-h-6 object-contain",
        )}
      </span>
    );
  }
  return (
    <span
      className="inline-block border-b border-foreground px-1 text-base leading-tight italic align-baseline"
      style={{ fontFamily: SIGNATURE_FONT }}
    >
      {initialsFromName(sig.name)}
    </span>
  );
}

function PendingChip({ label }: { label: string }) {
  return (
    <span className="mx-0.5 inline-block rounded border border-dashed border-primary/60 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">
      {label}
    </span>
  );
}

export function AgreementText({
  text,
  mode,
  landlordName,
  tenantNames,
  landlordSignature,
}: AgreementTextProps) {
  const renderMarker = (marker: SignatureMarker, key: number) => {
    if (mode === "wet") {
      switch (marker) {
        case "landlord_signature":
          return (
            <WetSignatureLine
              key={key}
              name={landlordName}
              role="Landlord"
              mark={landlordSignature ? landlordSignatureMark(landlordSignature) : undefined}
              date={landlordSignature?.date}
            />
          );
        case "tenant_signatures":
          return (
            <span key={key} className="block">
              {tenantNames.map((n, i) => (
                <WetSignatureLine key={n} name={n} role={i === 0 ? "Tenant" : "Co-tenant"} />
              ))}
            </span>
          );
        case "landlord_initials":
          return landlordSignature ? (
            <span key={key}>{landlordInitialsMark(landlordSignature)}</span>
          ) : (
            <WetInitials key={key} names={[landlordName]} />
          );
        case "tenant_initials":
          return <WetInitials key={key} names={tenantNames} />;
      }
    }
    switch (marker) {
      case "landlord_signature":
        return <PendingChip key={key} label={`${landlordName} — landlord signature`} />;
      case "tenant_signatures":
        return <PendingChip key={key} label="Tenant signatures appear here once signed" />;
      case "landlord_initials":
        return <PendingChip key={key} label="Landlord initials" />;
      case "tenant_initials":
        return <PendingChip key={key} label="Your initials appear here" />;
    }
  };

  return (
    <div className="space-y-3 text-sm leading-6">
      {parseAgreementBlocks(text).map((block, bi) => (
        <div key={bi} className="whitespace-pre-line">
          {block.heading && (
            <span className="font-semibold">{block.heading} </span>
          )}
          {block.parts.map((part, idx) =>
            part.type === "text" ? (
              <span key={idx}>{part.value}</span>
            ) : (
              renderMarker(part.marker, idx)
            ),
          )}
        </div>
      ))}
    </div>
  );
}
