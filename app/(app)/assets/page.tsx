import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { prisma } from "@/lib/db";
import { listAssets } from "@/lib/services/assets";
import {
  warrantyState,
  warrantyLabel,
  warrantyBadgeClass,
} from "@/lib/maintenance/warranty";
import { createAssetAction, setAssetActiveAction, updateAssetAction } from "./actions";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Date-only values are persisted at start-of-day in the property timezone (via
 * parseDateOnlyInZone), so render + edit-prefill them in that SAME zone — UTC
 * formatting would drift a day for properties east of UTC. Mirrors the
 * properties page (DateTime.fromJSDate(..., { zone }).toFormat(...)).
 */
function fmtDate(d: Date | null, tz: string): string {
  return d ? DateTime.fromJSDate(d, { zone: tz }).toFormat("M/d/yyyy") : "—";
}

/** YYYY-MM-DD for a date input default, in the property timezone. */
function dateInputValue(d: Date | null, tz: string): string {
  return d ? DateTime.fromJSDate(d, { zone: tz }).toFormat("yyyy-MM-dd") : "";
}

interface AssetDefaults {
  id: string;
  name: string;
  category: string | null;
  propertyId: string;
  unitId: string | null;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  installedOn: Date | null;
  warrantyExpiresOn: Date | null;
  notes: string | null;
  /** Timezone of the asset's current property — date prefill renders in it. */
  tz: string;
}

function AssetFields({
  defaults,
  properties,
  units,
}: {
  defaults?: AssetDefaults;
  properties: { id: string; name: string }[];
  units: { id: string; unitNumber: string; property: { name: string } }[];
}) {
  const k = defaults?.id ?? "new";
  return (
    <>
      {defaults && <input type="hidden" name="assetId" value={defaults.id} />}
      <div className="space-y-2">
        <Label htmlFor={`name-${k}`}>Name</Label>
        <Input
          id={`name-${k}`}
          name="name"
          required
          defaultValue={defaults?.name}
          placeholder="Water heater"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`category-${k}`}>Category</Label>
          <Input
            id={`category-${k}`}
            name="category"
            defaultValue={defaults?.category ?? ""}
            placeholder="HVAC"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`property-${k}`}>Property</Label>
          <select
            id={`property-${k}`}
            name="propertyId"
            required
            defaultValue={defaults?.propertyId ?? ""}
            className="h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">— select —</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`unit-${k}`}>Unit (optional)</Label>
        <select
          id={`unit-${k}`}
          name="unitId"
          defaultValue={defaults?.unitId ?? ""}
          className="h-9 w-full rounded-md border px-3 text-sm"
        >
          <option value="">— property-wide —</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.property.name} · {u.unitNumber}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Pick a unit only if it matches the property above.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`make-${k}`}>Make</Label>
          <Input id={`make-${k}`} name="make" defaultValue={defaults?.make ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`model-${k}`}>Model</Label>
          <Input id={`model-${k}`} name="model" defaultValue={defaults?.model ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`serial-${k}`}>Serial</Label>
          <Input
            id={`serial-${k}`}
            name="serialNumber"
            defaultValue={defaults?.serialNumber ?? ""}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`installed-${k}`}>Installed on</Label>
          <Input
            id={`installed-${k}`}
            name="installedOn"
            type="date"
            defaultValue={dateInputValue(defaults?.installedOn ?? null, defaults?.tz ?? "UTC")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`warranty-${k}`}>Warranty expires</Label>
          <Input
            id={`warranty-${k}`}
            name="warrantyExpiresOn"
            type="date"
            defaultValue={dateInputValue(defaults?.warrantyExpiresOn ?? null, defaults?.tz ?? "UTC")}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`notes-${k}`}>Notes</Label>
        <Textarea id={`notes-${k}`} name="notes" defaultValue={defaults?.notes ?? ""} />
      </div>
    </>
  );
}

