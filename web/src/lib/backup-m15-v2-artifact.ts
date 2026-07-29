import { createHash } from "crypto";

import type {
  BackupM15V2Artifact,
  BackupM15V2ImageAssetSectionRow,
  BackupV13AnalysisSectionRow,
  BackupV13ImageAnalysisReviewSectionRow,
  BackupV13ImageAnalysisSectionRow,
  BackupV13V2ClientSectionRow,
  BackupV13V3ConsultationSectionRow,
} from "./contracts";

export const M15_V2_SCHEMA_VERSION = "m15.v2" as const;
export const M15_V2_CANONICAL_SERIALIZATION_VERSION = "sorted-json-v2" as const;
export const M15_V2_CHECKSUM_ALGORITHM = "sha256" as const;

export const M15_V2_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const M15_V2_MAX_SECTION_BYTES = 2 * 1024 * 1024;
export const M15_V2_MAX_OBJECT_BYTES = 8 * 1024 * 1024;
export const M15_V2_MAX_ROWS_PER_SECTION = {
  clients: 2000,
  analyses: 10000,
  consultations: 10000,
  imageAssets: 10000,
  imageAnalyses: 10000,
  imageAnalysisReviews: 20000,
} as const;

export type BackupM15V2ArtifactErrorCode =
  | "M15_V2_JSON_INVALID"
  | "M15_V2_SCHEMA_INVALID"
  | "M15_V2_SCHEMA_VERSION_MISMATCH"
  | "M15_V2_STRUCTURE_INVALID"
  | "M15_V2_CHECKSUM_MISMATCH"
  | "M15_V2_STORAGE_KIND_UNKNOWN"
  | "M15_V2_LEGACY_REFERENCE_INVALID"
  | "M15_V2_OBJECT_REFERENCE_INVALID"
  | "M15_V2_FORBIDDEN_FIELD"
  | "M15_V2_DUPLICATE_ID"
  | "M15_V2_DUPLICATE_EXTERNAL_IDENTITY"
  | "M15_V2_SECTION_ORDER_INVALID"
  | "M15_V2_OWNER_SCOPE_MISMATCH"
  | "M15_V2_COUNT_MISMATCH"
  | "M15_V2_TIMESTAMP_INVALID"
  | "M15_V2_NUMERIC_BOUNDS_INVALID"
  | "M15_V2_LIMIT_EXCEEDED";

const SAFE_MESSAGES: Record<BackupM15V2ArtifactErrorCode, string> = {
  M15_V2_JSON_INVALID: "The M15 v2 artifact contains an invalid JSON value.",
  M15_V2_SCHEMA_INVALID: "The M15 v2 artifact schema is invalid.",
  M15_V2_SCHEMA_VERSION_MISMATCH: "The artifact is not an M15 v2 artifact.",
  M15_V2_STRUCTURE_INVALID: "The M15 v2 artifact structure is invalid.",
  M15_V2_CHECKSUM_MISMATCH: "The M15 v2 artifact checksum is invalid.",
  M15_V2_STORAGE_KIND_UNKNOWN: "The M15 v2 storage kind is unsupported.",
  M15_V2_LEGACY_REFERENCE_INVALID: "The M15 v2 legacy reference is invalid.",
  M15_V2_OBJECT_REFERENCE_INVALID: "The M15 v2 object reference is invalid.",
  M15_V2_FORBIDDEN_FIELD: "The M15 v2 artifact contains a forbidden field.",
  M15_V2_DUPLICATE_ID: "The M15 v2 artifact contains a duplicate record identity.",
  M15_V2_DUPLICATE_EXTERNAL_IDENTITY: "The M15 v2 artifact contains a duplicate external identity.",
  M15_V2_SECTION_ORDER_INVALID: "The M15 v2 artifact section order is invalid.",
  M15_V2_OWNER_SCOPE_MISMATCH: "The M15 v2 artifact owner scope is invalid.",
  M15_V2_COUNT_MISMATCH: "The M15 v2 artifact counts are invalid.",
  M15_V2_TIMESTAMP_INVALID: "The M15 v2 artifact contains an invalid timestamp.",
  M15_V2_NUMERIC_BOUNDS_INVALID: "The M15 v2 artifact contains an invalid numeric value.",
  M15_V2_LIMIT_EXCEEDED: "The M15 v2 artifact exceeds an approved limit.",
};

