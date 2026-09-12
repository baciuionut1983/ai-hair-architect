import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { S3ObjectStorageConfig } from "./object-storage-config";
import { classifyObjectStorageError, ObjectStorageError } from "./object-storage-errors";
import type {
  AbortMultipartUploadInput,
  CompleteMultipartUploadInput,
  CompletedMultipartUploadReference,
  CreateMultipartUploadInput,
  CreateMultipartUploadResult,
  ListPartsInput,
  MultipartObjectStorage,
  MultipartUploadPart,
  ObjectIdentity,
  ObjectMetadata,
  ObjectReference,
  ObjectStorage,
  PresignUploadPartInput,
  PutObjectInput,
  StoredObject
} from "./object-storage";

type S3ClientFactory = (config: S3ObjectStorageConfig) => S3Client;

export class S3ObjectStorage implements ObjectStorage, MultipartObjectStorage {
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

  // Stage 8.5L3.1 -- takes a RELATIVE key, resolves/prefixes it exactly
  // like put() does, and returns the FULL resolved key -- same
  // relative-in/full-out convention this class already established.
  async createMultipartUpload(input: CreateMultipartUploadInput): Promise<CreateMultipartUploadResult> {
    const key = this.resolveKey(input.key);
    const response = await this.execute((abortSignal) => this.getClient().send(new CreateMultipartUploadCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: input.contentType,
      ...(this.config.serverSideEncryption === "none"
        ? {}
        : { ServerSideEncryption: this.config.serverSideEncryption }),
      ...(this.config.serverSideEncryption === "aws:kms" && this.config.kmsKeyId
        ? { SSEKMSKeyId: this.config.kmsKeyId }
        : {})
    }), { abortSignal }));

    if (!response.UploadId) {
      throw new ObjectStorageError("provider_unavailable");
    }

    return { bucketAlias: this.config.bucketAlias, key, uploadId: response.UploadId };
  }

  // Presigning is a local, offline signature computation (no network
  // round-trip to S3) -- deliberately NOT wrapped in this.execute's own
  // network timeout/retry machinery, which exists for real requests only.
  async presignUploadPart(input: PresignUploadPartInput, expiresInSeconds: number): Promise<string> {
    this.assertIdentity({ bucketAlias: this.config.bucketAlias, key: input.key });
    const command = new UploadPartCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      UploadId: input.uploadId,
      PartNumber: input.partNumber
    });
    return getSignedUrl(this.getClient(), command, { expiresIn: expiresInSeconds });
  }

  // The AUTHORITATIVE finalization step (Stage 8.5L3.1 Part 11): S3
  // itself rejects this call if any given part's ETag does not match
  // what it actually recorded for (uploadId, partNumber), or if a part is
  // missing below the minimum-part-size threshold -- a forged or
  // fabricated part list is never merely trusted client-side.
  async completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<CompletedMultipartUploadReference> {
    this.assertIdentity({ bucketAlias: this.config.bucketAlias, key: input.key });
    const response = await this.execute((abortSignal) => this.getClient().send(new CompleteMultipartUploadCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: [...input.parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag }))
      }
    }), { abortSignal }));

    // A completed multipart object's ContentLength/size is not returned
    // by CompleteMultipartUploadCommand itself -- the caller
    // (video-multipart-upload-service.ts) always follows this with a real
    // head() call for the authoritative size/contentType, matching Part
    // 11/22's own "verify with provider/object metadata" requirement.
    return {
      bucketAlias: this.config.bucketAlias,
      key: input.key,
      versionId: response.VersionId ?? null,
      etag: response.ETag ?? null
    };
  }

  // A single, unpaginated ListParts call -- S3 returns up to 1000 parts
  // per page (IsTruncated/PartNumberMarker for more). Not implemented
  // here deliberately: this application's own MAX_MULTIPART_PART_COUNT
  // (professional-learning-upload-session-validators.ts) is bounded well
  // under 1000 by construction, so a second page can never genuinely
  // occur for an upload this application itself authorized. A future
  // stage that raises that bound past 1000 must add pagination here too.
  async listParts(input: ListPartsInput): Promise<readonly MultipartUploadPart[]> {
    this.assertIdentity({ bucketAlias: this.config.bucketAlias, key: input.key });
    const response = await this.execute((abortSignal) => this.getClient().send(new ListPartsCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      UploadId: input.uploadId
    }), { abortSignal }));

    return (response.Parts ?? [])
      .filter((part): part is { PartNumber: number; ETag: string } => typeof part.PartNumber === "number" && typeof part.ETag === "string")
      .map((part) => ({ partNumber: part.PartNumber, etag: part.ETag }));
  }

  async abortMultipartUpload(input: AbortMultipartUploadInput): Promise<void> {
    this.assertIdentity({ bucketAlias: this.config.bucketAlias, key: input.key });
    await this.execute((abortSignal) => this.getClient().send(new AbortMultipartUploadCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      UploadId: input.uploadId
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