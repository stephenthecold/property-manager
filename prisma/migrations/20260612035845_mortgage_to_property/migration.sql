-- Move financing from Building to Property (one mortgage per property).
ALTER TABLE "Property" ADD COLUMN "monthlyMortgageCents" BIGINT,
                       ADD COLUMN "mortgageMaturityDate" TIMESTAMP(3);

-- Preserve any building-level data already entered: sum the monthly payments
-- per property and keep the latest maturity among mortgaged buildings.
UPDATE "Property" p
SET "monthlyMortgageCents" = b.total,
    "mortgageMaturityDate" = b.maturity
FROM (
  SELECT "propertyId",
         SUM("monthlyMortgageCents") AS total,
         MAX("mortgageMaturityDate") AS maturity
  FROM "Building"
  WHERE "monthlyMortgageCents" IS NOT NULL
    AND "monthlyMortgageCents" > 0
  GROUP BY "propertyId"
) b
WHERE p."id" = b."propertyId";

ALTER TABLE "Building" DROP COLUMN "monthlyMortgageCents",
                       DROP COLUMN "mortgageMaturityDate";
