"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/app/signature-pad";
import {
  clearLandlordSignatureAction,
  saveLandlordSignatureAction,
  saveLeaseAgreementTextAction,
  saveLeaseExpirationWindowAction,
  uploadLeaseTemplateAction,
  type LeaseSettingsState,
} from "./actions";

/** Clause-text editor with placeholder docs and a reset-to-default affordance. */
export function LeaseAgreementTextForm({
  initialText,
  defaultText,
  hasOverride,
  placeholders,
}: {
  /** The currently effective text (override when set, otherwise the default). */
  initialText: string;
  defaultText: string;
  hasOverride: boolean;
  placeholders: { key: string; description: string }[];
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [state, formAction, pending] = useActionState<LeaseSettingsState, FormData>(
    async (prev, fd) => {
      const next = await saveLeaseAgreementTextAction(prev, fd);
      if (next.ok) router.refresh();
      return next;
    },
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
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

      <div className="space-y-2">
        <Label htmlFor="text">Agreement clause text</Label>
        <textarea
          id="text"
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={18}
          className="w-full rounded-md border p-3 font-mono text-xs leading-5"
        />
        <p className="text-xs text-muted-foreground">
          {hasOverride
            ? "Using custom text."
            : "Using the built-in default text."}{" "}
          Saving an empty editor (or text identical to the default) reverts to
          the built-in default.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save agreement text"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setText(defaultText)}>
          Reset to default
        </Button>
      </div>

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Available placeholders
        </summary>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {placeholders.map((p) => (
            <div key={p.key} className="flex gap-2 text-xs">
              <dt className="shrink-0 font-mono">{`{{${p.key}}}`}</dt>
              <dd className="text-muted-foreground">{p.description}</dd>
            </div>
          ))}
        </dl>
      </details>
    </form>
  );
}

/** .docx template upload (latest upload becomes the active template). */
export function LeaseTemplateUploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState<LeaseSettingsState, FormData>(
    async (prev, fd) => {
      const next = await uploadLeaseTemplateAction(prev, fd);
      if (next.ok) {
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
      return next;
    },
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
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

      <div className="space-y-2">
        <Label htmlFor="template">.docx template</Label>
        <input
          ref={fileRef}
          id="template"
          name="template"
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="text-sm"
          required
        />
        <p className="text-xs text-muted-foreground">
          Word (.docx) only, max 2 MB. Use the same {"{{placeholders}}"} as the
          agreement text above. Type each placeholder in one go without changing
          formatting mid-placeholder — simple split runs are handled, but a
          placeholder typed with formatting changes inside the braces may not be
          replaced. Unknown placeholders are left as-is in the generated file.
        </p>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload template"}
      </Button>
    </form>
  );
}

/**
 * Saved landlord signature (typed name + optional drawn PNG). Managers+ with
 * esign.manage apply it automatically when sending e-sign requests. Leaving
 * the pad empty keeps the stored drawing; Clear removes name and drawing.
 */
export function LandlordSignatureForm({
  currentName,
  signatureUrl,
  initialsUrl,
}: {
  currentName: string | null;
  /** Short-lived signed URL of the stored drawn signature, when one exists. */
  signatureUrl: string | null;
  /** Short-lived signed URL of the stored initials image, when one exists. */
  initialsUrl: string | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LeaseSettingsState, FormData>(
    async (prev, fd) => {
      const next = await saveLandlordSignatureAction(prev, fd);
      if (next.ok) router.refresh();
      return next;
    },
    {},
  );
  const [clearState, clearAction, clearPending] = useActionState<
    LeaseSettingsState,
    FormData
  >(async (prev, fd) => {
    const next = await clearLandlordSignatureAction(prev, fd);
    if (next.ok) router.refresh();
    return next;
  }, {});

  const error = state.error ?? clearState.error;
  const message = state.ok ? state.message : clearState.ok ? clearState.message : null;

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {currentName ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm">
            Saved signature: <span className="font-medium">{currentName}</span>
          </p>
          {signatureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL
            <img
              src={signatureUrl}
              alt="Saved landlord signature"
              className="max-h-16 rounded border bg-white object-contain p-1"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              No drawing saved — the typed name is used in cursive style.
            </p>
          )}
          {initialsUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL
            <img
              src={initialsUrl}
              alt="Saved landlord initials"
              className="max-h-10 rounded border bg-white object-contain p-1"
            />
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No landlord signature saved yet. E-sign requests can&apos;t be sent
          until one is set.
        </p>
      )}

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="landlord-signature-name">Signature name</Label>
          <Input
            id="landlord-signature-name"
            name="name"
            maxLength={120}
            defaultValue={currentName ?? ""}
            placeholder="e.g. Warren Properties LLC"
            required
          />
        </div>

        <div className="space-y-2">
          <Label>Drawn signature (optional)</Label>
          <SignaturePad name="signatureImage" />
          <p className="text-xs text-muted-foreground">
            Leave the pad empty to keep the current drawing. Managers and above
            apply this signature automatically when they send a lease for
            e-signature.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Drawn initials (optional)</Label>
          <SignaturePad name="initialsImage" width={220} height={110} />
          <p className="text-xs text-muted-foreground">
            Stamped wherever the agreement has a{" "}
            <code className="rounded bg-muted px-1">{"{{landlord_initials}}"}</code>{" "}
            marker. Empty pad keeps the current initials; with none saved, typed
            initials are derived from the signature name.
          </p>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save signature"}
        </Button>
      </form>

      {currentName && (
        <form action={clearAction}>
          <Button type="submit" variant="outline" disabled={clearPending}>
            {clearPending ? "Clearing…" : "Clear saved signature"}
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * Lease-expiration alert window (days). Drives both the dashboard "Lease
 * expirations" section and the weekly staff expiration digest. 1–365; blank
 * reverts to the default (60).
 */
export function LeaseExpirationWindowForm({
  currentDays,
  defaultDays,
  minDays,
  maxDays,
}: {
  currentDays: number;
  defaultDays: number;
  minDays: number;
  maxDays: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LeaseSettingsState, FormData>(
    async (prev, fd) => {
      const next = await saveLeaseExpirationWindowAction(prev, fd);
      if (next.ok) router.refresh();
      return next;
    },
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
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

      <div className="space-y-2">
        <Label htmlFor="leaseExpirationAlertDays">Alert window (days)</Label>
        <Input
          id="leaseExpirationAlertDays"
          name="leaseExpirationAlertDays"
          type="number"
          inputMode="numeric"
          min={minDays}
          max={maxDays}
          defaultValue={currentDays}
          className="max-w-[12rem]"
        />
        <p className="text-xs text-muted-foreground">
          Leases ending within this many days appear in the dashboard
          &ldquo;Lease expirations&rdquo; section and the weekly Monday digest
          emailed to staff. {minDays}–{maxDays}; leave blank to use the default
          ({defaultDays}).
        </p>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save alert window"}
      </Button>
    </form>
  );
}