export class BackupM15V2ArtifactError extends Error {
  readonly code: BackupM15V2ArtifactErrorCode;

  constructor(code: BackupM15V2ArtifactErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "BackupM15V2ArtifactError";
    this.code = code;
  }
}

export type BackupM15V2ArtifactInput = Omit<BackupM15V2Artifact, "checksum"> & {
  checksum?: null;
};

const ARTIFACT_KEYS = [
  "schemaVersion", "canonicalSerializationVersion", "checksumAlgorithm", "checksum", "backupId",
  "ownerUserId", "createdByUserId", "label", "createdAt", "summarySnapshot", "counts", "limits", "sections",
] as const;
const SUMMARY_KEYS = ["clientsCount", "consultationsCount", "appointmentsCount", "notificationsCount", "workspacesCount"] as const;
const SECTION_KEYS = ["clients", "analyses", "consultations", "imageAssets", "imageAnalyses", "imageAnalysisReviews"] as const;
const LIMIT_KEYS = ["maxArtifactBytes", "maxSectionBytes", "maxRowsPerSection"] as const;
const CLIENT_KEYS = ["id", "fullName", "email", "phone", "notes", "deletedAt", "ownerUserId", "createdAt", "updatedAt"] as const;
const ANALYSIS_KEYS = [
  "id", "clientId", "ownerUserId", "goal", "hairType", "density", "porosity", "phase", "clarificationRound",
  "confidenceScore", "uncertaintyReasons", "followUpQuestions", "recommendations", "safetyNotes", "faceShape",
  "headShape", "hairLength", "hairTexture", "hairCondition", "growthPattern", "targetShape", "technicalCutPlan",
  "clarificationAnswers", "imageAssetId", "imageAnalysisId", "m8DraftCreatedAt", "m8FinalizedAt", "createdAt", "updatedAt",
] as const;
const CONSULTATION_KEYS = ["id", "ownerUserId", "clientId", "analysisId", "summary", "nextSteps", "createdAt"] as const;
const COMMON_IMAGE_ASSET_KEYS = [
  "id", "fileName", "mimeType", "sizeBytes", "ownerUserId", "clientId", "exifStripped", "normalizedOrientation",
  "uploadedAt", "deletedAt", "retentionDeletesAt", "createdAt", "updatedAt",
] as const;
const LEGACY_IMAGE_ASSET_KEYS = [...COMMON_IMAGE_ASSET_KEYS, "storageKind", "legacyReference"] as const;
const OBJECT_IMAGE_ASSET_KEYS = [
  ...COMMON_IMAGE_ASSET_KEYS, "storageKind", "objectReference", "storageEtag", "storageState", "storageMigratedAt",
  "objectDeletedAt", "lastStorageErrorCode",
] as const;
const LEGACY_REFERENCE_KEYS = ["backend", "rootAlias", "relativePath", "contentSha256", "sizeBytes"] as const;
const OBJECT_REFERENCE_KEYS = ["backend", "bucketAlias", "key", "versionId", "contentSha256", "sizeBytes"] as const;
const IMAGE_ANALYSIS_KEYS = [
  "id", "assetId", "status", "providerName", "modelVersion", "analysisPayload", "confidences", "unknownFields",
  "warnings", "limitations", "consentTimestamp", "deletedAt", "retentionDeletesAt", "createdAt", "updatedAt",
] as const;
const REVIEW_KEYS = [
  "id", "analysisId", "reviewedByUserId", "manualCorrections", "confirmationTimestamp", "notes", "createdAt", "updatedAt",
] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
// Approved v2 portable-reference limits: alias 64, exact version 1024, basename 255.
const BUCKET_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const VERSION_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,1024}$/;
const MAX_LEGACY_BASENAME_LENGTH = 255;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const SAFE_STORAGE_ERROR_CODES = new Set([
  "not_found", "access_denied", "timeout", "throttled", "configuration", "missing_version", "integrity_mismatch",
  "invalid_state", "capability_unavailable", "provider_unavailable",
]);

