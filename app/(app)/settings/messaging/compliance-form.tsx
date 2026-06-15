"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  resolveComplianceLinks,
  sampleEmbeddedLink,
} from "@/lib/config/compliance";
import { saveComplianceAction, type MessagingState } from "./actions";

export interface ComplianceInitial {
  privacyPolicyText: string;
  privacyPolicyUrl: string;
  termsText: string;
  termsUrl: string;
  /** Absolute base URL (APP_URL) used to show the canonical hosted page URL. */
  baseUrl: string;
}

/** Read-only "submit this for 10DLC" line that updates as you edit. */
function ResolvedLink({
  href,
  hosted,
  hostedAt,
}: {
  href: string | null;
  hosted: boolean;
  hostedAt: string;
}) {
  if (!href) {
    return (
      <p className="text-xs text-muted-foreground">
        Add policy text to host a page at{" "}
        <span className="font-mono">{hostedAt}</span>, or paste an external link
        above.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {hosted ? "Hosted here — " : "External — "}submit this URL for 10DLC:{" "}
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-primary underline underline-offset-2"
      >
        {href}
      </a>
    </p>
  );
}

export function ComplianceForm({ initial }: { initial: ComplianceInitial }) {
  const [state, formAction, pending] = useActionState<MessagingState, FormData>(
    saveComplianceAction,
    {},
  );

  const [privacyText, setPrivacyText] = useState(initial.privacyPolicyText);
  const [privacyUrl, setPrivacyUrl] = useState(initial.privacyPolicyUrl);
  const [termsText, setTermsText] = useState(initial.termsText);
  const [termsUrl, setTermsUrl] = useState(initial.termsUrl);

  // Prefilled "dead" sample link for 10DLC registration — derived from APP_URL,
  // never stored or edited (see lib/config/compliance.ts).
  const sampleLink = sampleEmbeddedLink(initial.baseUrl);

  const resolved = resolveComplianceLinks(
    {
      privacyPolicyText: privacyText || null,
      privacyPolicyUrl: privacyUrl || null,
      termsText: termsText || null,
      termsUrl: termsUrl || null,
    },
    initial.baseUrl,
  );

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">
        Carriers require a public privacy policy and terms for A2P 10DLC
        registration. Write the policy text below to host it on this site, or
        paste a link to a page you host elsewhere (the link wins). Hosted pages
        are linked from the tenant portal footer.
      </p>

      {/* Privacy policy */}
      <div className="space-y-2 rounded-md border p-3">
        <Label htmlFor="privacyPolicyText">Privacy policy</Label>
        <textarea
          id="privacyPolicyText"
          name="privacyPolicyText"
          value={privacyText}
          onChange={(e) => setPrivacyText(e.target.value)}
          placeholder="Paste or write your privacy policy. Describe what data you collect, how SMS opt-in/opt-out works, and how to contact you."
          rows={5}
          className="w-full rounded-md border p-2 text-sm"
        />
        <Label htmlFor="privacyPolicyUrl" className="text-xs font-normal text-muted-foreground">
          …or link to an externally-hosted privacy policy
        </Label>
        <Input
          id="privacyPolicyUrl"
          name="privacyPolicyUrl"
          value={privacyUrl}
          onChange={(e) => setPrivacyUrl(e.target.value)}
          placeholder="https://example.com/privacy"
        />
        <ResolvedLink
          href={resolved.privacy.href}
          hosted={resolved.privacy.hosted}
          hostedAt={`${initial.baseUrl.replace(/\/+$/, "")}/privacy`}
        />
      </div>

      {/* Terms & conditions */}
      <div className="space-y-2 rounded-md border p-3">
        <Label htmlFor="termsText">Terms &amp; conditions</Label>
        <textarea
          id="termsText"
          name="termsText"
          value={termsText}
          onChange={(e) => setTermsText(e.target.value)}
          placeholder="Paste or write your terms. Name the messaging program, message frequency, that message/data rates may apply, and HELP/STOP instructions."
          rows={5}
          className="w-full rounded-md border p-2 text-sm"
        />
        <Label htmlFor="termsUrl" className="text-xs font-normal text-muted-foreground">
          …or link to externally-hosted terms
        </Label>
        <Input
          id="termsUrl"
          name="termsUrl"
          value={termsUrl}
          onChange={(e) => setTermsUrl(e.target.value)}
          placeholder="https://example.com/terms"
        />
        <ResolvedLink
          href={resolved.terms.href}
          hosted={resolved.terms.hosted}
          hostedAt={`${initial.baseUrl.replace(/\/+$/, "")}/terms`}
        />
      </div>

      {/* Sample embedded link — prefilled, read-only "dead" sample for 10DLC */}
      <div className="space-y-2">
        <Label>Sample embedded link</Label>
        <div
          className="select-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all"
          data-testid="sample-embedded-link"
        >
          {sampleLink}
        </div>
        <p className="text-xs text-muted-foreground">
          A representative sample of an embedded link this site sends to tenants
          (a portal login link), submitted with your A2P campaign registration.
          It is generated from your site address — read-only, carries no real
          token, and routes nowhere sensitive. Copy it into the campaign&apos;s
          sample-link field.
        </p>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save compliance links"}
      </Button>
    </form>
  );
}
