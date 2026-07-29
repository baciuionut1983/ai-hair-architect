import { createHash } from "crypto";

import {
  M15_V2_MAX_OBJECT_BYTES,
  parseBackupM15V2Artifact,
} from "./backup-m15-v2-artifact";
import type {
  BackupM15V2ImageAssetSectionRow,
  BackupM15V2LegacyLocalImageAsset,
  BackupM15V2ObjectBackedImageAsset,
} from "./contracts";

export type BackupM15V2ExternalReferenceKind = "legacy-local" | "object-backed";

export type BackupM15V2ExternalReferenceFailureCode =
  | "artifact_invalid"
  | "reference_resolution_failed"
  | "reference_missing"
  | "size_mismatch"
  | "hash_mismatch"
  | "version_mismatch"
  | "stream_limit_exceeded"
  | "resolver_contract_violation";

const SAFE_FAILURE_MESSAGES: Record<BackupM15V2ExternalReferenceFailureCode, string> = {
  artifact_invalid: "The M15 v2 artifact is not a valid, checksum-verified artifact.",
  reference_resolution_failed: "An external reference could not be resolved.",
  reference_missing: "An external reference does not exist in the resolved storage backend.",
  size_mismatch: "An external reference size does not match the backup record.",
  hash_mismatch: "An external reference content hash does not match the backup record.",
  version_mismatch: "An external reference version does not match the exact version recorded in the backup.",
  stream_limit_exceeded: "An external reference exceeded the maximum allowed verification stream size.",
  resolver_contract_violation: "A reference resolver returned a result that violates its contract.",
};

export interface BackupM15V2LegacyLocalReferenceIdentity {
  readonly rootAlias: "legacy-images";
  readonly relativePath: string;
}

export interface BackupM15V2ObjectBackedReferenceIdentity {
  readonly bucketAlias: string;
  readonly key: string;
  readonly versionId: string;
}

export interface BackupM15V2ResolvedLegacyLocalReferenceSource {
  readonly rootAlias: "legacy-images";
  readonly relativePath: string;
  readonly sizeBytes: number;
  openStream(): ReadableStream<Uint8Array>;
}

export interface BackupM15V2ResolvedObjectBackedReferenceSource {
  readonly bucketAlias: string;
  readonly key: string;
  readonly versionId: string;
  readonly sizeBytes: number;
  openStream(): ReadableStream<Uint8Array>;
}

export interface BackupM15V2LegacyLocalReferenceResolver {
  resolveLegacyLocalReference(
    identity: BackupM15V2LegacyLocalReferenceIdentity,
  ): Promise<BackupM15V2ResolvedLegacyLocalReferenceSource | null>;
}

export interface BackupM15V2ObjectBackedReferenceResolver {
  resolveObjectBackedReference(
    identity: BackupM15V2ObjectBackedReferenceIdentity,
  ): Promise<BackupM15V2ResolvedObjectBackedReferenceSource | null>;
}

export interface BackupM15V2ExternalReferenceVerificationSuccess {
  readonly ok: true;
  readonly artifactVersion: "m15.v2";
  readonly verifiedAt: string;
  readonly verifiedReferenceCount: number;
  readonly legacyLocalReferenceCount: number;
  readonly objectBackedReferenceCount: number;
}

export interface BackupM15V2ExternalReferenceVerificationFailure {
  readonly ok: false;
  readonly code: BackupM15V2ExternalReferenceFailureCode;
  readonly message: string;
  readonly verifiedAt: string;
  readonly referenceIndex: number | null;
  readonly referenceKind: BackupM15V2ExternalReferenceKind | null;
  readonly verifiedReferenceCount: number;
  readonly legacyLocalReferenceCount: number;
  readonly objectBackedReferenceCount: number;
}

export type BackupM15V2ExternalReferenceVerificationResult =
  | BackupM15V2ExternalReferenceVerificationSuccess
  | BackupM15V2ExternalReferenceVerificationFailure;

export interface VerifyBackupM15V2ExternalReferencesInput {
  readonly artifact: unknown;
  readonly verifiedAt: string;
  readonly legacyLocalResolver: BackupM15V2LegacyLocalReferenceResolver;
  readonly objectBackedResolver: BackupM15V2ObjectBackedReferenceResolver;
  readonly maxStreamBytes?: number;
}

