import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { authorizeApiCapability } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import {
  BACK_RENT_HEADERS,
  EXPIRATION_HEADERS,
  getBackRent,
  getIncomeSummary,
  getLeaseExpirations,
  getOverdue,
  getPaymentMethodSummary,
  getRentRoll,
  getTenantLedger,
  getUnitLedger,
  INCOME_HEADERS,
  LEDGER_HEADERS,
  METHOD_HEADERS,
  RENT_ROLL_HEADERS,
  UNIT_LEDGER_HEADERS,
  toCsv,
} from "@/lib/services/reports";

export const runtime = "nodejs";

const INVALID = Symbol("invalid");

/** A plausible cuid (lowercase alphanumeric). Bounds an otherwise-free id param
 * before it reaches a ledger-enumerating query — defense in depth (Prisma
 * already parameterizes). */
function isLikelyId(v: string): boolean {
  return /^[a-z0-9]{20,40}$/.test(v);
}

/**
 * Parse an optional "yyyy-MM-dd" param as a bound in `tz`; `endOfDay` makes it
 * inclusive. Bounds are civil days in the report's timezone (the property's tz
 * when a property is selected, else DEFAULT_TIMEZONE) so they line up with the
 * property-tz month bucketing instead of dropping boundary rows at UTC edges.
 */
function parseDay(
  v: string | null,
  tz: string,
  endOfDay = false,
): Date | undefined | typeof INVALID {
  if (v == null || v === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return INVALID;
  const dt = DateTime.fromISO(v, { zone: tz });
  if (!dt.isValid) return INVALID;
  return (endOfDay ? dt.endOf("day") : dt.startOf("day")).toJSDate();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  // Financial CSV exports (incl. arbitrary tenant/unit ledgers by id) require
  // the reports capability — closes ledger enumeration by a read-only viewer.
  const auth = await authorizeApiCapability("reports.view");
  if (!auth.ok) {
    return new NextResponse(auth.status === 401 ? "Unauthorized" : "Forbidden", {
      status: auth.status,
    });
  }

  const { type } = await params;
  const q = new URL(req.url).searchParams;
  const now = new Date();

  let rows: Record<string, string>[];
  let headers: readonly string[];
  if (type === "rent-roll") {
    rows = (await getRentRoll(now)) as unknown as Record<string, string>[];
    headers = RENT_ROLL_HEADERS;
  } else if (type === "overdue") {
    rows = (await getOverdue(now)) as unknown as Record<string, string>[];
    headers = RENT_ROLL_HEADERS;
  } else if (type === "back-rent") {
    rows = (await getBackRent(now)) as unknown as Record<string, string>[];
    headers = BACK_RENT_HEADERS;
  } else if (type === "tenant-ledger") {
    const tenantId = q.get("tenantId");
    if (!tenantId || !isLikelyId(tenantId)) {
      return new NextResponse("Valid tenantId is required", { status: 400 });
    }
    rows = (await getTenantLedger(tenantId)) as unknown as Record<
      string,
      string
    >[];
    headers = LEDGER_HEADERS;
  } else if (type === "unit-ledger") {
    const unitId = q.get("unitId");
    if (!unitId || !isLikelyId(unitId)) {
      return new NextResponse("Valid unitId is required", { status: 400 });
    }
    rows = (await getUnitLedger(unitId)) as unknown as Record<string, string>[];
    headers = UNIT_LEDGER_HEADERS;
  } else if (type === "income") {
    const propertyId = q.get("propertyId") ?? undefined;
    const property = propertyId
      ? await prisma.property.findUnique({ where: { id: propertyId } })
      : null;
    const tz = property?.timezone ?? getEnv().DEFAULT_TIMEZONE;
    const from = parseDay(q.get("from"), tz);
    const to = parseDay(q.get("to"), tz, true);
    if (from === INVALID || to === INVALID) {
      return new NextResponse("Invalid date (expected yyyy-MM-dd)", {
        status: 400,
      });
    }
    rows = (await getIncomeSummary(
      { from, to, propertyId },
      now,
    )) as unknown as Record<string, string>[];
    headers = INCOME_HEADERS;
  } else if (type === "lease-expirations") {
    const raw = q.get("windowDays");
    let windowDays: number | undefined;
    if (raw != null && raw !== "") {
      if (!/^\d+$/.test(raw)) {
        return new NextResponse("Invalid windowDays", { status: 400 });
      }
      // Clamp to 10 years so a huge value can't drive an unbounded scan.
      windowDays = Math.min(Number(raw), 3650);
    }
    rows = (await getLeaseExpirations({ windowDays }, now)) as unknown as Record<
      string,
      string
    >[];
    headers = EXPIRATION_HEADERS;
  } else if (type === "payment-methods") {
    const tz = getEnv().DEFAULT_TIMEZONE;
    const from = parseDay(q.get("from"), tz);
    const to = parseDay(q.get("to"), tz, true);
    if (from === INVALID || to === INVALID) {
      return new NextResponse("Invalid date (expected yyyy-MM-dd)", {
        status: 400,
      });
    }
    rows = (await getPaymentMethodSummary({ from, to })) as unknown as Record<
      string,
      string
    >[];
    headers = METHOD_HEADERS;
  } else {
    return new NextResponse("Unknown report", { status: 404 });
  }

  const csv = toCsv([...headers], rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}.csv"`,
    },
  });
}
