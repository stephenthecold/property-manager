-- Portfolio module (own-LLC grouping): the legal entity / LLC that owns a
-- property. Additive and nullable — no backfill, safe to deploy forward.
ALTER TABLE "Property" ADD COLUMN "legalEntityName" TEXT;
