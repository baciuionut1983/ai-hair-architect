import { createHash } from "crypto";

import { Prisma } from "@prisma/client";

import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import type {
  BackupRestoreRunMaintenanceDryRunRequest,
  BackupRestoreRunMaintenanceDryRunResponse,
  BackupRestoreRunMaintenanceExecutionRequest,
  BackupRestoreRunMaintenanceExecutionResponse,
  BackupRestoreRunMaintenanceResponse,
  BackupRestoreRunMaintenanceSummary,
} from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { writeOpsAuditEvent } from "@/lib/ops-persistence";

const EVALUATION_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FINGERPRINT_REGEX = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]{1,190}$/;
const MAX_RECONCILIATION_BATCH = 500;
const MAX_DRY_RUN_AGE_MS = 30 * 60 * 1000;
const MIN_STALE_THRESHOLD_MINUTES = 1;
const MAX_STALE_THRESHOLD_MINUTES = 24 * 60;
const MAINTENANCE_FINGERPRINT_VERSION = "m13e-v1" as const;
const GOVERNANCE_LOCK_NAMESPACE = "ops-backup-restore-governance";

const FINAL_ERROR_CODE_STALE_INDETERMINATE = "BACKUP_RESTORE_RUN_STALE_INDETERMINATE";
const FINAL_ERROR_CODE_LOCK_CONFLICT = "BACKUP_RESTORE_MAINTENANCE_LOCK_CONFLICT";
const FINAL_ERROR_CODE_FINGERPRINT_MISMATCH = "BACKUP_RESTORE_MAINTENANCE_FINGERPRINT_MISMATCH";
const FINAL_ERROR_CODE_TRANSACTION_FAILED = "BACKUP_RESTORE_MAINTENANCE_TRANSACTION_FAILED";
const FINAL_ERROR_CODE_DOMAIN_CONFLICT = "BACKUP_RESTORE_MAINTENANCE_DOMAIN_CONFLICT";

type RestoreRunCandidate = {
  id: string;
  startedAt: Date;
};

