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
  /** yearlyInsuranceCents / 12 (bigint division truncates — pennies/yr, acceptable). */
  insuranceMonthlyCents: bigint;
  /** yearlyPropertyTaxCents / 12 (bigint division truncates — pennies/yr, acceptable). */
  taxesMonthlyCents: bigint;
  expensesMonthCents: bigint;
  /** collected − mortgage − insurance − taxes − expenses (this month, cash basis). */
  netMonthCents: bigint;
}

export interface MortgageProjection {
  propertyId: string;
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
    insuranceMonthlyCents: bigint;
    taxesMonthlyCents: bigint;
    expensesMonthCents: bigint;
    netMonthCents: bigint;
  };
  mortgages: MortgageProjection[];
}

export async function getFinancialSummary(now: Date): Promise<FinancialSummary> {
  const since = monthStart(now);
  const [properties, leases, paymentsByProperty, expensesByProperty] =
    await Promise.all([
      prisma.property.findMany({ orderBy: { name: "asc" } }),
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
    const hasMortgage = (p.monthlyMortgageCents ?? 0n) > 0n;
    if (hasMortgage) {
      mortgages.push({
        propertyId: p.id,
        propertyName: p.name,
        monthlyCents: p.monthlyMortgageCents ?? 0n,
        maturityDate: p.mortgageMaturityDate,
        matured: !mortgageActive(p.mortgageMaturityDate, now),
      });
    }
    const mortgage =
      hasMortgage && mortgageActive(p.mortgageMaturityDate, now)
        ? (p.monthlyMortgageCents ?? 0n)
        : 0n;
    const collected = paymentsMap.get(p.id) ?? 0n;
    const expenses = expensesMap.get(p.id) ?? 0n;
    // Yearly figures spread evenly across months; bigint division truncates
    // (up to 11¢/yr understated) — acceptable for a planning view.
    const insurance = (p.yearlyInsuranceCents ?? 0n) / 12n;
    const taxes = (p.yearlyPropertyTaxCents ?? 0n) / 12n;
    return {
      propertyId: p.id,
      propertyName: p.name,
      currency: p.currency,
      activeLeases: propLeases.length,
      expectedMonthlyCents: expected,
      collectedMonthCents: collected,
      mortgageMonthlyCents: mortgage,
      insuranceMonthlyCents: insurance,
      taxesMonthlyCents: taxes,
      expensesMonthCents: expenses,
      netMonthCents: collected - mortgage - insurance - taxes - expenses,
    };
  });

  const totals = {
    expectedMonthlyCents: sumCents(rows.map((r) => r.expectedMonthlyCents)),
    collectedMonthCents: sumCents(rows.map((r) => r.collectedMonthCents)),
    mortgageMonthlyCents: sumCents(rows.map((r) => r.mortgageMonthlyCents)),
    insuranceMonthlyCents: sumCents(rows.map((r) => r.insuranceMonthlyCents)),
    taxesMonthlyCents: sumCents(rows.map((r) => r.taxesMonthlyCents)),
    expensesMonthCents: sumCents(rows.map((r) => r.expensesMonthCents)),
    netMonthCents: 0n,
  };
  totals.netMonthCents =
    totals.collectedMonthCents -
    totals.mortgageMonthlyCents -
    totals.insuranceMonthlyCents -
    totals.taxesMonthlyCents -
    totals.expensesMonthCents;

  return { rows, totals, mortgages };
}

/** Compact numbers for the dashboard profit cards. */
export interface ProfitSnapshot {
  expensesMonthCents: bigint;
  mortgageMonthlyCents: bigint;
  /** Sum over all properties of yearlyInsuranceCents / 12 (truncating bigint division). */
  insuranceMonthlyCents: bigint;
  /** Sum over all properties of yearlyPropertyTaxCents / 12 (truncating bigint division). */
  taxesMonthlyCents: bigint;
}

export async function getProfitSnapshot(now: Date): Promise<ProfitSnapshot> {
  const [expenseAgg, properties] = await Promise.all([
    prisma.propertyExpense.aggregate({
      _sum: { amountCents: true },
      where: { incurredOn: { gte: monthStart(now) } },
    }),
    prisma.property.findMany({
      select: {
        monthlyMortgageCents: true,
        mortgageMaturityDate: true,
        yearlyInsuranceCents: true,
        yearlyPropertyTaxCents: true,
      },
    }),
  ]);
  return {
    expensesMonthCents: expenseAgg._sum.amountCents ?? 0n,
    mortgageMonthlyCents: sumCents(
      properties
        .filter(
          (p) =>
            (p.monthlyMortgageCents ?? 0n) > 0n &&
            mortgageActive(p.mortgageMaturityDate, now),
        )
        .map((p) => p.monthlyMortgageCents ?? 0n),
    ),
    insuranceMonthlyCents: sumCents(
      properties.map((p) => (p.yearlyInsuranceCents ?? 0n) / 12n),
    ),
    taxesMonthlyCents: sumCents(
      properties.map((p) => (p.yearlyPropertyTaxCents ?? 0n) / 12n),
    ),
  };
}
