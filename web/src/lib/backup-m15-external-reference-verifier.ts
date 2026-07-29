import { createHash } from "crypto";

import {
  computeBackupM15V1Checksum,
  parseBackupM15V1Artifact,
} from "./backup-m15-artifact";
import type { ObjectStorage } from "./object-storage";
import {
  ObjectStorageError,
  classifyObjectStorageError,
} from "./object-storage-errors";
import {
  MAX_M15_NORMALIZED_OBJECT_BYTES,
  assertM15V1ObjectReference,
} from "./object-storage-runtime";

export type M15ExternalReferenceFailureCode =
  | "invalid_reference"
  | "unknown_alias"
  | "missing_object"
  | "identity_mismatch"
  | "version_mismatch"
  | "size_mismatch"
  | "checksum_metadata_mismatch"
  | "streamed_checksum_mismatch"
  | "streamed_size_mismatch"
  | "stream_limit_exceeded"
  | "storage_timeout"
  | "storage_access_denied"
  | "storage_unavailable";

export interface M15ExternalReferenceVerificationEvidence {
  status: "verified";
  code: "verified";
  verifiedAt: string;
  totalReferences: number;
  verifiedReferences: number;
}

export interface M15ExternalReferenceVerificationFailure {
  status: "failed";
  code: M15ExternalReferenceFailureCode;
  verifiedAt: string;
  totalReferences: number;
  verifiedReferences: number;
  referenceIndex: number | null;
  assetId: string | null;
}

export type M15ExternalReferenceVerificationResult =
  | M15ExternalReferenceVerificationEvidence
  | M15ExternalReferenceVerificationFailure;

export type M15ObjectStorageAliasResolver = (
  bucketAlias: string,
) => ObjectStorage | null | Promise<ObjectStorage | null>;

export interface VerifyM15ExternalReferencesInput {
  artifact: unknown;
  resolveStorage: M15ObjectStorageAliasResolver;
  maxStreamBytes?: number;
  now?: () => Date;
}

export async function verifyM15ExternalReferences(
  input: VerifyM15ExternalReferencesInput,
): Promise<M15ExternalReferenceVerificationResult> {
  const verifiedAt = (input.now ?? (() => new Date()))().toISOString();
  const maxStreamBytes = input.maxStreamBytes ?? MAX_M15_NORMALIZED_OBJECT_BYTES;
  let artifact;

  try {
    artifact = parseBackupM15V1Artifact(input.artifact);
    if (
      artifact.checksum === null ||
      artifact.checksum !== computeBackupM15V1Checksum(artifact) ||
      !Number.isSafeInteger(maxStreamBytes) ||
      maxStreamBytes <= 0 ||
      maxStreamBytes > MAX_M15_NORMALIZED_OBJECT_BYTES
    ) {
      return failure("invalid_reference", verifiedAt, 0, 0, null, null);
    }
  } catch {
    return failure("invalid_reference", verifiedAt, 0, 0, null, null);
  }

  const assets = [...artifact.sections.imageAssets].sort((left, right) => left.id.localeCompare(right.id));
  const totalReferences = assets.length;

  for (const [referenceIndex, asset] of assets.entries()) {
    const reference = asset.objectReference;
    try {
      assertM15V1ObjectReference(reference);
    } catch {
      return failure("invalid_reference", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }

    if (reference.sizeBytes > maxStreamBytes) {
      return failure("stream_limit_exceeded", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }

    let storage: ObjectStorage | null;
    try {
      storage = await input.resolveStorage(reference.bucketAlias);
    } catch {
      return failure("storage_unavailable", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }
    if (!storage) {
      return failure("unknown_alias", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }

    const identity = {
      bucketAlias: reference.bucketAlias,
      key: reference.key,
      versionId: reference.versionId,
    } as const;

    let metadata;
    try {
      metadata = await storage.head(identity);
    } catch (error) {
      return failure(mapStorageFailure(error), verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }

    if (metadata.bucketAlias !== identity.bucketAlias || metadata.key !== identity.key) {
      return failure("identity_mismatch", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }
    if (metadata.versionId !== identity.versionId) {
      return failure("version_mismatch", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }
    if (metadata.sizeBytes !== reference.sizeBytes) {
      return failure("size_mismatch", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }
    if (metadata.contentSha256 !== reference.contentSha256) {
      return failure("checksum_metadata_mismatch", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }

    let storedObject;
    try {
      storedObject = await storage.get(identity);
    } catch (error) {
      return failure(mapStorageFailure(error), verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }

    if (storedObject.bucketAlias !== identity.bucketAlias || storedObject.key !== identity.key) {
      await storedObject.body.cancel().catch(() => undefined);
      return failure("identity_mismatch", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }
    if (storedObject.versionId !== identity.versionId) {
      await storedObject.body.cancel().catch(() => undefined);
      return failure("version_mismatch", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }

    const streamed = await verifyStream(storedObject.body, maxStreamBytes);
    if (streamed.status === "limit_exceeded") {
      return failure("stream_limit_exceeded", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }
    if (streamed.status === "unavailable") {
      return failure("storage_unavailable", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }
    if (streamed.sizeBytes !== reference.sizeBytes) {
      return failure("streamed_size_mismatch", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }
    if (streamed.contentSha256 !== reference.contentSha256) {
      return failure("streamed_checksum_mismatch", verifiedAt, totalReferences, referenceIndex, referenceIndex, asset.id);
    }
  }

  return {
    status: "verified",
    code: "verified",
    verifiedAt,
    totalReferences,
    verifiedReferences: totalReferences,
  };
}

async function verifyStream(
  stream: ReadableStream<Uint8Array>,
  maxStreamBytes: number,
): Promise<
  | { status: "verified"; sizeBytes: number; contentSha256: string }
  | { status: "limit_exceeded" }
  | { status: "unavailable" }
> {
  const reader = stream.getReader();
  const hash = createHash("sha256");
  let sizeBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        await reader.cancel().catch(() => undefined);
        return { status: "unavailable" };
      }
      sizeBytes += result.value.byteLength;
      if (sizeBytes > maxStreamBytes) {
        await reader.cancel().catch(() => undefined);
        return { status: "limit_exceeded" };
      }
      hash.update(result.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { status: "unavailable" };
  } finally {
    reader.releaseLock();
  }

  return {
    status: "verified",
    sizeBytes,
    contentSha256: hash.digest("hex"),
  };
}

function mapStorageFailure(error: unknown): M15ExternalReferenceFailureCode {
  const classified = error instanceof ObjectStorageError ? error : classifyObjectStorageError(error);
  switch (classified.code) {
    case "not_found":
      return "missing_object";
    case "access_denied":
      return "storage_access_denied";
    case "timeout":
      return "storage_timeout";
    default:
      return "storage_unavailable";
  }
}

function failure(
  code: M15ExternalReferenceFailureCode,
  verifiedAt: string,
  totalReferences: number,
  verifiedReferences: number,
  referenceIndex: number | null,
  assetId: string | null,
): M15ExternalReferenceVerificationFailure {
  return {
    status: "failed",
    code,
    verifiedAt,
    totalReferences,
    verifiedReferences,
    referenceIndex,
    assetId,
  };
}