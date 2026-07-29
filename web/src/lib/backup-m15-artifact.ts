import { createHash } from "crypto";

import type {
  BackupM15V1Artifact,
  BackupM15V1ImageAssetSectionRow,
  BackupV13AnalysisSectionRow,
  BackupV13ImageAnalysisReviewSectionRow,
  BackupV13ImageAnalysisSectionRow,
  BackupV13V2ClientSectionRow,
  BackupV13V3ConsultationSectionRow,
} from "./contracts";
import {
  M15_V1_SCHEMA_VERSION,
  assertM15V1ObjectReference,
} from "./object-storage-runtime";

export const M15_CANONICAL_SERIALIZATION_VERSION = "sorted-json-v1" as const;
export const M15_CHECKSUM_ALGORITHM = "sha256" as const;

const ARTIFACT_KEYS = [
  "schemaVersion",
  "canonicalSerializationVersion",
  "checksumAlgorithm",
  "checksum",
  "backupId",
  "ownerUserId",
  "createdByUserId",
  "label",
  "createdAt",
  "summarySnapshot",
  "counts",
  "limits",
  "sections",
] as const;
const SUMMARY_KEYS = [
  "clientsCount",
  "consultationsCount",
  "appointmentsCount",
  "notificationsCount",
  "workspacesCount",
] as const;
const COUNT_KEYS = [
  "clients",
  "analyses",
  "consultations",
  "imageAssets",
  "imageAnalyses",
  "imageAnalysisReviews",
] as const;
const LIMIT_KEYS = ["maxArtifactBytes", "maxSectionBytes", "maxRowsPerSection"] as const;
const SECTION_KEYS = [
  "clients",
  "analyses",
  "consultations",
  "imageAssets",
  "imageAnalyses",
  "imageAnalysisReviews",
] as const;
const CLIENT_KEYS = ["id", "fullName", "email", "phone", "notes", "deletedAt", "ownerUserId", "createdAt", "updatedAt"] as const;
const ANALYSIS_KEYS = [
  "id", "clientId", "ownerUserId", "goal", "hairType", "density", "porosity", "phase",
  "clarificationRound", "confidenceScore", "uncertaintyReasons", "followUpQuestions", "recommendations",
  "safetyNotes", "faceShape", "headShape", "hairLength", "hairTexture", "hairCondition", "growthPattern",
  "targetShape", "technicalCutPlan", "clarificationAnswers", "imageAssetId", "imageAnalysisId",
  "m8DraftCreatedAt", "m8FinalizedAt", "createdAt", "updatedAt",
] as const;
const CONSULTATION_KEYS = ["id", "ownerUserId", "clientId", "analysisId", "summary", "nextSteps", "createdAt"] as const;
const IMAGE_ASSET_KEYS = [
  "id", "fileName", "mimeType", "sizeBytes", "ownerUserId", "clientId", "exifStripped",
  "normalizedOrientation", "uploadedAt", "deletedAt", "retentionDeletesAt", "createdAt", "updatedAt",
  "objectReference", "storageEtag", "storageState", "storageMigratedAt", "objectDeletedAt", "lastStorageErrorCode",
] as const;
const OBJECT_REFERENCE_KEYS = ["backend", "bucketAlias", "key", "versionId", "contentSha256", "sizeBytes"] as const;
const IMAGE_ANALYSIS_KEYS = [
  "id", "assetId", "status", "providerName", "modelVersion", "analysisPayload", "confidences",
  "unknownFields", "warnings", "limitations", "consentTimestamp", "deletedAt", "retentionDeletesAt",
  "createdAt", "updatedAt",
] as const;
const REVIEW_KEYS = [
  "id", "analysisId", "reviewedByUserId", "manualCorrections", "confirmationTimestamp", "notes", "createdAt", "updatedAt",
] as const;
const STORAGE_STATES = new Set(["pending_upload", "available", "delete_pending", "deleted", "quarantined"]);
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const CANONICAL_KEY_PATTERN = /^v1\/owners\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})\/original$/;

export type BackupM15V1ArtifactInput = Omit<BackupM15V1Artifact, "checksum"> & { checksum?: string | null };

