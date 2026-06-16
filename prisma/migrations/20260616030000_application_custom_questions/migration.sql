-- Operator-defined custom application questions: a config array on AppSettings
-- and a per-application display snapshot of the answers. Both additive/nullable;
-- existing applications and the default form are unaffected.
ALTER TABLE "AppSettings"
  ADD COLUMN IF NOT EXISTS "applicationCustomSections" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "RentalApplication"
  ADD COLUMN IF NOT EXISTS "customAnswers" JSONB;
