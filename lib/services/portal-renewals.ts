import { prisma } from "@/lib/db";

/**
 * Tenant-portal view of PENDING lease-renewal offers (status "sent") — the
 * read-only surface that tells a signed-in tenant their lease is up for renewal
 * and to use the e-sign link in their email/SMS to accept. The e-sign token
 * lives only in that sent link; this never exposes it and never mutates.
 *
 * STRICTLY scoped to the passed-in session tenant id (from requirePortalSession
 * — NEVER a client-supplied id): the lease must either be billed to this tenant
 * (Lease.tenantId) OR list them as a co-tenant (LeaseTenant via `coTenants`).
 * No other tenant's offers are reachable. Reused by the portal home card.
 */

export interface PortalRenewalOffer {
  offerId: string;
  /** Proposed monthly rent — crosses the RSC→client boundary as a STRING. */
  proposedRentAmountCents: string;
  proposedEndDate: Date;
  effectiveDate: Date;
  property: { name: string; unitNumber: string; timezone: string; currency: string };
}

/**
 * Pending ("sent") renewal offers for every lease the given tenant is on, as
 * primary tenant or co-tenant. Includes the lease's property timezone/currency
 * for date + money formatting. Newest offer first.
 */
export async function listPendingRenewalsForTenant(
  tenantId: string,
): Promise<PortalRenewalOffer[]> {
  const offers = await prisma.leaseRenewalOffer.findMany({
    where: {
      status: "sent",
      // Scope to leases THIS tenant is on: primary (lease.tenantId) OR a
      // co-tenant row (lease.coTenants). Nothing else is reachable.
      lease: {
        OR: [
          { tenantId },
          { coTenants: { some: { tenantId } } },
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      lease: {
        include: {
          unit: {
            include: {
              property: {
                select: { name: true, timezone: true, currency: true },
              },
            },
          },
        },
      },
    },
  });

  return offers.map((o) => ({
    offerId: o.id,
    // bigint cents -> string for the RSC→client boundary (never a float).
    proposedRentAmountCents: o.proposedRentAmountCents.toString(),
    proposedEndDate: o.proposedEndDate,
    effectiveDate: o.effectiveDate,
    property: {
      name: o.lease.unit.property.name,
      unitNumber: o.lease.unit.unitNumber,
      timezone: o.lease.unit.property.timezone,
      currency: o.lease.unit.property.currency,
    },
  }));
}