export function buildBackupM15V1Artifact(input: BackupM15V1ArtifactInput): BackupM15V1Artifact {
  const candidate = structuredClone({ ...input, checksum: null }) as BackupM15V1Artifact;
  candidate.sections = {
    clients: sortRows(candidate.sections.clients),
    analyses: sortRows(candidate.sections.analyses),
    consultations: sortRows(candidate.sections.consultations),
    imageAssets: sortRows(candidate.sections.imageAssets),
    imageAnalyses: sortRows(candidate.sections.imageAnalyses),
    imageAnalysisReviews: sortRows(candidate.sections.imageAnalysisReviews),
  };
  assertBackupM15V1Artifact(candidate);
  candidate.checksum = computeBackupM15V1Checksum(candidate);
  return candidate;
}

export function parseBackupM15V1Artifact(value: unknown): BackupM15V1Artifact {
  assertBackupM15V1Artifact(value);
  return structuredClone(value);
}

export function isBackupM15V1Artifact(value: unknown): value is BackupM15V1Artifact {
  try {
    assertBackupM15V1Artifact(value);
    return true;
  } catch {
    return false;
  }
}

export function canonicalizeM15SortedJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function computeBackupM15V1Checksum(artifact: BackupM15V1Artifact): string {
  assertBackupM15V1Artifact({ ...artifact, checksum: null });
  return createHash(M15_CHECKSUM_ALGORITHM)
    .update(canonicalizeM15SortedJson({ ...artifact, checksum: null }), "utf8")
    .digest("hex");
}

export function assertBackupM15V1Artifact(value: unknown): asserts value is BackupM15V1Artifact {
  const artifact = requireRecord(value, "artifact");
  requireExactKeys(artifact, ARTIFACT_KEYS, "artifact");
  if (
    artifact.schemaVersion !== M15_V1_SCHEMA_VERSION ||
    artifact.canonicalSerializationVersion !== M15_CANONICAL_SERIALIZATION_VERSION ||
    artifact.checksumAlgorithm !== M15_CHECKSUM_ALGORITHM ||
    !(artifact.checksum === null || isLowercaseSha256(artifact.checksum))
  ) {
    fail("Artifact metadata is invalid.");
  }
  requireNonEmptyString(artifact.backupId, "backupId");
  requireNonEmptyString(artifact.ownerUserId, "ownerUserId");
  requireNonEmptyString(artifact.createdByUserId, "createdByUserId");
  requireString(artifact.label, "label");
  requireTimestamp(artifact.createdAt, "createdAt");

  const summary = requireRecord(artifact.summarySnapshot, "summarySnapshot");
  requireExactKeys(summary, SUMMARY_KEYS, "summarySnapshot");
  for (const key of SUMMARY_KEYS) requireNonNegativeSafeInteger(summary[key], `summarySnapshot.${key}`);

  const counts = requireRecord(artifact.counts, "counts");
  requireExactKeys(counts, COUNT_KEYS, "counts");
  for (const key of COUNT_KEYS) requireNonNegativeSafeInteger(counts[key], `counts.${key}`);

  const limits = requireRecord(artifact.limits, "limits");
  requireExactKeys(limits, LIMIT_KEYS, "limits");
  requirePositiveSafeInteger(limits.maxArtifactBytes, "limits.maxArtifactBytes");
  requirePositiveSafeInteger(limits.maxSectionBytes, "limits.maxSectionBytes");
  const rowLimits = requireRecord(limits.maxRowsPerSection, "limits.maxRowsPerSection");
  requireExactKeys(rowLimits, COUNT_KEYS, "limits.maxRowsPerSection");
  for (const key of COUNT_KEYS) requirePositiveSafeInteger(rowLimits[key], `limits.maxRowsPerSection.${key}`);

  const sections = requireRecord(artifact.sections, "sections");
  requireExactKeys(sections, SECTION_KEYS, "sections");
  const clients = requireArray(sections.clients, "sections.clients");
  const analyses = requireArray(sections.analyses, "sections.analyses");
  const consultations = requireArray(sections.consultations, "sections.consultations");
  const imageAssets = requireArray(sections.imageAssets, "sections.imageAssets");
  const imageAnalyses = requireArray(sections.imageAnalyses, "sections.imageAnalyses");
  const reviews = requireArray(sections.imageAnalysisReviews, "sections.imageAnalysisReviews");
  const arrays = { clients, analyses, consultations, imageAssets, imageAnalyses, imageAnalysisReviews: reviews };
  for (const key of COUNT_KEYS) {
    const count = counts[key] as number;
    const rowLimit = rowLimits[key] as number;
    if (count !== arrays[key].length || arrays[key].length > rowLimit) fail(`Count mismatch for ${key}.`);
  }

  clients.forEach(assertClientRow);
  analyses.forEach(assertAnalysisRow);
  consultations.forEach(assertConsultationRow);
  imageAssets.forEach(assertImageAssetRow);
  imageAnalyses.forEach(assertImageAnalysisRow);
  reviews.forEach(assertReviewRow);
  assertUniqueIds(arrays);
}

