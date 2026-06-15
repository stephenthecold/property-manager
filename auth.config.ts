import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/lib/generated/prisma/enums";
import { roleAtLeast } from "@/lib/auth/rbac";

/**
 * Edge-safe Auth.js config: JWT-only, NO Prisma adapter, NO DB-touching callbacks.
 * The Node instance (auth.ts) spreads this and adds the adapter, dynamic providers,
 * and the DB-backed `jwt` callback. middleware.ts uses THIS instance directly so it
 * never imports Prisma at the edge.
 */

const PUBLIC_PREFIXES = [
  "/login",
  "/emergency",
  "/setup",
  "/api/auth",
  "/api/sms/status", // provider webhook — authenticated by HMAC signature, not session
  "/api/health", // container healthcheck — returns only {ok}, no data
  "/sign", // tenant e-sign pages — gated by a single-use token hash, not a session
  "/portal", // tenant portal — its own local session (lib/portal/session.ts), never staff auth
  "/api/portal", // portal-scoped APIs (file downloads) — same portal session check
  "/privacy", // public compliance page (10DLC) — operator-authored, no data
  "/terms", // public compliance page (10DLC) — operator-authored, no data
  "/apply", // public rental-application intake — module-gated at the service layer
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export const authConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 }, // 8h cap bounds exposure
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    session({ session, token }) {
      if (session.user) {
        const uid = token.uid as string | undefined;
        if (uid) session.user.id = uid;
        session.user.role = (token.role as Role | undefined) ?? "viewer";
        session.user.securityStamp = token.securityStamp as string | undefined;
        session.user.viaBreakGlass = token.viaBreakGlass as boolean | undefined;
        session.user.bgExpiresAt = token.bgExp as number | undefined;
      }
      return session;
    },
    authorized({ auth, request }) {
      try {
        const { pathname } = request.nextUrl;
        if (isPublic(pathname)) return true;

        const user = auth?.user;
        if (!user) return false;

        // Expired break-glass session -> force re-login.
        if (user.viaBreakGlass && user.bgExpiresAt && Date.now() > user.bgExpiresAt) {
          return false;
        }

        // Admin-minimum: auth settings (must match requireRole("admin") in
        // settings/auth — the edge check is a coarse JWT hint, the page and
        // actions re-verify against the DB).
        if (pathname.startsWith("/settings/auth")) {
          return roleAtLeast(user.role ?? "viewer", "admin");
        }
        return true;
      } catch {
        return false; // fail closed
      }
    },
  },
} satisfies NextAuthConfig;
