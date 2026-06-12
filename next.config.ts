import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native / Prisma packages out of the server bundle.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "argon2",
  ],
  experimental: {
    // Server-action posts default to a 1 MB body cap, which rejected logo /
    // .docx-template uploads (both validated app-side at 2 MB) with a bare 413
    // error page before any action code ran. 4 MB covers the 2 MB caps plus
    // multipart overhead; /api/uploads (15 MB) is a route handler and was
    // never affected by this limit.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