function assertClientRow(value: unknown): asserts value is BackupV13V2ClientSectionRow {
  const row = requireRecord(value, "client");
  requireExactKeys(row, CLIENT_KEYS, "client");
  requireOwnedIdentity(row);
  requireString(row.fullName, "client.fullName");
  requireNullableString(row.email, "client.email");
  requireNullableString(row.phone, "client.phone");
  requireNullableString(row.notes, "client.notes");
  requireNullableTimestamp(row.deletedAt, "client.deletedAt");
}

function assertAnalysisRow(value: unknown): asserts value is BackupV13AnalysisSectionRow {
  const row = requireRecord(value, "analysis");
  requireExactKeys(row, ANALYSIS_KEYS, "analysis");
  requireOwnedIdentity(row);
  for (const key of ["clientId", "goal", "hairType", "density", "porosity", "phase"] as const) requireString(row[key], `analysis.${key}`);
  requireNonNegativeSafeInteger(row.clarificationRound, "analysis.clarificationRound");
  requireFiniteNumber(row.confidenceScore, "analysis.confidenceScore");
  for (const key of ["faceShape", "headShape", "hairLength", "hairTexture", "hairCondition", "growthPattern", "targetShape", "imageAssetId", "imageAnalysisId"] as const) requireNullableString(row[key], `analysis.${key}`);
  requireNullableTimestamp(row.m8DraftCreatedAt, "analysis.m8DraftCreatedAt");
  requireNullableTimestamp(row.m8FinalizedAt, "analysis.m8FinalizedAt");
}

function assertConsultationRow(value: unknown): asserts value is BackupV13V3ConsultationSectionRow {
  const row = requireRecord(value, "consultation");
  requireExactKeys(row, CONSULTATION_KEYS, "consultation");
  for (const key of ["id", "ownerUserId", "clientId", "analysisId", "summary"] as const) requireNonEmptyString(row[key], `consultation.${key}`);
  requireTimestamp(row.createdAt, "consultation.createdAt");
  if (!Array.isArray(row.nextSteps) || row.nextSteps.some((entry) => typeof entry !== "string" || !entry.trim())) fail("consultation.nextSteps is invalid.");
}

function assertImageAssetRow(value: unknown): asserts value is BackupM15V1ImageAssetSectionRow {
  const row = requireRecord(value, "imageAsset");
  requireExactKeys(row, IMAGE_ASSET_KEYS, "imageAsset");
  requireOwnedIdentity(row);
  for (const key of ["fileName", "mimeType", "clientId"] as const) requireNonEmptyString(row[key], `imageAsset.${key}`);
  requirePositiveSafeInteger(row.sizeBytes, "imageAsset.sizeBytes");
  if (typeof row.exifStripped !== "boolean") fail("imageAsset.exifStripped is invalid.");
  requireSafeInteger(row.normalizedOrientation, "imageAsset.normalizedOrientation");
  requireTimestamp(row.uploadedAt, "imageAsset.uploadedAt");
  requireNullableTimestamp(row.deletedAt, "imageAsset.deletedAt");
  requireNullableTimestamp(row.retentionDeletesAt, "imageAsset.retentionDeletesAt");
  requireNullableString(row.storageEtag, "imageAsset.storageEtag");
  if (!STORAGE_STATES.has(row.storageState as string)) fail("imageAsset.storageState is invalid.");
  requireNullableTimestamp(row.storageMigratedAt, "imageAsset.storageMigratedAt");
  requireNullableTimestamp(row.objectDeletedAt, "imageAsset.objectDeletedAt");
  requireNullableString(row.lastStorageErrorCode, "imageAsset.lastStorageErrorCode");
  if (typeof row.lastStorageErrorCode === "string" && !SAFE_ERROR_CODE_PATTERN.test(row.lastStorageErrorCode)) fail("imageAsset.lastStorageErrorCode is invalid.");
  const reference = requireRecord(row.objectReference, "imageAsset.objectReference");
  requireExactKeys(reference, OBJECT_REFERENCE_KEYS, "imageAsset.objectReference");
  try {
    assertM15V1ObjectReference(reference as BackupM15V1ImageAssetSectionRow["objectReference"]);
  } catch {
    fail("imageAsset.objectReference is invalid.");
  }
  const keyMatch = CANONICAL_KEY_PATTERN.exec(reference.key as string);
  if (!keyMatch || keyMatch[1] !== row.ownerUserId || keyMatch[2] !== row.id || reference.sizeBytes !== row.sizeBytes) {
    fail("imageAsset.objectReference does not match the asset identity.");
  }
}