type MaintenanceRunRow = {
  id: string;
  ownerUserId: string;
  status: "running" | "completed" | "failed";
  staleThresholdMinutes: number;
  evaluationTime: Date;
  maintenanceFingerprint: string;
  executionIdempotencyKey: string;
  idempotencyFingerprint: string;
  advisoryLockKey: string;
  candidatesScanned: number;
  candidatesReconciledIndeterminate: number;
  finalErrorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

type MaintenanceRunDelegate = {
  findUnique(args: {
    where: {
      ownerUserId_executionIdempotencyKey: {
        ownerUserId: string;
        executionIdempotencyKey: string;
      };
    };
  }): Promise<MaintenanceRunRow | null>;
  create(args: {
    data: Record<string, unknown>;
    select: { id: true };
  }): Promise<{ id: string }>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<unknown>;
};

type RunBackupRestoreRunMaintenanceInput = {
  ownerUserId: string;
  actorUserId: string;
  correlationRequestId: string;
  request: BackupRestoreRunMaintenanceDryRunRequest | BackupRestoreRunMaintenanceExecutionRequest;
};

type CandidatePlan = {
  summary: BackupRestoreRunMaintenanceSummary;
  maintenanceFingerprint: string;
  candidateIds: string[];
};

function getMaintenanceRunDelegate(client: DbClient = prisma): MaintenanceRunDelegate {
  return (client as unknown as { opsBackupRestoreMaintenanceRun: MaintenanceRunDelegate }).opsBackupRestoreMaintenanceRun;
}

export async function runBackupRestoreRunMaintenance(
  input: RunBackupRestoreRunMaintenanceInput,
): Promise<BackupRestoreRunMaintenanceResponse> {
  if (!isDatabaseConfigured()) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_UNAVAILABLE",
      500,
      "Restore run maintenance requires a configured database.",
    );
  }

  const staleThresholdMinutes = parseStaleThresholdMinutes(input.request.staleThresholdMinutes);

  if (input.request.mode === "dry_run") {
    const evaluationTime = new Date();
    const plan = await buildCandidatePlan(prisma, input.ownerUserId, evaluationTime, staleThresholdMinutes);

    return {
      mode: "dry_run",
      evaluationTime: evaluationTime.toISOString(),
      maintenanceFingerprint: plan.maintenanceFingerprint,
      summary: plan.summary,
    };
  }

  validateMaintenanceFingerprint(input.request.maintenanceFingerprint);
  validateAcknowledgeMutation(input.request.acknowledgeMutation);
  validateExecutionIdempotencyKey(input.request.executionIdempotencyKey);
  const evaluationTime = parseExecutionEvaluationTime(input.request.evaluationTime);
  const executionRequest = input.request;
  const idempotencyFingerprint = computeIdempotencyFingerprint({
    ownerUserId: input.ownerUserId,
    evaluationTime: executionRequest.evaluationTime,
    staleThresholdMinutes,
    maintenanceFingerprint: executionRequest.maintenanceFingerprint,
  });
  const advisoryLockKey = deriveAdvisoryLockKey(input.ownerUserId);

  const existingReplay = await findExistingReplay({
    ownerUserId: input.ownerUserId,
    executionIdempotencyKey: input.request.executionIdempotencyKey,
    idempotencyFingerprint,
  });
  if (existingReplay) {
    return existingReplay;
  }

  let runId: string;
  try {
    runId = await createRunningMaintenanceRun({
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      staleThresholdMinutes,
      evaluationTime,
      maintenanceFingerprint: executionRequest.maintenanceFingerprint,
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
            "A restore run maintenance execution is already running for this owner.",
          );
        }

        const plan = await buildCandidatePlan(tx, input.ownerUserId, evaluationTime, staleThresholdMinutes);
        if (plan.maintenanceFingerprint !== executionRequest.maintenanceFingerprint) {
          throw new BackupArtifactError(
            FINAL_ERROR_CODE_FINGERPRINT_MISMATCH,
            409,
            "The maintenance fingerprint no longer matches the eligible candidate set.",
          );
        }

        const finishedAt = await selectDbNow(tx);
        let reconciledCount = 0;

        if (plan.candidateIds.length > 0) {
          const result = await tx.opsBackupRestoreRun.updateMany({
            where: {
              ownerUserId: input.ownerUserId,
              status: "started",
              startedAt: { lte: computeStaleCutoff(evaluationTime, staleThresholdMinutes) },
              id: { in: plan.candidateIds },
            },
            data: {
              status: "indeterminate",
              finishedAt,
              finalErrorCode: FINAL_ERROR_CODE_STALE_INDETERMINATE,
            },
          });

          reconciledCount = result.count;
          if (reconciledCount !== plan.candidateIds.length) {
            throw new Error("BACKUP_RESTORE_MAINTENANCE_PARTIAL_RECONCILIATION");
          }
        }

        const metadata = {
          maintenanceRunId: runId,
          candidateCount: plan.summary.candidateCount,
          reconciledCount,
          evaluationTime: evaluationTime.toISOString(),
          staleThresholdMinutes,
        };

        await writeOpsAuditEvent(
          {
            actorUserId: input.actorUserId,
            action: "ops.backup.restore_run.reconciled_indeterminate",
            status: "success",
            correlationRequestId: input.correlationRequestId,
            resourceId: runId,
            metadata,
          },
          tx,
          { strict: true },
        );

        await writeOpsAuditEvent(
          {
            actorUserId: input.actorUserId,
            action: "ops.backup.restore_run_maintenance.completed",
            status: "success",
            correlationRequestId: input.correlationRequestId,
            resourceId: runId,
            metadata,
          },
          tx,
          { strict: true },
        );

        return {
          runId,
          evaluationTime: evaluationTime.toISOString(),
          maintenanceFingerprint: plan.maintenanceFingerprint,
          summary: {
            candidateCount: plan.summary.candidateCount,
            reconciledCount,
          },
          finishedAt,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await markMaintenanceRunCompleted({
      runId,
      candidateCount: execution.summary.candidateCount,
      reconciledCount: execution.summary.reconciledCount,
      finishedAt: execution.finishedAt,
    });

    return {
      mode: "execution",
      runId,
      status: "completed",
      replayed: false,
      evaluationTime: execution.evaluationTime,
      maintenanceFingerprint: execution.maintenanceFingerprint,
      summary: execution.summary,
    };
  } catch (error) {
    await markMaintenanceRunFailed({
      runId,
      finalErrorCode: deriveFinalErrorCode(error),
    });

    if (error instanceof BackupArtifactError) {
      throw error;
    }

    throw new BackupArtifactError(
      "INTERNAL_ERROR",
      500,
      "Restore run maintenance failed.",
    );
  }
}

type DbClient = typeof prisma | Prisma.TransactionClient;

async function buildCandidatePlan(
  client: DbClient,
  ownerUserId: string,
  evaluationTime: Date,
  staleThresholdMinutes: number,
): Promise<CandidatePlan> {
  const candidateRows = await selectStaleCandidates(client, ownerUserId, evaluationTime, staleThresholdMinutes);
  const candidateIds = candidateRows.map((row) => row.id).sort((left, right) => left.localeCompare(right));
  const maintenanceFingerprint = computeMaintenanceFingerprint({
    ownerUserId,
    evaluationTime: evaluationTime.toISOString(),
    staleThresholdMinutes,
    candidateRestoreRunIds: candidateIds,
  });

  return {
    summary: {
      candidateCount: candidateIds.length,
      reconciledCount: candidateIds.length,
    },
    maintenanceFingerprint,
    candidateIds,
  };
}

