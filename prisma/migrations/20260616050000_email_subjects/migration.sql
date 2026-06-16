-- Per-type EMAIL subject-line overrides for reminders (the email channel from
-- workstream C). Additive; blank/missing -> the shipped DEFAULT_EMAIL_SUBJECTS.
ALTER TABLE "AppSettings"
  ADD COLUMN IF NOT EXISTS "emailSubjects" JSONB NOT NULL DEFAULT '{}';