export function buildBackupM15V2Artifact(input: BackupM15V2ArtifactInput): BackupM15V2Artifact {
  assertJsonSafe(input);
  const candidate = structuredClone({ ...input, checksum: null }) as BackupM15V2Artifact;
  validateArtifact(candidate, { checksum: "nullable", orderedSections: false });
  candidate.sections = sortSections(candidate.sections);
  candidate.checksum = computeChecksumForValidatedArtifact(candidate);
  validateArtifact(candidate, { checksum: "required", orderedSections: true });
  assertArtifactLimits(candidate);
  return structuredClone(candidate);
}

export function parseBackupM15V2Artifact(value: unknown): BackupM15V2Artifact {
  assertJsonSafe(value);
  const artifact = structuredClone(value) as BackupM15V2Artifact;
  validateArtifact(artifact, { checksum: "required", orderedSections: true });
  const expected = computeChecksumForValidatedArtifact(artifact);
  if (artifact.checksum !== expected) fail("M15_V2_CHECKSUM_MISMATCH");
  assertArtifactLimits(artifact);
  return structuredClone(artifact);
}

export function isBackupM15V2Artifact(value: unknown): value is BackupM15V2Artifact {
  try {
    parseBackupM15V2Artifact(value);
    return true;
  } catch {
    return false;
  }
}

export function computeBackupM15V2Checksum(artifact: BackupM15V2Artifact): string {
  assertJsonSafe(artifact);
  validateArtifact(artifact, { checksum: "required", orderedSections: true });
  return computeChecksumForValidatedArtifact(artifact);
}

export function canonicalizeM15V2(value: unknown): string {
  assertJsonSafe(value);
  return JSON.stringify(sortJsonObjectKeys(value));
}

function computeChecksumForValidatedArtifact(artifact: BackupM15V2Artifact): string {
  return createHash(M15_V2_CHECKSUM_ALGORITHM)
    .update(canonicalizeM15V2({ ...artifact, checksum: null }), "utf8")
    .digest("hex");
}

function validateArtifact(
  value: unknown,
  options: { checksum: "nullable" | "required"; orderedSections: boolean },
): asserts value is BackupM15V2Artifact {
  const artifact = requireRecord(value, "M15_V2_SCHEMA_INVALID");
  requireExactKeys(artifact, ARTIFACT_KEYS);
  if (artifact.schemaVersion !== M15_V2_SCHEMA_VERSION) fail("M15_V2_SCHEMA_VERSION_MISMATCH");
  if (
    artifact.canonicalSerializationVersion !== M15_V2_CANONICAL_SERIALIZATION_VERSION ||
    artifact.checksumAlgorithm !== M15_V2_CHECKSUM_ALGORITHM
  ) fail("M15_V2_SCHEMA_INVALID");
  if (options.checksum === "required") requireSha256(artifact.checksum, "M15_V2_CHECKSUM_MISMATCH");
  else if (artifact.checksum !== null) fail("M15_V2_CHECKSUM_MISMATCH");
  requireNonEmptyString(artifact.backupId);
  requireUuid(artifact.ownerUserId, "M15_V2_OWNER_SCOPE_MISMATCH");
  requireUuid(artifact.createdByUserId, "M15_V2_OWNER_SCOPE_MISMATCH");
  requireString(artifact.label);
  requireTimestamp(artifact.createdAt);

  const summary = requireRecord(artifact.summarySnapshot);
  requireExactKeys(summary, SUMMARY_KEYS);
  for (const key of SUMMARY_KEYS) requireNonNegativeInteger(summary[key]);

  const counts = requireRecord(artifact.counts);
  requireExactKeys(counts, SECTION_KEYS);
  for (const key of SECTION_KEYS) requireNonNegativeInteger(counts[key]);

  const limits = requireRecord(artifact.limits);
  requireExactKeys(limits, LIMIT_KEYS);
  requirePositiveInteger(limits.maxArtifactBytes);
  requirePositiveInteger(limits.maxSectionBytes);
  const rowLimits = requireRecord(limits.maxRowsPerSection);
  requireExactKeys(rowLimits, SECTION_KEYS);
  for (const key of SECTION_KEYS) requirePositiveInteger(rowLimits[key]);
  const validatedRowLimits = rowLimits as Record<typeof SECTION_KEYS[number], number>;

  const sections = requireRecord(artifact.sections);
  requireExactKeys(sections, SECTION_KEYS);
  const arrays = Object.fromEntries(SECTION_KEYS.map((key) => [key, requireArray(sections[key])])) as Record<typeof SECTION_KEYS[number], unknown[]>;
  for (const key of SECTION_KEYS) {
    if (counts[key] !== arrays[key].length) fail("M15_V2_COUNT_MISMATCH");
    if (arrays[key].length > validatedRowLimits[key] || arrays[key].length > M15_V2_MAX_ROWS_PER_SECTION[key]) fail("M15_V2_LIMIT_EXCEEDED");
    assertUniqueAndOrderedIds(arrays[key], options.orderedSections);
  }
  assertUniqueExternalIdentities(arrays.imageAssets as BackupM15V2ImageAssetSectionRow[]);

  arrays.clients.forEach((row) => assertClientRow(row, artifact.ownerUserId as string));
  arrays.analyses.forEach((row) => assertAnalysisRow(row, artifact.ownerUserId as string));
  arrays.consultations.forEach((row) => assertConsultationRow(row, artifact.ownerUserId as string));
  arrays.imageAssets.forEach((row) => assertImageAssetRow(row, artifact.ownerUserId as string));
  arrays.imageAnalyses.forEach(assertImageAnalysisRow);
  arrays.imageAnalysisReviews.forEach(assertReviewRow);
}