function assertImageAnalysisRow(value: unknown): asserts value is BackupV13ImageAnalysisSectionRow {
  const row = requireRecord(value, "imageAnalysis");
  requireExactKeys(row, IMAGE_ANALYSIS_KEYS, "imageAnalysis");
  requireIdentity(row);
  for (const key of ["assetId", "status", "providerName", "modelVersion"] as const) requireString(row[key], `imageAnalysis.${key}`);
  requireTimestamp(row.consentTimestamp, "imageAnalysis.consentTimestamp");
  requireNullableTimestamp(row.deletedAt, "imageAnalysis.deletedAt");
  requireNullableTimestamp(row.retentionDeletesAt, "imageAnalysis.retentionDeletesAt");
}

function assertReviewRow(value: unknown): asserts value is BackupV13ImageAnalysisReviewSectionRow {
  const row = requireRecord(value, "imageAnalysisReview");
  requireExactKeys(row, REVIEW_KEYS, "imageAnalysisReview");
  requireIdentity(row);
  requireNonEmptyString(row.analysisId, "imageAnalysisReview.analysisId");
  requireNonEmptyString(row.reviewedByUserId, "imageAnalysisReview.reviewedByUserId");
  requireNullableTimestamp(row.confirmationTimestamp, "imageAnalysisReview.confirmationTimestamp");
  requireNullableString(row.notes, "imageAnalysisReview.notes");
}

function requireIdentity(row: Record<string, unknown>): void {
  requireNonEmptyString(row.id, "id");
  requireTimestamp(row.createdAt, "createdAt");
  requireTimestamp(row.updatedAt, "updatedAt");
}

function requireOwnedIdentity(row: Record<string, unknown>): void {
  requireIdentity(row);
  requireNonEmptyString(row.ownerUserId, "ownerUserId");
}

function assertUniqueIds(sections: Record<string, unknown[]>): void {
  for (const [section, rows] of Object.entries(sections)) {
    const ids = rows.map((row) => requireRecord(row, section).id);
    if (new Set(ids).size !== ids.length) fail(`Duplicate ids in ${section}.`);
  }
}

function sortRows<T extends { id: string }>(rows: T[]): T[] {
  return structuredClone(rows).sort((left, right) => left.id.localeCompare(right.id));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.keys(value as Record<string, unknown>).sort((left, right) => left.localeCompare(right)).reduce<Record<string, unknown>>((result, key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = sortJsonValue(entry);
      return result;
    }, {});
  }
  return value;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${field} contains missing or additional fields.`);
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be an array.`);
  return value;
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") fail(`${field} must be a string.`);
}

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string.`);
}

function requireNullableString(value: unknown, field: string): void {
  if (value !== null && typeof value !== "string") fail(`${field} must be a string or null.`);
}

function requireTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`${field} must be a timestamp.`);
}

function requireNullableTimestamp(value: unknown, field: string): void {
  if (value !== null) requireTimestamp(value, field);
}

function requireFiniteNumber(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be finite.`);
}

function requireSafeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value)) fail(`${field} must be a safe integer.`);
}

function requireNonNegativeSafeInteger(value: unknown, field: string): void {
  requireSafeInteger(value, field);
  if (value < 0) fail(`${field} must be non-negative.`);
}

function requirePositiveSafeInteger(value: unknown, field: string): void {
  requireSafeInteger(value, field);
  if (value <= 0) fail(`${field} must be positive.`);
}

function isLowercaseSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function fail(message: string): never {
  throw new TypeError(message);
}