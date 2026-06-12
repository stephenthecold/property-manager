-- Move the purchase date from Building to Property (it describes the parcel).
ALTER TABLE "Property" ADD COLUMN "purchaseDate" TIMESTAMP(3);

-- Preserve any building-level data already entered: the property's purchase
-- date is the EARLIEST purchase date among its buildings.
UPDATE "Property" p
SET "purchaseDate" = b.earliest
FROM (
  SELECT "propertyId", MIN("purchaseDate") AS earliest
  FROM "Building"
  WHERE "purchaseDate" IS NOT NULL
  GROUP BY "propertyId"
) b
WHERE p."id" = b."propertyId";

ALTER TABLE "Building" DROP COLUMN "purchaseDate";
