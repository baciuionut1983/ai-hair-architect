import { createHash } from "crypto";

import { Prisma } from "@prisma/client";

import type {
  BackupRestorePreviewArtifactValidity,
  BackupRestorePreviewChecksumStatus,
  BackupRestorePreviewExternalReferenceStatus,
  BackupRestorePreviewImpactSection,
  BackupRestorePreviewIssue,
  BackupRestorePreviewIssueCode,
  BackupRestorePreviewResponse,
  BackupRestorePreviewSection,
  BackupV13AnalysisSectionRow,
  BackupV13Artifact,
  BackupV13ClientSectionRow,
  BackupV13ImageAnalysisReviewSectionRow,
  BackupV13ImageAnalysisSectionRow,
  BackupV13ImageAssetSectionRow,
} from "@/lib/contracts";
import {
  BACKUP_CHECKSUM_ALGORITHM,
  BACKUP_V13_CANONICAL_VERSION,
  BACKUP_V13_SCHEMA_VERSION,
  BackupArtifactError,
  canonicalizeSortedJsonV1,
  computeArtifactChecksumHex,
  isBackupV13Artifact,
  verifyExternalReferences,
} from "@/lib/backup-v13-artifact";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

const PREVIEW_FINGERPRINT_CONTRACT_VERSION = "m13.restore-preview.v1" as const;

type ComparableState = {
  contractVersion: typeof PREVIEW_FINGERPRINT_CONTRACT_VERSION;
  ownerUserId: string;
  clients: NormalizedClientRow[];
  analyses: NormalizedAnalysisRow[];
  imageAssets: NormalizedImageAssetRow[];
  imageAnalyses: NormalizedImageAnalysisRow[];
  imageAnalysisReviews: NormalizedImageAnalysisReviewRow[];
};

interface RestorePreviewDataSource {
  ownerUserId: string;
  backupId: string;
  backupRow: BackupSnapshotRow;
  backupArtifact: BackupV13Artifact;
  currentState: CurrentStateRows;
}

interface BackupSnapshotRow {
  id: string;
  ownerUserId: string;
  checksum: string;
  checksumAlgorithm: string;
  schemaVersion: string;
  snapshotJson: unknown;
}

interface CurrentStateRows {
  clients: CurrentClientRow[];
  analyses: CurrentAnalysisRow[];
  imageAssets: CurrentImageAssetRow[];
  imageAnalyses: CurrentImageAnalysisRow[];
  imageAnalysisReviews: CurrentImageAnalysisReviewRow[];
}