function assertClientRow(value: unknown, ownerUserId: string): asserts value is BackupV13V2ClientSectionRow {
  const row = requireRecord(value);
  requireExactKeys(row, CLIENT_KEYS);
  assertOwnedIdentity(row, ownerUserId);
  requireString(row.fullName);
  requireNullableString(row.email);
  requireNullableString(row.phone);
  requireNullableString(row.notes);
  requireNullableTimestamp(row.deletedAt);
}

function assertAnalysisRow(value: unknown, ownerUserId: string): asserts value is BackupV13AnalysisSectionRow {
  const row = requireRecord(value);
  requireExactKeys(row, ANALYSIS_KEYS);
  assertOwnedIdentity(row, ownerUserId);
  for (const key of ["clientId", "goal", "hairType", "density", "porosity", "phase"] as const) requireNonEmptyString(row[key]);
  requireNonNegativeInteger(row.clarificationRound);
  requireFiniteNumber(row.confidenceScore);
  for (const key of ["faceShape", "headShape", "hairLength", "hairTexture", "hairCondition", "growthPattern", "targetShape", "imageAssetId", "imageAnalysisId"] as const) requireNullableString(row[key]);
  requireNullableTimestamp(row.m8DraftCreatedAt);
  requireNullableTimestamp(row.m8FinalizedAt);
}

function assertConsultationRow(value: unknown, ownerUserId: string): asserts value is BackupV13V3ConsultationSectionRow {
  const row = requireRecord(value);
  requireExactKeys(row, CONSULTATION_KEYS);
  assertIdentity(row);
  if (row.ownerUserId !== ownerUserId) fail("M15_V2_OWNER_SCOPE_MISMATCH");
  for (const key of ["ownerUserId", "clientId", "analysisId", "summary"] as const) requireNonEmptyString(row[key]);
  if (!Array.isArray(row.nextSteps) || row.nextSteps.some((entry) => typeof entry !== "string" || !entry.trim())) fail("M15_V2_STRUCTURE_INVALID");
}

function assertImageAssetRow(value: unknown, ownerUserId: string): asserts value is BackupM15V2ImageAssetSectionRow {
  const row = requireRecord(value);
  if (row.storageKind !== "legacy-local" && row.storageKind !== "object-backed") fail("M15_V2_STORAGE_KIND_UNKNOWN");
  if (row.storageKind === "legacy-local") assertLegacyImageAsset(row, ownerUserId);
  else assertObjectImageAsset(row, ownerUserId);
}

