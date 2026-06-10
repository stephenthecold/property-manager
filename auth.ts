import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { authConfig } from "@/auth.config";
import { buildProviders } from "@/lib/auth/providers";
import { resolveRoleFromGroups, roleRank } from "@/lib/auth/rbac";
import { getAuthSettings } from "@/lib/auth/settings";
import { disableBreakGlass } from "@/lib/auth/breakglass";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Node-runtime Auth.js instance: Prisma adapter + dynamically-built providers +
 * the DB-backed jwt callback. The lazy async config rebuilds providers per request
 * so web-UI OIDC changes apply without a restart. NOT used by edge middleware.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
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

      async jwt({ token, user, account, profile }) {
        // Initial sign-in.
        if (user) {
          token.uid = user.id;
          if ((user as { viaBreakGlass?: boolean }).viaBreakGlass) {
            token.viaBreakGlass = true;
            token.role = "owner";
            token.bgExp = Date.now() + 30 * 60_000; // 30-min non-renewable break-glass
            return token;
          }
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
