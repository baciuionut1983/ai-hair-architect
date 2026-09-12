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

// Stage 8.5L3.1 -- MULTIPART UPLOAD, an ADDITIVE capability interface, not
// a second storage service. Only the s3 backend implements it
// (S3ObjectStorage, object-storage-s3.ts) -- the local-disk backend has no
// multipart concept and never claims to. Kept separate from the base
// ObjectStorage interface deliberately: every existing ObjectStorage
// consumer (image/video put-then-verify-via-head callers) is unaffected,
// and "does this backend support direct large-object multipart upload" is
// a genuinely different question from "can this backend store an object
// at all."
export interface MultipartUploadPart {
  readonly partNumber: number;
  readonly etag: string;
}

export interface CreateMultipartUploadInput {
  readonly key: string;
  readonly contentType: string;
}

export interface CreateMultipartUploadResult {
  readonly bucketAlias: string;
  readonly key: string;
  readonly uploadId: string;
}

export interface PresignUploadPartInput {
  readonly key: string;
  readonly uploadId: string;
  readonly partNumber: number;
}

export interface CompleteMultipartUploadInput {
  readonly key: string;
  readonly uploadId: string;
  readonly parts: readonly MultipartUploadPart[];
}

// Deliberately narrower than ObjectReference -- S3's own
// CompleteMultipartUpload response carries no ContentLength/size and no
// content hash of its own; a caller that needs the authoritative final
// size/contentType MUST follow up with a real head() call (Part 11/22's
// own "verify with provider metadata, never trust the client" rule).
// Returning a fabricated sizeBytes:0/contentSha256:"" inside a real
// ObjectReference would look like real data and invite exactly that
// mistake.
export interface CompletedMultipartUploadReference {
  readonly bucketAlias: string;
  readonly key: string;
  readonly versionId: string | null;
  readonly etag: string | null;
}

export interface AbortMultipartUploadInput {
  readonly key: string;
  readonly uploadId: string;
}

export interface ListPartsInput {
  readonly key: string;
  readonly uploadId: string;
}

export interface MultipartObjectStorage {
  createMultipartUpload(input: CreateMultipartUploadInput): Promise<CreateMultipartUploadResult>;
  // The provider is the authority on which parts already genuinely
  // arrived -- this is what makes real resume-after-page-refresh possible
  // with NO server-side part-tracking table of our own (Stage 8.5L3.1
  // Part 9): a resumed client asks "which parts does the provider already
  // have" and only (re-)uploads what's missing.
  listParts(input: ListPartsInput): Promise<readonly MultipartUploadPart[]>;
  // Returns a short-lived, single-part-scoped signed PUT URL -- the
  // browser uploads that ONE part's bytes directly to object storage,
  // never through this application's own request handler (Stage 8.5L3.1's
  // own "GB-scale media must not be proxied through application memory"
  // rule).
  presignUploadPart(input: PresignUploadPartInput, expiresInSeconds: number): Promise<string>;
  // The provider (S3) is the authority here: CompleteMultipartUpload
  // fails if a part's ETag does not match what S3 itself recorded for
  // that (uploadId, partNumber) -- a forged or stale ETag is rejected by
  // the provider itself, never merely trusted from the client's own
  // report.
  completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<CompletedMultipartUploadReference>;
  abortMultipartUpload(input: AbortMultipartUploadInput): Promise<void>;
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