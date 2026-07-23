import { createHash } from "crypto";

import { Prisma } from "@prisma/client";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import { deriveBackupRestoreGovernanceAdvisoryLockKey } from "@/lib/backup-v13-restore-run-maintenance";
import type {
  BackupRestoreRunRetentionDryRunRequest,
  BackupRestoreRunRetentionDryRunResponse,
  BackupRestoreRunRetentionExecutionRequest,
  BackupRestoreRunRetentionExecutionResponse,
  BackupRestoreRunRetentionResponse,
  BackupRestoreRunRetentionSummary,
} from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { writeOpsAuditEvent } from "@/lib/ops-persistence";

const POLICY_VERSION = "m13f-v1" as const;
const RETENTION_FINGERPRINT_VERSION = "m13f-v1" as const;
const IDEMPOTENCY_FINGERPRINT_VERSION = "m13f-v1" as const;
const MAX_TOTAL_DELETIONS_PER_EXECUTION = 500;
const SAMPLE_LIMIT = 50;
const MAX_DRY_RUN_AGE_MS = 30 * 60 * 1000;
const EVALUATION_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FINGERPRINT_REGEX = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]{1,190}$/;

const COMPLETED_RESTORE_RETENTION_DAYS = 120;
const FAILED_RESTORE_RETENTION_DAYS = 365;
const COMPLETED_MAINTENANCE_RETENTION_DAYS = 180;
const FAILED_MAINTENANCE_RETENTION_DAYS = 365;

const FINAL_ERROR_CODE_LOCK_CONFLICT = "BACKUP_RESTORE_RETENTION_LOCK_CONFLICT";
const FINAL_ERROR_CODE_FINGERPRINT_MISMATCH = "BACKUP_RESTORE_RETENTION_FINGERPRINT_MISMATCH";
const FINAL_ERROR_CODE_IDEMPOTENCY_RUNNING = "BACKUP_RESTORE_RETENTION_IDEMPOTENCY_RUNNING";
const FINAL_ERROR_CODE_IDEMPOTENCY_FAILED_REPLAY = "BACKUP_RESTORE_RETENTION_IDEMPOTENCY_FAILED_REPLAY";
const FINAL_ERROR_CODE_IDEMPOTENCY_KEY_MISMATCH = "BACKUP_RESTORE_RETENTION_IDEMPOTENCY_KEY_MISMATCH";
const FINAL_ERROR_CODE_DOMAIN_CONFLICT = "BACKUP_RESTORE_RETENTION_DOMAIN_CONFLICT";
const FINAL_ERROR_CODE_TRANSACTION_FAILED = "BACKUP_RESTORE_RETENTION_TRANSACTION_FAILED";

