import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * Edge middleware uses the JWT-only config (no Prisma) for coarse route gating.
 * The `authorized` callback decides allow/deny and fails closed on error.
 */
const { auth } = NextAuth(authConfig);

export default auth((_req) => {
  // The `authorized` callback in authConfig handles redirects; nothing else to do.
});

export const config = {
  // Run on everything except static assets and files with an extension.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