async function selectStaleCandidates(
  client: DbClient,
  ownerUserId: string,
  evaluationTime: Date,
  staleThresholdMinutes: number,
): Promise<RestoreRunCandidate[]> {
  return client.opsBackupRestoreRun.findMany({
    where: {
      ownerUserId,
      status: "started",
      startedAt: { lte: computeStaleCutoff(evaluationTime, staleThresholdMinutes) },
    },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    take: MAX_RECONCILIATION_BATCH,
    select: {
      id: true,
      startedAt: true,
    },
  });
}

async function findExistingReplay(input: {
  ownerUserId: string;
  executionIdempotencyKey: string;
  idempotencyFingerprint: string;
}): Promise<BackupRestoreRunMaintenanceExecutionResponse | null> {
  const row = await getMaintenanceRunDelegate().findUnique({
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

  return asReplayResult(row as MaintenanceRunRow, input.idempotencyFingerprint);
}

async function createRunningMaintenanceRun(input: {
  ownerUserId: string;
  actorUserId: string;
  staleThresholdMinutes: number;
  evaluationTime: Date;
  maintenanceFingerprint: string;
  executionIdempotencyKey: string;
  idempotencyFingerprint: string;
  advisoryLockKey: string;
}): Promise<string> {
  try {
    const row = await getMaintenanceRunDelegate().create({
      data: {
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        status: "running",
        staleThresholdMinutes: input.staleThresholdMinutes,
        evaluationTime: input.evaluationTime,
        maintenanceFingerprint: input.maintenanceFingerprint,
        executionIdempotencyKey: input.executionIdempotencyKey,
        idempotencyFingerprint: input.idempotencyFingerprint,
        advisoryLockKey: input.advisoryLockKey,
        candidatesScanned: 0,
        candidatesReconciledIndeterminate: 0,
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

    console.error("[BACKUP_RESTORE_MAINTENANCE_STARTED_WRITE_FAILED]", safeLogMessage(error));
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_UNAVAILABLE",
      500,
      "Restore run maintenance persistence is unavailable.",
    );
  }
}

async function markMaintenanceRunCompleted(input: {
  runId: string;
  candidateCount: number;
  reconciledCount: number;
  finishedAt: Date;
}): Promise<void> {
  try {
    await getMaintenanceRunDelegate().update({
      where: { id: input.runId },
      data: {
        status: "completed",
        candidatesScanned: input.candidateCount,
        candidatesReconciledIndeterminate: input.reconciledCount,
        finalErrorCode: null,
        finishedAt: input.finishedAt,
      },
    });
  } catch (error) {
    console.error("[BACKUP_RESTORE_MAINTENANCE_COMPLETED_WRITE_FAILED]", safeLogMessage(error));
  }
}

async function markMaintenanceRunFailed(input: { runId: string; finalErrorCode: string }): Promise<void> {
  try {
    await getMaintenanceRunDelegate().update({
      where: { id: input.runId },
      data: {
        status: "failed",
        finalErrorCode: input.finalErrorCode,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[BACKUP_RESTORE_MAINTENANCE_FAILED_WRITE_FAILED]", safeLogMessage(error));
  }
}

function asReplayResult(
  row: MaintenanceRunRow,
  idempotencyFingerprint: string,
): BackupRestoreRunMaintenanceExecutionResponse {
  if (row.idempotencyFingerprint !== idempotencyFingerprint) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_IDEMPOTENCY_KEY_MISMATCH",
      409,
      "The idempotency key was already used with a different maintenance payload.",
      { replayed: false, runId: row.id },
    );
  }

  if (row.status === "completed") {
    return {
      mode: "execution",
      runId: row.id,
      status: "completed",
      replayed: true,
      evaluationTime: row.evaluationTime.toISOString(),
      maintenanceFingerprint: row.maintenanceFingerprint,
      summary: {
        candidateCount: row.candidatesScanned,
        reconciledCount: row.candidatesReconciledIndeterminate,
      },
    };
  }

  if (row.status === "running") {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_IDEMPOTENCY_RUNNING",
      409,
      "The idempotent maintenance execution is still running.",
      { replayed: false, runId: row.id },
    );
  }

  throw new BackupArtifactError(
    "BACKUP_RESTORE_MAINTENANCE_IDEMPOTENCY_FAILED_REPLAY",
    409,
    "The idempotent maintenance execution previously failed.",
    { replayed: true, runId: row.id, finalErrorCode: row.finalErrorCode },
  );
}

function parseStaleThresholdMinutes(input: number): number {
  if (!Number.isInteger(input) || input < MIN_STALE_THRESHOLD_MINUTES || input > MAX_STALE_THRESHOLD_MINUTES) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_STALE_THRESHOLD_INVALID",
      400,
      `staleThresholdMinutes must be an integer between ${MIN_STALE_THRESHOLD_MINUTES} and ${MAX_STALE_THRESHOLD_MINUTES}.`,
    );
  }

  return input;
}

function parseExecutionEvaluationTime(input: string): Date {
  if (!EVALUATION_TIME_REGEX.test(input)) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_EVALUATION_TIME_INVALID",
      400,
      "evaluationTime must be a UTC ISO-8601 timestamp with millisecond precision.",
    );
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== input) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_EVALUATION_TIME_INVALID",
      400,
      "evaluationTime must be a valid UTC ISO-8601 timestamp with millisecond precision.",
    );
  }

  const now = Date.now();
  if (date.getTime() > now) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_EVALUATION_TIME_INVALID",
      400,
      "evaluationTime cannot be in the future.",
    );
  }

  if (now - date.getTime() > MAX_DRY_RUN_AGE_MS) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_EVALUATION_TIME_EXPIRED",
      400,
      "evaluationTime is older than the maximum dry-run validity window.",
    );
  }

  return date;
}

