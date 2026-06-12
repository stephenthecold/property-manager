"use client";

import * as React from "react";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignaturePad } from "@/components/app/signature-pad";
import { initialsFromName } from "@/lib/esign/markers";
import { signAction, type SignActionState } from "./actions";

/**
 * Tenant signing form: typed-name OR drawn signature, plus the ESIGN-style
 * consent checkbox. When the agreement has {{tenant_initials}} markers, an
 * initials section (typed, prefilled from the name, or drawn) is required —
 * the captured initials are stamped at every marker. Submits to the
 * token-authenticated public action; all errors come back as returned state.
 * On success the form is replaced by a confirmation panel.
 */
export function SignForm({
  token,
  signerName,
  needsInitials = false,
}: {
  token: string;
  signerName: string;
  needsInitials?: boolean;
}) {
  const [mode, setMode] = React.useState<"typed" | "drawn">("typed");
  const [typedName, setTypedName] = React.useState("");
  const [drawnEmpty, setDrawnEmpty] = React.useState(true);
  const [initialsMode, setInitialsMode] = React.useState<"typed" | "drawn">("typed");
  const [typedInitials, setTypedInitials] = React.useState(() =>
    initialsFromName(signerName),
  );
  const [drawnInitialsEmpty, setDrawnInitialsEmpty] = React.useState(true);
  const [consent, setConsent] = React.useState(false);
  const [state, formAction, pending] = useActionState<SignActionState, FormData>(
    signAction,
    {},
  );

  if (state.ok) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-800 dark:bg-emerald-950">
        <div className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">
          Signed — thank you!
        </div>
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
          Your signature has been recorded. You&apos;ll receive the final copy
          of the agreement from your property manager.
        </p>
      </div>
    );
  }

  const signatureMissing =
    mode === "typed" ? typedName.trim().length === 0 : drawnEmpty;
  const initialsMissing =
    needsInitials &&
    (initialsMode === "typed"
      ? typedInitials.trim().length === 0
      : drawnInitialsEmpty);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="kind" value={mode} />
      {needsInitials && (
        <input type="hidden" name="initialsKind" value={initialsMode} />
      )}

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <Tabs
        value={mode}
        onValueChange={(v) => setMode(v === "drawn" ? "drawn" : "typed")}
      >
        <TabsList className="w-full">
          <TabsTrigger value="typed">Type your name</TabsTrigger>
          <TabsTrigger value="drawn">Draw your signature</TabsTrigger>
        </TabsList>

        <TabsContent value="typed" className="space-y-3 pt-2">
          <div className="space-y-2">
            <Label htmlFor="signatureText">Full legal name</Label>
            <Input
              id="signatureText"
              name="signatureText"
              maxLength={120}
              placeholder={signerName}
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="rounded-md border bg-muted/30 px-4 py-3">
            <div
              className="min-h-9 font-serif text-2xl italic"
              aria-label="Signature preview"
            >
              {typedName.trim() || " "}
            </div>
            <div className="mt-1 border-t pt-1 text-xs text-muted-foreground">
              Signature preview
            </div>
          </div>
        </TabsContent>

        <TabsContent value="drawn" className="pt-2">
          <SignaturePad name="signatureImage" onEmptyChange={setDrawnEmpty} />
        </TabsContent>
      </Tabs>

      {needsInitials && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="text-sm font-medium">Your initials</div>
          <p className="text-xs text-muted-foreground">
            This agreement marks one or more places for your initials — they are
            applied at every marked spot.
          </p>
          <Tabs
            value={initialsMode}
            onValueChange={(v) => setInitialsMode(v === "drawn" ? "drawn" : "typed")}
          >
            <TabsList className="w-full">
              <TabsTrigger value="typed">Type initials</TabsTrigger>
              <TabsTrigger value="drawn">Draw initials</TabsTrigger>
            </TabsList>
            <TabsContent value="typed" className="space-y-2 pt-2">
              <Label htmlFor="initialsText">Initials</Label>
              <Input
                id="initialsText"
                name="initialsText"
                maxLength={8}
                value={typedInitials}
                onChange={(e) => setTypedInitials(e.target.value)}
                className="w-28 font-serif text-lg italic"
              />
            </TabsContent>
            <TabsContent value="drawn" className="pt-2">
              <SignaturePad
                name="initialsImage"
                width={220}
                height={110}
                onEmptyChange={setDrawnInitialsEmpty}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="consent"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I agree that my electronic signature is the legal equivalent of my
          handwritten signature, and I consent to conduct this transaction and
          sign this agreement electronically.
        </span>
      </label>

      <Button
        type="submit"
        className="w-full"
        disabled={pending || !consent || signatureMissing || initialsMissing}
      >
        {pending ? "Signing…" : "Sign agreement"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Signing as {signerName}. Your IP address and browser details are
        recorded as signing evidence.
      </p>
    </form>
  );
}
