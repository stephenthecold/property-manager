import { splitOnMarkers, type SignatureMarker } from "@/lib/esign/markers";

/**
 * Marker-aware agreement renderer (server component, themable). The frozen or
 * live agreement text renders pre-wrap; inline signature/initial markers
 * become:
 *  - mode="wet"    → ruled signature/initial lines for printing & pen signing
 *  - mode="pending"→ dashed "will appear here" placeholders on the /sign page
 * The signed ARTIFACT renders real marks separately (lib/esign/artifact.ts).
 */

export interface AgreementTextProps {
  text: string;
  mode: "wet" | "pending";
  landlordName: string;
  /** Primary tenant first, then co-tenants — one signature line each. */
  tenantNames: string[];
}

function WetSignatureLine({ name, role }: { name: string; role: string }) {
  return (
    <span className="my-4 block break-inside-avoid">
      <span className="flex items-end gap-8">
        <span className="inline-block w-64 border-b border-foreground" aria-hidden>
          &nbsp;
        </span>
        <span className="text-xs text-muted-foreground">Date: ____________</span>
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
}: AgreementTextProps) {
  const renderMarker = (marker: SignatureMarker, key: number) => {
    if (mode === "wet") {
      switch (marker) {
        case "landlord_signature":
          return <WetSignatureLine key={key} name={landlordName} role="Landlord" />;
        case "tenant_signatures":
          return (
            <span key={key} className="block">
              {tenantNames.map((n, i) => (
                <WetSignatureLine key={n} name={n} role={i === 0 ? "Tenant" : "Co-tenant"} />
              ))}
            </span>
          );
        case "landlord_initials":
          return <WetInitials key={key} names={[landlordName]} />;
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
    <div className="whitespace-pre-wrap text-sm leading-6">
      {splitOnMarkers(text).map((part, idx) =>
        part.type === "text" ? (
          <span key={idx}>{part.value}</span>
        ) : (
          renderMarker(part.marker, idx)
        ),
      )}
    </div>
  );
}