export async function verifyBackupM15V2ExternalReferences(
  input: VerifyBackupM15V2ExternalReferencesInput,
): Promise<BackupM15V2ExternalReferenceVerificationResult> {
  const verifiedAt = input.verifiedAt;
  const maxStreamBytes = input.maxStreamBytes ?? M15_V2_MAX_OBJECT_BYTES;

  if (
    typeof verifiedAt !== "string" ||
    !verifiedAt ||
    !Number.isSafeInteger(maxStreamBytes) ||
    maxStreamBytes <= 0 ||
    maxStreamBytes > M15_V2_MAX_OBJECT_BYTES
  ) {
    return failure(
      "artifact_invalid",
      typeof verifiedAt === "string" ? verifiedAt : "",
      null,
      null,
      0,
      0,
      0,
    );
  }

  let references: readonly BackupM15V2ImageAssetSectionRow[];
  try {
    references = parseBackupM15V2Artifact(input.artifact).sections.imageAssets;
  } catch {
    return failure("artifact_invalid", verifiedAt, null, null, 0, 0, 0);
  }

  let verifiedReferenceCount = 0;
  let legacyLocalReferenceCount = 0;
  let objectBackedReferenceCount = 0;

  for (let index = 0; index < references.length; index += 1) {
    const asset = references[index];
    const failureCode = await verifyOneReference(asset, input, maxStreamBytes);
    if (failureCode !== null) {
      return failure(
        failureCode,
        verifiedAt,
        index,
        asset.storageKind,
        verifiedReferenceCount,
        legacyLocalReferenceCount,
        objectBackedReferenceCount,
      );
    }
    verifiedReferenceCount += 1;
    if (asset.storageKind === "legacy-local") legacyLocalReferenceCount += 1;
    else objectBackedReferenceCount += 1;
  }

  return {
    ok: true,
    artifactVersion: "m15.v2",
    verifiedAt,
    verifiedReferenceCount,
    legacyLocalReferenceCount,
    objectBackedReferenceCount,
  };
}

async function verifyOneReference(
  asset: BackupM15V2ImageAssetSectionRow,
  input: VerifyBackupM15V2ExternalReferencesInput,
  maxStreamBytes: number,
): Promise<BackupM15V2ExternalReferenceFailureCode | null> {
  if (asset.storageKind === "legacy-local") {
    return verifyLegacyLocalReference(asset, input.legacyLocalResolver, maxStreamBytes);
  }
  if (asset.storageKind === "object-backed") {
    return verifyObjectBackedReference(asset, input.objectBackedResolver, maxStreamBytes);
  }
  // Unreachable: parseBackupM15V2Artifact rejects any other storageKind before this point.
  throw new Error("Unsupported M15 v2 external reference kind.");
}

async function verifyLegacyLocalReference(
  asset: BackupM15V2LegacyLocalImageAsset,
  resolver: BackupM15V2LegacyLocalReferenceResolver,
  maxStreamBytes: number,
): Promise<BackupM15V2ExternalReferenceFailureCode | null> {
  const reference = asset.legacyReference;
  if (reference.sizeBytes > maxStreamBytes) return "stream_limit_exceeded";

  const identity: BackupM15V2LegacyLocalReferenceIdentity = {
    rootAlias: reference.rootAlias,
    relativePath: reference.relativePath,
  };

  let resolved: BackupM15V2ResolvedLegacyLocalReferenceSource | null;
  try {
    resolved = await resolver.resolveLegacyLocalReference(identity);
  } catch {
    return "reference_resolution_failed";
  }
  if (resolved === null || resolved === undefined) return "reference_missing";
  if (!isValidLegacyLocalSource(resolved)) return "resolver_contract_violation";
  if (resolved.rootAlias !== identity.rootAlias || resolved.relativePath !== identity.relativePath) {
    return "resolver_contract_violation";
  }

  const streamed = await readBoundedStream(resolved, maxStreamBytes);
  if (streamed === "limit_exceeded") return "stream_limit_exceeded";
  if (streamed === "contract_violation") return "resolver_contract_violation";
  if (streamed.sizeBytes !== resolved.sizeBytes) return "resolver_contract_violation";
  if (streamed.sizeBytes !== reference.sizeBytes) return "size_mismatch";
  if (streamed.contentSha256 !== reference.contentSha256) return "hash_mismatch";
  return null;
}

