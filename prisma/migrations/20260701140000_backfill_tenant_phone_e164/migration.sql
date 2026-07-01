-- Backfill: normalize confidently-parseable US tenant phone numbers to E.164,
-- mirroring lib/sms/phone.ts toE164 exactly. SMS providers (Telnyx/Twilio)
-- silently reject bare 10-digit numbers, and many were entered that way.
--
-- Rules (identical to toE164):
--   * 10 digits (any punctuation/spacing)      -> +1XXXXXXXXXX
--   * 11 digits with a leading country "1"     -> +1XXXXXXXXXX
--   * already starts with "+", or any other    -> LEFT UNTOUCHED (never corrupt
--     a number we don't understand; it normalizes on next save / at send time).
--
-- The two updates are disjoint by digit length and both skip "+"-prefixed rows,
-- so re-running is a no-op (idempotent).

-- 10 digits -> +1XXXXXXXXXX
UPDATE "Tenant"
SET "phone" = '+1' || regexp_replace("phone", '[^0-9]', '', 'g')
WHERE "phone" IS NOT NULL
  AND left(btrim("phone", E' \t\n\r'), 1) <> '+'
  AND length(regexp_replace("phone", '[^0-9]', '', 'g')) = 10;

-- 11 digits with a leading "1" -> +1XXXXXXXXXX
UPDATE "Tenant"
SET "phone" = '+' || regexp_replace("phone", '[^0-9]', '', 'g')
WHERE "phone" IS NOT NULL
  AND left(btrim("phone", E' \t\n\r'), 1) <> '+'
  AND length(regexp_replace("phone", '[^0-9]', '', 'g')) = 11
  AND left(regexp_replace("phone", '[^0-9]', '', 'g'), 1) = '1';
