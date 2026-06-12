import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EncryptedFileStorage,
  encryptFileBuffer,
  isEncryptedFileBuffer,
  maybeDecryptFileBuffer,
} from "@/lib/providers/storage/encrypted";
import { LocalFileStorage } from "@/lib/providers/storage/local";

const KEY = randomBytes(32);

describe("encrypted file buffers", () => {
  it("round-trips and is not plaintext on disk format", () => {
    const plain = Buffer.from("tenant lease scan %PDF-1.7 ...", "utf8");
    const enc = encryptFileBuffer(plain, KEY);
    expect(isEncryptedFileBuffer(enc)).toBe(true);
    expect(enc.includes(Buffer.from("lease scan"))).toBe(false);
    expect(maybeDecryptFileBuffer(enc, KEY).equals(plain)).toBe(true);
  });

  it("passes through pre-encryption plaintext unchanged", () => {
    const legacy = Buffer.from("uploaded before encryption was enabled");
    expect(isEncryptedFileBuffer(legacy)).toBe(false);
    expect(maybeDecryptFileBuffer(legacy, KEY).equals(legacy)).toBe(true);
  });

  it("rejects tampered ciphertext (GCM auth)", () => {
    const enc = encryptFileBuffer(Buffer.from("secret"), KEY);
    enc[enc.length - 1] ^= 0xff;
    expect(() => maybeDecryptFileBuffer(enc, KEY)).toThrow();
  });

  it("rejects the wrong key", () => {
    const enc = encryptFileBuffer(Buffer.from("secret"), KEY);
    expect(() => maybeDecryptFileBuffer(enc, randomBytes(32))).toThrow();
  });
});

describe("EncryptedFileStorage over LocalFileStorage", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pm-enc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores ciphertext but get() returns plaintext", async () => {
    const inner = new LocalFileStorage({ baseDir: dir, secret: "test-secret" });
    const storage = new EncryptedFileStorage(inner, KEY);
    const body = Buffer.from("receipt photo bytes");

    await storage.put({ key: "2026/06/receipt.jpg", body, contentType: "image/jpeg" });

    const onDisk = await inner.get("2026/06/receipt.jpg");
    expect(isEncryptedFileBuffer(onDisk)).toBe(true);
    expect(onDisk.includes(body)).toBe(false);

    expect((await storage.get("2026/06/receipt.jpg")).equals(body)).toBe(true);
    expect(await storage.exists("2026/06/receipt.jpg")).toBe(true);
    await storage.delete("2026/06/receipt.jpg");
    expect(await storage.exists("2026/06/receipt.jpg")).toBe(false);
  });
});
