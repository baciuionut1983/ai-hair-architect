export type StorageBackend = "local" | "s3";

export interface ObjectIdentity {
  bucketAlias: string;
  key: string;
  versionId?: string | null;
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

export function buildImageAssetObjectKey(ownerUserId: string, assetId: string): string {
  if (!UUID_PATTERN.test(ownerUserId) || !UUID_PATTERN.test(assetId)) {
    throw new Error("Object keys require trusted UUID identifiers.");
  }
  return `owners/${ownerUserId}/assets/${assetId}/original`;
}