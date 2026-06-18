-- Phase 5 — H1. Brand accent colour. Additive + nullable: existing rows get
-- NULL and keep the shipped theme. Stored as a hex string; only its OKLCH hue
-- re-tints the app shell (lib/config/brand.ts).

ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "brandColor" TEXT;
