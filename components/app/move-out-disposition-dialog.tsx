"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, fromCents, toCents } from "@/lib/money";
import {
  computeDisposition,
  validateDeductions,
  type DepositDeduction,
} from "@/lib/accounting/deposit-disposition";
import {
  startDispositionAction,
  saveDispositionDraftAction,
  finalizeDispositionAction,
  discardDispositionAction,
  type DispositionActionResult,
} from "@/app/(app)/tenants/[id]/disposition-actions";
import type { SerializedDisposition } from "@/lib/services/deposit-disposition";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** A deduction line in the editor; `amount` is the raw decimal-dollars input. */
interface Line {
  id: number;
  label: string;
  amount: string;
}

/**
 * Move-out deposit settlement. Staff itemize damages/cleaning against the held
 * deposit; the live preview shows what deposit is applied, what cash is
 * refunded, and what the tenant still owes — recomputed from the same pure math
 * the server uses. FINALIZE posts the settlement to the ledger (damages as a
 * positive adjustment, the applied deposit as a negative credit) and snapshots
 * the totals. Until then it's an editable draft with no ledger impact.
 */
export function MoveOutDispositionDialog({
  leaseId,
  currency,
  currentBalanceCents,
  defaultDepositHeldCents,
  disposition,
  trigger,
}: {
  leaseId: string;
  currency: string;
  /** Live lease balance = SUM(LedgerEntry.amountCents): + owed, − credit. */
  currentBalanceCents: string;
  /** Default refundable deposit (base security + refundable extras), cents. */
  defaultDepositHeldCents: string;
  /** Existing draft / finalized disposition for this lease, if any. */
  disposition: SerializedDisposition | null;
  /** Trigger label. */
  trigger: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Next id for appended/reseeded lines. Seeded past the initial rows so ids
  // never collide; only ever touched in event handlers, never during render.
  const lineId = useRef(disposition?.deductions?.length ?? 0);

  const heldFor = (d: SerializedDisposition | null) =>
    fromCents(BigInt(d?.depositHeldCents ?? defaultDepositHeldCents));
  // Build editor lines from serialized deductions; uses the id counter, so call
  // only from event handlers (reseed after an action), never during render.
  const linesFrom = (d: SerializedDisposition | null): Line[] =>
    (d?.deductions ?? []).map((x) => ({
      id: lineId.current++,
      label: x.label,
      amount: fromCents(BigInt(x.amountCents)),
    }));

  const [disp, setDisp] = useState<SerializedDisposition | null>(disposition);
  const [held, setHeld] = useState<string>(() => heldFor(disposition));
  const [lines, setLines] = useState<Line[]>(() =>
    (disposition?.deductions ?? []).map((x, i) => ({
      id: i,
      label: x.label,
      amount: fromCents(BigInt(x.amountCents)),
    })),
  );
  const [notes, setNotes] = useState<string>(disposition?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const reseed = (d: SerializedDisposition | null) => {
    setDisp(d);
    setHeld(heldFor(d));
    setLines(linesFrom(d));
    setNotes(d?.notes ?? "");
  };

  const isFinalized = disp?.status === "finalized";

  // ---- Live preview (draft only) -----------------------------------------
  const balanceCents = (() => {
    try {
      return BigInt(currentBalanceCents);
    } catch {
      return 0n;
    }
  })();
  const centsOrNull = (s: string): bigint | null => {
    const t = s.trim();
    if (!t) return null;
    try {
      return toCents(t);
    } catch {
      return null;
    }
  };
  const heldCents = centsOrNull(held) ?? 0n;
  const previewDeductions: DepositDeduction[] = lines.map((l) => ({
    label: l.label.trim(),
    amountCents: centsOrNull(l.amount) ?? 0n,
  }));
  const preview = computeDisposition({
    balanceCents,
    depositHeldCents: heldCents < 0n ? 0n : heldCents,
    deductions: previewDeductions,
  });

  // ---- Mutations ---------------------------------------------------------
  const run = (
    fn: () => Promise<DispositionActionResult>,
    onOk?: (r: DispositionActionResult) => void,
  ) => {
    setError(undefined);
    setMessage(undefined);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "Something went wrong.");
        return;
      }
      if (r.message) setMessage(r.message);
      onOk?.(r);
    });
  };

  const onStart = () =>
    run(
      () => startDispositionAction(leaseId),
      (r) => reseed(r.disposition ?? null),
    );

  /** Build + client-validate the draft payload; returns null on a bad line. */
  const buildPayload = () => {
    if (heldCents < 0n) {
      setError("Deposit held cannot be negative.");
      return null;
    }
    const cleaned = lines.filter((l) => l.label.trim() || l.amount.trim());
    const deductions: { label: string; amountCents: string }[] = [];
    const checkable: DepositDeduction[] = [];
    for (const l of cleaned) {
      const c = centsOrNull(l.amount);
      if (c == null) {
        setError(`Deduction "${l.label || "(unlabeled)"}" has an invalid amount.`);
        return null;
      }
      checkable.push({ label: l.label.trim(), amountCents: c });
      deductions.push({ label: l.label.trim(), amountCents: c.toString() });
    }
    const v = validateDeductions(checkable);
    if (!v.ok) {
      setError(v.error);
      return null;
    }
    return {
      dispositionId: disp!.id,
      depositHeldCents: heldCents.toString(),
      deductions,
      notes: notes.trim() || null,
    };
  };

  const onSave = () => {
    const payload = buildPayload();
    if (!payload) return;
    run(
      () => saveDispositionDraftAction(payload),
      (r) => reseed(r.disposition ?? null),
    );
  };

  const onFinalize = () => {
    const payload = buildPayload();
    if (!payload) return;
    run(
      () => finalizeDispositionAction(payload),
      (r) => {
        setDisp(r.disposition ?? null);
        router.refresh();
      },
    );
  };

  const onDiscard = () => {
    if (!disp) return;
    run(
      () => discardDispositionAction(disp.id),
      () => {
        reseed(null);
        router.refresh();
      },
    );
  };

  const money = (cents: bigint) => formatCurrency(cents, currency);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {trigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Move-out deposit settlement</DialogTitle>
          <DialogDescription>
            Itemize move-out deductions against the held deposit. Finalizing
            posts the settlement to the ledger — damages as a charge, the applied
            deposit as a credit — and records the refund due. Postings are
            append-only; corrections are offsetting entries.
          </DialogDescription>
        </DialogHeader>

        {/* ---- No disposition yet ---- */}
        {!disp && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Current lease balance:{" "}
              <span className="font-medium tabular-nums text-foreground">
                {money(balanceCents)}
              </span>{" "}
              ({balanceCents > 0n ? "owed" : balanceCents < 0n ? "credit" : "settled"}).
              Default refundable deposit:{" "}
              <span className="font-medium tabular-nums text-foreground">
                {money(BigInt(defaultDepositHeldCents))}
              </span>
              .
            </p>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button onClick={onStart} disabled={pending} className="w-full">
              {pending ? "Starting…" : "Start settlement"}
            </Button>
          </div>
        )}

        {/* ---- Finalized: read-only statement ---- */}
        {disp && isFinalized && (
          <div className="space-y-3 text-sm">
            <Row label="Balance at settlement" value={money(BigInt(disp.balanceAtFinalizeCents ?? "0"))} />
            <Row label="Damages charged" value={money(BigInt(disp.damagesTotalCents ?? "0"))} />
            <Row label="Deposit applied" value={money(BigInt(disp.depositAppliedCents ?? "0"))} />
            <div className="border-t pt-3">
              <Row
                label="Refund due to tenant"
                value={money(BigInt(disp.refundDueCents ?? "0"))}
                strong
                tone="credit"
              />
              <Row
                label="Balance still owed"
                value={money(BigInt(disp.balanceOwedCents ?? "0"))}
                strong
                tone={BigInt(disp.balanceOwedCents ?? "0") > 0n ? "owed" : undefined}
              />
            </div>
            {disp.deductions.length > 0 && (
              <div className="border-t pt-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Deductions</p>
                <ul className="space-y-1">
                  {disp.deductions.map((d, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{d.label}</span>
                      <span className="tabular-nums">{money(BigInt(d.amountCents))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {disp.notes && (
              <p className="border-t pt-3 text-muted-foreground whitespace-pre-wrap">{disp.notes}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Finalized{disp.finalizedAt ? ` ${new Date(disp.finalizedAt).toLocaleDateString()}` : ""}.
              The refund is paid out separately; record it as a normal payout.
            </p>
          </div>
        )}

        {/* ---- Draft: editor ---- */}
        {disp && !isFinalized && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="depositHeld">Refundable deposit held</Label>
              <Input
                id="depositHeld"
                inputMode="decimal"
                value={held}
                onChange={(e) => setHeld(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Defaulted from the lease (security + refundable extras); edit if
                the held amount differs.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Deductions</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setLines((ls) => [...ls, { id: lineId.current++, label: "", amount: "" }])
                  }
                >
                  Add line
                </Button>
              </div>
              {lines.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No deductions — the full deposit is refundable.
                </p>
              )}
              {lines.map((l, idx) => (
                <div key={l.id} className="flex items-center gap-2">
                  <Input
                    aria-label={`Deduction ${idx + 1} label`}
                    placeholder="Carpet cleaning"
                    value={l.label}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)),
                      )
                    }
                  />
                  <Input
                    aria-label={`Deduction ${idx + 1} amount`}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-28"
                    value={l.amount}
                    onChange={(e) =>
                      setLines((ls) =>
                        ls.map((x) => (x.id === l.id ? { ...x, amount: e.target.value } : x)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove deduction ${idx + 1}`}
                    onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="dispNotes">Notes</Label>
              <Textarea
                id="dispNotes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional context for the settlement (kept on the record)."
              />
            </div>

            {/* Live preview */}
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <Row label="Lease balance" value={money(balanceCents)} />
              <Row label="Damages (deductions)" value={money(preview.damagesTotalCents)} />
              <Row label="Deposit held" value={money(heldCents < 0n ? 0n : heldCents)} />
              <Row label="Deposit applied" value={money(preview.depositAppliedCents)} />
              <div className="border-t pt-2">
                <Row
                  label="Refund due to tenant"
                  value={money(preview.refundDueCents)}
                  strong
                  tone="credit"
                />
                <Row
                  label="Balance still owed"
                  value={money(preview.balanceOwedCents)}
                  strong
                  tone={preview.balanceOwedCents > 0n ? "owed" : undefined}
                />
              </div>
            </div>

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

            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={onDiscard}
                disabled={pending}
                className="text-muted-foreground"
              >
                Discard draft
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onSave} disabled={pending}>
                  Save draft
                </Button>
                <Button type="button" onClick={onFinalize} disabled={pending}>
                  {pending ? "Working…" : "Finalize settlement"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "credit" | "owed";
}) {
  const toneClass =
    tone === "credit"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "owed"
        ? "text-red-600 dark:text-red-400"
        : "";
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""} ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}