type RetentionRunRow = {
  id: string;
  ownerUserId: string;
  actorUserId: string;
  status: "running" | "completed" | "failed";
  policyVersion: string;
  batchLimit: number;
  evaluationTime: Date;
  retentionFingerprint: string;
  executionIdempotencyKey: string;
  idempotencyFingerprint: string;
  advisoryLockKey: string;
  candidateRestoreRunCount: number;
  candidateMaintenanceRunCount: number;
  deletedRestoreRunCount: number;
  deletedMaintenanceRunCount: number;
  finalErrorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

type RetentionRunDelegate = {
  findUnique(args: {
    where: {
      ownerUserId_executionIdempotencyKey: {
        ownerUserId: string;
        executionIdempotencyKey: string;
      };
    };
  }): Promise<RetentionRunRow | null>;
  create(args: {
    data: Record<string, unknown>;
    select: { id: true };
  }): Promise<{ id: string }>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<unknown>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
};

type DbClient = typeof prisma | Prisma.TransactionClient;

type CandidatePlan = {
  summary: BackupRestoreRunRetentionSummary;
  retentionFingerprint: string;
  candidateRestoreRunIds: string[];
  candidateMaintenanceRunIds: string[];
};

type RunBackupRestoreRunRetentionInput = {
  ownerUserId: string;
  actorUserId: string;
  correlationRequestId: string;
  request: BackupRestoreRunRetentionDryRunRequest | BackupRestoreRunRetentionExecutionRequest;
};

export async function runBackupRestoreRunRetention(
  input: RunBackupRestoreRunRetentionInput,
): Promise<BackupRestoreRunRetentionResponse> {
  if (!isDatabaseConfigured()) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_UNAVAILABLE",
      500,
      "Restore run retention requires a configured database.",
    );
  }

  validatePolicyVersion(input.request.policyVersion);
  const batchLimit = parseBatchLimit(input.request.batchLimit);

  if (input.request.mode === "dry_run") {
    const evaluationTime = new Date();
    const plan = await buildCandidatePlan(prisma, input.ownerUserId, evaluationTime, batchLimit);
    return {
      mode: "dry_run",
      policyVersion: POLICY_VERSION,
      batchLimit,
      evaluationTime: evaluationTime.toISOString(),
      retentionFingerprint: plan.retentionFingerprint,
      summary: plan.summary,
    };
  }

  const executionRequest = input.request;
  validateRetentionFingerprint(executionRequest.retentionFingerprint);
  validateExecutionIdempotencyKey(executionRequest.executionIdempotencyKey);
  validateAcknowledgeDeletion(executionRequest.acknowledgeDeletion);
  const evaluationTime = parseExecutionEvaluationTime(executionRequest.evaluationTime);
  const advisoryLockKey = deriveBackupRestoreGovernanceAdvisoryLockKey(input.ownerUserId);
  const idempotencyFingerprint = computeIdempotencyFingerprint({
    ownerUserId: input.ownerUserId,
    evaluationTime: executionRequest.evaluationTime,
    policyVersion: POLICY_VERSION,
    batchLimit,
    retentionFingerprint: executionRequest.retentionFingerprint,
    acknowledgeDeletion: true,
  });

  const existingReplay = await findExistingReplay({
    ownerUserId: input.ownerUserId,
    executionIdempotencyKey: executionRequest.executionIdempotencyKey,
    idempotencyFingerprint,
  });
  if (existingReplay) {
    return existingReplay;
  }

  let retentionRunId: string;
  try {
    retentionRunId = await createRunningRetentionRun({
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      policyVersion: POLICY_VERSION,
      batchLimit,
      evaluationTime,
      retentionFingerprint: executionRequest.retentionFingerprint,
      executionIdempotencyKey: executionRequest.executionIdempotencyKey,
      idempotencyFingerprint,
      advisoryLockKey,
    });
  } catch (error) {
    if (error instanceof ReplayResultError) {
      return error.response;
    }

    throw error;
  }

  try {
    const execution = await prisma.$transaction(
      async (tx) => {
        const acquired = await tryAcquireAdvisoryXactLock(tx, advisoryLockKey);
        if (!acquired) {
          throw new BackupArtifactError(
            FINAL_ERROR_CODE_LOCK_CONFLICT,
            409,
            "A restore governance operation is already running for this owner.",
          );
        }

        const plan = await buildCandidatePlan(tx, input.ownerUserId, evaluationTime, batchLimit);
        if (plan.retentionFingerprint !== executionRequest.retentionFingerprint) {
          throw new BackupArtifactError(
            FINAL_ERROR_CODE_FINGERPRINT_MISMATCH,
            409,
            "The retention fingerprint no longer matches the eligible candidate set.",
          );
        }

        const deletedMaintenanceRuns = await deleteMaintenanceRunsExact(tx, {
          ownerUserId: input.ownerUserId,
          candidateIds: plan.candidateMaintenanceRunIds,
          evaluationTime,
        });

        const deletedRestoreRuns = await deleteRestoreRunsExact(tx, {
          ownerUserId: input.ownerUserId,
          candidateIds: plan.candidateRestoreRunIds,
          evaluationTime,
        });

        const finishedAt = await selectDbNow(tx);
        const completedUpdate = await getRetentionRunDelegate(tx).updateMany({
          where: {
            id: retentionRunId,
            ownerUserId: input.ownerUserId,
            status: "running",
          },
          data: {
            status: "completed",
            candidateRestoreRunCount: plan.summary.restoreRunCandidatesCount,
            candidateMaintenanceRunCount: plan.summary.maintenanceRunCandidatesCount,
            deletedRestoreRunCount: deletedRestoreRuns,
            deletedMaintenanceRunCount: deletedMaintenanceRuns,
            finalErrorCode: null,
            finishedAt,
          },
        });

        if (completedUpdate.count !== 1) {
          throw new BackupArtifactError(
            FINAL_ERROR_CODE_TRANSACTION_FAILED,
            500,
            "Retention ledger completion update failed consistency guard.",
          );
        }

        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            action: "ops.backup.restore_retention.execution.completed",
            resourceType: "ops",
            resourceId: retentionRunId,
            status: "success",
            metadata: {
              retentionRunId,
              policyVersion: POLICY_VERSION,
              restoreRunCandidateCount: plan.summary.restoreRunCandidatesCount,
              maintenanceRunCandidateCount: plan.summary.maintenanceRunCandidatesCount,
              restoreRunsDeleted: deletedRestoreRuns,
              maintenanceRunsDeleted: deletedMaintenanceRuns,
              evaluationTime: evaluationTime.toISOString(),
              batchLimit,
              correlationRequestId: input.correlationRequestId,
            },
          },
        });

        return {
          finishedAt,
          retentionFingerprint: plan.retentionFingerprint,
          summary: plan.summary,
          deletedCounts: {
            restoreRunsDeleted: deletedRestoreRuns,
            maintenanceRunsDeleted: deletedMaintenanceRuns,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      mode: "execution",
      runId: retentionRunId,
      status: "completed",
      replayed: false,
      policyVersion: POLICY_VERSION,
      batchLimit,
      evaluationTime: executionRequest.evaluationTime,
      retentionFingerprint: execution.retentionFingerprint,
      summary: execution.summary,
      deletedCounts: execution.deletedCounts,
    };
  } catch (error) {
    const finalErrorCode = deriveFinalErrorCode(error);
    await markRetentionRunFailed({
      runId: retentionRunId,
      ownerUserId: input.ownerUserId,
      finalErrorCode,
    });
    await writeFailureAuditBestEffort({
      actorUserId: input.actorUserId,
      correlationRequestId: input.correlationRequestId,
      retentionRunId,
      policyVersion: POLICY_VERSION,
      evaluationTime: executionRequest.evaluationTime,
      batchLimit,
      finalErrorCode,
    });

    if (error instanceof BackupArtifactError) {
      if (
        error.httpStatus >= 400 &&
        error.httpStatus < 500 &&
        error.code !== FINAL_ERROR_CODE_LOCK_CONFLICT &&
        error.code !== FINAL_ERROR_CODE_FINGERPRINT_MISMATCH &&
        error.code !== FINAL_ERROR_CODE_IDEMPOTENCY_RUNNING &&
        error.code !== FINAL_ERROR_CODE_IDEMPOTENCY_FAILED_REPLAY &&
        error.code !== FINAL_ERROR_CODE_IDEMPOTENCY_KEY_MISMATCH
      ) {
        throw new BackupArtifactError(
          FINAL_ERROR_CODE_DOMAIN_CONFLICT,
          409,
          "Restore governance retention encountered a domain conflict.",
        );
      }

      throw error;
    }

    throw new BackupArtifactError(
      FINAL_ERROR_CODE_TRANSACTION_FAILED,
      500,
      "Restore governance retention transaction failed.",
    );
  }
}

