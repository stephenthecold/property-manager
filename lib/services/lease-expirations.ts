import { prisma } from "@/lib/db";
import {
  expirationState,
  UPCOMING_DAYS,
  type ExpirationStateName,
} from "@/lib/leases/expiration";

export interface ExpiringLeaseRow {
  leaseId: string;
  tenantId: string;
  tenantName: string;
  unitLabel: string;
  propertyName: string;
  /** IANA tz of the property, for date-only formatting of endDate. */
  timezone: string;
  endDate: Date;
  state: ExpirationStateName;
  daysUntilExpiry: number;
}

/**
 * Active leases whose end date falls within `withinDays` (including ones
 * already past their end but still active), soonest end first. Read-only;
 * bridges Prisma → the pure `expirationState` — never re-implements the math.
 */
export async function expiringLeases({
  withinDays = UPCOMING_DAYS,
  now = new Date(),
}: {
  withinDays?: number;
  now?: Date;
} = {}): Promise<ExpiringLeaseRow[]> {
  const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

  const leases = await prisma.lease.findMany({
    where: {
      status: "active",
      // include already-past-end active leases (no lower bound)
      endDate: { not: null, lte: cutoff },
    },
    orderBy: { endDate: "asc" },
    include: {
      tenant: { select: { id: true, firstName: true, lastName: true } },
      unit: {
        select: {
          unitNumber: true,
          property: { select: { name: true, timezone: true } },
        },
      },
    },
  });

  return leases.map((l) => {
    // endDate is non-null by the query filter; assert for the pure call.
    const endDate = l.endDate!;
    const { state, daysUntilExpiry } = expirationState({
      endDate,
      status: "active",
      now,
    });
    return {
      leaseId: l.id,
      tenantId: l.tenant.id,
      tenantName: `${l.tenant.firstName} ${l.tenant.lastName}`,
      unitLabel: l.unit.unitNumber,
      propertyName: l.unit.property.name,
      timezone: l.unit.property.timezone,
      endDate,
      state,
      // non-null because endDate is non-null and status is active
      daysUntilExpiry: daysUntilExpiry!,
    };
  });
}