function assertCommonImageAsset(row: Record<string, unknown>, ownerUserId: string): void {
  assertOwnedIdentity(row, ownerUserId);
  requireUuid(row.id, "M15_V2_STRUCTURE_INVALID");
  for (const key of ["fileName", "mimeType", "clientId"] as const) requireNonEmptyString(row[key]);
  requireBoundedObjectSize(row.sizeBytes);
  if (typeof row.exifStripped !== "boolean") fail("M15_V2_STRUCTURE_INVALID");
  requireSafeInteger(row.normalizedOrientation);
  requireTimestamp(row.uploadedAt);
  requireNullableTimestamp(row.deletedAt);
  requireNullableTimestamp(row.retentionDeletesAt);
}

function assertLegacyImageAsset(row: Record<string, unknown>, ownerUserId: string): void {
  requireExactKeys(row, LEGACY_IMAGE_ASSET_KEYS);
  assertCommonImageAsset(row, ownerUserId);
  const reference = requireRecord(row.legacyReference, "M15_V2_LEGACY_REFERENCE_INVALID");
  requireExactKeys(reference, LEGACY_REFERENCE_KEYS);
  if (reference.backend !== "local" || reference.rootAlias !== "legacy-images") fail("M15_V2_LEGACY_REFERENCE_INVALID");
  requireSha256(reference.contentSha256, "M15_V2_LEGACY_REFERENCE_INVALID");
  requireBoundedObjectSize(reference.sizeBytes, "M15_V2_LEGACY_REFERENCE_INVALID");
  if (reference.sizeBytes !== row.sizeBytes) fail("M15_V2_LEGACY_REFERENCE_INVALID");
  assertLegacyRelativePath(reference.relativePath, row.ownerUserId as string, row.id as string);
}

function assertObjectImageAsset(row: Record<string, unknown>, ownerUserId: string): void {
  requireExactKeys(row, OBJECT_IMAGE_ASSET_KEYS);
  assertCommonImageAsset(row, ownerUserId);
  const reference = requireRecord(row.objectReference, "M15_V2_OBJECT_REFERENCE_INVALID");
  requireExactKeys(reference, OBJECT_REFERENCE_KEYS);
  if (reference.backend !== "s3" || typeof reference.bucketAlias !== "string" || !BUCKET_ALIAS_PATTERN.test(reference.bucketAlias)) fail("M15_V2_OBJECT_REFERENCE_INVALID");
  if (typeof reference.versionId !== "string" || !VERSION_ID_PATTERN.test(reference.versionId) || !reference.versionId.trim()) fail("M15_V2_OBJECT_REFERENCE_INVALID");
  requireSha256(reference.contentSha256, "M15_V2_OBJECT_REFERENCE_INVALID");
  requireBoundedObjectSize(reference.sizeBytes, "M15_V2_OBJECT_REFERENCE_INVALID");
  if (reference.sizeBytes !== row.sizeBytes) fail("M15_V2_OBJECT_REFERENCE_INVALID");
  const expectedKey = `v1/owners/${row.ownerUserId}/assets/${row.id}/original`;
  if (reference.key !== expectedKey) fail("M15_V2_OBJECT_REFERENCE_INVALID");
  requireNullableString(row.storageEtag);
  requireNullableTimestamp(row.storageMigratedAt);
  if (row.objectDeletedAt !== null) fail("M15_V2_STRUCTURE_INVALID");
  requireNullableString(row.lastStorageErrorCode);
  if (typeof row.lastStorageErrorCode === "string" && !SAFE_STORAGE_ERROR_CODES.has(row.lastStorageErrorCode)) fail("M15_V2_STRUCTURE_INVALID");
  if (row.storageState === "available") {
    if (row.deletedAt !== null || row.retentionDeletesAt !== null) fail("M15_V2_STRUCTURE_INVALID");
  } else if (row.storageState === "delete_pending") {
    requireTimestamp(row.deletedAt);
    requireTimestamp(row.retentionDeletesAt);
    if (Date.parse(row.retentionDeletesAt) <= Date.parse(row.deletedAt)) fail("M15_V2_TIMESTAMP_INVALID");
  } else {
    fail("M15_V2_STRUCTURE_INVALID");
  }
}

