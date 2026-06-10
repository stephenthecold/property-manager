import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Installer + break-glass CLI.
 *
 *   npm run bootstrap                 Ensure .env has generated secrets; print setup URL.
 *   npm run breakglass issue [hours]  Provision a one-time break-glass passphrase (default 72h).
 *   npm run breakglass rotate [hours] Rotate the break-glass passphrase.
 *   npm run breakglass disable        Disable break-glass and clear the credential.
 */

const ENV_PATH = path.resolve(process.cwd(), ".env");

function b64(bytes: number): string {
  return crypto.randomBytes(bytes).toString("base64");
}
function hex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function ensureEnv(): Record<string, string> {
  const existing = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, "utf8")
    : "";
  const lines = existing.split("\n");
  const required: Record<string, () => string> = {
    AUTH_SECRET: () => b64(36),
    SETTINGS_ENC_KEY: () => b64(32),
    SETUP_BOOTSTRAP_TOKEN: () => hex(24),
  };

  const valueOf = (line: string) =>
    line.slice(line.indexOf("=") + 1).replace(/^["']|["']$/g, "").trim();

  // Generate a value when the key is MISSING or PRESENT-BUT-EMPTY, replacing the
  // empty placeholder in place (so .env.example's blank lines get filled, and we
  // never create duplicate keys that dotenv/compose would mis-resolve).
  let changed = 0;
  for (const [key, gen] of Object.entries(required)) {
    const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    const current = idx >= 0 ? valueOf(lines[idx]) : process.env[key] ?? "";
    if (current) continue; // already set — leave it
    const value = gen();
    const newLine = `${key}="${value}"`;
    if (idx >= 0) lines[idx] = newLine;
    else lines.push(newLine);
    process.env[key] = value;
    changed++;
  }

  if (changed > 0) {
    fs.writeFileSync(ENV_PATH, lines.join("\n"));
    console.log(`Set ${changed} secret(s) in .env`);
  } else {
    console.log(".env already has the required secrets.");
  }

  return Object.fromEntries(
    ["AUTH_SECRET", "SETTINGS_ENC_KEY", "SETUP_BOOTSTRAP_TOKEN"].map((k) => [
      k,
      process.env[k] ?? "",
    ]),
  );
}

async function main() {
  const [cmd, sub, arg] = process.argv.slice(2);

  if (cmd === "breakglass") {
    // Imported lazily so the env is loaded first.
    const { issueBreakGlass, disableBreakGlass } = await import(
      "@/lib/auth/breakglass"
    );
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";

    if (sub === "issue" || sub === "rotate") {
      const hours = arg ? Number(arg) : 72;
      const { passphrase, expiresAt } = await issueBreakGlass(hours);
      console.log("\n=== Break-glass provisioned ===");
      console.log(`Passphrase (shown once): ${passphrase}`);
      console.log(`Emergency login:        ${appUrl}/emergency`);
      console.log(`Auto-disables at:       ${expiresAt.toISOString()}`);
      console.log(
        "Store this securely. It is argon2id-hashed at rest and cannot be recovered.\n",
      );
    } else if (sub === "disable") {
      await disableBreakGlass("cli");
      console.log("Break-glass disabled and credential cleared.");
    } else {
      console.error("Usage: npm run breakglass <issue|rotate|disable> [hours]");
      process.exitCode = 1;
    }
    return;
  }

  // Default: bootstrap secrets.
  ensureEnv();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const token = process.env.SETUP_BOOTSTRAP_TOKEN ?? "";
  console.log("\n=== Bootstrap complete ===");
  console.log(`Setup token: ${token}`);
  console.log(`Setup URL (configured APP_URL): ${appUrl}/setup?token=${token}`);
  console.log(`Setup URL (local Docker):       http://localhost:3000/setup?token=${token}`);
  console.log("\nNext steps (Docker Compose):");
  console.log("  1. docker compose up -d                      # app runs migrations automatically");
  console.log("  2. open the local setup URL above and create the first owner");
  console.log("  3. docker compose exec app npm run breakglass issue   # emergency login");
  console.log("     (run break-glass INSIDE the stack — the host can't reach the `db` hostname)\n");
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