async function buildCandidatePlan(
  client: DbClient,
  ownerUserId: string,
  evaluationTime: Date,
  batchLimit: number,
): Promise<CandidatePlan> {
  const restoreWhere = buildRestoreEligibilityWhere(ownerUserId, evaluationTime);
  const maintenanceWhere = buildMaintenanceEligibilityWhere(ownerUserId, evaluationTime);

  const totalEligibleRestoreRuns = await client.opsBackupRestoreRun.count({ where: restoreWhere });
  const restoreRows = await client.opsBackupRestoreRun.findMany({
    where: restoreWhere,
    orderBy: [{ finishedAt: "asc" }, { id: "asc" }],
    take: batchLimit,
    select: { id: true },
  });

  const remaining = Math.max(0, batchLimit - restoreRows.length);
  const totalEligibleMaintenanceRuns = await getMaintenanceRunDelegate(client).count({ where: maintenanceWhere });
  const maintenanceRows = remaining > 0
    ? await getMaintenanceRunDelegate(client).findMany({
      where: maintenanceWhere,
      orderBy: [{ finishedAt: "asc" }, { id: "asc" }],
      take: remaining,
      select: { id: true },
    })
    : [];

  const candidateRestoreRunIds = restoreRows.map((row) => row.id).sort((left, right) => left.localeCompare(right));
  const candidateMaintenanceRunIds = maintenanceRows.map((row) => row.id).sort((left, right) => left.localeCompare(right));

  const retentionFingerprint = computeRetentionFingerprint({
    ownerUserId,
    evaluationTime: evaluationTime.toISOString(),
    policyVersion: POLICY_VERSION,
    batchLimit,
    candidateRestoreRunIds,
    candidateMaintenanceRunIds,
  });

  return {
    retentionFingerprint,
    candidateRestoreRunIds,
    candidateMaintenanceRunIds,
    summary: {
      restoreRunCandidatesCount: candidateRestoreRunIds.length,
      maintenanceRunCandidatesCount: candidateMaintenanceRunIds.length,
      totalCandidatesCount: candidateRestoreRunIds.length + candidateMaintenanceRunIds.length,
      eligibleBeyondBatchRestoreRunCount: Math.max(0, totalEligibleRestoreRuns - candidateRestoreRunIds.length),
      eligibleBeyondBatchMaintenanceRunCount: Math.max(0, totalEligibleMaintenanceRuns - candidateMaintenanceRunIds.length),
      restoreRunIdsSample: candidateRestoreRunIds.slice(0, SAMPLE_LIMIT),
      maintenanceRunIdsSample: candidateMaintenanceRunIds.slice(0, SAMPLE_LIMIT),
    },
  };
}

