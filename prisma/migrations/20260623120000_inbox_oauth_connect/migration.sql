-- Interactive OAuth "Connect" flow for the inbound mailbox (Microsoft 365 /
-- Google). ADDITIVE ONLY: two nullable columns recording which provider issued
-- the stored refresh token and (for Microsoft) the tenant, so the redirect flow
-- can rebuild the authorize/token URLs. The refresh token itself reuses the
-- existing encrypted inboxOauthRefreshToken* columns.
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthProvider" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "inboxOauthTenant" TEXT;
