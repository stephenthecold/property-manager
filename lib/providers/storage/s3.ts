import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FileStorage, PutObjectInput } from "@/lib/providers/storage/types";
import { getEnv } from "@/lib/config/env";

/**
 * One S3-compatible implementation parameterized by env — works for AWS S3,
 * Cloudflare R2, Backblaze B2, and MinIO (set S3_ENDPOINT + S3_FORCE_PATH_STYLE).
 */
export interface S3StorageConfig {
  bucket?: string | null;
  region?: string | null;
  endpoint?: string | null;
  forcePathStyle?: boolean;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
}

export class S3FileStorage implements FileStorage {
  readonly name = "s3";
  private readonly client: S3Client;
  private readonly bucket: string;

  /** Resolved (DB-over-env) config wins; each field falls back to env. */
  constructor(config?: S3StorageConfig) {
    const env = getEnv();
    const bucket = config?.bucket ?? env.S3_BUCKET;
    if (!bucket) throw new Error("S3 bucket is required when the storage provider is s3");
    this.bucket = bucket;
    const accessKeyId = config?.accessKeyId ?? env.S3_ACCESS_KEY_ID;
    const secretAccessKey = config?.secretAccessKey ?? env.S3_SECRET_ACCESS_KEY;
    this.client = new S3Client({
      region: (config?.region ?? env.S3_REGION) ?? "us-east-1",
      endpoint: config?.endpoint ?? env.S3_ENDPOINT,
      forcePathStyle: config?.forcePathStyle ?? env.S3_FORCE_PATH_STYLE,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
  }

  async put(input: PutObjectInput): Promise<{ key: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return { key: input.key };
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`Object has no body: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 900,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
