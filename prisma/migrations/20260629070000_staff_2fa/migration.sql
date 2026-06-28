-- Optional staff 2FA (TOTP). Additive and forward-only — no existing rows change
-- behaviour: every column is nullable or defaults off, so an install with 2FA
-- never enrolled and require2fa off behaves exactly as before.
--
-- User: the TOTP base32 secret is AES-256-GCM encrypted at rest (ciphertext +
-- nonce + tag, like the OIDC/SMS/email secrets). totpConfirmedAt is NULL until
-- the user proves a live code (enrollment complete); non-NULL means 2FA is
-- active and required at login. totpBackupCodes is a JSON array of
-- { hash, usedAt } one-time recovery codes (argon2id-hashed).
ALTER TABLE "User" ADD COLUMN "totpSecretCiphertext" TEXT;
ALTER TABLE "User" ADD COLUMN "totpSecretNonce" TEXT;
ALTER TABLE "User" ADD COLUMN "totpSecretTag" TEXT;
ALTER TABLE "User" ADD COLUMN "totpConfirmedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "totpBackupCodes" JSONB;

-- AppSettings: org-wide enforcement switch. Off by default (no change for
-- existing installs). When on, unenrolled staff are forced to enroll at login.
ALTER TABLE "AppSettings" ADD COLUMN "require2fa" BOOLEAN NOT NULL DEFAULT false;
