-- Public /vacancies browse page master switch. ADDITIVE ONLY — one new
-- non-null AppSettings column, defaulting on. The page also requires the
-- publicSite module to be enabled (see app/vacancies/page.tsx).
ALTER TABLE "AppSettings" ADD COLUMN "showVacancies" BOOLEAN NOT NULL DEFAULT true;
