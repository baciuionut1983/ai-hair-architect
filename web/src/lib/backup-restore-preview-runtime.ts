import { Prisma } from "@prisma/client";

import { BackupArtifactError } from "./backup-v13-artifact";
import {
  getBackupRestorePreviewForUser,
} from "./backup-v13-restore-preview";
import {
  verifyM15ExternalReferences,
  type M15ObjectStorageAliasResolver,
} from "./backup-m15-external-reference-verifier";
import {
  buildBackupM15RestorePreview,
  type BackupM15RestorePreviewSource,
} from "./backup-m15-restore-preview";
import {
  BackupRestorePreviewDispatchError,
  dispatchBackupRestorePreview,
} from "./backup-restore-preview";
import type {
  BackupM15RestorePreviewResponse,
  BackupM15V1Artifact,
  BackupM15V1ImageAssetSectionRow,
  BackupRestorePreviewResponse,
} from "./contracts";
import { createObjectStorageAliasResolver } from "./object-storage-alias-resolver";
import { isDatabaseConfigured, prisma } from "./prisma";

interface SnapshotRow {
  id: string;
  ownerUserId: string;
  checksum: string;
  schemaVersion: string;
  snapshotJson: unknown;
}

interface RuntimeDelegate<T> {
  findMany(args: unknown): Promise<T[]>;
}

interface RuntimeTransaction {
  opsBackupSnapshot: {
    findFirst(args: unknown): Promise<SnapshotRow | null>;
  };
  client: RuntimeDelegate<Record<string, unknown>>;
  analysis: RuntimeDelegate<Record<string, unknown>>;
  consultation: RuntimeDelegate<Record<string, unknown>>;
  imageAsset: RuntimeDelegate<Record<string, unknown>>;
  imageAnalysis: RuntimeDelegate<Record<string, unknown>>;
  imageAnalysisReview: RuntimeDelegate<Record<string, unknown>>;
}

