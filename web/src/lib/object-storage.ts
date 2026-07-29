export type StorageBackend = "local" | "s3";

export interface ObjectIdentity {
  bucketAlias: string;
  key: string;
  versionId?: string | null;
}

export interface ExactObjectIdentity {
  bucketAlias: string;
  key: string;
  versionId: string;
}

export interface ExactObjectReference extends ExactObjectIdentity {
  backend: "s3";
  etag: string | null;
  contentSha256: string;
  sizeBytes: number;
}

export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
  contentSha256: string;
}

export interface ObjectReference extends ObjectIdentity {
  backend: "s3";
  versionId: string | null;
  etag: string | null;
  contentSha256: string;
  sizeBytes: number;
}

export interface ObjectMetadata extends ObjectIdentity {
  versionId: string | null;
  etag: string | null;
  contentSha256: string | null;
  sizeBytes: number;
  contentType: string | null;
}

export interface StoredObject extends ObjectMetadata {
  body: ReadableStream<Uint8Array>;
}

export interface ObjectStorage {
  put(input: PutObjectInput): Promise<ObjectReference>;
  get(input: ObjectIdentity): Promise<StoredObject>;
  head(input: ObjectIdentity): Promise<ObjectMetadata>;
  delete(input: ObjectIdentity): Promise<void>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function toExactObjectReference(reference: ObjectReference): ExactObjectReference {
  if (
    typeof reference.versionId !== "string" ||
    !reference.versionId.trim() ||
    !CONTENT_SHA256_PATTERN.test(reference.contentSha256) ||
    !Number.isSafeInteger(reference.sizeBytes) ||
    reference.sizeBytes <= 0
  ) {
    throw new TypeError("A complete exact-version object reference is required.");
  }

  return {
    backend: "s3",
    bucketAlias: reference.bucketAlias,
    key: reference.key,
    versionId: reference.versionId,
    etag: reference.etag,
    contentSha256: reference.contentSha256,
    sizeBytes: reference.sizeBytes
  };
}

export function buildImageAssetObjectKey(ownerUserId: string, assetId: string): string {
  if (!UUID_PATTERN.test(ownerUserId) || !UUID_PATTERN.test(assetId)) {
    throw new Error("Object keys require trusted UUID identifiers.");
  }
  return `owners/${ownerUserId}/assets/${assetId}/original`;
}