import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { PAYER_TYPES, payerTypeLabel } from "@/lib/payers/payer-type";
import type { PayerType } from "@/lib/generated/prisma/enums";
import {
  createPayerAction,
  setPayerActiveAction,
  updatePayerAction,
} from "./actions";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";

interface PayerDefaults {
  id: string;
  name: string;
  type: PayerType;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  mailingAddress: string | null;
  notes: string | null;
}

/** Shared add/edit fields. `defaults` (edit) prefill values + a hidden id. */
function PayerFields({ defaults }: { defaults?: PayerDefaults }) {
  const k = defaults?.id ?? "new";
  return (
    <>
      {defaults && <input type="hidden" name="payerId" value={defaults.id} />}
      <div className="space-y-2">
        <Label htmlFor={`name-${k}`}>Name</Label>
        <Input
          id={`name-${k}`}
          name="name"
          required
          defaultValue={defaults?.name}
          placeholder="Metro Housing Authority"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`type-${k}`}>Type</Label>
        <select
          id={`type-${k}`}
          name="type"
          defaultValue={defaults?.type ?? "housing_authority"}
          className="h-9 w-full rounded-md border px-3 text-sm"
        >
          {PAYER_TYPES.map((t) => (
            <option key={t} value={t}>
              {payerTypeLabel(t)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`contact-${k}`}>Contact name</Label>
          <Input id={`contact-${k}`} name="contactName" defaultValue={defaults?.contactName ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`phone-${k}`}>Phone</Label>
          <Input id={`phone-${k}`} name="phone" defaultValue={defaults?.phone ?? ""} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`email-${k}`}>Email</Label>
        <Input id={`email-${k}`} name="email" type="email" defaultValue={defaults?.email ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`addr-${k}`}>Mailing address</Label>
        <Input id={`addr-${k}`} name="mailingAddress" defaultValue={defaults?.mailingAddress ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`notes-${k}`}>Notes</Label>
        <Textarea id={`notes-${k}`} name="notes" defaultValue={defaults?.notes ?? ""} />
      </div>
    </>
  );
}

export default async function PayersPage() {
  await requireCapability("payers.manage");

  const payers = await prisma.payer.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { _count: { select: { payments: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Payers</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Third parties who pay on a tenant&apos;s behalf — e.g. a HUD/Section 8
            housing authority paying the subsidy (HAP) portion of rent. Recording
            a payment, pick the payer under &ldquo;Paid by.&rdquo; Payers are an
            attribution directory only; they never affect tenant balances.
          </p>
        </div>
        <FormDialog
          trigger="Add payer"
          triggerVariant="default"
          title="Add payer"
          action={createPayerAction}
          submitLabel="Add payer"
        >
          <PayerFields />
        </FormDialog>
      </div>

      <DataTable
        emptyMessage="No payers yet. Add a housing authority or other third-party payer."
        columns={[
          { key: "name", label: "Name" },
          { key: "type", label: "Type" },
          { key: "contact", label: "Contact", sortable: false, className: "hidden md:table-cell" },
          { key: "payments", label: "Payments", align: "right", numeric: true, className: "hidden sm:table-cell" },
          { key: "status", label: "Status" },
          { key: "actions", label: "", align: "right", sortable: false },
        ]}
        rows={payers.map((p) => ({
          key: p.id,
          sortValues: [
            p.name,
            payerTypeLabel(p.type),
            null,
            p._count.payments,
            p.isActive ? "active" : "inactive",
            null,
          ],
          cells: [
            <span key="n" className={p.isActive ? "font-medium" : "font-medium text-muted-foreground"}>
              {p.name}
            </span>,
            payerTypeLabel(p.type),
            <span key="c" className="text-sm text-muted-foreground">
              {p.contactName && <div>{p.contactName}</div>}
              {p.email && <div>{p.email}</div>}
              {p.phone && <div>{p.phone}</div>}
              {!p.contactName && !p.email && !p.phone && "—"}
            </span>,
            p._count.payments,
            p.isActive ? (
              <span key="s" className="text-emerald-600 dark:text-emerald-400">Active</span>
            ) : (
              <span key="s" className="text-muted-foreground">Inactive</span>
            ),
            <div key="a" className="flex justify-end gap-2">
              <FormDialog
                trigger="Edit"
                title={`Edit ${p.name}`}
                action={updatePayerAction}
                submitLabel="Save"
              >
                <PayerFields
                  defaults={{
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    contactName: p.contactName,
                    email: p.email,
                    phone: p.phone,
                    mailingAddress: p.mailingAddress,
                    notes: p.notes,
                  }}
                />
              </FormDialog>
              <form action={setPayerActiveAction}>
                <input type="hidden" name="payerId" value={p.id} />
                <input type="hidden" name="isActive" value={p.isActive ? "false" : "true"} />
                <Button type="submit" variant="outline" size="sm">
                  {p.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              </form>
            </div>,
          ],
        }))}
      />
    </div>
  );
}
