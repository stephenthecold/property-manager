/**
 * Built-in lease-agreement clause text. Rendered on the printable agreement
 * page with `renderTemplate` (single-pass `{{var}}` substitution) and shown in
 * Settings → Leases as the starting point for a custom template. Plain text;
 * the page renders it with `whitespace-pre-line`.
 *
 * AppSettings.leaseAgreementText overrides this when set (null = use this).
 */

export const DEFAULT_LEASE_AGREEMENT_TEXT = `This Residential Lease Agreement ("Agreement") is made on {{today}} between {{business_legal_name}} ("Landlord") and {{tenant_names}} ("Tenant"), for the premises at {{property_address}}, Unit {{unit}} (the "Premises").

1. TERM. The tenancy begins on {{start_date}}. End of term: {{end_date}}. A month-to-month tenancy continues until either party gives written notice as required by applicable law.

2. RENT. Tenant shall pay rent of {{rent}} per month, due in advance on the {{due_day}} day of each month. A grace period of {{grace_days}} day(s) applies. {{late_fee_terms}}

3. SECURITY DEPOSIT. Tenant shall pay a security deposit of {{security_deposit}}, to be held and returned in accordance with applicable law, less lawful deductions for unpaid rent, damage beyond normal wear and tear, and other amounts owed under this Agreement. Additional deposits: {{additional_deposits}}.

4. UTILITIES. Landlord pays for the following utilities and services: {{utilities_landlord}}. Tenant is responsible for arranging and paying for: {{utilities_tenant}}. {{utilities_notes}}

5. INTERNET. Internet service: {{internet}}.

6. OCCUPANCY AND USE. The Premises shall be occupied only by the tenant(s) named in this Agreement and used solely as a private residence. Guests remaining more than fourteen (14) consecutive days require Landlord's prior written consent. Tenant shall not engage in any unlawful activity on the Premises.

7. MAINTENANCE AND REPAIRS. Tenant shall keep the Premises clean and sanitary, dispose of waste properly, and promptly notify Landlord of any condition requiring repair. Tenant shall not make alterations to the Premises without Landlord's prior written consent. Landlord shall maintain the Premises in a habitable condition as required by law.

8. RIGHT OF ENTRY. Landlord may enter the Premises to inspect, make repairs, or show the Premises to prospective tenants or purchasers after giving reasonable advance notice as required by applicable law, and at any time without notice in the case of emergency.

9. CONDITION OF PREMISES. Tenant acknowledges that the Premises are in good order and repair unless otherwise noted in writing at move-in, and agrees to return the Premises in the same condition, normal wear and tear excepted.

10. ENTIRE AGREEMENT. This Agreement, together with any written addenda, constitutes the entire agreement between the parties and may be amended only in a writing signed by both parties. If any provision is held invalid, the remainder of this Agreement remains in effect.

IN WITNESS WHEREOF, the parties have executed this Agreement as of the date written beside each signature below.

LANDLORD:
{{landlord_signature}}

TENANT(S):
{{tenant_signatures}}`;

/** Placeholder reference shown under the Settings → Leases editor and used by .docx templates. */
export const LEASE_AGREEMENT_PLACEHOLDERS: { key: string; description: string }[] = [
  { key: "business_name", description: "Business (brand) name" },
  { key: "business_legal_name", description: "Legal business name (falls back to business name)" },
  { key: "business_address", description: "Business address (single line)" },
  { key: "business_phone", description: "Business contact phone" },
  { key: "business_email", description: "Business contact email" },
  { key: "tenant_names", description: "Primary tenant and all co-tenants, comma-separated" },
  { key: "primary_tenant", description: "Primary (billing) tenant name" },
  { key: "co_tenants", description: "Co-tenant names, or — when none" },
  { key: "property_name", description: "Property name" },
  { key: "property_address", description: "Property street address" },
  { key: "unit", description: "Unit number" },
  { key: "start_date", description: "Lease start date" },
  { key: "end_date", description: "Lease end date, or “month-to-month”" },
  { key: "rent", description: "Monthly rent (formatted)" },
  { key: "due_day", description: "Rent due day as an ordinal (1st, 15th)" },
  { key: "grace_days", description: "Grace period in days" },
  { key: "late_fee_terms", description: "Late-fee policy as a sentence" },
  { key: "security_deposit", description: "Security deposit (formatted)" },
  { key: "additional_deposits", description: "Itemized extra deposits, or — when none" },
  { key: "internet", description: "Internet add-on (“Included at …/month” or “Not included”)" },
  { key: "utilities_landlord", description: "Utilities the landlord pays, or “None”" },
  { key: "utilities_tenant", description: "Utilities the tenant pays, or “None”" },
  { key: "utilities_notes", description: "Free-text utility notes (empty when none)" },
  { key: "today", description: "Today's date (property timezone)" },
  // Signature markers (built-in agreement + e-sign only; a .docx template
  // keeps them as literal text). Place them anywhere — even mid-clause.
  { key: "tenant_signatures", description: "Signature block for every tenant signer — print: ruled lines; e-sign: the captured signatures" },
  { key: "tenant_initials", description: "Each tenant's initials inline — print: small ruled boxes; e-sign: captured initials (signers are asked to initial)" },
  { key: "landlord_signature", description: "Landlord signature block (saved signature on e-sign)" },
  { key: "landlord_initials", description: "Landlord initials inline (saved initials image, or derived from the signature name)" },
];