export default async function AssetsPage() {
  await requireCapability("maintenance.manage");
  const settings = await getAppSettings();
  if (!settings.modules.maintenance) redirect("/dashboard");

  const [assets, properties, units] = await Promise.all([
    listAssets(),
    prisma.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.unit.findMany({
      orderBy: [{ property: { name: "asc" } }, { unitNumber: "asc" }],
      select: { id: true, unitNumber: true, property: { select: { name: true } } },
    }),
  ]);

  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Assets</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Your registry of physical equipment (water heaters, HVAC,
            appliances) with warranty awareness. An operating record only —
            assets never affect tenant balances.
          </p>
        </div>
        <FormDialog
          trigger="Add asset"
          triggerVariant="default"
          title="Add asset"
          action={createAssetAction}
          submitLabel="Add asset"
        >
          <AssetFields properties={properties} units={units} />
        </FormDialog>
      </div>

      <DataTable
        emptyMessage="No assets yet — register equipment like water heaters, HVAC units, or appliances."
        columns={[
          { key: "name", label: "Name" },
          { key: "category", label: "Category", className: "hidden sm:table-cell" },
          { key: "location", label: "Property · Unit" },
          { key: "makeModel", label: "Make / Model", className: "hidden md:table-cell" },
          { key: "serial", label: "Serial", className: "hidden lg:table-cell" },
          { key: "installed", label: "Installed", className: "hidden md:table-cell" },
          { key: "warranty", label: "Warranty" },
          { key: "status", label: "Status" },
          { key: "actions", label: "", align: "right", sortable: false },
        ]}
        rows={assets.map((a) => {
          const tz = a.property.timezone;
          const wState = warrantyState({
            warrantyExpiresOn: a.warrantyExpiresOn,
            now,
            tz,
          });
          const makeModel = [a.make, a.model].filter(Boolean).join(" ");
          return {
            key: a.id,
            sortValues: [
              a.name,
              a.category,
              `${a.property.name} ${a.unit?.unitNumber ?? ""}`.trim(),
              makeModel || null,
              a.serialNumber,
              a.installedOn?.toISOString() ?? null,
              // Sort warranty by days-to-expiry feel: expired first, then soon.
              a.warrantyExpiresOn?.toISOString() ?? null,
              a.active ? "active" : "inactive",
              null,
            ],
            cells: [
              <span
                key="n"
                className={a.active ? "font-medium" : "font-medium text-muted-foreground"}
              >
                {a.name}
              </span>,
              a.category ?? "—",
              <span key="loc" className="text-sm">
                <Link
                  href={`/properties/${a.property.id}`}
                  className="hover:underline"
                >
                  {a.property.name}
                </Link>
                {a.unit && (
                  <Link
                    href={`/units/${a.unit.id}`}
                    className="block text-xs text-muted-foreground hover:underline"
                  >
                    Unit {a.unit.unitNumber}
                  </Link>
                )}
              </span>,
              makeModel || "—",
              a.serialNumber ?? "—",
              fmtDate(a.installedOn, tz),
              <span key="w" className="inline-flex items-center gap-1">
                <Badge variant="outline" className={`font-medium ${warrantyBadgeClass(wState)}`}>
                  {warrantyLabel(wState)}
                </Badge>
                {a.warrantyExpiresOn && wState !== "none" && (
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(a.warrantyExpiresOn, tz)}
                  </span>
                )}
              </span>,
              a.active ? (
                <span key="s" className="text-emerald-600 dark:text-emerald-400">
                  Active
                </span>
              ) : (
                <span key="s" className="text-muted-foreground">
                  Inactive
                </span>
              ),
              <div key="a" className="flex justify-end gap-2">
                <FormDialog
                  trigger="Edit"
                  triggerSize="xs"
                  title={`Edit ${a.name}`}
                  action={updateAssetAction}
                  submitLabel="Save"
                >
                  <AssetFields
                    properties={properties}
                    units={units}
                    defaults={{
                      id: a.id,
                      name: a.name,
                      category: a.category,
                      propertyId: a.propertyId,
                      unitId: a.unitId,
                      make: a.make,
                      model: a.model,
                      serialNumber: a.serialNumber,
                      installedOn: a.installedOn,
                      warrantyExpiresOn: a.warrantyExpiresOn,
                      notes: a.notes,
                      tz,
                    }}
                  />
                </FormDialog>
                <form action={setAssetActiveAction}>
                  <input type="hidden" name="assetId" value={a.id} />
                  <input type="hidden" name="active" value={a.active ? "false" : "true"} />
                  <Button type="submit" variant="outline" size="xs">
                    {a.active ? "Deactivate" : "Activate"}
                  </Button>
                </form>
              </div>,
            ],
          };
        })}
      />
    </div>
  );
}
