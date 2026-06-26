/**
 * Best-effort tenant/lease matching for a parsed payment email. PURE — operates
 * on a pre-fetched list of active leases so it's unit-tested without a DB.
 *
 * SAFE BY DESIGN: only suggests when a payer's FULL name (first AND last)
 * matches exactly one active lease. First-name-only ("James"), invoice codes,
 * and ambiguous matches return null — staff then pick the lease manually. This
 * only pre-selects a dropdown; it never posts a payment.
 */

export interface LeaseMatchOption {
  leaseId: string;
  tenantFirst: string;
  tenantLast: string;
}

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

export function suggestLeaseId(
  payerName: string | null | undefined,
  options: LeaseMatchOption[],
): string | null {
  if (!payerName) return null;
  const parts = new Set(norm(payerName).split(" ").filter(Boolean));
  if (parts.size < 2) return null; // need at least two name tokens to be confident

  const matches = options.filter((o) => {
    const first = norm(o.tenantFirst);
    const last = norm(o.tenantLast);
    return !!first && !!last && parts.has(first) && parts.has(last);
  });
  // Only suggest on a UNIQUE full-name match — never guess on ambiguity.
  return matches.length === 1 ? matches[0].leaseId : null;
}