function validateMaintenanceFingerprint(input: string): void {
  if (!FINGERPRINT_REGEX.test(input)) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_FINGERPRINT_INVALID",
      400,
      "maintenanceFingerprint must be 64 lowercase hexadecimal characters.",
    );
  }
}

function validateExecutionIdempotencyKey(input: string): void {
  if (!IDEMPOTENCY_KEY_REGEX.test(input)) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_IDEMPOTENCY_KEY_INVALID",
      400,
      "executionIdempotencyKey is invalid.",
    );
  }
}

function validateAcknowledgeMutation(input: true): void {
  if (input !== true) {
    throw new BackupArtifactError(
      "BACKUP_RESTORE_MAINTENANCE_ACKNOWLEDGEMENT_REQUIRED",
      400,
      "acknowledgeMutation must be true.",
    );
  }
}

function computeStaleCutoff(evaluationTime: Date, staleThresholdMinutes: number): Date {
  return new Date(evaluationTime.getTime() - staleThresholdMinutes * 60 * 1000);
}

function computeMaintenanceFingerprint(input: {
  ownerUserId: string;
  evaluationTime: string;
  staleThresholdMinutes: number;
  candidateRestoreRunIds: string[];
}): string {
  const payload = JSON.stringify({
    version: MAINTENANCE_FINGERPRINT_VERSION,
    ownerUserId: input.ownerUserId,
    evaluationTime: input.evaluationTime,
    staleThresholdMinutes: input.staleThresholdMinutes,
    candidateRestoreRunIds: input.candidateRestoreRunIds,
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function computeIdempotencyFingerprint(input: {
  ownerUserId: string;
  evaluationTime: string;
  staleThresholdMinutes: number;
  maintenanceFingerprint: string;
}): string {
  const payload = JSON.stringify({
    ownerUserId: input.ownerUserId,
    mode: "execution",
    evaluationTime: input.evaluationTime,
    staleThresholdMinutes: input.staleThresholdMinutes,
    maintenanceFingerprint: input.maintenanceFingerprint,
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function deriveAdvisoryLockKey(ownerUserId: string): string {
  const digest = createHash("sha256")
    .update(`${GOVERNANCE_LOCK_NAMESPACE}:${ownerUserId}`, "utf8")
    .digest();
  return digest.readBigInt64BE(0).toString();
}

export function deriveBackupRestoreGovernanceAdvisoryLockKey(ownerUserId: string): string {
  return deriveAdvisoryLockKey(ownerUserId);
}

async function tryAcquireAdvisoryXactLock(tx: Prisma.TransactionClient, advisoryLockKey: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
    SELECT pg_try_advisory_xact_lock(CAST(${advisoryLockKey} AS bigint)) AS acquired
  `);

  return rows[0]?.acquired === true;
}

async function selectDbNow(client: Prisma.TransactionClient): Promise<Date> {
  const rows = await client.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT NOW() AS now`);
  return rows[0]?.now ?? new Date();
}

function deriveFinalErrorCode(error: unknown): string {
  if (error instanceof BackupArtifactError) {
    if (
      error.code === FINAL_ERROR_CODE_LOCK_CONFLICT ||
      error.code === FINAL_ERROR_CODE_FINGERPRINT_MISMATCH
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

class ReplayResultError extends Error {
  response: BackupRestoreRunMaintenanceExecutionResponse;

  constructor(response: BackupRestoreRunMaintenanceExecutionResponse) {
    super("Replay result");
    this.response = response;
  }
}

export const __testUtils = {
  computeMaintenanceFingerprint,
  computeIdempotencyFingerprint,
  deriveAdvisoryLockKey: deriveBackupRestoreGovernanceAdvisoryLockKey,
};