import { Prisma } from "@prisma/client";

import type {
  BackupRestoreCounts,
  BackupRestoreRequest,
  BackupRestoreResponse,
  BackupRestoreWarning,
  BackupV13Artifact,
  BackupV13ClientSectionRow,
  BackupV13V2ClientSectionRow,
} from "@/lib/contracts";
import {
  BACKUP_V13_SCHEMA_VERSION,
  BACKUP_V13_V2_SCHEMA_VERSION,
  BackupArtifactError,
  computeArtifactChecksumHex,
  isBackupV13Artifact,
  isBackupV13V2Artifact,
} from "@/lib/backup-v13-artifact";
import {
  getBackupComparableStateFingerprintForArtifact,
  getBackupRestorePreviewForUserWithTransaction,
  getClientStateFingerprintForArtifact,
  getCurrentComparableStateFingerprintForOwner,
  loadRestorePreviewSourceWithTransaction,
} from "@/lib/backup-v13-restore-preview";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { writeOpsAuditEvent } from "@/lib/ops-persistence";

const MAX_RESTORE_RETRIES = 3;

type RestoreTransactionalClient = Prisma.TransactionClient;

export interface BackupRestoreExecutionInternalResult {
  response: BackupRestoreResponse;
  attemptsUsed: 1 | 2 | 3;
}

export interface BackupRestoreExecutionOptions {
  correlationRequestId?: string;
}

