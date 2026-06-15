/**
 * Branded, chrome-free renderer for the public compliance pages (/privacy,
 * /terms). Operator-authored text is rendered whitespace-pre-wrap (no markdown,
 * no HTML — same treatment as the lease-agreement text), so there is nothing to
 * sanitize. These routes are PUBLIC_PREFIXES and carry no tenant/account data.
 */

export interface LegalDocPageProps {
  businessName: string;
  title: string;
  /** Operator-authored policy text (already known non-empty). */
  text: string;
}

export function LegalDocPage({ businessName, title, text }: LegalDocPageProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header className="space-y-1 border-b pb-4 text-center">
        <div className="text-lg font-semibold">{businessName}</div>
        <h1 className="text-2xl font-semibold tracking-wide">{title}</h1>
      </header>
      <article className="whitespace-pre-wrap text-sm leading-6">{text}</article>
      <p className="border-t pt-4 text-center text-xs text-muted-foreground">
        {businessName}
      </p>
    </div>
  );
}