function buildRestoreEligibilityWhere(ownerUserId: string, evaluationTime: Date): Prisma.OpsBackupRestoreRunWhereInput {
  const completedCutoff = computeCutoff(evaluationTime, COMPLETED_RESTORE_RETENTION_DAYS);
  const failedCutoff = computeCutoff(evaluationTime, FAILED_RESTORE_RETENTION_DAYS);
  return {
    ownerUserId,
    finishedAt: { not: null },
    OR: [
      { status: "completed", finishedAt: { lte: completedCutoff } },
      { status: "failed", finishedAt: { lte: failedCutoff } },
    ],
  };
}

function buildMaintenanceEligibilityWhere(ownerUserId: string, evaluationTime: Date): Record<string, unknown> {
  const completedCutoff = computeCutoff(evaluationTime, COMPLETED_MAINTENANCE_RETENTION_DAYS);
  const failedCutoff = computeCutoff(evaluationTime, FAILED_MAINTENANCE_RETENTION_DAYS);
  return {
    ownerUserId,
    finishedAt: { not: null },
    OR: [
      { status: "completed", finishedAt: { lte: completedCutoff } },
      { status: "failed", finishedAt: { lte: failedCutoff } },
    ],
  };
}

async function deleteRestoreRunsExact(
  tx: Prisma.TransactionClient,
  input: {
    ownerUserId: string;
    candidateIds: string[];
    evaluationTime: Date;
  },
): Promise<number> {
  if (input.candidateIds.length === 0) {
    return 0;
  }

  const result = await tx.opsBackupRestoreRun.deleteMany({
    where: {
      ownerUserId: input.ownerUserId,
      id: { in: input.candidateIds },
      finishedAt: { not: null },
      OR: [
        { status: "completed", finishedAt: { lte: computeCutoff(input.evaluationTime, COMPLETED_RESTORE_RETENTION_DAYS) } },
        { status: "failed", finishedAt: { lte: computeCutoff(input.evaluationTime, FAILED_RESTORE_RETENTION_DAYS) } },
      ],
    },
  });

  if (result.count !== input.candidateIds.length) {
    throw new BackupArtifactError(
      FINAL_ERROR_CODE_TRANSACTION_FAILED,
      500,
      "Restore run retention delete count mismatch.",
    );
  }

  return result.count;
}