type RestoreExecutionSnapshot = {
  clients: Array<{ id: string; ownerUserId: string; name: string; createdAt: Date; updatedAt: Date }>;
  analyses: Array<{
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
    uncertaintyReasons: Prisma.JsonValue;
    followUpQuestions: Prisma.JsonValue;
    recommendations: Prisma.JsonValue;
    safetyNotes: Prisma.JsonValue;
    faceShape: string | null;
    headShape: string | null;
    hairLength: string | null;
    hairTexture: string | null;
    hairCondition: string | null;
    growthPattern: string | null;
    targetShape: string | null;
    technicalCutPlan: Prisma.JsonValue | null;
    clarificationAnswers: Prisma.JsonValue;
    imageAssetId: string | null;
    imageAnalysisId: string | null;
    m8DraftCreatedAt: Date | null;
    m8FinalizedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  imageAssets: Array<{
    id: string;
    ownerUserId: string;
    clientId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    exifStripped: boolean;
    normalizedOrientation: number;
    uploadedAt: Date;
    deletedAt: Date | null;
    retentionDeletesAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  imageAnalyses: Array<{
    id: string;
    assetId: string;
    status: string;
    providerName: string;
    modelVersion: string;
    analysisPayload: Prisma.JsonValue;
    confidences: Prisma.JsonValue;
    unknownFields: Prisma.JsonValue;
    warnings: Prisma.JsonValue;
    limitations: Prisma.JsonValue;
    consentTimestamp: Date;
    deletedAt: Date | null;
    retentionDeletesAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  imageAnalysisReviews: Array<{
    id: string;
    analysisId: string;
    reviewedByUserId: string;
    manualCorrections: Prisma.JsonValue;
    confirmationTimestamp: Date | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  backupSnapshots: Array<{
    id: string;
    ownerUserId: string;
    snapshotJson: Prisma.JsonValue;
    checksum: string;
    checksumAlgorithm: string;
    schemaVersion: string;
    createdByUserId: string;
    createdAt: Date;
    label: string;
  }>;
  auditLogs: Array<{
    id: string;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    status: string;
    metadata: Prisma.JsonValue;
    createdAt: Date;
  }>;
};

type RestoreCountsResult = {
  deletedCounts: BackupRestoreCounts;
  restoredCounts: BackupRestoreCounts;
};

const restoreTestHooks: {
  afterDeletePhase: null | (() => Promise<void> | void);
  afterImageAssetInsert: null | (() => Promise<void> | void);
  forcePostconditionMismatch: boolean;
  retryableFailuresRemaining: number;
} = {
  afterDeletePhase: null,
  afterImageAssetInsert: null,
  forcePostconditionMismatch: false,
  retryableFailuresRemaining: 0,
};

export async function executeBackupRestoreForUser(
  ownerUserId: string,
  backupId: string,
  request: BackupRestoreRequest,
): Promise<BackupRestoreResponse> {
  const result = await executeBackupRestoreInternalForUser(ownerUserId, backupId, request);
  return result.response;
}

export async function executeBackupRestoreInternalForUser(
  ownerUserId: string,
  backupId: string,
  request: BackupRestoreRequest,
  options?: BackupRestoreExecutionOptions,
): Promise<BackupRestoreExecutionInternalResult> {
  if (!isDatabaseConfigured()) {
    throw new BackupArtifactError("BACKUP_RESTORE_UNAVAILABLE", 500, "Backup restore requires a configured database.");
  }

  let lastRetryableError: unknown = null;
  for (let attempt = 1; attempt <= MAX_RESTORE_RETRIES; attempt += 1) {
    try {
      const response = await prisma.$transaction(
        async (tx) => runRestoreAttempt(tx, ownerUserId, backupId, request, options?.correlationRequestId ?? backupId),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return {
        response,
        attemptsUsed: attempt as 1 | 2 | 3,
      };
    } catch (error) {
      if (isRetryableRestoreConcurrencyError(error) && attempt < MAX_RESTORE_RETRIES) {
        lastRetryableError = error;
        continue;
      }

      if (isRetryableRestoreConcurrencyError(error)) {
        throw attachAttemptsUsed(
          new BackupArtifactError(
          "BACKUP_RESTORE_CONCURRENCY_CONFLICT",
          409,
          "Backup restore could not complete due to concurrent changes.",
          ),
          attempt,
        );
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          throw attachAttemptsUsed(
            new BackupArtifactError(
            "BACKUP_RESTORE_UNIQUE_CONFLICT",
            409,
            "Backup restore encountered a unique constraint conflict.",
            ),
            attempt,
          );
        }

        if (error.code === "P2003") {
          throw attachAttemptsUsed(
            new BackupArtifactError(
            "BACKUP_RESTORE_REFERENCE_COLLISION",
            409,
            "Backup restore encountered a foreign-key or reference collision.",
            ),
            attempt,
          );
        }
      }

      throw attachAttemptsUsed(error, attempt);
    }
  }

  throw attachAttemptsUsed(
    new BackupArtifactError(
      "BACKUP_RESTORE_CONCURRENCY_CONFLICT",
      409,
      "Backup restore could not complete due to concurrent changes.",
      { cause: lastRetryableError instanceof Error ? lastRetryableError.message : undefined },
    ),
    MAX_RESTORE_RETRIES,
  );
}

async function runRestoreAttempt(
  tx: RestoreTransactionalClient,
  ownerUserId: string,
  backupId: string,
  request: BackupRestoreRequest,
  correlationRequestId: string,
): Promise<BackupRestoreResponse> {
  const startedAt = new Date();

  if (restoreTestHooks.retryableFailuresRemaining > 0) {
    restoreTestHooks.retryableFailuresRemaining -= 1;
    throw new Prisma.PrismaClientKnownRequestError("Simulated serialization failure.", {
      code: "P2034",
      clientVersion: "test",
    });
  }

  const source = await loadRestorePreviewSourceWithTransaction(tx, ownerUserId, backupId);
  if (!source) {
    throw new BackupArtifactError("BACKUP_RESTORE_NOT_FOUND", 404, "Backup snapshot not found.");
  }

  assertRestoreRequestShape(request);
  assertBackupArtifactExecutable(source.backupArtifact, source.backupRow);

  const preview = await getBackupRestorePreviewForUserWithTransaction(
    tx,
    ownerUserId,
    backupId,
    request.previewGeneratedAt,
  );
  if (!preview.eligibleForRestorePlanning || preview.blockingReasons.length > 0) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_BLOCKED_BY_PREVIEW",
      422,
      "Backup restore is blocked by preview validation.",
      { blockingReasons: preview.blockingReasons },
    );
  }

  if (preview.previewFingerprint !== request.previewFingerprint) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_PREVIEW_FINGERPRINT_STALE",
      409,
      "Preview fingerprint no longer matches current restore conditions.",
    );
  }

  if (preview.currentStateFingerprint !== request.currentStateFingerprint) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_CURRENT_STATE_FINGERPRINT_STALE",
      409,
      "Current state fingerprint no longer matches current restore conditions.",
    );
  }

  if (source.backupArtifact.schemaVersion === BACKUP_V13_SCHEMA_VERSION) {
    await assertLegacyClientSafetyBackup(
      tx,
      ownerUserId,
      request,
      preview.currentClientStateFingerprint,
    );
  }

  const previousCurrentStateFingerprint = preview.currentStateFingerprint;
  const backupStateFingerprint = preview.backupStateFingerprint;

  await assertNoCrossOwnerCollisions(tx, ownerUserId, source.backupArtifact);

  const deletedCounts = await deleteOwnerScopedRows(tx, ownerUserId);
  if (restoreTestHooks.afterDeletePhase) {
    await restoreTestHooks.afterDeletePhase();
  }

  await insertBackupRows(tx, source.backupArtifact, ownerUserId);

  const restoredStateFingerprint = restoreTestHooks.forcePostconditionMismatch
    ? "postcondition-mismatch"
    : await getCurrentComparableStateFingerprintForOwner(tx, ownerUserId);

  if (restoredStateFingerprint !== backupStateFingerprint) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_POSTCONDITION_FAILED",
      500,
      "Backup restore postcondition failed.",
    );
  }

  const restoredCounts = buildRestoredCounts(source.backupArtifact);
  const finishedAt = new Date();

  await writeOpsAuditEvent(
    {
      actorUserId: ownerUserId,
      action: "ops.backup.restore.completed",
      status: "success",
      correlationRequestId,
      resourceId: backupId,
      metadata: {
        backupId,
        ownerUserId,
        strategy: request.strategy,
        appliedPreviewFingerprint: preview.previewFingerprint,
        previousCurrentStateFingerprint,
        restoredStateFingerprint,
        deletedCounts,
        restoredCounts,
      },
    },
    tx,
    { strict: true },
  );

  return {
    backupId,
    status: "completed",
    strategy: "replace_all",
    appliedPreviewFingerprint: preview.previewFingerprint,
    previousCurrentStateFingerprint,
    backupStateFingerprint,
    restoredStateFingerprint,
    deletedCounts,
    restoredCounts,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    warnings: mapWarnings(preview.warnings),
  };
}