interface CurrentClientRow {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CurrentAnalysisRow {
  id: string;
  clientId: string;
  ownerUserId: string;
  goal: string;
  hairType: string;
  density: string;
  porosity: string;
  phase: string;
  clarificationRound: number;
  confidenceScore: number;
  uncertaintyReasons: unknown;
  followUpQuestions: unknown;
  recommendations: unknown;
  safetyNotes: unknown;
  faceShape: string | null;
  headShape: string | null;
  hairLength: string | null;
  hairTexture: string | null;
  hairCondition: string | null;
  growthPattern: string | null;
  targetShape: string | null;
  technicalCutPlan: unknown;
  clarificationAnswers: unknown;
  imageAssetId: string | null;
  imageAnalysisId: string | null;
  m8DraftCreatedAt: Date | null;
  m8FinalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CurrentImageAssetRow {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  ownerUserId: string;
  clientId: string;
  storagePath: string;
  exifStripped: boolean;
  normalizedOrientation: number;
  uploadedAt: Date;
  deletedAt: Date | null;
  retentionDeletesAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CurrentImageAnalysisRow {
  id: string;
  assetId: string;
  status: string;
  providerName: string;
  modelVersion: string;
  analysisPayload: unknown;
  confidences: unknown;
  unknownFields: unknown;
  warnings: unknown;
  limitations: unknown;
  consentTimestamp: Date;
  deletedAt: Date | null;
  retentionDeletesAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CurrentImageAnalysisReviewRow {
  id: string;
  analysisId: string;
  reviewedByUserId: string;
  manualCorrections: unknown;
  confirmationTimestamp: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NormalizedClientRow {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

interface NormalizedAnalysisRow {
  id: string;
  clientId: string;
  ownerUserId: string;
  goal: string;
  hairType: string;
  density: string;
  porosity: string;
  phase: string;
  clarificationRound: number;
  confidenceScore: number;
  uncertaintyReasons: unknown;
  followUpQuestions: unknown;
  recommendations: unknown;
  safetyNotes: unknown;
  faceShape: string | null;
  headShape: string | null;
  hairLength: string | null;
  hairTexture: string | null;
  hairCondition: string | null;
  growthPattern: string | null;
  targetShape: string | null;
  technicalCutPlan: unknown;
  clarificationAnswers: unknown;
  imageAssetId: string | null;
  imageAnalysisId: string | null;
  m8DraftCreatedAt: string | null;
  m8FinalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NormalizedImageAssetRow {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  ownerUserId: string;
  clientId: string;
  storagePath: string;
  exifStripped: boolean;
  normalizedOrientation: number;
  uploadedAt: string;
  deletedAt: string | null;
  retentionDeletesAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NormalizedImageAnalysisRow {
  id: string;
  assetId: string;
  status: string;
  providerName: string;
  modelVersion: string;
  analysisPayload: unknown;
  confidences: unknown;
  unknownFields: unknown;
  warnings: unknown;
  limitations: unknown;
  consentTimestamp: string;
  deletedAt: string | null;
  retentionDeletesAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NormalizedImageAnalysisReviewRow {
  id: string;
  analysisId: string;
  reviewedByUserId: string;
  manualCorrections: unknown;
  confirmationTimestamp: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const SECTION_NAMES: BackupRestorePreviewSection[] = [
  "clients",
  "analyses",
  "imageAssets",
  "imageAnalyses",
  "imageAnalysisReviews",
];

const ROW_KEY_SELECTORS: Record<BackupRestorePreviewSection, (row: ComparableRow) => string> = {
  clients: (row) => row.id,
  analyses: (row) => row.id,
  imageAssets: (row) => row.id,
  imageAnalyses: (row) => row.id,
  imageAnalysisReviews: (row) => row.id,
};

type ComparableRow = NormalizedClientRow | NormalizedAnalysisRow | NormalizedImageAssetRow | NormalizedImageAnalysisRow | NormalizedImageAnalysisReviewRow;

export async function getBackupRestorePreviewForUser(ownerUserId: string, backupId: string): Promise<BackupRestorePreviewResponse> {
  const source = await loadRestorePreviewSource(ownerUserId, backupId);
  if (!source) {
    throw new BackupArtifactError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found.");
  }

  return buildBackupRestorePreview(source);
}

export async function loadRestorePreviewSource(ownerUserId: string, backupId: string): Promise<RestorePreviewDataSource | null> {
  if (!isDatabaseConfigured()) {
    throw new BackupArtifactError(
      "BACKUP_PREVIEW_UNAVAILABLE",
      500,
      "Backup restore preview requires a configured database.",
    );
  }

  const transactionOptions = Prisma.TransactionIsolationLevel?.RepeatableRead
    ? { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    : undefined;

  return prisma.$transaction(async (tx) => {
    const backupRow = await tx.opsBackupSnapshot.findFirst({
      where: {
        id: backupId,
        ownerUserId,
      },
    });

    if (!backupRow) {
      return null;
    }

    const snapshot = normalizeBackupSnapshotRow(backupRow);
    const currentState = await readCurrentStateForOwner(tx, ownerUserId);

    return {
      ownerUserId,
      backupId,
      backupRow: snapshot.backupRow,
      backupArtifact: snapshot.backupArtifact,
      currentState,
    };
  }, transactionOptions);
}

export async function buildBackupRestorePreview(source: RestorePreviewDataSource): Promise<BackupRestorePreviewResponse> {
  if (source.backupArtifact.schemaVersion !== BACKUP_V13_SCHEMA_VERSION) {
    throw new BackupArtifactError(
      "BACKUP_PREVIEW_UNSUPPORTED_SCHEMA",
      422,
      "Backup snapshot schema is unsupported for restore planning.",
      { schemaVersion: source.backupArtifact.schemaVersion },
    );
  }

  if (
    source.backupArtifact.canonicalSerializationVersion !== BACKUP_V13_CANONICAL_VERSION ||
    source.backupArtifact.checksumAlgorithm !== BACKUP_CHECKSUM_ALGORITHM
  ) {
    throw new BackupArtifactError(
      "BACKUP_PREVIEW_UNINTERPRETABLE",
      422,
      "Backup snapshot cannot be interpreted for restore planning.",
    );
  }

  if (!isBackupV13Artifact(source.backupArtifact)) {
    throw new BackupArtifactError(
      "BACKUP_PREVIEW_UNINTERPRETABLE",
      422,
      "Backup snapshot cannot be interpreted for restore planning.",
    );
  }

  if (source.backupArtifact.backupId !== source.backupRow.id) {
    throw new BackupArtifactError(
      "BACKUP_PREVIEW_UNINTERPRETABLE",
      422,
      "Backup snapshot cannot be interpreted for restore planning.",
      { backupId: source.backupRow.id },
    );
  }

  const normalizedBackup = normalizeBackupArtifact(source.backupArtifact, source.ownerUserId);
  const normalizedCurrent = normalizeCurrentState(source.currentState, source.ownerUserId);

  const validation = validateArtifactAndReferences(normalizedBackup, normalizedCurrent);
  const externalReferences = await resolveExternalReferenceStatus(source.backupArtifact);
  const checksum = computeArtifactChecksumHex(source.backupArtifact);
  const checksumStatus: BackupRestorePreviewChecksumStatus =
    source.backupArtifact.checksum === checksum && source.backupRow.checksum === checksum ? "valid" : "mismatch";

  const artifactValidity: BackupRestorePreviewArtifactValidity =
    validation.blockingReasons.some((item) => item.code === "CHECKSUM_MISMATCH") || checksumStatus === "mismatch"
      ? "invalid"
      : "valid";

  const externalReferenceStatus = externalReferences.status;
  const backupStateFingerprint = computeStateFingerprint(normalizedBackup.state);
  const currentStateFingerprint = computeStateFingerprint(normalizedCurrent.state);

  const clients = compareRowSets(normalizedBackup.state.clients, normalizedCurrent.state.clients, "clients");
  const analyses = compareRowSets(normalizedBackup.state.analyses, normalizedCurrent.state.analyses, "analyses");
  const imageAssets = compareRowSets(normalizedBackup.state.imageAssets, normalizedCurrent.state.imageAssets, "imageAssets");
  const imageAnalyses = compareRowSets(normalizedBackup.state.imageAnalyses, normalizedCurrent.state.imageAnalyses, "imageAnalyses");
  const imageAnalysisReviews = compareRowSets(normalizedBackup.state.imageAnalysisReviews, normalizedCurrent.state.imageAnalysisReviews, "imageAnalysisReviews");

  const rowComparisonConflicts = [
    ...clients.conflicts,
    ...analyses.conflicts,
    ...imageAssets.conflicts,
    ...imageAnalyses.conflicts,
    ...imageAnalysisReviews.conflicts,
  ];

  const responseConflicts = [...validation.conflicts, ...rowComparisonConflicts];
  const impact = computeImpact(normalizedBackup.state, normalizedCurrent.state, responseConflicts);
  const latestBackupUpdatedAt = computeLatestUpdatedAt(normalizedBackup.state);
  const latestCurrentUpdatedAt = computeLatestUpdatedAt(normalizedCurrent.state);

  const warnings: BackupRestorePreviewIssue[] = [];
  if (compareTimestampOrder(latestBackupUpdatedAt, latestCurrentUpdatedAt) < 0) {
    warnings.push(
      issue("BACKUP_OLDER_THAN_CURRENT_STATE", null, null, null, "Current state is newer than the backup snapshot."),
    );
  }

  const checksumBlockingReasons = checksumStatus === "mismatch"
    ? [buildArtifactIssue("CHECKSUM_MISMATCH", null, null, null, "Backup checksum does not match canonical content.")]
    : [];
  const blockingReasons = [...validation.blockingReasons, ...externalReferences.blockingReasons, ...checksumBlockingReasons];
  const eligibleForRestorePlanning = blockingReasons.length === 0;
  const previewFingerprint = computePreviewFingerprint({
    backupId: source.backupRow.id,
    backupStateFingerprint,
    currentStateFingerprint,
    eligibleForRestorePlanning,
    checksumStatus,
    artifactValidity,
    externalReferenceStatus,
    latestBackupUpdatedAt,
    latestCurrentUpdatedAt,
    impact,
    conflicts: responseConflicts,
    warnings,
    blockingReasons,
  });

  return {
    backupId: source.backupRow.id,
    schemaVersion: source.backupArtifact.schemaVersion,
    eligibleForRestorePlanning,
    checksumStatus,
    artifactValidity,
    externalReferenceStatus,
    backupStateFingerprint,
    currentStateFingerprint,
    previewFingerprint,
    latestBackupUpdatedAt,
    latestCurrentUpdatedAt,
    impact,
    conflicts: responseConflicts,
    warnings,
    blockingReasons,
  };
}

function normalizeBackupSnapshotRow(row: {
  id: string;
  ownerUserId: string;
  checksum: string;
  checksumAlgorithm: string;
  schemaVersion: string;
  snapshotJson: unknown;
}): { backupRow: BackupSnapshotRow; backupArtifact: BackupV13Artifact } {
  const backupArtifact = row.snapshotJson;
  if (!backupArtifact || typeof backupArtifact !== "object" || Array.isArray(backupArtifact)) {
    throw new BackupArtifactError(
      "BACKUP_PREVIEW_UNINTERPRETABLE",
      422,
      "Backup snapshot cannot be interpreted for restore planning.",
    );
  }

  if (typeof (backupArtifact as Record<string, unknown>).schemaVersion !== "string") {
    throw new BackupArtifactError(
      "BACKUP_PREVIEW_UNINTERPRETABLE",
      422,
      "Backup snapshot cannot be interpreted for restore planning.",
    );
  }

  return {
    backupRow: {
      id: row.id,
      ownerUserId: row.ownerUserId,
      checksum: row.checksum,
      checksumAlgorithm: row.checksumAlgorithm,
      schemaVersion: row.schemaVersion,
      snapshotJson: row.snapshotJson,
    },
    backupArtifact: row.snapshotJson as BackupV13Artifact,
  };
}

function normalizeBackupArtifact(artifact: BackupV13Artifact, ownerUserId: string): { state: ComparableState; maps: SectionMaps } {
  const clients = artifact.sections.clients.map((row) => normalizeBackupClientRow(row, ownerUserId));
  const analyses = artifact.sections.analyses.map((row) => normalizeBackupAnalysisRow(row, ownerUserId));
  const imageAssets = artifact.sections.imageAssets.map((row) => normalizeBackupImageAssetRow(row, ownerUserId));
  const imageAnalyses = artifact.sections.imageAnalyses.map((row) => normalizeBackupImageAnalysisRow(row, ownerUserId));
  const imageAnalysisReviews = artifact.sections.imageAnalysisReviews.map((row) => normalizeBackupImageAnalysisReviewRow(row, ownerUserId));

  const state: ComparableState = {
    contractVersion: PREVIEW_FINGERPRINT_CONTRACT_VERSION,
    ownerUserId,
    clients: sortRows(clients),
    analyses: sortRows(analyses),
    imageAssets: sortRows(imageAssets),
    imageAnalyses: sortRows(imageAnalyses),
    imageAnalysisReviews: sortRows(imageAnalysisReviews),
  };

  return {
    state,
    maps: buildSectionMaps(state),
  };
}

function normalizeCurrentState(currentState: CurrentStateRows, ownerUserId: string): { state: ComparableState; maps: SectionMaps } {
  const clients = currentState.clients.map((row) => normalizeCurrentClientRow(row, ownerUserId));
  const analyses = currentState.analyses.map((row) => normalizeCurrentAnalysisRow(row, ownerUserId));
  const imageAssets = currentState.imageAssets.map((row) => normalizeCurrentImageAssetRow(row, ownerUserId));
  const imageAnalyses = currentState.imageAnalyses.map((row) => normalizeCurrentImageAnalysisRow(row, ownerUserId));
  const imageAnalysisReviews = currentState.imageAnalysisReviews.map((row) => normalizeCurrentImageAnalysisReviewRow(row, ownerUserId));

  const state: ComparableState = {
    contractVersion: PREVIEW_FINGERPRINT_CONTRACT_VERSION,
    ownerUserId,
    clients: sortRows(clients),
    analyses: sortRows(analyses),
    imageAssets: sortRows(imageAssets),
    imageAnalyses: sortRows(imageAnalyses),
    imageAnalysisReviews: sortRows(imageAnalysisReviews),
  };

  return {
    state,
    maps: buildSectionMaps(state),
  };
}

interface SectionMaps {
  clients: Map<string, NormalizedClientRow>;
  analyses: Map<string, NormalizedAnalysisRow>;
  imageAssets: Map<string, NormalizedImageAssetRow>;
  imageAnalyses: Map<string, NormalizedImageAnalysisRow>;
  imageAnalysisReviews: Map<string, NormalizedImageAnalysisReviewRow>;
}

interface ValidationResult {
  conflicts: BackupRestorePreviewIssue[];
  blockingReasons: BackupRestorePreviewIssue[];
}

function validateArtifactAndReferences(backup: { state: ComparableState; maps: SectionMaps }, current: { state: ComparableState; maps: SectionMaps }): ValidationResult {
  const conflicts: BackupRestorePreviewIssue[] = [];
  const blockingReasons: BackupRestorePreviewIssue[] = [];

  if (backup.state.ownerUserId !== current.state.ownerUserId) {
    const ownerConflict = issue("OWNER_SCOPE_MISMATCH", null, backup.state.ownerUserId, current.state.ownerUserId, "Owner scope does not match current state.");
    conflicts.push(ownerConflict);
    blockingReasons.push(ownerConflict);
  }

  for (const row of backup.state.clients) {
    if (row.ownerUserId !== backup.state.ownerUserId) {
      const item = issue("OWNER_SCOPE_MISMATCH", "clients", row.id, row.ownerUserId, "Client owner scope does not match backup owner scope.");
      conflicts.push(item);
      blockingReasons.push(item);
    }
  }

  for (const row of backup.state.analyses) {
    if (row.ownerUserId !== backup.state.ownerUserId) {
      const item = issue("OWNER_SCOPE_MISMATCH", "analyses", row.id, row.ownerUserId, "Analysis owner scope does not match backup owner scope.");
      conflicts.push(item);
      blockingReasons.push(item);
    }

    const reference = backup.maps.clients.get(row.clientId);
    if (!reference) {
      const item = issue("REFERENCE_MISSING", "analyses", row.id, row.clientId, "Analysis references a missing client.");
      blockingReasons.push(item);
      conflicts.push(item);
      continue;
    }

    if (reference.ownerUserId !== backup.state.ownerUserId) {
      const item = issue("REFERENCE_OWNER_MISMATCH", "analyses", row.id, row.clientId, "Analysis references a client outside the backup owner scope.");
      blockingReasons.push(item);
      conflicts.push(item);
    }

    if (row.imageAssetId) {
      const assetReference = backup.maps.imageAssets.get(row.imageAssetId);
      if (!assetReference) {
        const item = issue("REFERENCE_MISSING", "analyses", row.id, row.imageAssetId, "Analysis references a missing image asset.");
        blockingReasons.push(item);
        conflicts.push(item);
      } else if (assetReference.ownerUserId !== backup.state.ownerUserId) {
        const item = issue("REFERENCE_OWNER_MISMATCH", "analyses", row.id, row.imageAssetId, "Analysis references an image asset outside the backup owner scope.");
        blockingReasons.push(item);
        conflicts.push(item);
      }
    }

    if (row.imageAnalysisId) {
      const analysisReference = backup.maps.imageAnalyses.get(row.imageAnalysisId);
      if (!analysisReference) {
        const item = issue("REFERENCE_MISSING", "analyses", row.id, row.imageAnalysisId, "Analysis references a missing image analysis.");
        blockingReasons.push(item);
        conflicts.push(item);
      }
    }
  }

  for (const row of backup.state.imageAssets) {
    if (row.ownerUserId !== backup.state.ownerUserId) {
      const item = issue("OWNER_SCOPE_MISMATCH", "imageAssets", row.id, row.ownerUserId, "Image asset owner scope does not match backup owner scope.");
      conflicts.push(item);
      blockingReasons.push(item);
    }

    const reference = backup.maps.clients.get(row.clientId);
    if (!reference) {
      const item = issue("REFERENCE_MISSING", "imageAssets", row.id, row.clientId, "Image asset references a missing client.");
      blockingReasons.push(item);
      conflicts.push(item);
      continue;
    }

    if (reference.ownerUserId !== backup.state.ownerUserId) {
      const item = issue("REFERENCE_OWNER_MISMATCH", "imageAssets", row.id, row.clientId, "Image asset references a client outside the backup owner scope.");
      blockingReasons.push(item);
      conflicts.push(item);
    }
  }

  for (const row of backup.state.imageAnalyses) {
    const reference = backup.maps.imageAssets.get(row.assetId);
    if (!reference) {
      const item = issue("REFERENCE_MISSING", "imageAnalyses", row.id, row.assetId, "Image analysis references a missing image asset.");
      blockingReasons.push(item);
      conflicts.push(item);
    } else if (reference.ownerUserId !== backup.state.ownerUserId) {
      const item = issue("REFERENCE_OWNER_MISMATCH", "imageAnalyses", row.id, row.assetId, "Image analysis references an image asset outside the backup owner scope.");
      blockingReasons.push(item);
      conflicts.push(item);
    }
  }

  for (const row of backup.state.imageAnalysisReviews) {
    const reference = backup.maps.imageAnalyses.get(row.analysisId);
    if (!reference) {
      const item = issue("REFERENCE_MISSING", "imageAnalysisReviews", row.id, row.analysisId, "Image analysis review references a missing image analysis.");
      blockingReasons.push(item);
      conflicts.push(item);
    }
  }

  const graphIssue = conflicts.some((item) => item.code === "REFERENCE_MISSING" || item.code === "REFERENCE_OWNER_MISMATCH")
    ? issue("REFERENCE_GRAPH_INVALID", null, null, null, "Backup reference graph is not internally consistent.")
    : null;

  if (graphIssue) {
    blockingReasons.push(graphIssue);
  }

  return {
    conflicts,
    blockingReasons,
  };
}

function computeImpact(backup: ComparableState, current: ComparableState, conflicts: BackupRestorePreviewIssue[]): BackupRestorePreviewResponse["impact"] {
  return {
    clients: computeSectionImpact(backup.clients, current.clients, conflicts, "clients"),
    analyses: computeSectionImpact(backup.analyses, current.analyses, conflicts, "analyses"),
    imageAssets: computeSectionImpact(backup.imageAssets, current.imageAssets, conflicts, "imageAssets"),
    imageAnalyses: computeSectionImpact(backup.imageAnalyses, current.imageAnalyses, conflicts, "imageAnalyses"),
    imageAnalysisReviews: computeSectionImpact(backup.imageAnalysisReviews, current.imageAnalysisReviews, conflicts, "imageAnalysisReviews"),
  };
}

function computeSectionImpact<T extends ComparableRow>(backupRows: T[], currentRows: T[], conflicts: BackupRestorePreviewIssue[], section: BackupRestorePreviewSection): BackupRestorePreviewImpactSection {
  const backupMap = new Map(backupRows.map((row) => [row.id, row]));
  const currentMap = new Map(currentRows.map((row) => [row.id, row]));

  let wouldCreate = 0;
  let wouldReplace = 0;
  let wouldDelete = 0;
  let unchanged = 0;
  let conflictCount = conflicts.filter((item) => item.section === section).length;

  for (const row of backupRows) {
    const current = currentMap.get(row.id);
    if (!current) {
      wouldCreate += 1;
      continue;
    }

    if (canonicalizeSortedJsonV1(row) === canonicalizeSortedJsonV1(current)) {
      unchanged += 1;
    } else {
      wouldReplace += 1;
    }
  }

  for (const row of currentRows) {
    if (!backupMap.has(row.id)) {
      wouldDelete += 1;
    }
  }

  return {
    backupCount: backupRows.length,
    currentCount: currentRows.length,
    wouldCreate,
    wouldReplace,
    wouldDelete,
    unchanged,
    conflictCount,
  };
}

function computeStateFingerprint(state: ComparableState): string {
  return hashCanonicalJson(state);
}

function computePreviewFingerprint(input: {
  backupId: string;
  backupStateFingerprint: string;
  currentStateFingerprint: string;
  eligibleForRestorePlanning: boolean;
  checksumStatus: BackupRestorePreviewChecksumStatus;
  artifactValidity: BackupRestorePreviewArtifactValidity;
  externalReferenceStatus: BackupRestorePreviewExternalReferenceStatus;
  latestBackupUpdatedAt: string | null;
  latestCurrentUpdatedAt: string | null;
  impact: BackupRestorePreviewResponse["impact"];
  conflicts: BackupRestorePreviewIssue[];
  warnings: BackupRestorePreviewIssue[];
  blockingReasons: BackupRestorePreviewIssue[];
}): string {
  return hashCanonicalJson({
    contractVersion: PREVIEW_FINGERPRINT_CONTRACT_VERSION,
    backupId: input.backupId,
    backupStateFingerprint: input.backupStateFingerprint,
    currentStateFingerprint: input.currentStateFingerprint,
    eligibleForRestorePlanning: input.eligibleForRestorePlanning,
    checksumStatus: input.checksumStatus,
    artifactValidity: input.artifactValidity,
    externalReferenceStatus: input.externalReferenceStatus,
    latestBackupUpdatedAt: input.latestBackupUpdatedAt,
    latestCurrentUpdatedAt: input.latestCurrentUpdatedAt,
    impact: input.impact,
    conflicts: input.conflicts,
    warnings: input.warnings,
    blockingReasons: input.blockingReasons,
  });
}

function computeLatestUpdatedAt(state: ComparableState): string | null {
  const timestamps = [
    ...state.clients.map((row) => row.updatedAt),
    ...state.analyses.map((row) => row.updatedAt),
    ...state.imageAssets.map((row) => row.updatedAt),
    ...state.imageAnalyses.map((row) => row.updatedAt),
    ...state.imageAnalysisReviews.map((row) => row.updatedAt),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();

  return timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
}

function compareTimestampOrder(left: string | null, right: string | null): number {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return -1;
  }

  if (!right) {
    return 1;
  }

  return left.localeCompare(right);
}

function issue(
  code: BackupRestorePreviewIssueCode,
  section: BackupRestorePreviewSection | null,
  recordId: string | null,
  referenceId: string | null,
  messageSafe: string,
): BackupRestorePreviewIssue {
  return {
    code,
    section,
    recordId,
    referenceId,
    messageSafe,
  };
}

function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalizeSortedJsonV1(value), "utf8").digest("hex");
}

function sortRows<T extends ComparableRow>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

function buildSectionMaps(state: ComparableState): SectionMaps {
  return {
    clients: new Map(state.clients.map((row) => [row.id, row])),
    analyses: new Map(state.analyses.map((row) => [row.id, row])),
    imageAssets: new Map(state.imageAssets.map((row) => [row.id, row])),
    imageAnalyses: new Map(state.imageAnalyses.map((row) => [row.id, row])),
    imageAnalysisReviews: new Map(state.imageAnalysisReviews.map((row) => [row.id, row])),
  };
}

function normalizeBackupClientRow(row: BackupV13ClientSectionRow, ownerUserId: string): NormalizedClientRow {
  return normalizeClientRow(row.id, row.name, row.ownerUserId, row.createdAt, row.updatedAt, ownerUserId);
}

function normalizeCurrentClientRow(row: CurrentClientRow, ownerUserId: string): NormalizedClientRow {
  return normalizeClientRow(row.id, row.name, row.ownerUserId, row.createdAt.toISOString(), row.updatedAt.toISOString(), ownerUserId);
}

function normalizeClientRow(
  id: unknown,
  name: unknown,
  rowOwnerUserId: unknown,
  createdAt: unknown,
  updatedAt: unknown,
  ownerUserId: string,
): NormalizedClientRow {
  return {
    id: normalizeString(id, "clients.id"),
    name: normalizeString(name, "clients.name"),
    ownerUserId: normalizeOwner(rowOwnerUserId, ownerUserId, "clients.ownerUserId"),
    createdAt: normalizeTimestamp(createdAt, "clients.createdAt"),
    updatedAt: normalizeTimestamp(updatedAt, "clients.updatedAt"),
  };
}

function normalizeBackupAnalysisRow(row: BackupV13AnalysisSectionRow, ownerUserId: string): NormalizedAnalysisRow {
  return normalizeAnalysisRow(row, ownerUserId);
}

function normalizeCurrentAnalysisRow(row: CurrentAnalysisRow, ownerUserId: string): NormalizedAnalysisRow {
  return normalizeAnalysisRow(
    {
      id: row.id,
      clientId: row.clientId,
      ownerUserId: row.ownerUserId,
      goal: row.goal,
      hairType: row.hairType,
      density: row.density,
      porosity: row.porosity,
      phase: row.phase,
      clarificationRound: row.clarificationRound,
      confidenceScore: row.confidenceScore,
      uncertaintyReasons: row.uncertaintyReasons,
      followUpQuestions: row.followUpQuestions,
      recommendations: row.recommendations,
      safetyNotes: row.safetyNotes,
      faceShape: row.faceShape,
      headShape: row.headShape,
      hairLength: row.hairLength,
      hairTexture: row.hairTexture,
      hairCondition: row.hairCondition,
      growthPattern: row.growthPattern,
      targetShape: row.targetShape,
      technicalCutPlan: row.technicalCutPlan,
      clarificationAnswers: row.clarificationAnswers,
      imageAssetId: row.imageAssetId,
      imageAnalysisId: row.imageAnalysisId,
      m8DraftCreatedAt: row.m8DraftCreatedAt ? row.m8DraftCreatedAt.toISOString() : null,
      m8FinalizedAt: row.m8FinalizedAt ? row.m8FinalizedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    ownerUserId,
  );
}

function normalizeAnalysisRow(
  row: BackupV13AnalysisSectionRow,
  ownerUserId: string,
): NormalizedAnalysisRow {
  return {
    id: normalizeString(row.id, "analyses.id"),
    clientId: normalizeString(row.clientId, "analyses.clientId"),
    ownerUserId: normalizeOwner(row.ownerUserId, ownerUserId, "analyses.ownerUserId"),
    goal: normalizeString(row.goal, "analyses.goal"),
    hairType: normalizeString(row.hairType, "analyses.hairType"),
    density: normalizeString(row.density, "analyses.density"),
    porosity: normalizeString(row.porosity, "analyses.porosity"),
    phase: normalizeString(row.phase, "analyses.phase"),
    clarificationRound: normalizeNumber(row.clarificationRound, "analyses.clarificationRound"),
    confidenceScore: normalizeNumber(row.confidenceScore, "analyses.confidenceScore"),
    uncertaintyReasons: row.uncertaintyReasons,
    followUpQuestions: row.followUpQuestions,
    recommendations: row.recommendations,
    safetyNotes: row.safetyNotes,
    faceShape: normalizeNullableString(row.faceShape, "analyses.faceShape"),
    headShape: normalizeNullableString(row.headShape, "analyses.headShape"),
    hairLength: normalizeNullableString(row.hairLength, "analyses.hairLength"),
    hairTexture: normalizeNullableString(row.hairTexture, "analyses.hairTexture"),
    hairCondition: normalizeNullableString(row.hairCondition, "analyses.hairCondition"),
    growthPattern: normalizeNullableString(row.growthPattern, "analyses.growthPattern"),
    targetShape: normalizeNullableString(row.targetShape, "analyses.targetShape"),
    technicalCutPlan: row.technicalCutPlan,
    clarificationAnswers: row.clarificationAnswers,
    imageAssetId: normalizeNullableString(row.imageAssetId, "analyses.imageAssetId"),
    imageAnalysisId: normalizeNullableString(row.imageAnalysisId, "analyses.imageAnalysisId"),
    m8DraftCreatedAt: normalizeNullableTimestamp(row.m8DraftCreatedAt, "analyses.m8DraftCreatedAt"),
    m8FinalizedAt: normalizeNullableTimestamp(row.m8FinalizedAt, "analyses.m8FinalizedAt"),
    createdAt: normalizeTimestamp(row.createdAt, "analyses.createdAt"),
    updatedAt: normalizeTimestamp(row.updatedAt, "analyses.updatedAt"),
  };
}

function normalizeBackupImageAssetRow(row: BackupV13ImageAssetSectionRow, ownerUserId: string): NormalizedImageAssetRow {
  return normalizeImageAssetRow(row, ownerUserId);
}

function normalizeCurrentImageAssetRow(row: CurrentImageAssetRow, ownerUserId: string): NormalizedImageAssetRow {
  return normalizeImageAssetRow(
    {
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      ownerUserId: row.ownerUserId,
      clientId: row.clientId,
      storagePath: row.storagePath,
      exifStripped: row.exifStripped,
      normalizedOrientation: row.normalizedOrientation,
      uploadedAt: row.uploadedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      retentionDeletesAt: row.retentionDeletesAt ? row.retentionDeletesAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    ownerUserId,
  );
}

function normalizeImageAssetRow(
  row: BackupV13ImageAssetSectionRow,
  ownerUserId: string,
): NormalizedImageAssetRow {
  return {
    id: normalizeString(row.id, "imageAssets.id"),
    fileName: normalizeString(row.fileName, "imageAssets.fileName"),
    mimeType: normalizeString(row.mimeType, "imageAssets.mimeType"),
    sizeBytes: normalizeNumber(row.sizeBytes, "imageAssets.sizeBytes"),
    ownerUserId: normalizeOwner(row.ownerUserId, ownerUserId, "imageAssets.ownerUserId"),
    clientId: normalizeString(row.clientId, "imageAssets.clientId"),
    storagePath: normalizeString(row.storagePath, "imageAssets.storagePath"),
    exifStripped: Boolean(row.exifStripped),
    normalizedOrientation: normalizeNumber(row.normalizedOrientation, "imageAssets.normalizedOrientation"),
    uploadedAt: normalizeTimestamp(row.uploadedAt, "imageAssets.uploadedAt"),
    deletedAt: normalizeNullableTimestamp(row.deletedAt, "imageAssets.deletedAt"),
    retentionDeletesAt: normalizeNullableTimestamp(row.retentionDeletesAt, "imageAssets.retentionDeletesAt"),
    createdAt: normalizeTimestamp(row.createdAt, "imageAssets.createdAt"),
    updatedAt: normalizeTimestamp(row.updatedAt, "imageAssets.updatedAt"),
  };
}

function normalizeBackupImageAnalysisRow(row: BackupV13ImageAnalysisSectionRow, ownerUserId: string): NormalizedImageAnalysisRow {
  return normalizeImageAnalysisRow(row, ownerUserId);
}

function normalizeCurrentImageAnalysisRow(row: CurrentImageAnalysisRow, ownerUserId: string): NormalizedImageAnalysisRow {
  return normalizeImageAnalysisRow(
    {
      id: row.id,
      assetId: row.assetId,
      status: row.status,
      providerName: row.providerName,
      modelVersion: row.modelVersion,
      analysisPayload: row.analysisPayload,
      confidences: row.confidences,
      unknownFields: row.unknownFields,
      warnings: row.warnings,
      limitations: row.limitations,
      consentTimestamp: row.consentTimestamp.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      retentionDeletesAt: row.retentionDeletesAt ? row.retentionDeletesAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    ownerUserId,
  );
}

function normalizeImageAnalysisRow(
  row: BackupV13ImageAnalysisSectionRow,
  ownerUserId: string,
): NormalizedImageAnalysisRow {
  return {
    id: normalizeString(row.id, "imageAnalyses.id"),
    assetId: normalizeString(row.assetId, "imageAnalyses.assetId"),
    status: normalizeString(row.status, "imageAnalyses.status"),
    providerName: normalizeString(row.providerName, "imageAnalyses.providerName"),
    modelVersion: normalizeString(row.modelVersion, "imageAnalyses.modelVersion"),
    analysisPayload: row.analysisPayload,
    confidences: row.confidences,
    unknownFields: row.unknownFields,
    warnings: row.warnings,
    limitations: row.limitations,
    consentTimestamp: normalizeTimestamp(row.consentTimestamp, "imageAnalyses.consentTimestamp"),
    deletedAt: normalizeNullableTimestamp(row.deletedAt, "imageAnalyses.deletedAt"),
    retentionDeletesAt: normalizeNullableTimestamp(row.retentionDeletesAt, "imageAnalyses.retentionDeletesAt"),
    createdAt: normalizeTimestamp(row.createdAt, "imageAnalyses.createdAt"),
    updatedAt: normalizeTimestamp(row.updatedAt, "imageAnalyses.updatedAt"),
  };
}

function normalizeBackupImageAnalysisReviewRow(row: BackupV13ImageAnalysisReviewSectionRow, ownerUserId: string): NormalizedImageAnalysisReviewRow {
  return normalizeImageAnalysisReviewRow(row, ownerUserId);
}

function normalizeCurrentImageAnalysisReviewRow(row: CurrentImageAnalysisReviewRow, ownerUserId: string): NormalizedImageAnalysisReviewRow {
  return normalizeImageAnalysisReviewRow(
    {
      id: row.id,
      analysisId: row.analysisId,
      reviewedByUserId: row.reviewedByUserId,
      manualCorrections: row.manualCorrections,
      confirmationTimestamp: row.confirmationTimestamp ? row.confirmationTimestamp.toISOString() : null,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    ownerUserId,
  );
}

function normalizeImageAnalysisReviewRow(
  row: BackupV13ImageAnalysisReviewSectionRow,
  ownerUserId: string,
): NormalizedImageAnalysisReviewRow {
  return {
    id: normalizeString(row.id, "imageAnalysisReviews.id"),
    analysisId: normalizeString(row.analysisId, "imageAnalysisReviews.analysisId"),
    reviewedByUserId: normalizeOwner(row.reviewedByUserId, ownerUserId, "imageAnalysisReviews.reviewedByUserId"),
    manualCorrections: row.manualCorrections,
    confirmationTimestamp: normalizeNullableTimestamp(row.confirmationTimestamp, "imageAnalysisReviews.confirmationTimestamp"),
    notes: normalizeNullableString(row.notes, "imageAnalysisReviews.notes"),
    createdAt: normalizeTimestamp(row.createdAt, "imageAnalysisReviews.createdAt"),
    updatedAt: normalizeTimestamp(row.updatedAt, "imageAnalysisReviews.updatedAt"),
  };
}

function normalizeOwner(value: unknown, ownerUserId: string, path: string): string {
  const normalized = normalizeString(value, path);
  if (normalized !== ownerUserId) {
    return normalized;
  }

  return normalized;
}

function normalizeString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BackupArtifactError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, `Backup snapshot field ${path} is invalid.`);
  }

  return value;
}

function normalizeNullableString(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new BackupArtifactError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, `Backup snapshot field ${path} is invalid.`);
  }

  return value;
}

function normalizeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new BackupArtifactError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, `Backup snapshot field ${path} is invalid.`);
  }

  return value;
}

function normalizeTimestamp(value: unknown, path: string): string {
  const normalized = normalizeNullableTimestamp(value, path);
  if (normalized === null) {
    throw new BackupArtifactError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, `Backup snapshot field ${path} is invalid.`);
  }

  return normalized;
}

function normalizeNullableTimestamp(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new BackupArtifactError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, `Backup snapshot field ${path} is invalid.`);
  }

  return new Date(value).toISOString();
}

function buildSectionResult<T extends ComparableRow>(rows: T[]): T[] {
  return sortRows(rows);
}

function isPreviewConflictCode(code: BackupRestorePreviewIssueCode): boolean {
  return code === "REFERENCE_MISSING" || code === "REFERENCE_OWNER_MISMATCH" || code === "OWNER_SCOPE_MISMATCH" || code === "SCHEMA_DRIFT";
}

async function readCurrentStateForOwner(tx: Prisma.TransactionClient, ownerUserId: string): Promise<CurrentStateRows> {
  const [clients, analyses, imageAssets, imageAnalyses, imageAnalysisReviews] = await Promise.all([
    tx.client.findMany({
      where: { ownerUserId },
      select: {
        id: true,
        name: true,
        ownerUserId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
    }),
    tx.analysis.findMany({
      where: { ownerUserId },
      select: {
        id: true,
        clientId: true,
        ownerUserId: true,
        goal: true,
        hairType: true,
        density: true,
        porosity: true,
        phase: true,
        clarificationRound: true,
        confidenceScore: true,
        uncertaintyReasons: true,
        followUpQuestions: true,
        recommendations: true,
        safetyNotes: true,
        faceShape: true,
        headShape: true,
        hairLength: true,
        hairTexture: true,
        hairCondition: true,
        growthPattern: true,
        targetShape: true,
        technicalCutPlan: true,
        clarificationAnswers: true,
        imageAssetId: true,
        imageAnalysisId: true,
        m8DraftCreatedAt: true,
        m8FinalizedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
    }),
    tx.imageAsset.findMany({
      where: { ownerUserId },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        ownerUserId: true,
        clientId: true,
        storagePath: true,
        exifStripped: true,
        normalizedOrientation: true,
        uploadedAt: true,
        deletedAt: true,
        retentionDeletesAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
    }),
    tx.imageAnalysis.findMany({
      where: { asset: { ownerUserId } },
      select: {
        id: true,
        assetId: true,
        status: true,
        providerName: true,
        modelVersion: true,
        analysisPayload: true,
        confidences: true,
        unknownFields: true,
        warnings: true,
        limitations: true,
        consentTimestamp: true,
        deletedAt: true,
        retentionDeletesAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
    }),
    tx.imageAnalysisReview.findMany({
      where: { analysis: { asset: { ownerUserId } } },
      select: {
        id: true,
        analysisId: true,
        reviewedByUserId: true,
        manualCorrections: true,
        confirmationTimestamp: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
    }),
  ]);

  return {
    clients,
    analyses,
    imageAssets,
    imageAnalyses,
    imageAnalysisReviews,
  };
}

function isBackupArtifactIssue(error: unknown): error is BackupArtifactError {
  return error instanceof BackupArtifactError;
}

function buildArtifactIssue(code: BackupRestorePreviewIssueCode, section: BackupRestorePreviewSection | null, recordId: string | null, referenceId: string | null, messageSafe: string): BackupRestorePreviewIssue {
  return issue(code, section, recordId, referenceId, messageSafe);
}

async function resolveExternalReferenceStatus(artifact: BackupV13Artifact): Promise<{ status: BackupRestorePreviewExternalReferenceStatus; blockingReasons: BackupRestorePreviewIssue[] }> {
  if (artifact.sections.imageAssets.length === 0) {
    return { status: "none", blockingReasons: [] };
  }

  try {
    await verifyExternalReferences(artifact);
  } catch (error) {
    if (isBackupArtifactIssue(error)) {
      return {
        status: error.code === "BACKUP_EXTERNAL_REFERENCE_UNSAFE" ? "unsafe" : "missing",
        blockingReasons: [
          buildArtifactIssue(
            error.code === "BACKUP_EXTERNAL_REFERENCE_UNSAFE" ? "EXTERNAL_PATH_UNSAFE" : "EXTERNAL_FILE_MISSING",
            "imageAssets",
            null,
            null,
            error.message,
          ),
        ],
      };
    }

    throw error;
  }

  return {
    status: "all_exist_integrity_unverified",
    blockingReasons: [],
  };
}

function validateReferenceGraph(backup: { state: ComparableState; maps: SectionMaps }): BackupRestorePreviewIssue[] {
  const issues: BackupRestorePreviewIssue[] = [];

  for (const row of backup.state.analyses) {
    if (!backup.maps.clients.has(row.clientId)) {
      issues.push(buildArtifactIssue("REFERENCE_MISSING", "analyses", row.id, row.clientId, "Analysis references a missing client."));
    }
  }

  for (const row of backup.state.imageAssets) {
    if (!backup.maps.clients.has(row.clientId)) {
      issues.push(buildArtifactIssue("REFERENCE_MISSING", "imageAssets", row.id, row.clientId, "Image asset references a missing client."));
    }
  }

  for (const row of backup.state.imageAnalyses) {
    if (!backup.maps.imageAssets.has(row.assetId)) {
      issues.push(buildArtifactIssue("REFERENCE_MISSING", "imageAnalyses", row.id, row.assetId, "Image analysis references a missing image asset."));
    }
  }

  for (const row of backup.state.imageAnalysisReviews) {
    if (!backup.maps.imageAnalyses.has(row.analysisId)) {
      issues.push(buildArtifactIssue("REFERENCE_MISSING", "imageAnalysisReviews", row.id, row.analysisId, "Image analysis review references a missing image analysis."));
    }
  }

  return issues;
}

function evaluateReferenceOwnership(backup: { state: ComparableState; maps: SectionMaps }): BackupRestorePreviewIssue[] {
  const issues: BackupRestorePreviewIssue[] = [];

  for (const row of backup.state.analyses) {
    const client = backup.maps.clients.get(row.clientId);
    if (client && client.ownerUserId !== backup.state.ownerUserId) {
      issues.push(buildArtifactIssue("REFERENCE_OWNER_MISMATCH", "analyses", row.id, client.id, "Analysis references a client outside the backup owner scope."));
    }
  }

  for (const row of backup.state.imageAssets) {
    const client = backup.maps.clients.get(row.clientId);
    if (client && client.ownerUserId !== backup.state.ownerUserId) {
      issues.push(buildArtifactIssue("REFERENCE_OWNER_MISMATCH", "imageAssets", row.id, client.id, "Image asset references a client outside the backup owner scope."));
    }
  }

  for (const row of backup.state.imageAnalyses) {
    const asset = backup.maps.imageAssets.get(row.assetId);
    if (asset && asset.ownerUserId !== backup.state.ownerUserId) {
      issues.push(buildArtifactIssue("REFERENCE_OWNER_MISMATCH", "imageAnalyses", row.id, asset.id, "Image analysis references an image asset outside the backup owner scope."));
    }
  }

  for (const row of backup.state.imageAnalysisReviews) {
    const analysis = backup.maps.imageAnalyses.get(row.analysisId);
    if (analysis) {
      const asset = backup.maps.imageAssets.get(analysis.assetId);
      if (asset && asset.ownerUserId !== backup.state.ownerUserId) {
        issues.push(buildArtifactIssue("REFERENCE_OWNER_MISMATCH", "imageAnalysisReviews", row.id, analysis.id, "Image analysis review references an image analysis outside the backup owner scope."));
      }
    }
  }

  return issues;
}

function compareRowSets(backup: ComparableRow[], current: ComparableRow[], section: BackupRestorePreviewSection): {
  impact: BackupRestorePreviewImpactSection;
  conflicts: BackupRestorePreviewIssue[];
} {
  const conflicts: BackupRestorePreviewIssue[] = [];
  const backupMap = new Map(backup.map((row) => [row.id, row]));
  const currentMap = new Map(current.map((row) => [row.id, row]));

  let wouldCreate = 0;
  let wouldReplace = 0;
  let wouldDelete = 0;
  let unchanged = 0;

  for (const row of backup) {
    const currentRow = currentMap.get(row.id);
    if (!currentRow) {
      wouldCreate += 1;
      continue;
    }

    if (canonicalizeSortedJsonV1(row) === canonicalizeSortedJsonV1(currentRow)) {
      unchanged += 1;
    } else {
      wouldReplace += 1;
    }
  }

  for (const row of current) {
    if (!backupMap.has(row.id)) {
      wouldDelete += 1;
      conflicts.push(buildArtifactIssue("CURRENT_STATE_HAS_EXTRA_ROWS", section, row.id, null, "Current state contains a row not present in the backup."));
    }
  }

  return {
    impact: {
      backupCount: backup.length,
      currentCount: current.length,
      wouldCreate,
      wouldReplace,
      wouldDelete,
      unchanged,
      conflictCount: conflicts.length,
    },
    conflicts,
  };
}
