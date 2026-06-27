-- At most one OPEN (draft/sent) renewal offer per lease. Backstops the
-- check-then-create race in createRenewalOffer with a DB-enforced guarantee
-- (the second concurrent create fails with a unique violation instead of
-- producing a duplicate open offer). Terminal offers (accepted/declined/
-- expired/canceled) are excluded, so a lease can be renewed again later.
CREATE UNIQUE INDEX "LeaseRenewalOffer_one_open_per_lease"
  ON "LeaseRenewalOffer" ("leaseId")
  WHERE "status" IN ('draft', 'sent');