function assertRestoreRequestShape(request: BackupRestoreRequest): void {
  if (request.strategy !== "replace_all") {
    throw new BackupArtifactError("BACKUP_RESTORE_STRATEGY_INVALID", 400, "strategy must be 'replace_all'.");
  }

  if (request.acknowledgeDataLoss !== true) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_ACKNOWLEDGE_REQUIRED",
      400,
      "acknowledgeDataLoss must be true.",
    );
  }

  if (!request.previewFingerprint || !request.currentStateFingerprint) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_REQUEST_INVALID",
      400,
      "previewFingerprint and currentStateFingerprint are required.",
    );
  }
}

async function assertLegacyClientSafetyBackup(
  tx: RestoreTransactionalClient,
  ownerUserId: string,
  request: BackupRestoreRequest,
  expectedClientStateFingerprint: string,
): Promise<void> {
  if (
    request.acknowledgeLegacyClientDataLoss !== true ||
    !request.safetyBackupId ||
    !request.previewGeneratedAt ||
    Number.isNaN(Date.parse(request.previewGeneratedAt))
  ) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_LEGACY_CLIENT_SAFETY_REQUIRED",
      409,
      "Legacy restore requires explicit acknowledgement and a post-preview v2 safety backup.",
    );
  }

  const safetyRow = await tx.opsBackupSnapshot.findFirst({
    where: { id: request.safetyBackupId, ownerUserId },
  });
  if (!safetyRow) {
    throw new BackupArtifactError("BACKUP_RESTORE_SAFETY_BACKUP_NOT_FOUND", 409, "Safety backup not found.");
  }

  if (
    safetyRow.schemaVersion !== BACKUP_V13_V2_SCHEMA_VERSION ||
    safetyRow.createdAt.getTime() <= new Date(request.previewGeneratedAt).getTime() ||
    !isBackupV13V2Artifact(safetyRow.snapshotJson)
  ) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_SAFETY_BACKUP_INVALID",
      409,
      "Safety backup must be a valid v2 artifact created after the preview.",
    );
  }

  const safetyArtifact = safetyRow.snapshotJson;
  const checksum = computeArtifactChecksumHex(safetyArtifact);
  if (
    safetyArtifact.backupId !== safetyRow.id ||
    safetyArtifact.ownerUserId !== ownerUserId ||
    safetyArtifact.checksum !== checksum ||
    safetyRow.checksum !== checksum
  ) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_SAFETY_BACKUP_INVALID",
      409,
      "Safety backup integrity validation failed.",
    );
  }

  if (getClientStateFingerprintForArtifact(safetyArtifact, ownerUserId) !== expectedClientStateFingerprint) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_SAFETY_BACKUP_STATE_MISMATCH",
      409,
      "Safety backup Client state does not match the previewed current state.",
    );
  }
}