async function deleteMaintenanceRunsExact(
  tx: Prisma.TransactionClient,
  input: {
    ownerUserId: string;
    candidateIds: string[];
    evaluationTime: Date;
  },
): Promise<number> {
  if (input.candidateIds.length === 0) {
    return 0;
  }

  const result = await getMaintenanceRunDelegate(tx).deleteMany({
    where: {
      ownerUserId: input.ownerUserId,
      id: { in: input.candidateIds },
      finishedAt: { not: null },
      OR: [
        { status: "completed", finishedAt: { lte: computeCutoff(input.evaluationTime, COMPLETED_MAINTENANCE_RETENTION_DAYS) } },
        { status: "failed", finishedAt: { lte: computeCutoff(input.evaluationTime, FAILED_MAINTENANCE_RETENTION_DAYS) } },
      ],
    },
  });

  if (result.count !== input.candidateIds.length) {
    throw new BackupArtifactError(
      FINAL_ERROR_CODE_TRANSACTION_FAILED,
      500,
      "Maintenance run retention delete count mismatch.",
    );
  }

  return result.count;
}

async function findExistingReplay(input: {
  ownerUserId: string;
  executionIdempotencyKey: string;
  idempotencyFingerprint: string;
}): Promise<BackupRestoreRunRetentionExecutionResponse | null> {
  const row = await getRetentionRunDelegate().findUnique({
    where: {
      ownerUserId_executionIdempotencyKey: {
        ownerUserId: input.ownerUserId,
        executionIdempotencyKey: input.executionIdempotencyKey,
      },
    },
  });

  if (!row) {
    return null;
  }

  return asReplayResult(row, input.idempotencyFingerprint);
}

async function createRunningRetentionRun(input: {
  ownerUserId: string;
  actorUserId: string;
  policyVersion: string;
  batchLimit: number;
  evaluationTime: Date;
  retentionFingerprint: string;
  executionIdempotencyKey: string;
  idempotencyFingerprint: string;
  advisoryLockKey: string;
}): Promise<string> {
  try {
    const row = await getRetentionRunDelegate().create({
      data: {
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        status: "running",
        policyVersion: input.policyVersion,
        batchLimit: input.batchLimit,
        evaluationTime: input.evaluationTime,
        retentionFingerprint: input.retentionFingerprint,
        executionIdempotencyKey: input.executionIdempotencyKey,
        idempotencyFingerprint: input.idempotencyFingerprint,
        advisoryLockKey: input.advisoryLockKey,
        candidateRestoreRunCount: 0,
        candidateMaintenanceRunCount: 0,
        deletedRestoreRunCount: 0,
        deletedMaintenanceRunCount: 0,
        finalErrorCode: null,
        startedAt: new Date(),
        finishedAt: null,
      },
      select: { id: true },
    });

    return row.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await findExistingReplay({
        ownerUserId: input.ownerUserId,
        executionIdempotencyKey: input.executionIdempotencyKey,
        idempotencyFingerprint: input.idempotencyFingerprint,
      });
      if (replay) {
        throw new ReplayResultError(replay);
      }
    }

    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_UNAVAILABLE",
      500,
      "Restore run retention persistence is unavailable.",
    );
  }
}

