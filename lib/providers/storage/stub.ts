import type { FileStorage, PutObjectInput } from "@/lib/providers/storage/types";

/**
 * Phase-1 default. No external storage is configured, so file operations are not
 * available. Methods throw a clear error rather than silently succeeding — Phase 1
 * never calls them (uploads/receipts are Phase 2).
 */
export class StubFileStorage implements FileStorage {
  readonly name = "stub";

  private unavailable(): never {
    throw new Error(
      "File storage is not configured (STORAGE_PROVIDER=stub). Set STORAGE_PROVIDER=s3 and the S3_* vars to enable uploads.",
    );
  }

  async put(_input: PutObjectInput): Promise<{ key: string }> {
    this.unavailable();
  }
  async getSignedUrl(_key: string): Promise<string> {
    this.unavailable();
  }
  async getSignedUploadUrl(_key: string, _ct: string): Promise<string> {
    this.unavailable();
  }
  async delete(_key: string): Promise<void> {
    this.unavailable();
  }
  async exists(_key: string): Promise<boolean> {
    this.unavailable();
  }
}