function assertBackupArtifactExecutable(artifact: BackupV13Artifact, row: { id: string; checksum: string }): void {
  if (artifact.schemaVersion !== BACKUP_V13_SCHEMA_VERSION && artifact.schemaVersion !== BACKUP_V13_V2_SCHEMA_VERSION) {
    throw new BackupArtifactError("BACKUP_RESTORE_SCHEMA_UNSUPPORTED", 422, "Unsupported backup schema version.");
  }

  if (!isBackupV13Artifact(artifact)) {
    throw new BackupArtifactError("BACKUP_RESTORE_ARTIFACT_INVALID", 422, "Backup artifact is malformed.");
  }

  if (artifact.backupId !== row.id) {
    throw new BackupArtifactError("BACKUP_RESTORE_ARTIFACT_INVALID", 422, "Backup artifact id mismatch.");
  }

  const checksum = computeArtifactChecksumHex(artifact);
  if (artifact.checksum !== checksum || row.checksum !== checksum) {
    throw new BackupArtifactError("BACKUP_RESTORE_CHECKSUM_MISMATCH", 422, "Backup checksum does not match canonical content.");
  }
}

async function assertNoCrossOwnerCollisions(tx: RestoreTransactionalClient, ownerUserId: string, artifact: BackupV13Artifact): Promise<void> {
  const [clientCollisions, analysisCollisions, assetCollisions, imageAnalysisCollisions, reviewCollisions] = await Promise.all([
    tx.client.findMany({ where: { id: { in: artifact.sections.clients.map((row) => row.id) } }, select: { id: true, ownerUserId: true } }),
    tx.analysis.findMany({ where: { id: { in: artifact.sections.analyses.map((row) => row.id) } }, select: { id: true, ownerUserId: true } }),
    tx.imageAsset.findMany({ where: { id: { in: artifact.sections.imageAssets.map((row) => row.id) } }, select: { id: true, ownerUserId: true } }),
    tx.imageAnalysis.findMany({ where: { id: { in: artifact.sections.imageAnalyses.map((row) => row.id) } }, select: { id: true, asset: { select: { ownerUserId: true } } } }),
    tx.imageAnalysisReview.findMany({ where: { id: { in: artifact.sections.imageAnalysisReviews.map((row) => row.id) } }, select: { id: true, analysis: { select: { asset: { select: { ownerUserId: true } } } } } }),
  ]);

  const crossOwnerClient = clientCollisions.find((row) => row.ownerUserId !== ownerUserId);
  if (crossOwnerClient) {
    throw new BackupArtifactError("BACKUP_RESTORE_OWNER_COLLISION", 409, "Restore encountered a cross-owner client collision.", { id: crossOwnerClient.id });
  }

  const crossOwnerAnalysis = analysisCollisions.find((row) => row.ownerUserId !== ownerUserId);
  if (crossOwnerAnalysis) {
    throw new BackupArtifactError("BACKUP_RESTORE_OWNER_COLLISION", 409, "Restore encountered a cross-owner analysis collision.", { id: crossOwnerAnalysis.id });
  }

  const crossOwnerAsset = assetCollisions.find((row) => row.ownerUserId !== ownerUserId);
  if (crossOwnerAsset) {
    throw new BackupArtifactError("BACKUP_RESTORE_OWNER_COLLISION", 409, "Restore encountered a cross-owner image asset collision.", { id: crossOwnerAsset.id });
  }

  const crossOwnerImageAnalysis = imageAnalysisCollisions.find((row) => row.asset.ownerUserId !== ownerUserId);
  if (crossOwnerImageAnalysis) {
    throw new BackupArtifactError("BACKUP_RESTORE_OWNER_COLLISION", 409, "Restore encountered a cross-owner image analysis collision.", { id: crossOwnerImageAnalysis.id });
  }

  const crossOwnerReview = reviewCollisions.find((row) => row.analysis.asset.ownerUserId !== ownerUserId);
  if (crossOwnerReview) {
    throw new BackupArtifactError("BACKUP_RESTORE_OWNER_COLLISION", 409, "Restore encountered a cross-owner image analysis review collision.", { id: crossOwnerReview.id });
  }

  await assertReferenceTargetsAreInternal(artifact);
}

