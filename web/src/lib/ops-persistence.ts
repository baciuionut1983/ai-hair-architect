import { createHash, randomUUID } from "crypto";

import { Prisma } from "@prisma/client";

import type {
  AuthSessionResponse,
  BackupSnapshotRecord,
  BackupV13Artifact,
  BackupVerificationResult,
  PushQueueRecord,
  RetentionRunResult,
} from "@/lib/contracts";
import { findPersistenceUserBySessionToken } from "@/lib/auth-persistence";
import {
  assertSectionByteLimits,
  assertSectionRowLimits,
  assertTotalArtifactByteLimit,
  BACKUP_CHECKSUM_ALGORITHM,
  BACKUP_LEGACY_M12_SCHEMA_VERSION,
  BACKUP_V13_CANONICAL_VERSION,
  BACKUP_V13_SCHEMA_VERSION,
  BackupArtifactError,
  buildVerificationResult,
  computeArtifactChecksumHex,
  generateBackupId,
  isBackupV13Artifact,
  MAX_BACKUP_ARTIFACT_BYTES,
  MAX_BACKUP_SECTION_BYTES,
  MAX_ROWS_PER_SECTION,
  parseSnapshotSchemaVersion,
  verifyExternalReferences,
} from "@/lib/backup-v13-artifact";
import {
  createBackupSnapshot,
  enqueuePushNotification,
  getAuditEventsForUser,
  getBackupSnapshotsForUser,
  getSession,
  getWorkspacesForUser,
  processPushQueueForUser,
  runRetentionJobForUser,
  sanitize,
  store,
  upsertUser,
} from "@/lib/milestone1-store";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

const RETENTION_CONFIRMATION_TOKEN = "CONFIRM_RETENTION_EXECUTION";
const OPS_AUDIT_MODULE = "security";
const OPS_RESOURCE_TYPE = "ops";
const testHooks: {
  beforeRetentionDelete: null | (() => Promise<void> | void);
  beforePushProcessCommit: null | (() => Promise<void> | void);
} = {
  beforeRetentionDelete: null,
  beforePushProcessCommit: null,
};
export interface OpsAuditEventView {
  id: string;
  ownerUserId: string;
  requestId: string;
  module: "billing" | "agents" | "security";
  action: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface RunRetentionExecutionInput {
  userId: string;
  olderThanDays: number;
  dryRun: boolean;
  confirmationToken?: string;
  executionIdempotencyKey?: string;
  reason?: string;
  correlationRequestId: string;
}

export interface OpsMutationResult {
  httpStatus: number;
  body: { backup?: BackupSnapshotRecord; backups?: BackupSnapshotRecord[]; result?: RetentionRunResult; error?: string; message?: string; requestId?: string };
}

export async function enqueuePersistentPushNotification(input: {
  userId: string;
  channel: "in_app" | "email" | "push";
  title: string;
  body: string;
}): Promise<PushQueueRecord> {
  const queued = enqueuePushNotification(input);

  if (!isDatabaseConfigured()) {
    return queued;
  }

  try {
    await prisma.opsPushQueueEntry.upsert({
      where: { id: queued.id },
      create: {
        id: queued.id,
        ownerUserId: queued.userId,
        channel: queued.channel,
        title: queued.title,
        body: queued.body,
        status: queued.status,
        createdAt: new Date(queued.createdAt),
        processedAt: queued.processedAt ? new Date(queued.processedAt) : null,
      },
      update: {
        ownerUserId: queued.userId,
        channel: queued.channel,
        title: queued.title,
        body: queued.body,
        status: queued.status,
        createdAt: new Date(queued.createdAt),
        processedAt: queued.processedAt ? new Date(queued.processedAt) : null,
      },
    });

    return queued;
  } catch (error) {
    store.pushQueue = store.pushQueue.filter((entry) => entry.id !== queued.id);
    throw error;
  }
}

export async function processPersistentPushQueueForUser(userId: string): Promise<{ sent: number }> {
  if (!isDatabaseConfigured()) {
    return processPushQueueForUser(userId);
  }

  const queuedEntries = store.pushQueue.filter((entry) => entry.userId === userId && entry.status === "queued");
  if (queuedEntries.length === 0) {
    return { sent: 0 };
  }

  const queuedIds = queuedEntries.map((entry) => entry.id);
  const processedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const updated = await tx.opsPushQueueEntry.updateMany({
      where: {
        ownerUserId: userId,
        id: { in: queuedIds },
        status: "queued",
      },
      data: {
        status: "sent",
        processedAt,
      },
    });

    if (updated.count !== queuedIds.length) {
      throw new Error("PUSH_PROCESS_DB_COUNT_MISMATCH");
    }

    if (testHooks.beforePushProcessCommit) {
      await testHooks.beforePushProcessCommit();
    }
  });

  const queuedIdSet = new Set(queuedIds);
  const processedAtIso = processedAt.toISOString();
  for (const entry of store.pushQueue) {
    if (entry.userId === userId && queuedIdSet.has(entry.id) && entry.status === "queued") {
      entry.status = "sent";
      entry.processedAt = processedAtIso;
    }
  }

  return { sent: queuedIds.length };
}