async function markRetentionRunFailed(input: {
  runId: string;
  ownerUserId: string;
  finalErrorCode: string;
}): Promise<void> {
  try {
    await getRetentionRunDelegate().updateMany({
      where: {
        id: input.runId,
        ownerUserId: input.ownerUserId,
      },
      data: {
        status: "failed",
        finalErrorCode: input.finalErrorCode,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[BACKUP_RESTORE_RETENTION_FAILED_WRITE_FAILED]", safeLogMessage(error));
  }
}

async function writeFailureAuditBestEffort(input: {
  actorUserId: string;
  correlationRequestId: string;
  retentionRunId: string;
  policyVersion: string;
  evaluationTime: string;
  batchLimit: number;
  finalErrorCode: string;
}): Promise<void> {
  try {
    await writeOpsAuditEvent({
      actorUserId: input.actorUserId,
      action: "ops.backup.restore_retention.execution.failed",
      status: "failure",
      correlationRequestId: input.correlationRequestId,
      resourceId: input.retentionRunId,
      metadata: {
        retentionRunId: input.retentionRunId,
        policyVersion: input.policyVersion,
        evaluationTime: input.evaluationTime,
        batchLimit: input.batchLimit,
        finalErrorCode: input.finalErrorCode,
      },
    });
  } catch {
    // best-effort failure trace only
  }
}

function asReplayResult(
  row: RetentionRunRow,
  idempotencyFingerprint: string,
): BackupRestoreRunRetentionExecutionResponse {
  if (row.idempotencyFingerprint !== idempotencyFingerprint) {
    throw new BackupArtifactError(
      FINAL_ERROR_CODE_IDEMPOTENCY_KEY_MISMATCH,
      409,
      "The idempotency key was already used with a different retention payload.",
      { replayed: false, runId: row.id },
    );
  }

  if (row.status === "completed") {
    return {
      mode: "execution",
      runId: row.id,
      status: "completed",
      replayed: true,
      policyVersion: POLICY_VERSION,
      batchLimit: row.batchLimit,
      evaluationTime: row.evaluationTime.toISOString(),
      retentionFingerprint: row.retentionFingerprint,
      summary: {
        restoreRunCandidatesCount: row.candidateRestoreRunCount,
        maintenanceRunCandidatesCount: row.candidateMaintenanceRunCount,
        totalCandidatesCount: row.candidateRestoreRunCount + row.candidateMaintenanceRunCount,
        eligibleBeyondBatchRestoreRunCount: 0,
        eligibleBeyondBatchMaintenanceRunCount: 0,
        restoreRunIdsSample: [],
        maintenanceRunIdsSample: [],
      },
      deletedCounts: {
        restoreRunsDeleted: row.deletedRestoreRunCount,
        maintenanceRunsDeleted: row.deletedMaintenanceRunCount,
      },
    };
  }

  if (row.status === "running") {
    throw new BackupArtifactError(
      FINAL_ERROR_CODE_IDEMPOTENCY_RUNNING,
      409,
      "The idempotent retention execution is still running.",
      { replayed: false, runId: row.id },
    );
  }

  throw new BackupArtifactError(
    FINAL_ERROR_CODE_IDEMPOTENCY_FAILED_REPLAY,
    409,
    "The idempotent retention execution previously failed.",
    { replayed: true, runId: row.id, finalErrorCode: row.finalErrorCode },
  );
}

function validatePolicyVersion(input: string): void {
  if (input !== POLICY_VERSION) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_POLICY_VERSION_INVALID",
      400,
      `policyVersion must be ${POLICY_VERSION}.`,
    );
  }
}

function parseBatchLimit(input: number): number {
  if (!Number.isInteger(input) || input < 1 || input > MAX_TOTAL_DELETIONS_PER_EXECUTION) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_BATCH_LIMIT_INVALID",
      400,
      `batchLimit must be an integer between 1 and ${MAX_TOTAL_DELETIONS_PER_EXECUTION}.`,
    );
  }

  return input;
}

function parseExecutionEvaluationTime(input: string): Date {
  if (!EVALUATION_TIME_REGEX.test(input)) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_EVALUATION_TIME_INVALID",
      400,
      "evaluationTime must be a UTC ISO-8601 timestamp with millisecond precision.",
    );
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== input) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_EVALUATION_TIME_INVALID",
      400,
      "evaluationTime must be a valid UTC ISO-8601 timestamp with millisecond precision.",
    );
  }

  const now = Date.now();
  if (date.getTime() > now) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_EVALUATION_TIME_INVALID",
      400,
      "evaluationTime cannot be in the future.",
    );
  }

  if (now - date.getTime() > MAX_DRY_RUN_AGE_MS) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_EVALUATION_TIME_EXPIRED",
      400,
      "evaluationTime is older than the maximum dry-run validity window.",
    );
  }

  return date;
}

function validateRetentionFingerprint(input: string): void {
  if (!FINGERPRINT_REGEX.test(input)) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_FINGERPRINT_INVALID",
      400,
      "retentionFingerprint must be 64 lowercase hexadecimal characters.",
    );
  }
}

function validateExecutionIdempotencyKey(input: string): void {
  if (!IDEMPOTENCY_KEY_REGEX.test(input)) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_IDEMPOTENCY_KEY_INVALID",
      400,
      "executionIdempotencyKey is invalid.",
    );
  }
}

function validateAcknowledgeDeletion(input: true): void {
  if (input !== true) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_RETENTION_ACKNOWLEDGEMENT_REQUIRED",
      400,
      "acknowledgeDeletion must be true.",
    );
  }
}