async function assertReferenceTargetsAreInternal(artifact: BackupV13Artifact): Promise<void> {
  const clientIds = new Set(artifact.sections.clients.map((row) => row.id));
  const imageAssetIds = new Set(artifact.sections.imageAssets.map((row) => row.id));
  const imageAnalysisIds = new Set(artifact.sections.imageAnalyses.map((row) => row.id));

  for (const row of artifact.sections.analyses) {
    if (!clientIds.has(row.clientId)) {
      throw new BackupArtifactError("BACKUP_RESTORE_REFERENCE_COLLISION", 409, "Analysis references a client missing from the artifact.", { id: row.id, clientId: row.clientId });
    }

    if (row.imageAssetId && !imageAssetIds.has(row.imageAssetId)) {
      throw new BackupArtifactError("BACKUP_RESTORE_REFERENCE_COLLISION", 409, "Analysis references an image asset missing from the artifact.", { id: row.id, imageAssetId: row.imageAssetId });
    }

    if (row.imageAnalysisId && !imageAnalysisIds.has(row.imageAnalysisId)) {
      throw new BackupArtifactError("BACKUP_RESTORE_REFERENCE_COLLISION", 409, "Analysis references an image analysis missing from the artifact.", { id: row.id, imageAnalysisId: row.imageAnalysisId });
    }
  }

  for (const row of artifact.sections.imageAssets) {
    if (!clientIds.has(row.clientId)) {
      throw new BackupArtifactError("BACKUP_RESTORE_REFERENCE_COLLISION", 409, "Image asset references a client missing from the artifact.", { id: row.id, clientId: row.clientId });
    }
  }

  for (const row of artifact.sections.imageAnalyses) {
    if (!imageAssetIds.has(row.assetId)) {
      throw new BackupArtifactError("BACKUP_RESTORE_REFERENCE_COLLISION", 409, "Image analysis references an image asset missing from the artifact.", { id: row.id, assetId: row.assetId });
    }
  }

  for (const row of artifact.sections.imageAnalysisReviews) {
    if (!imageAnalysisIds.has(row.analysisId)) {
      throw new BackupArtifactError("BACKUP_RESTORE_REFERENCE_COLLISION", 409, "Image analysis review references an image analysis missing from the artifact.", { id: row.id, analysisId: row.analysisId });
    }
  }
}

