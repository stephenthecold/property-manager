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
  {
    key: "applications" as const,
    label: "Rental applications",
    description:
      "Public application form at /apply that prospective tenants submit (no login). Staff review submissions at Applications, change status, email/text the apply link to a prospect, and convert an approved applicant into a tenant. Turning it off hides the form and the staff page; submissions are kept.",
  },
  {
    key: "payerPortal" as const,
    label: "Payer portal",
    description:
      "Self-service portal at /payer-portal where invited third-party payers (e.g. a HUD/Section 8 housing authority) sign in (email + password — local accounts, never your staff SSO) to a read-only view of the leases they pay, their expected share, and what they've paid. Invite/enable payers from the Payers page. Turning it off blocks payer logins immediately; the Payers directory and all data are kept.",
  },
  {
    key: "notices" as const,
    label: "Notices",
    description:
      "Formal landlord notices to a tenant (late-rent / pay-or-quit, lease violation, notice to quit, non-renewal, rent increase). Generate from a per-type template prefilled with the lease's details, edit, then mark served (with date + method) and print. The text is snapshotted so what was served is immutable. Turning it off hides the Notices page; all notices are kept. NOTE: the default templates are starting points — review them against your local/state requirements before serving.",
  },
  {
    key: "inspections" as const,
    label: "Inspections & deposit disposition",
    description:
      "Schedule and record property-condition inspections (move-in, move-out, routine). A move-out inspection drives a deposit disposition: itemize deductions against the lease's refundable deposit and the refund is computed for you. Inspections are operating records — they never touch tenant ledger balances. Turning it off hides the Inspections page; all records are kept.",
  },
  {
    key: "vendors" as const,
    label: "Vendors",
    description:
      "A directory of contractors and service providers (plumber, electrician, HVAC, landscaper, cleaner, …) with trade, contact details, and notes. A reference list only — vendors never affect tenant balances. Turning it off hides the Vendors page; all entries are kept.",
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
