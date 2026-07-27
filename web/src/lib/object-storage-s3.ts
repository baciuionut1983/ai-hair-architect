import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

import type { S3ObjectStorageConfig } from "./object-storage-config";
import { classifyObjectStorageError, ObjectStorageError } from "./object-storage-errors";
import type {
  ObjectIdentity,
  ObjectMetadata,
  ObjectReference,
  ObjectStorage,
  PutObjectInput,
  StoredObject
} from "./object-storage";

type S3ClientFactory = (config: S3ObjectStorageConfig) => S3Client;

export class S3ObjectStorage implements ObjectStorage {
  private client: S3Client | null = null;

  constructor(
    private readonly config: S3ObjectStorageConfig,
    private readonly clientFactory: S3ClientFactory = createS3Client
  ) {}

  async put(input: PutObjectInput): Promise<ObjectReference> {
    const key = this.resolveKey(input.key);
    const response = await this.execute((abortSignal) => this.getClient().send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: input.body,
      ContentLength: input.body.byteLength,
      ContentType: input.contentType,
      Metadata: { "content-sha256": input.contentSha256 },
      IfNoneMatch: "*",
      ...(this.config.serverSideEncryption === "none"
        ? {}
        : { ServerSideEncryption: this.config.serverSideEncryption }),
      ...(this.config.serverSideEncryption === "aws:kms" && this.config.kmsKeyId
        ? { SSEKMSKeyId: this.config.kmsKeyId }
        : {})
    }), { abortSignal }));

    return {
      backend: "s3",
      bucketAlias: this.config.bucketAlias,
      key,
      versionId: response.VersionId ?? null,
      etag: response.ETag ?? null,
      contentSha256: input.contentSha256,
      sizeBytes: input.body.byteLength
    };
  }

  async get(input: ObjectIdentity): Promise<StoredObject> {
    this.assertIdentity(input);
    const response = await this.execute((abortSignal) => this.getClient().send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ...(input.versionId ? { VersionId: input.versionId } : {})
    }), { abortSignal }));

    if (!response.Body) {
      throw new ObjectStorageError("provider_unavailable");
    }

    return {
      ...metadata(input, response),
      body: response.Body.transformToWebStream()
    };
  }

  async head(input: ObjectIdentity): Promise<ObjectMetadata> {
    this.assertIdentity(input);
    const response = await this.execute((abortSignal) => this.getClient().send(new HeadObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ...(input.versionId ? { VersionId: input.versionId } : {})
    }), { abortSignal }));
    return metadata(input, response);
  }

  async delete(input: ObjectIdentity): Promise<void> {
    this.assertIdentity(input);
    await this.execute((abortSignal) => this.getClient().send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ...(input.versionId ? { VersionId: input.versionId } : {})
    }), { abortSignal }));
  }

  private getClient(): S3Client {
    this.client ??= this.clientFactory(this.config);
    return this.client;
  }

  private resolveKey(relativeKey: string): string {
    if (!relativeKey || relativeKey.startsWith("/") || relativeKey.includes("..")) {
      throw new ObjectStorageError("configuration");
    }
    return `${this.config.prefix}/${relativeKey}`;
  }

  private assertIdentity(input: ObjectIdentity): void {
    if (input.bucketAlias !== this.config.bucketAlias || !input.key.startsWith(`${this.config.prefix}/`)) {
      throw new ObjectStorageError("configuration");
    }
  }

  private async execute<T>(operation: (abortSignal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      return await operation(controller.signal);
    } catch (error) {
      throw classifyObjectStorageError(error);
    } finally {
      clearTimeout(timer);
    }
  }
}

function createS3Client(config: S3ObjectStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    maxAttempts: 3
  });
}

function metadata(
  input: ObjectIdentity,
  response: {
    VersionId?: string;
    ETag?: string;
    Metadata?: Record<string, string>;
    ContentLength?: number;
    ContentType?: string;
  }
): ObjectMetadata {
  return {
    bucketAlias: input.bucketAlias,
    key: input.key,
    versionId: response.VersionId ?? input.versionId ?? null,
    etag: response.ETag ?? null,
    contentSha256: response.Metadata?.["content-sha256"] ?? null,
    sizeBytes: response.ContentLength ?? 0,
    contentType: response.ContentType ?? null
  };
}