async function deleteOwnerScopedRows(tx: RestoreTransactionalClient, ownerUserId: string): Promise<BackupRestoreCounts> {
  const deletedCounts = await countOwnerScopedRows(tx, ownerUserId);

  await tx.imageAnalysisReview.deleteMany({
    where: {
      analysis: {
        asset: {
          ownerUserId,
        },
      },
    },
  });

  await tx.analysis.deleteMany({
    where: { ownerUserId },
  });

  await tx.imageAnalysis.deleteMany({
    where: {
      asset: {
        ownerUserId,
      },
    },
  });

  await tx.imageAsset.deleteMany({
    where: { ownerUserId },
  });

  await tx.client.deleteMany({
    where: { ownerUserId },
  });

  return deletedCounts;
}

async function insertBackupRows(tx: RestoreTransactionalClient, artifact: BackupV13Artifact, ownerUserId: string): Promise<void> {
  for (const clientData of mapClientRowsForRestore(artifact)) {
    await tx.client.create({
      data: clientData,
    });
  }

  for (const row of artifact.sections.imageAssets) {
    await tx.imageAsset.create({
      data: {
        id: row.id,
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        ownerUserId: row.ownerUserId,
        clientId: row.clientId,
        storagePath: row.storagePath,
        exifStripped: row.exifStripped,
        normalizedOrientation: row.normalizedOrientation,
        uploadedAt: new Date(row.uploadedAt),
        deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
        retentionDeletesAt: row.retentionDeletesAt ? new Date(row.retentionDeletesAt) : null,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      },
    });
  }

  if (restoreTestHooks.afterImageAssetInsert) {
    await restoreTestHooks.afterImageAssetInsert();
  }

  for (const row of artifact.sections.imageAnalyses) {
    await tx.imageAnalysis.create({
      data: {
        id: row.id,
        assetId: row.assetId,
        status: row.status,
        providerName: row.providerName,
        modelVersion: row.modelVersion,
        analysisPayload: asJsonValue(row.analysisPayload),
        confidences: asJsonValue(row.confidences),
        unknownFields: asJsonValue(row.unknownFields),
        warnings: asJsonValue(row.warnings),
        limitations: asJsonValue(row.limitations),
        consentTimestamp: new Date(row.consentTimestamp),
        deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
        retentionDeletesAt: row.retentionDeletesAt ? new Date(row.retentionDeletesAt) : null,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      },
    });
  }

  for (const row of artifact.sections.analyses) {
    await tx.analysis.create({
      data: {
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
        uncertaintyReasons: asJsonValue(row.uncertaintyReasons),
        followUpQuestions: asJsonValue(row.followUpQuestions),
        recommendations: asJsonValue(row.recommendations),
        safetyNotes: asJsonValue(row.safetyNotes),
        faceShape: row.faceShape,
        headShape: row.headShape,
        hairLength: row.hairLength,
        hairTexture: row.hairTexture,
        hairCondition: row.hairCondition,
        growthPattern: row.growthPattern,
        targetShape: row.targetShape,
        technicalCutPlan: row.technicalCutPlan === null ? Prisma.JsonNull : asJsonValue(row.technicalCutPlan),
        clarificationAnswers: asJsonValue(row.clarificationAnswers),
        imageAssetId: row.imageAssetId,
        imageAnalysisId: row.imageAnalysisId,
        m8DraftCreatedAt: row.m8DraftCreatedAt ? new Date(row.m8DraftCreatedAt) : null,
        m8FinalizedAt: row.m8FinalizedAt ? new Date(row.m8FinalizedAt) : null,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      },
    });
  }

  for (const row of artifact.sections.imageAnalysisReviews) {
    await tx.imageAnalysisReview.create({
      data: {
        id: row.id,
        analysisId: row.analysisId,
        reviewedByUserId: row.reviewedByUserId,
        manualCorrections: asJsonValue(row.manualCorrections),
        confirmationTimestamp: row.confirmationTimestamp ? new Date(row.confirmationTimestamp) : null,
        notes: row.notes,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      },
    });
  }

  const finalCounts = await countOwnerScopedRows(tx, ownerUserId);
  const expectedCounts = buildRestoredCounts(artifact);
  if (JSON.stringify(finalCounts) !== JSON.stringify(expectedCounts)) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_UNIQUE_CONFLICT",
      409,
      "Restore counts do not match expected artifact counts.",
    );
  }
}

