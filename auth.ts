import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { authConfig } from "@/auth.config";
import { buildProviders } from "@/lib/auth/providers";
import { resolveRoleFromGroups, roleRank } from "@/lib/auth/rbac";
import { getAuthSettings } from "@/lib/auth/settings";
import { disableBreakGlass } from "@/lib/auth/breakglass";
import { verifyTwoFactorProof } from "@/lib/services/totp";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Node-runtime Auth.js instance: Prisma adapter + dynamically-built providers +
 * the DB-backed jwt callback. The lazy async config rebuilds providers per request
 * so web-UI OIDC changes apply without a restart. NOT used by edge middleware.
 */
export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth(async () => {
  const providers = await buildProviders();
  return {
    ...authConfig,
    adapter: PrismaAdapter(prisma),
    providers,
    callbacks: {
      ...authConfig.callbacks,

      async signIn({ user }) {
        if (user && (user as { viaBreakGlass?: boolean }).viaBreakGlass) {
          return true;
        }
        if (user?.id) {
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
          });
          if (dbUser && !dbUser.isActive) return false;
        }
        return true;
      },

      async jwt({ token, user, account, profile, trigger, session }) {
        // Initial sign-in.
        if (user) {
          token.uid = user.id;
          if ((user as { viaBreakGlass?: boolean }).viaBreakGlass) {
            // Break-glass is the recovery lane: it NEVER carries a 2FA gate.
            // Returning here means twoFactorPending is never set for it.
            token.viaBreakGlass = true;
            token.role = "owner";
            token.bgExp = Date.now() + 30 * 60_000; // 30-min non-renewable break-glass
            return token;
          }
        }

        // 2FA step passed: the /2fa server action (login challenge OR forced
        // login-time enrollment) verified a code, then called auth's update()
        // with an HMAC proof. The session-update body is CLIENT-INFLUENCED (a
        // pending user could POST the update endpoint directly), so we must NOT
        // trust a bare flag — we require an unforgeable proof bound to this
        // user id + their CURRENT DB securityStamp (verifyTwoFactorProof). Only
        // a server holding SETTINGS_ENC_KEY can mint it. We also re-read the DB
        // and require the user to be active + enrolled. Re-syncing the stamp
        // here keeps the token valid across the enrollment-driven stamp bump.
        // Fails CLOSED: missing/invalid proof, or a missing/inactive/unenrolled
        // user, leaves twoFactorPending untouched.
        const updateUid = token.uid as string | undefined;
        const updateProof = (session as { twoFactorProof?: string } | undefined)?.twoFactorProof;
        if (trigger === "update" && updateProof && updateUid && !token.viaBreakGlass) {
          const dbUser = await prisma.user.findUnique({ where: { id: updateUid } });
          if (
            dbUser &&
            dbUser.isActive &&
            dbUser.totpConfirmedAt &&
            verifyTwoFactorProof(updateUid, dbUser.securityStamp, updateProof)
          ) {
            token.twoFactorPending = false;
            token.securityStamp = dbUser.securityStamp;
            token.role = dbUser.role as Role;
          }
          return token;
        }

        const uid = token.uid as string | undefined;
        if (account?.provider === "authentik" && uid) {
          const settings = await getAuthSettings();
          const groups = (profile as { groups?: string[] } | undefined)?.groups;
          const mapped = resolveRoleFromGroups(
            groups,
            settings.groupMappings,
            settings.allowOwnerFromGroup,
          );
          const dbUser = await prisma.user.findUnique({
            where: { id: uid },
          });
          if (dbUser) {
            let role = dbUser.role as Role;
            // JIT provisioning: only ever raise a still-default viewer, never downgrade.
            if (role === "viewer" && mapped && roleRank(mapped) > roleRank("viewer")) {
              role = mapped;
              await prisma.user.update({
                where: { id: dbUser.id },
                data: { role },
              });
            }
            token.role = role;
            token.securityStamp = dbUser.securityStamp;
            token.viaBreakGlass = false;
            // 2FA gate: if the user has confirmed TOTP, the session starts
            // PENDING and may only reach /2fa until a code is verified (which
            // fires update() -> clears this above). If not enrolled, no gate
            // here — org-wide enforcement (require2fa) is handled at the app
            // boundary (forced enrollment), not in the token. Fails closed:
            // the only way to clear a true here is a verified challenge.
            token.twoFactorPending = !!dbUser.totpConfirmedAt;

            // Once a real OIDC owner can log in, retire break-glass.
            if (role === "owner" && settings.breakGlassEnabled) {
              await disableBreakGlass("auto: oidc owner login");
            }
          }
        }

        return token;
      },
    },
  };
});