interface RuntimePrismaClient extends RuntimeTransaction {
  $transaction<T>(
    callback: (transaction: RuntimeTransaction) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
}

type M13Runtime = (
  ownerUserId: string,
  backupId: string,
) => Promise<BackupRestorePreviewResponse>;

export interface BackupRestorePreviewRuntimeDependencies {
  database?: RuntimePrismaClient;
  isDatabaseConfigured?: () => boolean;
  buildM13Preview?: M13Runtime;
  buildM15Preview?: typeof buildBackupM15RestorePreview;
  verifyExternalReferences?: typeof verifyM15ExternalReferences;
  createAliasResolver?: () => M15ObjectStorageAliasResolver;
  now?: () => Date;
}

export type RuntimeBackupRestorePreviewResponse =
  | BackupRestorePreviewResponse
  | BackupM15RestorePreviewResponse;

export async function getRuntimeBackupRestorePreviewForUser(
  ownerUserId: string,
  backupId: string,
  dependencies: BackupRestorePreviewRuntimeDependencies = {},
): Promise<RuntimeBackupRestorePreviewResponse> {
  const databaseConfigured = dependencies.isDatabaseConfigured ?? isDatabaseConfigured;
  if (!databaseConfigured()) {
    throw previewError("BACKUP_PREVIEW_UNAVAILABLE", 500, "Backup restore preview requires a configured database.");
  }

  const database = dependencies.database ?? (prisma as unknown as RuntimePrismaClient);
  const snapshot = await findSnapshot(database, ownerUserId, backupId);
  if (!snapshot) {
    throw previewError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found.");
  }

  const artifactSchemaVersion = readSchemaVersion(snapshot.snapshotJson);
  if (!artifactSchemaVersion) {
    throw previewError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning.");
  }
  if (snapshot.schemaVersion !== artifactSchemaVersion) {
    throw previewError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning.");
  }

  try {
    return await dispatchBackupRestorePreview(
      {
        artifact: snapshot.snapshotJson,
        m13Source: { ownerUserId, backupId },
        m15Source: { ownerUserId, backupId, snapshot },
      },
      {
        buildM13Preview: ({ ownerUserId: owner, backupId: id }) =>
          (dependencies.buildM13Preview ?? getBackupRestorePreviewForUser)(owner, id),
        buildM15Preview: async ({ ownerUserId: owner, backupId: id, snapshot: selectedSnapshot }) => {
          const source = await loadM15Source(database, owner, id, selectedSnapshot);
          const resolveStorage = (dependencies.createAliasResolver ?? createObjectStorageAliasResolver)();
          return (dependencies.buildM15Preview ?? buildBackupM15RestorePreview)(source, {
            verifyExternalReferences: dependencies.verifyExternalReferences ?? verifyM15ExternalReferences,
            resolveStorage,
            now: dependencies.now,
          });
        },
      },
    );
  } catch (error) {
    if (error instanceof BackupRestorePreviewDispatchError) {
      throw previewError(
        "BACKUP_PREVIEW_UNSUPPORTED_SCHEMA",
        422,
        "Backup schema is not supported for restore preview.",
      );
    }
    throw error;
  }
}

async function findSnapshot(
  database: RuntimeTransaction,
  ownerUserId: string,
  backupId: string,
): Promise<SnapshotRow | null> {
  return database.opsBackupSnapshot.findFirst({
    where: { id: backupId, ownerUserId },
    select: {
      id: true,
      ownerUserId: true,
      checksum: true,
      schemaVersion: true,
      snapshotJson: true,
    },
  });
}

async function loadM15Source(
  database: RuntimePrismaClient,
  ownerUserId: string,
  backupId: string,
  selectedSnapshot: SnapshotRow,
): Promise<BackupM15RestorePreviewSource> {
  const isolationLevel = Prisma.TransactionIsolationLevel?.RepeatableRead;
  return database.$transaction(async (transaction) => {
    const snapshot = await findSnapshot(transaction, ownerUserId, backupId);
    if (!snapshot) {
      throw previewError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found.");
    }
    if (
      snapshot.schemaVersion !== "m15.v1" ||
      readSchemaVersion(snapshot.snapshotJson) !== "m15.v1" ||
      snapshot.checksum !== selectedSnapshot.checksum
    ) {
      throw previewError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning.");
    }

    const [clients, analyses, consultations, imageAssets, imageAnalyses, imageAnalysisReviews] = await Promise.all([
      transaction.client.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
      transaction.analysis.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
      transaction.consultation.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
      transaction.imageAsset.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
      transaction.imageAnalysis.findMany({ where: { asset: { ownerUserId } }, orderBy: { id: "asc" } }),
      transaction.imageAnalysisReview.findMany({
        where: { analysis: { asset: { ownerUserId } } },
        orderBy: { id: "asc" },
      }),
    ]);

    return {
      ownerUserId,
      backupId,
      backupChecksum: snapshot.checksum,
      artifact: snapshot.snapshotJson,
      currentState: {
        clients: sortAndMap(clients, mapClient),
        analyses: sortAndMap(analyses, mapAnalysis),
        consultations: sortAndMap(consultations, mapConsultation),
        imageAssets: sortAndMap(imageAssets, mapImageAsset),
        imageAnalyses: sortAndMap(imageAnalyses, mapImageAnalysis),
        imageAnalysisReviews: sortAndMap(imageAnalysisReviews, mapImageAnalysisReview),
      },
    };
  }, isolationLevel ? { isolationLevel } : undefined);
}

function sortAndMap<T>(rows: Record<string, unknown>[], mapper: (row: Record<string, unknown>) => T): T[] {
  return [...rows]
    .sort((left, right) => requireString(left.id).localeCompare(requireString(right.id)))
    .map(mapper);
}

function mapClient(row: Record<string, unknown>): BackupM15V1Artifact["sections"]["clients"][number] {
  return {
    id: requireString(row.id), fullName: requireString(row.fullName), email: nullableString(row.email),
    phone: nullableString(row.phone), notes: nullableString(row.notes), deletedAt: nullableTimestamp(row.deletedAt),
    ownerUserId: requireString(row.ownerUserId), createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
  };
}

function mapAnalysis(row: Record<string, unknown>): BackupM15V1Artifact["sections"]["analyses"][number] {
  return {
    id: requireString(row.id), clientId: requireString(row.clientId), ownerUserId: requireString(row.ownerUserId),
    goal: requireString(row.goal), hairType: requireString(row.hairType), density: requireString(row.density),
    porosity: requireString(row.porosity), phase: requireString(row.phase), clarificationRound: requireNumber(row.clarificationRound),
    confidenceScore: requireNumber(row.confidenceScore), uncertaintyReasons: row.uncertaintyReasons,
    followUpQuestions: row.followUpQuestions, recommendations: row.recommendations, safetyNotes: row.safetyNotes,
    faceShape: nullableString(row.faceShape), headShape: nullableString(row.headShape), hairLength: nullableString(row.hairLength),
    hairTexture: nullableString(row.hairTexture), hairCondition: nullableString(row.hairCondition),
    growthPattern: nullableString(row.growthPattern), targetShape: nullableString(row.targetShape),
    technicalCutPlan: row.technicalCutPlan, clarificationAnswers: row.clarificationAnswers,
    imageAssetId: nullableString(row.imageAssetId), imageAnalysisId: nullableString(row.imageAnalysisId),
    m8DraftCreatedAt: nullableTimestamp(row.m8DraftCreatedAt), m8FinalizedAt: nullableTimestamp(row.m8FinalizedAt),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
  };
}

function mapConsultation(row: Record<string, unknown>): BackupM15V1Artifact["sections"]["consultations"][number] {
  return {
    id: requireString(row.id), ownerUserId: requireString(row.ownerUserId), clientId: requireString(row.clientId),
    analysisId: requireString(row.analysisId), summary: requireString(row.summary),
    nextSteps: requireStringArray(row.nextSteps), createdAt: timestamp(row.createdAt),
  };
}

function mapImageAsset(row: Record<string, unknown>): BackupM15V1ImageAssetSectionRow {
  if (
    row.storageBackend !== "s3" ||
    typeof row.storageBucketAlias !== "string" ||
    typeof row.storageKey !== "string" ||
    typeof row.storageVersionId !== "string" ||
    typeof row.contentSha256 !== "string" ||
    typeof row.sizeBytes !== "number" ||
    !isStorageState(row.storageState)
  ) {
    throw previewError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning.");
  }
  const reference = {
    backend: "s3" as const,
    bucketAlias: row.storageBucketAlias,
    key: row.storageKey,
    versionId: row.storageVersionId,
    contentSha256: row.contentSha256,
    sizeBytes: row.sizeBytes,
  };
  return {
    id: requireString(row.id), fileName: requireString(row.fileName), mimeType: requireString(row.mimeType),
    sizeBytes: requireNumber(row.sizeBytes), ownerUserId: requireString(row.ownerUserId), clientId: requireString(row.clientId),
    exifStripped: requireBoolean(row.exifStripped), normalizedOrientation: requireNumber(row.normalizedOrientation),
    uploadedAt: timestamp(row.uploadedAt), deletedAt: nullableTimestamp(row.deletedAt),
    retentionDeletesAt: nullableTimestamp(row.retentionDeletesAt), createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt), objectReference: reference, storageEtag: nullableString(row.storageEtag),
    storageState: row.storageState, storageMigratedAt: nullableTimestamp(row.storageMigratedAt),
    objectDeletedAt: nullableTimestamp(row.objectDeletedAt), lastStorageErrorCode: nullableString(row.lastStorageErrorCode),
  };
}

