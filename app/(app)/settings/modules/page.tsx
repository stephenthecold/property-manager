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
  {
    key: "publicSite" as const,
    label: "Public website (marketing splash)",
    description:
      "A public landing page at your public domain's root (e.g. newedgerentals.com) with a hero, an Apply button, resident/payer login links, areas served, office hours, and contact — linking to the existing privacy/terms pages. Edit the copy at Settings → Public site. Requires DNS + your reverse proxy to route the public domain to the app (see docs/PUBLIC_SITE.md). When off, the public root sends visitors to the resident login instead.",
  },
  {
    key: "mailbox" as const,
    label: "Email inbox (invoice & mail capture)",
    description:
      "Polls a configured mailbox (IMAP) into a staff Email inbox at /inbox, where emailed invoices/receipts can be reviewed and posted to Financials as expenses (the file is attached and amount/date are OCR-prefilled). Configure the mailbox at Settings → Email inbox (supports Microsoft 365 OAuth2, Gmail app passwords, and self-hosted IMAP). Capture is read-only and de-duplicated; nothing financial is created without staff review. Turning it off stops polling and hides the inbox; captured mail is kept.",
  },
  {
    key: "tenantLedgerExport" as const,
    label: "Tenant ledger export & filters",
    description:
      "Adds an Account ledger page in the resident portal (/portal/ledger) where a signed-in tenant can filter their OWN charge/payment history by date range and entry type and download it as a CSV. Strictly scoped to the logged-in tenant — they only ever see and export their own ledger. Requires the Tenant portal module to be on. Turning it off removes the ledger page, the filters, and the CSV download (the export endpoint also stops responding); nothing is deleted.",
  },
  {
    key: "portfolio" as const,
    label: "Portfolio (legal-entity grouping)",
    description:
      "Group properties by legal entity for per-entity financials. Adds an optional \"Legal entity / LLC\" field to each property; when on, Financials subtotals the net-income table by entity (with a portfolio grand total) and the Reports income summary gains an entity column. Properties with no entity set roll up under \"Unassigned\". Turning it off just hides the grouping and the field — the saved entity names are kept.",
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
