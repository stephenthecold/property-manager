import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    // Unit tests only (DB-free). Integration tests use vitest.integration.config.ts.
    include: ["lib/**/*.test.ts"],
    // macOS AppleDouble metadata files (._foo.test.ts) are not test code.
    exclude: ["**/._*"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
