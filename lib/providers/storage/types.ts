/** Swappable file storage (S3 / R2 / Backblaze / MinIO). Phase 2 uses this for uploads. */
export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
}

export interface FileStorage {
  readonly name: string;
  put(input: PutObjectInput): Promise<{ key: string }>;
  /** Download object contents. */
  get(key: string): Promise<Buffer>;
  /** Signed URL to download a private object. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Signed URL the browser can PUT directly to (presigned upload). */
  getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds?: number,
  ): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