async function verifyObjectBackedReference(
  asset: BackupM15V2ObjectBackedImageAsset,
  resolver: BackupM15V2ObjectBackedReferenceResolver,
  maxStreamBytes: number,
): Promise<BackupM15V2ExternalReferenceFailureCode | null> {
  const reference = asset.objectReference;
  if (reference.sizeBytes > maxStreamBytes) return "stream_limit_exceeded";

  const identity: BackupM15V2ObjectBackedReferenceIdentity = {
    bucketAlias: reference.bucketAlias,
    key: reference.key,
    versionId: reference.versionId,
  };

  let resolved: BackupM15V2ResolvedObjectBackedReferenceSource | null;
  try {
    resolved = await resolver.resolveObjectBackedReference(identity);
  } catch {
    return "reference_resolution_failed";
  }
  if (resolved === null || resolved === undefined) return "reference_missing";
  if (!isValidObjectBackedSource(resolved)) return "resolver_contract_violation";
  if (resolved.bucketAlias !== identity.bucketAlias || resolved.key !== identity.key) {
    return "resolver_contract_violation";
  }
  // Exact-version pin: a resolver that substitutes any other version (e.g. "latest") fails closed here.
  if (resolved.versionId !== identity.versionId) return "version_mismatch";

  const streamed = await readBoundedStream(resolved, maxStreamBytes);
  if (streamed === "limit_exceeded") return "stream_limit_exceeded";
  if (streamed === "contract_violation") return "resolver_contract_violation";
  if (streamed.sizeBytes !== resolved.sizeBytes) return "resolver_contract_violation";
  if (streamed.sizeBytes !== reference.sizeBytes) return "size_mismatch";
  if (streamed.contentSha256 !== reference.contentSha256) return "hash_mismatch";
  return null;
}

function isValidLegacyLocalSource(value: unknown): value is BackupM15V2ResolvedLegacyLocalReferenceSource {
  if (value === null || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    source.rootAlias === "legacy-images" &&
    typeof source.relativePath === "string" &&
    source.relativePath.length > 0 &&
    Number.isSafeInteger(source.sizeBytes) &&
    (source.sizeBytes as number) >= 0 &&
    typeof source.openStream === "function"
  );
}

function isValidObjectBackedSource(value: unknown): value is BackupM15V2ResolvedObjectBackedReferenceSource {
  if (value === null || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.bucketAlias === "string" &&
    source.bucketAlias.length > 0 &&
    typeof source.key === "string" &&
    source.key.length > 0 &&
    typeof source.versionId === "string" &&
    source.versionId.length > 0 &&
    Number.isSafeInteger(source.sizeBytes) &&
    (source.sizeBytes as number) >= 0 &&
    typeof source.openStream === "function"
  );
}

async function readBoundedStream(
  source: { openStream(): ReadableStream<Uint8Array> },
  maxStreamBytes: number,
): Promise<{ sizeBytes: number; contentSha256: string } | "limit_exceeded" | "contract_violation"> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = source.openStream();
  } catch {
    return "contract_violation";
  }
  if (stream === null || typeof stream !== "object" || typeof stream.getReader !== "function") {
    return "contract_violation";
  }

  const reader = stream.getReader();
  const hash = createHash("sha256");
  let sizeBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        await reader.cancel().catch(() => undefined);
        return "contract_violation";
      }
      sizeBytes += result.value.byteLength;
      if (sizeBytes > maxStreamBytes) {
        await reader.cancel().catch(() => undefined);
        return "limit_exceeded";
      }
      hash.update(result.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return "contract_violation";
  } finally {
    reader.releaseLock();
  }

  return { sizeBytes, contentSha256: hash.digest("hex") };
}

function failure(
  code: BackupM15V2ExternalReferenceFailureCode,
  verifiedAt: string,
  referenceIndex: number | null,
  referenceKind: BackupM15V2ExternalReferenceKind | null,
  verifiedReferenceCount: number,
  legacyLocalReferenceCount: number,
  objectBackedReferenceCount: number,
): BackupM15V2ExternalReferenceVerificationFailure {
  return {
    ok: false,
    code,
    message: SAFE_FAILURE_MESSAGES[code],
    verifiedAt,
    referenceIndex,
    referenceKind,
    verifiedReferenceCount,
    legacyLocalReferenceCount,
    objectBackedReferenceCount,
  };
}
