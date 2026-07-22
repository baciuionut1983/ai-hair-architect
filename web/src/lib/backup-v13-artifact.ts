import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";

import type {
  BackupV13Artifact,
  BackupVerificationResult,
  BackupVerifyArtifactValidity,
  BackupVerifyChecksumStatus,
  BackupVerifyExternalReferenceStatus,
  BackupVerifyReason,
} from "@/lib/contracts";

export const BACKUP_V13_SCHEMA_VERSION = "m13.v1" as const;
export const BACKUP_V13_CANONICAL_VERSION = "sorted-json-v1" as const;
export const BACKUP_CHECKSUM_ALGORITHM = "sha256" as const;
export const BACKUP_LEGACY_M12_SCHEMA_VERSION = "m12.v1" as const;

export const MAX_BACKUP_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_BACKUP_SECTION_BYTES = 2 * 1024 * 1024;

export const MAX_ROWS_PER_SECTION = {
  clients: 2000,
  analyses: 10000,
  imageAssets: 10000,
  imageAnalyses: 10000,
  imageAnalysisReviews: 20000,
} as const;

const STORAGE_ROOT = path.join(process.cwd(), ".storage", "images");

export class BackupArtifactError extends Error {
  code: string;
  httpStatus: number;
  details?: Record<string, unknown>;

