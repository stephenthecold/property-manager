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
  }
}
