import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { listVendors } from "@/lib/services/vendors";
import { VENDOR_TRADES, vendorTradeLabel } from "@/lib/vendors/vendor-trade";
import type { VendorTrade } from "@/lib/generated/prisma/enums";
import {
  createVendorAction,
  setVendorActiveAction,
  updateVendorAction,
} from "./actions";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const runtime = "nodejs";

interface VendorDefaults {
  id: string;
  name: string;
  trade: VendorTrade;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  mailingAddress: string | null;
  notes: string | null;
}

function VendorFields({ defaults }: { defaults?: VendorDefaults }) {
  const k = defaults?.id ?? "new";
  return (
    <>
      {defaults && <input type="hidden" name="vendorId" value={defaults.id} />}
      <div className="space-y-2">
        <Label htmlFor={`name-${k}`}>Name</Label>
        <Input id={`name-${k}`} name="name" required defaultValue={defaults?.name} placeholder="Ace Plumbing" />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`trade-${k}`}>Trade</Label>
        <select
          id={`trade-${k}`}
          name="trade"
          defaultValue={defaults?.trade ?? "general"}
          className="h-9 w-full rounded-md border px-3 text-sm"
        >
          {VENDOR_TRADES.map((t) => (
            <option key={t} value={t}>
              {vendorTradeLabel(t)}
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

export default async function VendorsPage() {
  await requireCapability("vendors.manage");
  const settings = await getAppSettings();
  if (!settings.modules.vendors) redirect("/dashboard");

  const vendors = await listVendors();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Vendors</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Your directory of contractors and service providers. A reference list
            only — vendors never affect tenant balances.
          </p>
        </div>
        <FormDialog
          trigger="Add vendor"
          triggerVariant="default"
          title="Add vendor"
          action={createVendorAction}
          submitLabel="Add vendor"
        >
          <VendorFields />
        </FormDialog>
      </div>

      <DataTable
        emptyMessage="No vendors yet."
        columns={[
          { key: "name", label: "Name" },
          { key: "trade", label: "Trade" },
          { key: "contact", label: "Contact", className: "hidden md:table-cell" },
          { key: "status", label: "Status" },
          { key: "actions", label: "", align: "right", sortable: false },
        ]}
        rows={vendors.map((v) => ({
          key: v.id,
          sortValues: [
            v.name,
            vendorTradeLabel(v.trade),
            null,
            v.isActive ? "active" : "inactive",
            null,
          ],
          cells: [
            <span key="n" className={v.isActive ? "font-medium" : "font-medium text-muted-foreground"}>
              {v.name}
            </span>,
            vendorTradeLabel(v.trade),
            <span key="c" className="text-sm text-muted-foreground">
              {v.contactName && <div>{v.contactName}</div>}
              {v.email && <div>{v.email}</div>}
              {v.phone && <div>{v.phone}</div>}
              {!v.contactName && !v.email && !v.phone && "—"}
            </span>,
            v.isActive ? (
              <span key="s" className="text-emerald-600 dark:text-emerald-400">Active</span>
            ) : (
              <span key="s" className="text-muted-foreground">Inactive</span>
            ),
            <div key="a" className="flex justify-end gap-2">
              <FormDialog
                trigger="Edit"
                triggerSize="xs"
                title={`Edit ${v.name}`}
                action={updateVendorAction}
                submitLabel="Save"
              >
                <VendorFields
                  defaults={{
                    id: v.id,
                    name: v.name,
                    trade: v.trade,
                    contactName: v.contactName,
                    email: v.email,
                    phone: v.phone,
                    mailingAddress: v.mailingAddress,
                    notes: v.notes,
                  }}
                />
              </FormDialog>
              <form action={setVendorActiveAction}>
                <input type="hidden" name="vendorId" value={v.id} />
                <input type="hidden" name="isActive" value={v.isActive ? "false" : "true"} />
                <Button type="submit" variant="outline" size="xs">
                  {v.isActive ? "Deactivate" : "Activate"}
                </Button>
              </form>
            </div>,
          ],
        }))}
      />
    </div>
  );
}