export async function resolveOpsSessionUser(token: string | null): Promise<AuthSessionResponse["user"] | null> {
  let user = getSession(token);

  if (!user && token) {
    const persisted = await findPersistenceUserBySessionToken(token);
    if (persisted) {
      const synced = upsertUser({
        id: persisted.id,
        email: persisted.email,
        passwordHash: persisted.passwordHash,
        role: persisted.role,
        locale: persisted.locale,
        createdAt: persisted.createdAt,
      });

      user = {
        id: synced.id,
        email: synced.email,
        role: synced.role,
        locale: synced.locale,
        createdAt: synced.createdAt,
      };
    }
  }

  return user;
}

export async function resolveOpsSessionUserReadOnly(token: string | null): Promise<AuthSessionResponse["user"] | null> {
  const inMemoryUser = getSession(token);
  if (inMemoryUser) {
    return inMemoryUser;
  }

  if (!token) {
    return null;
  }

  const persisted = await findPersistenceUserBySessionToken(token);
  if (!persisted) {
    return null;
  }

  return {
    id: persisted.id,
    email: persisted.email,
    role: persisted.role,
    locale: persisted.locale,
    createdAt: persisted.createdAt,
  };
}

export async function listOpsAuditEventsForUser(userId: string): Promise<OpsAuditEventView[]> {
  if (!isDatabaseConfigured()) {
    return getAuditEventsForUser(userId).map((event) => ({
      id: event.id,
      ownerUserId: event.ownerUserId,
      requestId: event.requestId,
      module: event.module,
      action: event.action,
      createdAt: event.createdAt,
      metadata: event.metadata,
    }));
  }

  const rows = await prisma.auditLog.findMany({
    where: {
      actorUserId: userId,
      action: {
        startsWith: "ops.",
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return rows.map((row) => ({
    id: row.id,
    ownerUserId: row.actorUserId,
    requestId: getMetadataString(row.metadata, "correlationRequestId") ?? row.id,
    module: OPS_AUDIT_MODULE,
    action: row.action,
    createdAt: row.createdAt.toISOString(),
    metadata: asRecord(row.metadata),
  }));
}

export async function listBackupSnapshotsForUser(userId: string): Promise<BackupSnapshotRecord[]> {
  if (!isDatabaseConfigured()) {
    return getBackupSnapshotsForUser(userId);
  }

  const rows = await prisma.opsBackupSnapshot.findMany({
    where: { ownerUserId: userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    ownerUserId: row.ownerUserId,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    checksum: row.checksum,
    checksumAlgorithm: row.checksumAlgorithm,
    schemaVersion: row.schemaVersion,
    createdByUserId: row.createdByUserId,
    snapshot: asBackupSnapshot(row.snapshotJson),
  }));
}

export async function createPersistentBackupSnapshot(input: {
  ownerUserId: string;
  createdByUserId: string;
  label: string;
}): Promise<BackupSnapshotRecord> {
  if (!isDatabaseConfigured()) {
    return createBackupSnapshot(input.ownerUserId, input.label);
  }

  if (!Prisma.TransactionIsolationLevel?.RepeatableRead) {
    throw new BackupArtifactError(
      "BACKUP_CONSISTENT_SNAPSHOT_UNSUPPORTED",
      500,
      "RepeatableRead transaction isolation is required for M13 backup creation.",
    );
  }

  const backupId = generateBackupId();
  const nowIso = new Date().toISOString();

  const sectionData = await prisma.$transaction(
    async (tx) => {
      const [
        clientsCount,
        analysesCount,
        imageAssetsCount,
        imageAnalysesCount,
        imageAnalysisReviewsCount,
      ] = await Promise.all([
        tx.client.count({ where: { ownerUserId: input.ownerUserId } }),
        tx.analysis.count({ where: { ownerUserId: input.ownerUserId } }),
        tx.imageAsset.count({ where: { ownerUserId: input.ownerUserId } }),
        tx.imageAnalysis.count({ where: { asset: { ownerUserId: input.ownerUserId } } }),
        tx.imageAnalysisReview.count({ where: { analysis: { asset: { ownerUserId: input.ownerUserId } } } }),
      ]);

      const counts = {
        clients: clientsCount,
        analyses: analysesCount,
        imageAssets: imageAssetsCount,
        imageAnalyses: imageAnalysesCount,
        imageAnalysisReviews: imageAnalysisReviewsCount,
      };
      assertSectionRowLimits(counts);

      const [clients, analyses, imageAssets, imageAnalyses, imageAnalysisReviews] = await Promise.all([
        tx.client.findMany({
          where: { ownerUserId: input.ownerUserId },
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
          where: { ownerUserId: input.ownerUserId },
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
          where: { ownerUserId: input.ownerUserId },
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
          where: { asset: { ownerUserId: input.ownerUserId } },
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
          where: {
            analysis: {
              asset: {
                ownerUserId: input.ownerUserId,
              },
            },
          },
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
        counts,
        sections: {
          clients: clients.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })),
          analyses: analyses.map((row) => ({
            ...row,
            m8DraftCreatedAt: row.m8DraftCreatedAt?.toISOString() ?? null,
            m8FinalizedAt: row.m8FinalizedAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })),
          imageAssets: imageAssets.map((row) => ({
            ...row,
            uploadedAt: row.uploadedAt.toISOString(),
            deletedAt: row.deletedAt?.toISOString() ?? null,
            retentionDeletesAt: row.retentionDeletesAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })),
          imageAnalyses: imageAnalyses.map((row) => ({
            ...row,
            consentTimestamp: row.consentTimestamp.toISOString(),
            deletedAt: row.deletedAt?.toISOString() ?? null,
            retentionDeletesAt: row.retentionDeletesAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })),
          imageAnalysisReviews: imageAnalysisReviews.map((row) => ({
            ...row,
            confirmationTimestamp: row.confirmationTimestamp?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })),
        },
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );

  const summarySnapshot = {
    clientsCount: sectionData.counts.clients,
    consultationsCount: 0,
    appointmentsCount: 0,
    notificationsCount: 0,
    workspacesCount: 0,
  };

  const artifact: BackupV13Artifact = {
    schemaVersion: BACKUP_V13_SCHEMA_VERSION,
    canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
    checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
    checksum: null,
    backupId,
    ownerUserId: input.ownerUserId,
    createdByUserId: input.createdByUserId,
    label: input.label,
    createdAt: nowIso,
    summarySnapshot,
    counts: sectionData.counts,
    limits: {
      maxArtifactBytes: MAX_BACKUP_ARTIFACT_BYTES,
      maxSectionBytes: MAX_BACKUP_SECTION_BYTES,
      maxRowsPerSection: { ...MAX_ROWS_PER_SECTION },
    },
    sections: sectionData.sections,
  };

  assertSectionByteLimits(artifact);
  const checksum = computeArtifactChecksumHex(artifact);
  artifact.checksum = checksum;
  assertTotalArtifactByteLimit(artifact);

  const row = await prisma.opsBackupSnapshot.create({
    data: {
      id: backupId,
      ownerUserId: input.ownerUserId,
      createdByUserId: input.createdByUserId,
      label: input.label,
      snapshotJson: artifact as unknown as Prisma.InputJsonValue,
      checksum,
      checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
      schemaVersion: BACKUP_V13_SCHEMA_VERSION,
    },
  });

  await logOpsAuditEvent({
    actorUserId: input.ownerUserId,
    action: "ops.backup.created",
    status: "success",
    correlationRequestId: row.id,
    resourceId: row.id,
    metadata: {
      checksum,
      checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
      schemaVersion: BACKUP_V13_SCHEMA_VERSION,
      label: input.label,
    },
  });

  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    checksum: row.checksum,
    checksumAlgorithm: row.checksumAlgorithm,
    schemaVersion: row.schemaVersion,
    createdByUserId: row.createdByUserId,
    snapshot: summarySnapshot,
  };
}

export async function verifyBackupSnapshotForUser(userId: string, backupId: string): Promise<BackupVerificationResult> {
  if (!isDatabaseConfigured()) {
    throw new BackupArtifactError(
      "BACKUP_VERIFICATION_UNAVAILABLE",
      400,
      "Backup verification requires a configured database.",
    );
  }

  const row = await prisma.opsBackupSnapshot.findFirst({
    where: {
      id: backupId,
      ownerUserId: userId,
    },
  });

  if (!row) {
    throw new BackupArtifactError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found.");
  }

  const parsedSchemaVersion = parseSnapshotSchemaVersion(row.schemaVersion, row.snapshotJson);
  if (parsedSchemaVersion === BACKUP_LEGACY_M12_SCHEMA_VERSION) {
    return buildVerificationResult({
      backupId: row.id,
      schemaVersion: BACKUP_LEGACY_M12_SCHEMA_VERSION,
      checksumStatus: "not_available",
      artifactValidity: "legacy_valid",
      externalReferenceStatus: "not_applicable",
      recoveryArtifactStatus: "legacy_summary_only",
      reason: "legacy_summary_only",
    });
  }

  if (parsedSchemaVersion !== BACKUP_V13_SCHEMA_VERSION) {
    throw new BackupArtifactError(
      "BACKUP_SCHEMA_UNSUPPORTED",
      422,
      "Unsupported backup schema version.",
    );
  }

  if (!isBackupV13Artifact(row.snapshotJson)) {
    throw new BackupArtifactError("BACKUP_ARTIFACT_MALFORMED", 422, "Backup artifact is malformed.");
  }

  const artifact = row.snapshotJson;
  if (artifact.backupId !== row.id) {
    throw new BackupArtifactError("BACKUP_ARTIFACT_ID_MISMATCH", 422, "Artifact backupId does not match row id.");
  }

  const recomputed = computeArtifactChecksumHex(artifact);
  if (artifact.checksum !== recomputed || row.checksum !== recomputed) {
    throw new BackupArtifactError("BACKUP_CHECKSUM_MISMATCH", 422, "Backup checksum does not match canonical content.");
  }

  const external = await verifyExternalReferences(artifact);
  return buildVerificationResult({
    backupId: row.id,
    schemaVersion: BACKUP_V13_SCHEMA_VERSION,
    checksumStatus: "verified_match",
    artifactValidity: "valid",
    externalReferenceStatus: external.status,
    recoveryArtifactStatus: "verification_ready",
    reason: external.reason,
  });
}

export async function runPersistentRetention(input: RunRetentionExecutionInput): Promise<OpsMutationResult> {
  const olderThanDays = normalizeOlderThanDays(input.olderThanDays);
  const dryRun = input.dryRun;

  if (!dryRun && input.confirmationToken !== RETENTION_CONFIRMATION_TOKEN) {
    return {
      httpStatus: 400,
      body: {
        error: "CONFIRMATION_REQUIRED",
        message: "Explicit confirmation is required to execute retention.",
        requestId: input.correlationRequestId,
      },
    };
  }

  if (!isDatabaseConfigured()) {
    const result = runRetentionJobForUser({
      userId: input.userId,
      olderThanDays,
      dryRun,
    });

    return {
      httpStatus: 200,
      body: {
        result,
      },
    };
  }

  const reasonAuditSafe = sanitizeReasonForAudit(input.reason);
  const executionIdempotencyKey = sanitizeIdempotencyKey(input.executionIdempotencyKey);
  const advisoryLockKey = deriveAdvisoryLockKey(input.userId);
  const idempotencyFingerprint = executionIdempotencyKey
    ? computeRetentionFingerprint({ ownerUserId: input.userId, olderThanDays, reason: input.reason })
    : null;

  if (!dryRun && executionIdempotencyKey) {
    const replay = await findRetentionReplay({
      ownerUserId: input.userId,
      executionIdempotencyKey,
      fingerprint: idempotencyFingerprint!,
    });

    if (replay) {
      return replay;
    }
  }

  if (dryRun) {
    const startedAt = new Date();
    const pushQueueAffected = await countEligiblePushQueue(prisma, input.userId, startedAt, olderThanDays);
    const auditEventsAffected = await countEligibleAuditEvents(prisma, input.userId, startedAt, olderThanDays);
    const row = await prisma.opsRetentionRun.create({
      data: {
        ownerUserId: input.userId,
        mode: "dry_run",
        status: "dry_run_completed",
        olderThanDays,
        reasonAuditSafe,
        executionIdempotencyKey: null,
        idempotencyFingerprint: null,
        advisoryLockKey,
        startedAt,
        finishedAt: startedAt,
        pushQueueAffected,
        auditEventsAffected,
      },
    });

    await logOpsAuditEvent({
      actorUserId: input.userId,
      action: "ops.retention.dry_run.completed",
      status: "success",
      correlationRequestId: input.correlationRequestId,
      resourceId: row.id,
      metadata: {
        olderThanDays,
        pushQueueAffected,
        auditEventsAffected,
      },
    });

    return {
      httpStatus: 200,
      body: {
        result: {
          runId: row.id,
          status: "dry_run_completed",
          startedAt: row.startedAt.toISOString(),
          finishedAt: row.finishedAt?.toISOString(),
          replayed: false,
          dryRun: true,
          olderThanDays,
          pushQueueAffected,
          auditEventsAffected,
        },
      },
    };
  }

  try {
    const execution = await prisma.$transaction(async (tx) => {
      const acquired = await tryAcquireAdvisoryXactLock(tx, advisoryLockKey);
      if (!acquired) {
        return { kind: "conflict" as const };
      }

      if (executionIdempotencyKey) {
        const existing = await tx.opsRetentionRun.findUnique({
          where: {
            ownerUserId_executionIdempotencyKey: {
              ownerUserId: input.userId,
              executionIdempotencyKey,
            },
          },
        });

        if (existing) {
          return { kind: "replay" as const, row: existing };
        }
      }

      const startedAt = await selectDbNow(tx);
      const runId = randomUUID();

      await tx.opsRetentionRun.create({
        data: {
          id: runId,
          ownerUserId: input.userId,
          mode: "execution",
          status: "running",
          olderThanDays,
          reasonAuditSafe,
          executionIdempotencyKey: executionIdempotencyKey ?? null,
          idempotencyFingerprint,
          advisoryLockKey,
          startedAt,
          finishedAt: null,
          pushQueueAffected: 0,
          auditEventsAffected: 0,
        },
      });

      const startedEvent = await tx.auditLog.create({
        data: buildAuditLogCreateInput({
          actorUserId: input.userId,
          action: "ops.retention.execution.started",
          status: "success",
          correlationRequestId: input.correlationRequestId,
          resourceId: runId,
          metadata: {
            olderThanDays,
            mode: "execution",
          },
        }),
      });

      const eligiblePushQueueRecords = await tx.opsPushQueueEntry.findMany({
        where: buildEligiblePushQueueWhere(input.userId, startedAt, olderThanDays),
        select: { id: true },
      });

      const eligibleAuditEvents = await tx.auditLog.findMany({
        where: buildEligibleAuditWhere(input.userId, startedAt, olderThanDays, {
          protectedAuditLogIds: [startedEvent.id],
          protectedResourceIds: [runId],
        }),
        select: { id: true },
      });

      const pushQueueAffected = eligiblePushQueueRecords.length;
      const auditEventsAffected = eligibleAuditEvents.length;

      if (testHooks.beforeRetentionDelete) {
        await testHooks.beforeRetentionDelete();
      }

      if (pushQueueAffected > 0) {
        const deletedPush = await tx.opsPushQueueEntry.deleteMany({
          where: {
            ownerUserId: input.userId,
            id: { in: eligiblePushQueueRecords.map((entry) => entry.id) },
          },
        });

        if (deletedPush.count !== pushQueueAffected) {
          throw new Error("RETENTION_PARTIAL_PUSH_DELETE");
        }
      }

      if (auditEventsAffected > 0) {
        const deletedAudit = await tx.auditLog.deleteMany({
          where: {
            actorUserId: input.userId,
            id: { in: eligibleAuditEvents.map((entry) => entry.id) },
          },
        });

        if (deletedAudit.count !== auditEventsAffected) {
          throw new Error("RETENTION_PARTIAL_AUDIT_DELETE");
        }
      }

      const finishedAt = await selectDbNow(tx);

      const row = await tx.opsRetentionRun.update({
        where: { id: runId },
        data: {
          status: "execution_completed",
          finishedAt,
          pushQueueAffected,
          auditEventsAffected,
        },
      });

      await tx.auditLog.create({
        data: buildAuditLogCreateInput({
          actorUserId: input.userId,
          action: "ops.retention.execution.completed",
          status: "success",
          correlationRequestId: input.correlationRequestId,
          resourceId: runId,
          metadata: {
            olderThanDays,
            auditEventsAffected,
            pushQueueAffected,
          },
        }),
      });

      return {
        kind: "completed" as const,
        row,
        deletedPushQueueIds: eligiblePushQueueRecords.map((entry) => entry.id),
      };
    });

    if (execution.kind === "conflict") {
      await logOpsAuditEvent({
        actorUserId: input.userId,
        action: "ops.retention.execution.conflict",
        status: "failure",
        correlationRequestId: input.correlationRequestId,
        metadata: { olderThanDays },
      });

      return {
        httpStatus: 409,
        body: {
          error: "RETENTION_CONFLICT",
          message: "A retention execution is already running for this scope.",
          requestId: input.correlationRequestId,
        },
      };
    }

    if (execution.kind === "replay") {
      return asReplayResult(execution.row, input.correlationRequestId);
    }

    if (execution.deletedPushQueueIds.length > 0) {
      const deletedIdSet = new Set(execution.deletedPushQueueIds);
      store.pushQueue = store.pushQueue.filter(
        (entry) => !(entry.userId === input.userId && deletedIdSet.has(entry.id)),
      );
    }

    return {
      httpStatus: 200,
      body: {
        result: toRetentionResult(execution.row, false),
      },
    };
  } catch (error) {
    const errorCode = getSafeErrorCode(error);
    const errorMessageSafe = getSafeErrorMessage(error);

    await persistFailureTrace({
      userId: input.userId,
      olderThanDays,
      advisoryLockKey,
      executionIdempotencyKey,
      idempotencyFingerprint,
      reasonAuditSafe,
      errorCode,
      errorMessageSafe,
      correlationRequestId: input.correlationRequestId,
    });

    return {
      httpStatus: 500,
      body: {
        error: "INTERNAL_ERROR",
        message: "Retention execution failed.",
        requestId: input.correlationRequestId,
      },
    };
  }
}

export const __testUtils = {
  canonicalize,
  computeBackupChecksum,
  computeRetentionFingerprint,
  deriveAdvisoryLockKey,
  setBeforeRetentionDeleteHook,
  setBeforePushProcessCommitHook,
  resetHooks,
};

function setBeforeRetentionDeleteHook(hook: null | (() => Promise<void> | void)): void {
  testHooks.beforeRetentionDelete = hook;
}

function setBeforePushProcessCommitHook(hook: null | (() => Promise<void> | void)): void {
  testHooks.beforePushProcessCommit = hook;
}

function resetHooks(): void {
  testHooks.beforeRetentionDelete = null;
  testHooks.beforePushProcessCommit = null;
}

function buildBackupSnapshot(ownerUserId: string): BackupSnapshotRecord["snapshot"] {
  const ownedClientIds = new Set(store.clients.filter((entry) => entry.ownerUserId === ownerUserId).map((entry) => entry.id));

  return {
    clientsCount: ownedClientIds.size,
    consultationsCount: store.consultations.filter((entry) => ownedClientIds.has(entry.clientId)).length,
    appointmentsCount: store.appointments.filter((entry) => entry.ownerUserId === ownerUserId).length,
    notificationsCount: store.notifications.filter((entry) => entry.ownerUserId === ownerUserId).length,
    workspacesCount: getWorkspacesForUser(ownerUserId).length,
  };
}

function asBackupSnapshot(value: Prisma.JsonValue): BackupSnapshotRecord["snapshot"] {
  const snapshot = asRecord(value);
  const maybeSummary = asRecord(snapshot.summarySnapshot as Prisma.JsonValue | null);
  const source = Object.keys(maybeSummary).length > 0 ? maybeSummary : snapshot;
  return {
    clientsCount: asNumber(source.clientsCount),
    consultationsCount: asNumber(source.consultationsCount),
    appointmentsCount: asNumber(source.appointmentsCount),
    notificationsCount: asNumber(source.notificationsCount),
    workspacesCount: asNumber(source.workspacesCount),
  };
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getMetadataString(value: Prisma.JsonValue, key: string): string | null {
  const record = asRecord(value);
  const entry = record[key];
  return typeof entry === "string" ? entry : null;
}

function normalizeOlderThanDays(value: number): number {
  if (!Number.isFinite(value)) {
    return 30;
  }

  return Math.min(3650, Math.max(30, Math.trunc(value)));
}

function sanitizeReasonForAudit(reason: string | undefined): string | null {
  const normalized = sanitize(reason);
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 200);
}

function sanitizeIdempotencyKey(value: string | undefined): string | null {
  const normalized = sanitize(value);
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 190);
}

function normalizeReasonForFingerprint(reason: string | undefined): string {
  return sanitize(reason)
    .normalize("NFC")
    .replace(/\s+/g, " ");
}

function computeRetentionFingerprint(input: { ownerUserId: string; olderThanDays: number; reason?: string }): string {
  const canonicalPayload = canonicalize({
    ownerUserId: input.ownerUserId,
    mode: "execution",
    olderThanDays: normalizeOlderThanDays(input.olderThanDays),
    reasonFingerprintNormalized: normalizeReasonForFingerprint(input.reason),
    routeSemanticVersion: "v1",
  });

  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

function computeBackupChecksum(ownerUserId: string, snapshot: BackupSnapshotRecord["snapshot"]): string {
  const canonicalPayload = canonicalize({
    schemaVersion: BACKUP_V13_SCHEMA_VERSION,
    ownerScope: ownerUserId,
    snapshotJson: snapshot,
  });

  return createHash(BACKUP_CHECKSUM_ALGORITHM).update(canonicalPayload, "utf8").digest("hex");
}

function deriveAdvisoryLockKey(ownerUserId: string): string {
  const digest = createHash("sha256").update(`ops-retention:${ownerUserId}`, "utf8").digest();
  return digest.readBigInt64BE(0).toString();
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortJsonValue((value as Record<string, unknown>)[key]);
        return accumulator;
      }, {});
  }

  return value;
}

async function tryAcquireAdvisoryXactLock(tx: Prisma.TransactionClient, advisoryLockKey: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
    SELECT pg_try_advisory_xact_lock(CAST(${advisoryLockKey} AS bigint)) AS acquired
  `);

  return rows[0]?.acquired === true;
}

async function selectDbNow(client: Prisma.TransactionClient | typeof prisma): Promise<Date> {
  const rows = await client.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT NOW() AS now`);
  return rows[0]?.now ?? new Date();
}

async function countEligibleAuditEvents(
  client: Prisma.TransactionClient | typeof prisma,
  userId: string,
  startedAt: Date,
  olderThanDays: number,
): Promise<number> {
  return client.auditLog.count({
    where: buildEligibleAuditWhere(userId, startedAt, olderThanDays),
  });
}

async function countEligiblePushQueue(
  client: Prisma.TransactionClient | typeof prisma,
  userId: string,
  startedAt: Date,
  olderThanDays: number,
): Promise<number> {
  return client.opsPushQueueEntry.count({
    where: buildEligiblePushQueueWhere(userId, startedAt, olderThanDays),
  });
}

function buildEligiblePushQueueWhere(userId: string, startedAt: Date, olderThanDays: number): Prisma.OpsPushQueueEntryWhereInput {
  const threshold = new Date(startedAt.getTime() - normalizeOlderThanDays(olderThanDays) * 24 * 60 * 60 * 1000);

  return {
    ownerUserId: userId,
    createdAt: { lt: threshold },
  };
}

function buildEligibleAuditWhere(
  userId: string,
  startedAt: Date,
  olderThanDays: number,
  protections?: {
    protectedResourceIds?: string[];
    protectedAuditLogIds?: string[];
  },
): Prisma.AuditLogWhereInput {
  const threshold = new Date(startedAt.getTime() - normalizeOlderThanDays(olderThanDays) * 24 * 60 * 60 * 1000);
  const protectedResourceIds = protections?.protectedResourceIds?.filter(Boolean) ?? [];
  const protectedAuditLogIds = protections?.protectedAuditLogIds?.filter(Boolean) ?? [];
  const resourceProtection = protectedResourceIds.length > 0
    ? {
      OR: [
        { resourceId: null },
        { resourceId: { notIn: protectedResourceIds } },
      ],
    }
    : {};

  const eventProtection = protectedAuditLogIds.length > 0 ? { id: { notIn: protectedAuditLogIds } } : {};

  return {
    actorUserId: userId,
    createdAt: { lt: threshold },
    ...resourceProtection,
    ...eventProtection,
  };
}

async function findRetentionReplay(input: {
  ownerUserId: string;
  executionIdempotencyKey: string;
  fingerprint: string;
}): Promise<OpsMutationResult | null> {
  const existing = await prisma.opsRetentionRun.findUnique({
    where: {
      ownerUserId_executionIdempotencyKey: {
        ownerUserId: input.ownerUserId,
        executionIdempotencyKey: input.executionIdempotencyKey,
      },
    },
  });

  if (!existing) {
    return null;
  }

  if (existing.idempotencyFingerprint !== input.fingerprint) {
    return {
      httpStatus: 409,
      body: {
        error: "IDEMPOTENCY_CONFLICT",
        message: "The idempotency key was already used with a different payload.",
      },
    };
  }

  return asReplayResult(existing);
}

function asReplayResult(row: {
  id: string;
  status: string;
  mode: string;
  olderThanDays: number;
  pushQueueAffected: number;
  auditEventsAffected: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorCode: string | null;
  errorMessageSafe: string | null;
}, requestId?: string): OpsMutationResult {
  const result = toRetentionResult(row, true);
  if (row.status === "execution_failed") {
    return {
      httpStatus: 409,
      body: {
        result,
        error: "EXECUTION_FAILED",
        message: row.errorMessageSafe ?? "Retention execution previously failed.",
        requestId,
      },
    };
  }

  return {
    httpStatus: 200,
    body: { result },
  };
}

function toRetentionResult(row: {
  id: string;
  status: string;
  mode: string;
  olderThanDays: number;
  pushQueueAffected: number;
  auditEventsAffected: number;
  startedAt: Date;
  finishedAt: Date | null;
}, replayed: boolean): RetentionRunResult {
  return {
    runId: row.id,
    status: row.status as RetentionRunResult["status"],
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    replayed,
    dryRun: row.mode === "dry_run",
    olderThanDays: row.olderThanDays,
    pushQueueAffected: row.pushQueueAffected,
    auditEventsAffected: row.auditEventsAffected,
  };
}

async function persistFailureTrace(input: {
  userId: string;
  olderThanDays: number;
  advisoryLockKey: string;
  executionIdempotencyKey: string | null;
  idempotencyFingerprint: string | null;
  reasonAuditSafe: string | null;
  errorCode: string;
  errorMessageSafe: string;
  correlationRequestId: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  const startedAt = new Date();
  const finishedAt = new Date();
  const failureTraceId = randomUUID();

  try {
    await prisma.opsRetentionRun.create({
      data: {
        id: failureTraceId,
        ownerUserId: input.userId,
        mode: "execution",
        status: "execution_failed",
        olderThanDays: input.olderThanDays,
        reasonAuditSafe: input.reasonAuditSafe,
        executionIdempotencyKey: input.executionIdempotencyKey,
        idempotencyFingerprint: input.idempotencyFingerprint,
        advisoryLockKey: input.advisoryLockKey,
        startedAt,
        finishedAt,
        pushQueueAffected: 0,
        auditEventsAffected: 0,
        errorCode: input.errorCode,
        errorMessageSafe: input.errorMessageSafe,
      },
    });
  } catch {
    // Best-effort failure trace only.
  }

  await logOpsAuditEvent({
    actorUserId: input.userId,
    action: "ops.retention.execution.failed",
    status: "failure",
    correlationRequestId: input.correlationRequestId,
    resourceId: failureTraceId,
    metadata: {
      olderThanDays: input.olderThanDays,
      errorCode: input.errorCode,
    },
  });
}

async function logOpsAuditEvent(input: {
  actorUserId: string;
  action: string;
  status: "success" | "failure";
  correlationRequestId: string;
  resourceId?: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await prisma.auditLog.create({
      data: buildAuditLogCreateInput(input),
    });
  } catch (error) {
    console.error("[OPS_AUDIT_ERROR]", error instanceof Error ? error.message : String(error));
  }
}

function buildAuditLogCreateInput(input: {
  actorUserId: string;
  action: string;
  status: "success" | "failure";
  correlationRequestId: string;
  resourceId?: string;
  metadata: Record<string, unknown>;
}): Prisma.AuditLogCreateInput {
  return {
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: OPS_RESOURCE_TYPE,
    resourceId: input.resourceId ?? null,
    status: input.status,
    metadata: {
      ...input.metadata,
      correlationRequestId: input.correlationRequestId,
    },
  };
}

function getSafeErrorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }

  if (error instanceof Error && error.name) {
    return error.name.slice(0, 80);
  }

  return "RETENTION_EXECUTION_FAILED";
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return "Retention execution failed.";
}