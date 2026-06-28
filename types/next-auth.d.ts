import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      securityStamp?: string;
      viaBreakGlass?: boolean;
      bgExpiresAt?: number;
      /** True after primary auth but before the TOTP 2FA challenge is passed.
       *  Such a session may ONLY reach /2fa (and sign-out); see auth flow. */
      twoFactorPending?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
    viaBreakGlass?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
    securityStamp?: string;
    viaBreakGlass?: boolean;
    bgExp?: number;
    /** Set on sign-in when the user has 2FA enrolled; cleared only by the
     *  server-side `update()` the /2fa action fires after a verified code. */
    twoFactorPending?: boolean;
  }
}