function computeCutoff(evaluationTime: Date, retentionDays: number): Date {
  return new Date(evaluationTime.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

function computeRetentionFingerprint(input: {
  ownerUserId: string;
  evaluationTime: string;
  policyVersion: string;
  batchLimit: number;
  candidateRestoreRunIds: string[];
  candidateMaintenanceRunIds: string[];
}): string {
  const payload = JSON.stringify({
    version: RETENTION_FINGERPRINT_VERSION,
    ownerUserId: input.ownerUserId,
    evaluationTime: input.evaluationTime,
    policyVersion: input.policyVersion,
    batchLimit: input.batchLimit,
    candidateRestoreRunIds: input.candidateRestoreRunIds,
    candidateMaintenanceRunIds: input.candidateMaintenanceRunIds,
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function computeIdempotencyFingerprint(input: {
  ownerUserId: string;
  evaluationTime: string;
  policyVersion: string;
  batchLimit: number;
  retentionFingerprint: string;
  acknowledgeDeletion: true;
}): string {
  const payload = JSON.stringify({
    version: IDEMPOTENCY_FINGERPRINT_VERSION,
    ownerUserId: input.ownerUserId,
    evaluationTime: input.evaluationTime,
    policyVersion: input.policyVersion,
    batchLimit: input.batchLimit,
    retentionFingerprint: input.retentionFingerprint,
    acknowledgeDeletion: input.acknowledgeDeletion,
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

async function tryAcquireAdvisoryXactLock(tx: Prisma.TransactionClient, advisoryLockKey: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
    SELECT pg_try_advisory_xact_lock(CAST(${advisoryLockKey} AS bigint)) AS acquired
  `);

  return rows[0]?.acquired === true;
}

async function selectDbNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT NOW() AS now`);
  return rows[0]?.now ?? new Date();
}

function deriveFinalErrorCode(error: unknown): string {
  if (error instanceof BackupArtifactError) {
    if (
      error.code === FINAL_ERROR_CODE_LOCK_CONFLICT ||
      error.code === FINAL_ERROR_CODE_FINGERPRINT_MISMATCH ||
      error.code === FINAL_ERROR_CODE_IDEMPOTENCY_RUNNING ||
      error.code === FINAL_ERROR_CODE_IDEMPOTENCY_FAILED_REPLAY ||
      error.code === FINAL_ERROR_CODE_IDEMPOTENCY_KEY_MISMATCH
    ) {
      return error.code;
    }

    if (error.httpStatus >= 400 && error.httpStatus < 500) {
      return FINAL_ERROR_CODE_DOMAIN_CONFLICT;
    }
  }

  return FINAL_ERROR_CODE_TRANSACTION_FAILED;
}

function safeLogMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getRetentionRunDelegate(client: DbClient = prisma): RetentionRunDelegate {
  return (client as unknown as { opsBackupRestoreRetentionRun: RetentionRunDelegate }).opsBackupRestoreRetentionRun;
}

type MaintenanceRunClient = {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: Array<{ finishedAt: "asc" | "desc" } | { id: "asc" | "desc" }>;
    take: number;
    select: { id: true };
  }): Promise<Array<{ id: string }>>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
};

function getMaintenanceRunDelegate(client: DbClient = prisma): MaintenanceRunClient {
  return (client as unknown as { opsBackupRestoreMaintenanceRun: MaintenanceRunClient }).opsBackupRestoreMaintenanceRun;
}

class ReplayResultError extends Error {
  response: BackupRestoreRunRetentionExecutionResponse;

  constructor(response: BackupRestoreRunRetentionExecutionResponse) {
    super("Replay result");
    this.response = response;
  }
}

export const __testUtils = {
  POLICY_VERSION,
  MAX_TOTAL_DELETIONS_PER_EXECUTION,
  COMPLETED_RESTORE_RETENTION_DAYS,
  FAILED_RESTORE_RETENTION_DAYS,
  COMPLETED_MAINTENANCE_RETENTION_DAYS,
  FAILED_MAINTENANCE_RETENTION_DAYS,
  computeRetentionFingerprint,
  computeIdempotencyFingerprint,
  deriveAdvisoryLockKey: deriveBackupRestoreGovernanceAdvisoryLockKey,
};