function mapClientRowsForRestore(artifact: BackupV13Artifact) {
  switch (artifact.schemaVersion) {
    case BACKUP_V13_SCHEMA_VERSION:
      return artifact.sections.clients.map(mapV1ClientRowForRestore);
    case BACKUP_V13_V2_SCHEMA_VERSION:
      return artifact.sections.clients.map(mapV2ClientRowForRestore);
    default:
      throw new BackupArtifactError("BACKUP_RESTORE_SCHEMA_UNSUPPORTED", 422, "Unsupported backup schema version.");
  }
}

function mapV1ClientRowForRestore(row: BackupV13ClientSectionRow) {
  return {
    id: row.id,
    fullName: row.name,
    email: null,
    phone: null,
    notes: null,
    deletedAt: null,
    ownerUserId: row.ownerUserId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function mapV2ClientRowForRestore(row: BackupV13V2ClientSectionRow) {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
    ownerUserId: row.ownerUserId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

async function countOwnerScopedRows(tx: RestoreTransactionalClient, ownerUserId: string): Promise<BackupRestoreCounts> {
  const [clients, analyses, imageAssets, imageAnalyses, imageAnalysisReviews] = await Promise.all([
    tx.client.count({ where: { ownerUserId } }),
    tx.analysis.count({ where: { ownerUserId } }),
    tx.imageAsset.count({ where: { ownerUserId } }),
    tx.imageAnalysis.count({ where: { asset: { ownerUserId } } }),
    tx.imageAnalysisReview.count({ where: { analysis: { asset: { ownerUserId } } } }),
  ]);

  return {
    clients,
    analyses,
    imageAssets,
    imageAnalyses,
    imageAnalysisReviews,
  };
}

function buildRestoredCounts(artifact: BackupV13Artifact): BackupRestoreCounts {
  return {
    clients: artifact.sections.clients.length,
    analyses: artifact.sections.analyses.length,
    imageAssets: artifact.sections.imageAssets.length,
    imageAnalyses: artifact.sections.imageAnalyses.length,
    imageAnalysisReviews: artifact.sections.imageAnalysisReviews.length,
  };
}

function mapWarnings(warnings: Array<{ code: string; messageSafe: string }>): BackupRestoreWarning[] {
  return warnings.map((warning) => ({
    code: warning.code === "CURRENT_STATE_HAS_EXTRA_ROWS" ? "CURRENT_STATE_HAS_EXTRA_ROWS" : "BACKUP_OLDER_THAN_CURRENT_STATE",
    messageSafe: warning.messageSafe,
  }));
}

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isRetryableRestoreConcurrencyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("deadlock") || message.includes("serialization");
  }

  return false;
}

function attachAttemptsUsed(error: unknown, attempt: number): unknown {
  if (!error || typeof error !== "object") {
    return error;
  }

  const normalizedAttempt = Math.min(Math.max(attempt, 1), MAX_RESTORE_RETRIES) as 1 | 2 | 3;
  const value = error as { attemptsUsed?: 1 | 2 | 3 };
  value.attemptsUsed = normalizedAttempt;
  return value;
}

export const __testUtils = {
  setAfterDeletePhaseHook(hook: null | (() => Promise<void> | void)) {
    restoreTestHooks.afterDeletePhase = hook;
  },
  setAfterImageAssetInsertHook(hook: null | (() => Promise<void> | void)) {
    restoreTestHooks.afterImageAssetInsert = hook;
  },
  setForcePostconditionMismatch(value: boolean) {
    restoreTestHooks.forcePostconditionMismatch = value;
  },
  setRetryableFailuresRemaining(count: number) {
    restoreTestHooks.retryableFailuresRemaining = count;
  },
  resetHooks() {
    restoreTestHooks.afterDeletePhase = null;
    restoreTestHooks.afterImageAssetInsert = null;
    restoreTestHooks.forcePostconditionMismatch = false;
    restoreTestHooks.retryableFailuresRemaining = 0;
  },
  countOwnerScopedRows,
  mapClientRowsForRestore,
};