function mapImageAnalysis(row: Record<string, unknown>): BackupM15V1Artifact["sections"]["imageAnalyses"][number] {
  return {
    id: requireString(row.id), assetId: requireString(row.assetId), status: requireString(row.status),
    providerName: requireString(row.providerName), modelVersion: requireString(row.modelVersion),
    analysisPayload: row.analysisPayload, confidences: row.confidences, unknownFields: row.unknownFields,
    warnings: row.warnings, limitations: row.limitations, consentTimestamp: timestamp(row.consentTimestamp),
    deletedAt: nullableTimestamp(row.deletedAt), retentionDeletesAt: nullableTimestamp(row.retentionDeletesAt),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
  };
}

function mapImageAnalysisReview(row: Record<string, unknown>): BackupM15V1Artifact["sections"]["imageAnalysisReviews"][number] {
  return {
    id: requireString(row.id), analysisId: requireString(row.analysisId), reviewedByUserId: requireString(row.reviewedByUserId),
    manualCorrections: row.manualCorrections, confirmationTimestamp: nullableTimestamp(row.confirmationTimestamp),
    notes: nullableString(row.notes), createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
  };
}

function readSchemaVersion(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  return typeof schemaVersion === "string" ? schemaVersion : null;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") throw invalidState();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requireString(value);
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidState();
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidState();
  return value;
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw invalidState();
  return [...value];
}

function timestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw invalidState();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function isStorageState(value: unknown): value is BackupM15V1ImageAssetSectionRow["storageState"] {
  return ["pending_upload", "available", "delete_pending", "deleted", "quarantined"].includes(value as string);
}

function invalidState(): BackupArtifactError {
  return previewError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning.");
}

function previewError(code: string, httpStatus: number, message: string): BackupArtifactError {
  return new BackupArtifactError(code, httpStatus, message);
}