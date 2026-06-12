import { prisma } from "@/lib/db";
import { sumCents } from "@/lib/money";
import { expectedMonthlyChargeCents } from "@/lib/accounting/rent";

/**
 * Financials module: operating expenses, financing (building mortgages), and
 * per-property net income. These are OPERATING records — they never touch the
 * tenant ledger (LedgerEntry stays the sole source of tenant-balance truth).
 */

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** A building mortgage counts until its maturity date passes. */
function mortgageActive(maturity: Date | null, now: Date): boolean {
  return maturity == null || maturity.getTime() > now.getTime();
}

export interface PropertyFinancialRow {
  propertyId: string;
  propertyName: string;
  currency: string;
  activeLeases: number;
  expectedMonthlyCents: bigint;
  collectedMonthCents: bigint;
  mortgageMonthlyCents: bigint;
  expensesMonthCents: bigint;
  /** collected − mortgage − expenses (this month, cash basis). */
  netMonthCents: bigint;
}

export interface MortgageProjection {
  buildingId: string;
  buildingName: string;
  propertyName: string;
  monthlyCents: bigint;
  maturityDate: Date | null;
  matured: boolean;
}

export interface FinancialSummary {
  rows: PropertyFinancialRow[];
  totals: {
    expectedMonthlyCents: bigint;
    collectedMonthCents: bigint;
    mortgageMonthlyCents: bigint;
    expensesMonthCents: bigint;
    netMonthCents: bigint;
  };
  mortgages: MortgageProjection[];
}

export async function getFinancialSummary(now: Date): Promise<FinancialSummary> {
  const since = monthStart(now);
  const [properties, leases, paymentsByProperty, expensesByProperty] =
    await Promise.all([
      prisma.property.findMany({
        orderBy: { name: "asc" },
        include: { buildings: { orderBy: { name: "asc" } } },
      }),
      prisma.lease.findMany({
        where: { status: { in: ["active", "month_to_month"] } },
        include: { unit: { select: { propertyId: true } } },
      }),
      prisma.payment.groupBy({
        by: ["propertyId"],
        _sum: { amountCents: true },
        where: { status: "posted", paymentDate: { gte: since } },
      }),
      prisma.propertyExpense.groupBy({
        by: ["propertyId"],
        _sum: { amountCents: true },
        where: { incurredOn: { gte: since } },
      }),
    ]);

  const paymentsMap = new Map(
    paymentsByProperty.map((p) => [p.propertyId, p._sum.amountCents ?? 0n]),
  );
  const expensesMap = new Map(
    expensesByProperty.map((e) => [e.propertyId, e._sum.amountCents ?? 0n]),
  );

  const mortgages: MortgageProjection[] = [];
  const rows: PropertyFinancialRow[] = properties.map((p) => {
    const propLeases = leases.filter((l) => l.unit.propertyId === p.id);
    const expected = sumCents(propLeases.map((l) => expectedMonthlyChargeCents(l)));
    const activeMortgages = p.buildings.filter(
      (b) => (b.monthlyMortgageCents ?? 0n) > 0n,
    );
    for (const b of activeMortgages) {
      mortgages.push({
        buildingId: b.id,
        buildingName: b.name,
        propertyName: p.name,
        monthlyCents: b.monthlyMortgageCents ?? 0n,
        maturityDate: b.mortgageMaturityDate,
        matured: !mortgageActive(b.mortgageMaturityDate, now),
      });
    }
    const mortgage = sumCents(
      activeMortgages
        .filter((b) => mortgageActive(b.mortgageMaturityDate, now))
        .map((b) => b.monthlyMortgageCents ?? 0n),
    );
    const collected = paymentsMap.get(p.id) ?? 0n;
    const expenses = expensesMap.get(p.id) ?? 0n;
    return {
      propertyId: p.id,
      propertyName: p.name,
      currency: p.currency,
      activeLeases: propLeases.length,
      expectedMonthlyCents: expected,
      collectedMonthCents: collected,
      mortgageMonthlyCents: mortgage,
      expensesMonthCents: expenses,
      netMonthCents: collected - mortgage - expenses,
    };
  });

  const totals = {
    expectedMonthlyCents: sumCents(rows.map((r) => r.expectedMonthlyCents)),
    collectedMonthCents: sumCents(rows.map((r) => r.collectedMonthCents)),
    mortgageMonthlyCents: sumCents(rows.map((r) => r.mortgageMonthlyCents)),
    expensesMonthCents: sumCents(rows.map((r) => r.expensesMonthCents)),
    netMonthCents: 0n,
  };
  totals.netMonthCents =
    totals.collectedMonthCents - totals.mortgageMonthlyCents - totals.expensesMonthCents;

  return { rows, totals, mortgages };
}

/** Compact numbers for the dashboard profit cards. */
export interface ProfitSnapshot {
  expensesMonthCents: bigint;
  mortgageMonthlyCents: bigint;
}

export async function getProfitSnapshot(now: Date): Promise<ProfitSnapshot> {
  const [expenseAgg, buildings] = await Promise.all([
    prisma.propertyExpense.aggregate({
      _sum: { amountCents: true },
      where: { incurredOn: { gte: monthStart(now) } },
    }),
    prisma.building.findMany({
      where: { monthlyMortgageCents: { gt: 0n } },
      select: { monthlyMortgageCents: true, mortgageMaturityDate: true },
    }),
  ]);
  return {
    expensesMonthCents: expenseAgg._sum.amountCents ?? 0n,
    mortgageMonthlyCents: sumCents(
      buildings
        .filter((b) => mortgageActive(b.mortgageMaturityDate, now))
        .map((b) => b.monthlyMortgageCents ?? 0n),
    ),
  };
}