function assertImageAnalysisRow(value: unknown): asserts value is BackupV13ImageAnalysisSectionRow {
  const row = requireRecord(value);
  requireExactKeys(row, IMAGE_ANALYSIS_KEYS);
  assertIdentity(row);
  for (const key of ["assetId", "status", "providerName", "modelVersion"] as const) requireNonEmptyString(row[key]);
  requireTimestamp(row.consentTimestamp);
  requireNullableTimestamp(row.deletedAt);
  requireNullableTimestamp(row.retentionDeletesAt);
}

function assertReviewRow(value: unknown): asserts value is BackupV13ImageAnalysisReviewSectionRow {
  const row = requireRecord(value);
  requireExactKeys(row, REVIEW_KEYS);
  assertIdentity(row);
  requireNonEmptyString(row.analysisId);
  requireNonEmptyString(row.reviewedByUserId);
  requireNullableTimestamp(row.confirmationTimestamp);
  requireNullableString(row.notes);
}

function assertLegacyRelativePath(value: unknown, ownerUserId: string, assetId: string): void {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\") || /^[A-Za-z]:/.test(value) || CONTROL_CHARACTER_PATTERN.test(value)) {
    fail("M15_V2_LEGACY_REFERENCE_INVALID");
  }
  const segments = value.split("/");
  if (segments.length !== 3 || segments.some((segment) => !segment || segment === "." || segment === "..")) fail("M15_V2_LEGACY_REFERENCE_INVALID");
  const [ownerSegment, assetSegment, basename] = segments;
  if (ownerSegment !== ownerUserId || assetSegment !== assetId || !UUID_PATTERN.test(ownerSegment) || !UUID_PATTERN.test(assetSegment)) fail("M15_V2_LEGACY_REFERENCE_INVALID");
  if (!basename || basename.length > MAX_LEGACY_BASENAME_LENGTH || basename.normalize("NFC") !== basename || CONTROL_CHARACTER_PATTERN.test(basename)) fail("M15_V2_LEGACY_REFERENCE_INVALID");
}

function assertUniqueExternalIdentities(assets: BackupM15V2ImageAssetSectionRow[]): void {
  const identities = new Set<string>();
  for (const asset of assets) {
    let identity: string;
    if (asset.storageKind === "legacy-local") {
      if (asset.legacyReference === null || typeof asset.legacyReference !== "object") continue;
      identity = JSON.stringify(["local", asset.legacyReference.rootAlias, asset.legacyReference.relativePath]);
    } else if (asset.storageKind === "object-backed") {
      if (asset.objectReference === null || typeof asset.objectReference !== "object") continue;
      identity = JSON.stringify([
        "s3",
        asset.objectReference.bucketAlias,
        asset.objectReference.key,
        asset.objectReference.versionId,
      ]);
    } else {
      continue;
    }
    if (identities.has(identity)) fail("M15_V2_DUPLICATE_EXTERNAL_IDENTITY");
    identities.add(identity);
  }
}

function assertUniqueAndOrderedIds(rows: unknown[], requireOrder: boolean): void {
  const ids = rows.map((row) => {
    const record = requireRecord(row);
    requireNonEmptyString(record.id);
    return record.id;
  });
  if (new Set(ids).size !== ids.length) fail("M15_V2_DUPLICATE_ID");
  if (requireOrder && ids.some((id, index) => index > 0 && compareCanonicalStrings(ids[index - 1], id) >= 0)) fail("M15_V2_SECTION_ORDER_INVALID");
}

function sortSections(sections: BackupM15V2Artifact["sections"]): BackupM15V2Artifact["sections"] {
  return {
    clients: sortRows(sections.clients),
    analyses: sortRows(sections.analyses),
    consultations: sortRows(sections.consultations),
    imageAssets: sortRows(sections.imageAssets),
    imageAnalyses: sortRows(sections.imageAnalyses),
    imageAnalysisReviews: sortRows(sections.imageAnalysisReviews),
  };
}

function sortRows<T extends { id: string }>(rows: T[]): T[] {
  return structuredClone(rows).sort((left, right) => compareCanonicalStrings(left.id, right.id));
}

function compareCanonicalStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertArtifactLimits(artifact: BackupM15V2Artifact): void {
  for (const key of SECTION_KEYS) {
    const bytes = Buffer.byteLength(canonicalizeM15V2(artifact.sections[key]), "utf8");
    if (bytes > artifact.limits.maxSectionBytes || bytes > M15_V2_MAX_SECTION_BYTES) fail("M15_V2_LIMIT_EXCEEDED");
  }
  const totalBytes = Buffer.byteLength(canonicalizeM15V2(artifact), "utf8");
  if (totalBytes > artifact.limits.maxArtifactBytes || totalBytes > M15_V2_MAX_ARTIFACT_BYTES) fail("M15_V2_LIMIT_EXCEEDED");
}

function assertJsonSafe(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail("M15_V2_JSON_INVALID");
    return;
  }
  if (typeof value !== "object") fail("M15_V2_JSON_INVALID");
  if (seen.has(value)) fail("M15_V2_JSON_INVALID");
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) fail("M15_V2_JSON_INVALID");
      assertJsonSafe(value[index], seen);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) fail("M15_V2_JSON_INVALID");
    for (const key of Object.keys(value)) assertJsonSafe((value as Record<string, unknown>)[key], seen);
  }
  seen.delete(value);
}

function sortJsonObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonObjectKeys);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort(compareCanonicalStrings)
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortJsonObjectKeys((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value);
  const expectedSet = new Set(expected);
  if (actual.some((key) => !expectedSet.has(key))) fail("M15_V2_FORBIDDEN_FIELD");
  if (actual.length !== expected.length || expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) fail("M15_V2_STRUCTURE_INVALID");
}

function requireRecord(value: unknown, code: BackupM15V2ArtifactErrorCode = "M15_V2_STRUCTURE_INVALID"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail("M15_V2_STRUCTURE_INVALID");
  return value;
}

function assertIdentity(row: Record<string, unknown>): void {
  requireNonEmptyString(row.id);
  requireTimestamp(row.createdAt);
  if (Object.prototype.hasOwnProperty.call(row, "updatedAt")) requireTimestamp(row.updatedAt);
}

function assertOwnedIdentity(row: Record<string, unknown>, ownerUserId: string): void {
  assertIdentity(row);
  if (row.ownerUserId !== ownerUserId) fail("M15_V2_OWNER_SCOPE_MISMATCH");
}

function requireString(value: unknown): asserts value is string {
  if (typeof value !== "string") fail("M15_V2_STRUCTURE_INVALID");
}

function requireNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail("M15_V2_STRUCTURE_INVALID");
}

function requireNullableString(value: unknown): void {
  if (value !== null && typeof value !== "string") fail("M15_V2_STRUCTURE_INVALID");
}

function requireTimestamp(value: unknown): asserts value is string {
  if (typeof value !== "string") fail("M15_V2_TIMESTAMP_INVALID");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) fail("M15_V2_TIMESTAMP_INVALID");
}

function requireNullableTimestamp(value: unknown): void {
  if (value !== null) requireTimestamp(value);
}

function requireFiniteNumber(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("M15_V2_NUMERIC_BOUNDS_INVALID");
}

function requireSafeInteger(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value)) fail("M15_V2_NUMERIC_BOUNDS_INVALID");
}

function requireNonNegativeInteger(value: unknown): asserts value is number {
  requireSafeInteger(value);
  if (value < 0) fail("M15_V2_NUMERIC_BOUNDS_INVALID");
}

function requirePositiveInteger(value: unknown): asserts value is number {
  requireSafeInteger(value);
  if (value <= 0) fail("M15_V2_NUMERIC_BOUNDS_INVALID");
}

function requireBoundedObjectSize(value: unknown, code: BackupM15V2ArtifactErrorCode = "M15_V2_NUMERIC_BOUNDS_INVALID"): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > M15_V2_MAX_OBJECT_BYTES) fail(code);
}

function requireUuid(value: unknown, code: BackupM15V2ArtifactErrorCode): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail(code);
}

function requireSha256(value: unknown, code: BackupM15V2ArtifactErrorCode): asserts value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail(code);
}

function fail(code: BackupM15V2ArtifactErrorCode): never {
  throw new BackupM15V2ArtifactError(code);
}