  constructor(code: string, httpStatus: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BackupArtifactError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function generateBackupId(): string {
  const time = Date.now().toString(36);
  const entropy = randomBytes(12).toString("hex");
  return `c${time}${entropy}`;
}

export function canonicalizeSortedJsonV1(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function withChecksumNull(artifact: BackupV13Artifact): BackupV13Artifact {
  return {
    ...artifact,
    checksum: null,
  };
}

export function computeArtifactChecksumHex(artifact: BackupV13Artifact): string {
  const canonical = canonicalizeSortedJsonV1(withChecksumNull(artifact));
  return createHash(BACKUP_CHECKSUM_ALGORITHM).update(canonical, "utf8").digest("hex");
}

export function computeCanonicalSectionBytes(section: unknown[]): number {
  return utf8ByteLength(canonicalizeSortedJsonV1(section));
}

export function computeCanonicalArtifactBytes(artifact: BackupV13Artifact): number {
  return utf8ByteLength(canonicalizeSortedJsonV1(artifact));
}

export function assertSectionRowLimits(counts: BackupV13Artifact["counts"]): void {
  assertLimit("clients", counts.clients, MAX_ROWS_PER_SECTION.clients);
  assertLimit("analyses", counts.analyses, MAX_ROWS_PER_SECTION.analyses);
  assertLimit("imageAssets", counts.imageAssets, MAX_ROWS_PER_SECTION.imageAssets);
  assertLimit("imageAnalyses", counts.imageAnalyses, MAX_ROWS_PER_SECTION.imageAnalyses);
  assertLimit("imageAnalysisReviews", counts.imageAnalysisReviews, MAX_ROWS_PER_SECTION.imageAnalysisReviews);
}

export function assertSectionByteLimits(artifact: BackupV13Artifact): void {
  assertBytes("clients", computeCanonicalSectionBytes(artifact.sections.clients));
  assertBytes("analyses", computeCanonicalSectionBytes(artifact.sections.analyses));
  assertBytes("imageAssets", computeCanonicalSectionBytes(artifact.sections.imageAssets));
  assertBytes("imageAnalyses", computeCanonicalSectionBytes(artifact.sections.imageAnalyses));
  assertBytes("imageAnalysisReviews", computeCanonicalSectionBytes(artifact.sections.imageAnalysisReviews));
}

export function assertTotalArtifactByteLimit(artifact: BackupV13Artifact): void {
  const bytes = computeCanonicalArtifactBytes(artifact);
  if (bytes > MAX_BACKUP_ARTIFACT_BYTES) {
    throw new BackupArtifactError(
      "BACKUP_ARTIFACT_SIZE_LIMIT_EXCEEDED",
      413,
      "Backup artifact exceeds total size limit.",
      { limit: MAX_BACKUP_ARTIFACT_BYTES, actual: bytes },
    );
  }
}

export function isRecognizedLegacyM12Summary(snapshot: unknown): boolean {
  const obj = asRecord(snapshot);
  return (
    typeof obj.clientsCount === "number" &&
    typeof obj.consultationsCount === "number" &&
    typeof obj.appointmentsCount === "number" &&
    typeof obj.notificationsCount === "number" &&
    typeof obj.workspacesCount === "number"
  );
}

export function parseSnapshotSchemaVersion(
  columnSchemaVersion: string | null,
  snapshot: unknown,
): string | null {
  if (columnSchemaVersion && columnSchemaVersion.trim()) {
    return columnSchemaVersion;
  }

  const obj = asRecord(snapshot);
  if (typeof obj.schemaVersion === "string" && obj.schemaVersion.trim()) {
    return obj.schemaVersion;
  }

  if (isRecognizedLegacyM12Summary(snapshot)) {
    return BACKUP_LEGACY_M12_SCHEMA_VERSION;
  }

  return null;
}

export function isBackupV13Artifact(value: unknown): value is BackupV13Artifact {
  const obj = asRecord(value);
  if (obj.schemaVersion !== BACKUP_V13_SCHEMA_VERSION) {
    return false;
  }

  if (obj.canonicalSerializationVersion !== BACKUP_V13_CANONICAL_VERSION) {
    return false;
  }

  if (obj.checksumAlgorithm !== BACKUP_CHECKSUM_ALGORITHM) {
    return false;
  }

  if (typeof obj.backupId !== "string" || typeof obj.ownerUserId !== "string" || typeof obj.createdByUserId !== "string") {
    return false;
  }

  if (!obj.sections || typeof obj.sections !== "object") {
    return false;
  }

  const sections = obj.sections as Record<string, unknown>;
  return (
    Array.isArray(sections.clients) &&
    Array.isArray(sections.analyses) &&
    Array.isArray(sections.imageAssets) &&
    Array.isArray(sections.imageAnalyses) &&
    Array.isArray(sections.imageAnalysisReviews)
  );
}

export async function verifyExternalReferences(artifact: BackupV13Artifact): Promise<{
  status: BackupVerifyExternalReferenceStatus;
  reason: BackupVerifyReason | null;
}> {
  if (artifact.sections.imageAssets.length === 0) {
    return {
      status: "not_applicable",
      reason: null,
    };
  }

  for (const asset of artifact.sections.imageAssets) {
    const safePath = resolveSafeStoragePath(asset.storagePath);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(safePath);
    } catch {
      throw new BackupArtifactError(
        "BACKUP_EXTERNAL_OBJECT_MISSING",
        422,
        "Referenced image object does not exist.",
        { storagePath: asset.storagePath },
      );
    }

    if (stat.isSymbolicLink()) {
      let resolvedRealPath: string;
      try {
        resolvedRealPath = await fs.promises.realpath(safePath);
      } catch {
        throw new BackupArtifactError(
          "BACKUP_EXTERNAL_OBJECT_MISSING",
          422,
          "Referenced symbolic link target does not exist.",
          { storagePath: asset.storagePath },
        );
      }
      const rootResolved = path.resolve(STORAGE_ROOT);
      if (!resolvedRealPath.startsWith(rootResolved + path.sep) && resolvedRealPath !== rootResolved) {
        throw new BackupArtifactError(
          "BACKUP_EXTERNAL_REFERENCE_UNSAFE",
          422,
          "Symbolic link escapes authorized storage root.",
          { storagePath: asset.storagePath },
        );
      }

      stat = await fs.promises.stat(resolvedRealPath);
    }

    if (!stat.isFile()) {
      throw new BackupArtifactError(
        "BACKUP_EXTERNAL_REFERENCE_UNSAFE",
        422,
        "Referenced storage path is not a regular file.",
        { storagePath: asset.storagePath },
      );
    }
  }

  return {
    status: "all_exist_integrity_unverified",
    reason: "external_binary_integrity_unavailable",
  };
}

export function buildVerificationResult(input: {
  backupId: string;
  schemaVersion: string | null;
  checksumStatus: BackupVerifyChecksumStatus;
  artifactValidity: BackupVerifyArtifactValidity;
  externalReferenceStatus: BackupVerifyExternalReferenceStatus;
  recoveryArtifactStatus: BackupVerificationResult["recoveryArtifactStatus"];
  reason: BackupVerifyReason | null;
}): BackupVerificationResult {
  return {
    backupId: input.backupId,
    schemaVersion: input.schemaVersion,
    checksumStatus: input.checksumStatus,
    artifactValidity: input.artifactValidity,
    externalReferenceStatus: input.externalReferenceStatus,
    recoveryArtifactStatus: input.recoveryArtifactStatus,
    reason: input.reason,
    verifiedAt: new Date().toISOString(),
  };
}

export function resolveSafeStoragePath(rawPath: string): string {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new BackupArtifactError("BACKUP_EXTERNAL_REFERENCE_UNSAFE", 422, "Storage path is empty.");
  }

  const normalized = path.normalize(rawPath);
  const resolved = path.resolve(normalized);

  if (!path.isAbsolute(normalized)) {
    throw new BackupArtifactError(
      "BACKUP_EXTERNAL_REFERENCE_UNSAFE",
      422,
      "Storage path must be absolute within storage root.",
      { storagePath: rawPath },
    );
  }

  const rootResolved = path.resolve(STORAGE_ROOT);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new BackupArtifactError(
      "BACKUP_EXTERNAL_REFERENCE_UNSAFE",
      422,
      "Storage path escapes authorized storage root.",
      { storagePath: rawPath },
    );
  }

  return resolved;
}

function assertLimit(section: string, actual: number, limit: number): void {
  if (actual > limit) {
    throw new BackupArtifactError(
      "BACKUP_SECTION_ROW_LIMIT_EXCEEDED",
      413,
      "Backup section row limit exceeded.",
      { section, limit, actualCount: actual },
    );
  }
}

function assertBytes(section: string, actualBytes: number): void {
  if (actualBytes > MAX_BACKUP_SECTION_BYTES) {
    throw new BackupArtifactError(
      "BACKUP_SECTION_SIZE_LIMIT_EXCEEDED",
      413,
      "Backup section serialized payload exceeds section byte limit.",
      { section, limitBytes: MAX_BACKUP_SECTION_BYTES, actualBytes },
    );
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, key) => {
        const entry = (value as Record<string, unknown>)[key];
        if (entry !== undefined) {
          accumulator[key] = sortJsonValue(entry);
        }
        return accumulator;
      }, {});
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
