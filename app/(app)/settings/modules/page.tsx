import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { saveModulesAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";

const MODULE_INFO = [
  {
    key: "financials" as const,
    label: "Financials (profit & ROI)",
    description:
      "Expense log (utilities, insurance, maintenance, taxes), building mortgage terms, per-property net income, and profit cards on the dashboard. Visible only to roles with the financial capabilities.",
  },
  {
    key: "maintenance" as const,
    label: "Maintenance (jobs & monthly tasks)",
    description:
      "Per-unit job tracker (pending/completed, optional cost that flows into Financials) and recurring monthly property tasks like mowing and spraying.",
  },
  {
    key: "tenantPortal" as const,
    label: "Tenant portal",
    description:
      "Self-service portal at /portal where invited tenants sign in (email + password or SMS code — local accounts, never your staff SSO) to see their lease, balance, payment history, receipts and documents, submit maintenance requests, and set how they pay. Turning it off blocks tenant logins immediately; accounts and requests are kept.",
  },
];

export default async function ModulesSettingsPage() {
  await requireCapability("organization.settings");
  const { modules } = await getAppSettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Modules</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Turn optional features on or off. Disabling a module hides its pages,
          navigation, and dashboard sections — <span className="font-medium text-foreground">
          all of its data is kept</span> and reappears when re-enabled.
        </p>
        <form action={saveModulesAction} className="space-y-4">
          {MODULE_INFO.map((m) => (
            <label
              key={m.key}
              className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/30"
            >
              <input
                type="checkbox"
                name={m.key}
                defaultChecked={modules[m.key]}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">{m.label}</span>
                <span className="block text-sm text-muted-foreground">{m.description}</span>
              </span>
            </label>
          ))}
          <Button type="submit" size="sm">
            Save modules
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
