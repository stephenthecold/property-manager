import { describe, it, expect, afterAll } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LocalFileStorage,
  assertSafeStorageKey,
  verifyLocalFileSignature,
} from "@/lib/providers/storage/local";

const SECRET = "test-secret";
const baseDir = path.join(os.tmpdir(), `pm-local-storage-${randomUUID()}`);
const storage = new LocalFileStorage({ baseDir, secret: SECRET });

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

function signedParts(url: string): { key: string; exp: string; sig: string } {
  const u = new URL(url, "http://localhost");
  return {
    key: u.searchParams.get("key")!,
    exp: u.searchParams.get("exp")!,
    sig: u.searchParams.get("sig")!,
  };
}

describe("LocalFileStorage roundtrip", () => {
  it("puts, reads back, and deletes a file", async () => {
    const body = Buffer.from("receipt body bytes");
    await storage.put({ key: "receipts/r-1.pdf", body, contentType: "application/pdf" });
    expect(await storage.exists("receipts/r-1.pdf")).toBe(true);
    expect((await storage.get("receipts/r-1.pdf")).equals(body)).toBe(true);
    await storage.delete("receipts/r-1.pdf");
    expect(await storage.exists("receipts/r-1.pdf")).toBe(false);
  });

  it("creates nested parent directories", async () => {
    await storage.put({ key: "docs/2026/06/lease_42.txt", body: Buffer.from("nested") });
    expect((await storage.get("docs/2026/06/lease_42.txt")).toString("utf8")).toBe("nested");
  });

  it("get throws for a missing key; exists is false; delete is idempotent", async () => {
    await expect(storage.get("missing/nope.txt")).rejects.toThrow();
    expect(await storage.exists("missing/nope.txt")).toBe(false);
    await expect(storage.delete("missing/nope.txt")).resolves.toBeUndefined();
  });

  it("overwrites an existing key", async () => {
    await storage.put({ key: "docs/over.txt", body: Buffer.from("v1") });
    await storage.put({ key: "docs/over.txt", body: Buffer.from("v2") });
    expect((await storage.get("docs/over.txt")).toString("utf8")).toBe("v2");
  });

  it("rejects browser-direct uploads", async () => {
    await expect(storage.getSignedUploadUrl("docs/x.txt")).rejects.toThrow(
      /does not support browser-direct uploads/,
    );
  });
});

describe("assertSafeStorageKey", () => {
  it("accepts normal nested keys", () => {
    expect(() => assertSafeStorageKey("receipts/2026-06/r_1.v2.pdf")).not.toThrow();
  });

  it.each([
    ["traversal", "../etc/passwd"],
    ["embedded traversal", "a/../b.txt"],
    ["leading slash", "/abs.txt"],
    ["backslash", "a\\b.txt"],
    ["space", "a b.txt"],
    ["empty", ""],
    ["percent-encoding", "a%2e%2e/b.txt"],
  ])("rejects %s", (_label, key) => {
    expect(() => assertSafeStorageKey(key)).toThrow(/Unsafe storage key/);
  });

  it("is enforced on every storage method", async () => {
    await expect(storage.put({ key: "../escape.txt", body: Buffer.from("x") })).rejects.toThrow(
      /Unsafe storage key/,
    );
    await expect(storage.get("..\\escape.txt")).rejects.toThrow(/Unsafe storage key/);
    await expect(storage.delete("/escape.txt")).rejects.toThrow(/Unsafe storage key/);
    await expect(storage.exists("a/../b")).rejects.toThrow(/Unsafe storage key/);
    await expect(storage.getSignedUrl("../escape.txt")).rejects.toThrow(/Unsafe storage key/);
  });
});

describe("signed URLs", () => {
  it("issues a URL that verifies with the same secret", async () => {
    const url = await storage.getSignedUrl("docs/file.txt", 60);
    const u = new URL(url, "http://localhost");
    expect(u.pathname).toBe("/api/files");
    const { key, exp, sig } = signedParts(url);
    expect(key).toBe("docs/file.txt");
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Number(exp)).toBeGreaterThan(nowSec);
    expect(Number(exp)).toBeLessThanOrEqual(nowSec + 60);
    expect(verifyLocalFileSignature({ key, exp, sig, secret: SECRET })).toBe(true);
  });

  it("rejects an expired signature even when the HMAC is valid", () => {
    const key = "docs/file.txt";
    const exp = String(Math.floor(Date.now() / 1000) - 10);
    const sig = createHmac("sha256", SECRET).update(`${key}\n${exp}`).digest("hex");
    expect(verifyLocalFileSignature({ key, exp, sig, secret: SECRET })).toBe(false);
  });

  it("rejects tampering with key, exp, sig, or secret", async () => {
    const { key, exp, sig } = signedParts(await storage.getSignedUrl("docs/file.txt", 60));
    expect(verifyLocalFileSignature({ key: "docs/other.txt", exp, sig, secret: SECRET })).toBe(
      false,
    );
    expect(
      verifyLocalFileSignature({ key, exp: String(Number(exp) + 9999), sig, secret: SECRET }),
    ).toBe(false);
    const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(verifyLocalFileSignature({ key, exp, sig: flipped, secret: SECRET })).toBe(false);
    expect(verifyLocalFileSignature({ key, exp, sig, secret: "wrong-secret" })).toBe(false);
  });

  it("rejects malformed inputs without throwing", async () => {
    const { key, exp, sig } = signedParts(await storage.getSignedUrl("docs/file.txt", 60));
    expect(verifyLocalFileSignature({ key, exp: "not-a-number", sig, secret: SECRET })).toBe(false);
    expect(verifyLocalFileSignature({ key, exp, sig: "zz", secret: SECRET })).toBe(false);
    expect(verifyLocalFileSignature({ key, exp, sig: "", secret: SECRET })).toBe(false);
    expect(verifyLocalFileSignature({ key: "../escape", exp, sig, secret: SECRET })).toBe(false);
  });
});
