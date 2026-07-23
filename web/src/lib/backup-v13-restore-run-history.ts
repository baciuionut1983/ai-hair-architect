import { BackupArtifactError } from "@/lib/backup-v13-artifact";
import {
  executeBackupRestoreInternalForUser,
  type BackupRestoreExecutionInternalResult,
} from "@/lib/backup-v13-restore-execution";
import type {
  BackupRestoreRequest,
  BackupRestoreResponse,
  BackupRestoreRunCounts,
  BackupRestoreRunHistoryListInput,
  BackupRestoreRunHistoryPage,
  BackupRestoreRunHistoryRecord,
  BackupRestoreRunStatus,
  BackupRestoreWarningCode,
} from "@/lib/contracts";
import { prisma } from "@/lib/prisma";

const MAX_RESTORE_ATTEMPTS = 3;
const STALE_STARTED_WINDOW_MS = 15 * 60 * 1000;
const MAX_HISTORY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

const ALLOWED_WARNING_CODES = new Set<BackupRestoreWarningCode>([
  "BACKUP_OLDER_THAN_CURRENT_STATE",
  "CURRENT_STATE_HAS_EXTRA_ROWS",
]);

type RestoreRunWarningJson = { warningCodes: BackupRestoreWarningCode[] };

type OpsBackupRestoreRunDelegate = {
  create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, "asc" | "desc">>;
    take: number;
    select: Record<string, true>;
  }): Promise<Array<Record<string, unknown>>>;
};

function getRestoreRunDelegate(): OpsBackupRestoreRunDelegate {
  return (prisma as unknown as { opsBackupRestoreRun: OpsBackupRestoreRunDelegate }).opsBackupRestoreRun;
}

export interface ExecuteBackupRestoreWithHistoryInput {
  ownerUserId: string;
  actorUserId: string;
  backupId: string;
  request: BackupRestoreRequest;
  correlationRequestId: string;
}

export async function executeBackupRestoreWithHistory(
  input: ExecuteBackupRestoreWithHistoryInput,
): Promise<BackupRestoreResponse> {
  const startedAt = new Date();
  const runId = await createStartedRestoreRun({
    ownerUserId: input.ownerUserId,
    backupId: input.backupId,
    actorUserId: input.actorUserId,
    correlationRequestId: input.correlationRequestId,
    request: input.request,
    startedAt,
  });

  let attemptsUsed: 1 | 2 | 3 = 1;

  try {
    const result = await executeBackupRestoreInternalForUser(
      input.ownerUserId,
      input.backupId,
      input.request,
      { correlationRequestId: input.correlationRequestId },
    );
    attemptsUsed = result.attemptsUsed;

    await markRestoreRunCompleted({ runId, attemptsUsed, result });
    return result.response;
  } catch (error) {
    attemptsUsed = getAttemptsUsed(error);
    const finalErrorCode = error instanceof BackupArtifactError ? error.code : "INTERNAL_ERROR";

    await markRestoreRunFailed({
      runId,
      attemptsUsed,
      finalErrorCode,
    });

    throw error;
  }
}

export async function listBackupRestoreRunsForUser(
  input: BackupRestoreRunHistoryListInput,
): Promise<BackupRestoreRunHistoryPage> {
  const limit = parseLimit(input.limit);
  const status = parseStatus(input.status);
  const fromDate = parseIsoDate(input.from, "RESTORE_HISTORY_TIME_FILTER_INVALID");
  const toDate = parseIsoDate(input.to, "RESTORE_HISTORY_TIME_FILTER_INVALID");
  const cursor = decodeCursor(input.cursor);

  if (fromDate && toDate && fromDate >= toDate) {
    throw new BackupArtifactError(
      "RESTORE_HISTORY_TIME_RANGE_INVALID",
      400,
      "from must be earlier than to.",
    );
  }

  if (fromDate && toDate && toDate.getTime() - fromDate.getTime() > MAX_HISTORY_WINDOW_MS) {
    throw new BackupArtifactError(
      "RESTORE_HISTORY_TIME_RANGE_TOO_LARGE",
      400,
      "Requested time range is too large.",
    );
  }

  const where: Record<string, unknown> = {
    ownerUserId: input.ownerUserId,
  };

  if (input.backupId) {
    where.backupId = input.backupId;
  }

  if (status) {
    where.status = status;
  }

  if (input.correlationRequestId) {
    where.correlationRequestId = input.correlationRequestId;
  }

  if (fromDate || toDate) {
    where.startedAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lt: toDate } : {}),
    };
  }

  if (cursor) {
    where.OR = [
      { startedAt: { lt: cursor.startedAt } },
      {
        AND: [
          { startedAt: cursor.startedAt },
          { id: { lt: cursor.id } },
        ],
      },
    ];
  }

  const rows = await getRestoreRunDelegate().findMany({
    where,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      backupId: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      strategy: true,
      previewFingerprint: true,
      currentStateFingerprint: true,
      startedAt: true,
      finishedAt: true,
      finalErrorCode: true,
      deletedClientCount: true,
      deletedAnalysisCount: true,
      deletedImageAssetCount: true,
      deletedImageAnalysisCount: true,
      deletedImageAnalysisReviewCount: true,
      restoredClientCount: true,
      restoredAnalysisCount: true,
      restoredImageAssetCount: true,
      restoredImageAnalysisCount: true,
      restoredImageAnalysisReviewCount: true,
      warningCodes: true,
    },
  });

  const hasNextPage = rows.length > limit;
  const visible = hasNextPage ? rows.slice(0, limit) : rows;

  const data = visible.map((row) => toHistoryRecord(row));
  const last = visible.at(-1);

  return {
    data,
    pageInfo: {
      limit,
      hasNextPage,
      nextCursor: hasNextPage && last ? encodeCursor(toDateCursor(last)) : null,
    },
  };
}

function toHistoryRecord(row: Record<string, unknown>): BackupRestoreRunHistoryRecord {
  const startedAt = asDate(row.startedAt);
  return {
    id: asString(row.id),
    backupId: asString(row.backupId),
    status: asStatus(row.status),
    attemptCount: asNumber(row.attemptCount),
    maxAttempts: asNumber(row.maxAttempts),
    strategy: "replace_all",
    previewFingerprintPrefix: asString(row.previewFingerprint).slice(0, 12),
    currentStateFingerprintPrefix: asString(row.currentStateFingerprint).slice(0, 12),
    startedAt: startedAt.toISOString(),
    finishedAt: asNullableDate(row.finishedAt),
    finalErrorCode: asNullableString(row.finalErrorCode),
    warningCodes: parseWarningCodes(row.warningCodes),
    isStale: asStatus(row.status) === "started" && Date.now() - startedAt.getTime() >= STALE_STARTED_WINDOW_MS,
    ...toCounts(row),
  };
}

function toCounts(row: Record<string, unknown>): BackupRestoreRunCounts {
  return {
    deletedClientCount: asNullableNumber(row.deletedClientCount),
    deletedAnalysisCount: asNullableNumber(row.deletedAnalysisCount),
    deletedImageAssetCount: asNullableNumber(row.deletedImageAssetCount),
    deletedImageAnalysisCount: asNullableNumber(row.deletedImageAnalysisCount),
    deletedImageAnalysisReviewCount: asNullableNumber(row.deletedImageAnalysisReviewCount),
    restoredClientCount: asNullableNumber(row.restoredClientCount),
    restoredAnalysisCount: asNullableNumber(row.restoredAnalysisCount),
    restoredImageAssetCount: asNullableNumber(row.restoredImageAssetCount),
    restoredImageAnalysisCount: asNullableNumber(row.restoredImageAnalysisCount),
    restoredImageAnalysisReviewCount: asNullableNumber(row.restoredImageAnalysisReviewCount),
  };
}

function parseWarningCodes(input: unknown): BackupRestoreWarningCode[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  const value = input as RestoreRunWarningJson;
  if (!Array.isArray(value.warningCodes)) {
    return [];
  }

  return toAllowedUniqueWarningCodes(value.warningCodes);
}

function toAllowedUniqueWarningCodes(codes: readonly unknown[]): BackupRestoreWarningCode[] {
  const seen = new Set<BackupRestoreWarningCode>();
  const allowedUnique: BackupRestoreWarningCode[] = [];

  for (const code of codes) {
    if (!ALLOWED_WARNING_CODES.has(code as BackupRestoreWarningCode)) {
      continue;
    }

    const allowedCode = code as BackupRestoreWarningCode;
    if (seen.has(allowedCode)) {
      continue;
    }

    seen.add(allowedCode);
    allowedUnique.push(allowedCode);
  }

  return allowedUnique;
}

async function createStartedRestoreRun(input: {
  ownerUserId: string;
  backupId: string;
  actorUserId: string;
  correlationRequestId: string;
  request: BackupRestoreRequest;
  startedAt: Date;
}): Promise<string> {
  try {
    const row = await getRestoreRunDelegate().create({
      data: {
        ownerUserId: input.ownerUserId,
        backupId: input.backupId,
        actorUserId: input.actorUserId,
        correlationRequestId: input.correlationRequestId,
        strategy: input.request.strategy,
        previewFingerprint: input.request.previewFingerprint,
        currentStateFingerprint: input.request.currentStateFingerprint,
        status: "started",
        attemptCount: 0,
        maxAttempts: MAX_RESTORE_ATTEMPTS,
        startedAt: input.startedAt,
        finishedAt: null,
        finalErrorCode: null,
      },
      select: { id: true },
    });

    return row.id;
  } catch (error) {
    console.error("[BACKUP_RESTORE_HISTORY_STARTED_WRITE_FAILED]", safeLogMessage(error));
    throw new BackupArtifactError(
      "BACKUP_RESTORE_HISTORY_UNAVAILABLE",
      500,
      "Restore history persistence is unavailable.",
    );
  }
}

async function markRestoreRunCompleted(input: {
  runId: string;
  attemptsUsed: 1 | 2 | 3;
  result: BackupRestoreExecutionInternalResult;
}): Promise<void> {
  try {
    await getRestoreRunDelegate().update({
      where: { id: input.runId },
      data: {
        status: "completed",
        attemptCount: input.attemptsUsed,
        finishedAt: new Date(input.result.response.finishedAt),
        finalErrorCode: null,
        deletedClientCount: input.result.response.deletedCounts.clients,
        deletedAnalysisCount: input.result.response.deletedCounts.analyses,
        deletedImageAssetCount: input.result.response.deletedCounts.imageAssets,
        deletedImageAnalysisCount: input.result.response.deletedCounts.imageAnalyses,
        deletedImageAnalysisReviewCount: input.result.response.deletedCounts.imageAnalysisReviews,
        restoredClientCount: input.result.response.restoredCounts.clients,
        restoredAnalysisCount: input.result.response.restoredCounts.analyses,
        restoredImageAssetCount: input.result.response.restoredCounts.imageAssets,
        restoredImageAnalysisCount: input.result.response.restoredCounts.imageAnalyses,
        restoredImageAnalysisReviewCount: input.result.response.restoredCounts.imageAnalysisReviews,
        warningCodes: {
          warningCodes: toAllowedUniqueWarningCodes(input.result.response.warnings.map((warning) => warning.code)),
        },
      },
    });
  } catch (error) {
    console.error("[BACKUP_RESTORE_HISTORY_COMPLETED_WRITE_FAILED]", safeLogMessage(error));
  }
}

async function markRestoreRunFailed(input: {
  runId: string;
  attemptsUsed: 1 | 2 | 3;
  finalErrorCode: string;
}): Promise<void> {
  try {
    await getRestoreRunDelegate().update({
      where: { id: input.runId },
      data: {
        status: "failed",
        attemptCount: input.attemptsUsed,
        finishedAt: new Date(),
        finalErrorCode: input.finalErrorCode,
      },
    });
  } catch (error) {
    console.error("[BACKUP_RESTORE_HISTORY_FAILED_WRITE_FAILED]", safeLogMessage(error));
  }
}

function parseLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 20;
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new BackupArtifactError("RESTORE_HISTORY_LIMIT_INVALID", 400, "limit must be an integer between 1 and 100.");
  }

  return limit;
}

function parseStatus(status: BackupRestoreRunStatus | undefined): BackupRestoreRunStatus | undefined {
  if (status === undefined) {
    return undefined;
  }

  if (status === "started" || status === "completed" || status === "failed" || status === "indeterminate") {
    return status;
  }

  throw new BackupArtifactError("RESTORE_HISTORY_STATUS_INVALID", 400, "status must be one of started, completed, failed, indeterminate.");
}

function parseIsoDate(value: string | undefined, code: string): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BackupArtifactError(code, 400, "Invalid ISO date value.");
  }

  return date;
}

function decodeCursor(cursor: string | null | undefined): { startedAt: Date; id: string } | null {
  if (!cursor) {
    return null;
  }

  let decoded: unknown;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    decoded = JSON.parse(raw);
  } catch {
    throw new BackupArtifactError("RESTORE_HISTORY_CURSOR_INVALID", 400, "cursor is invalid.");
  }

  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new BackupArtifactError("RESTORE_HISTORY_CURSOR_INVALID", 400, "cursor is invalid.");
  }

  const parsed = decoded as { startedAt?: unknown; id?: unknown };
  if (typeof parsed.startedAt !== "string" || typeof parsed.id !== "string") {
    throw new BackupArtifactError("RESTORE_HISTORY_CURSOR_INVALID", 400, "cursor is invalid.");
  }

  const startedAt = new Date(parsed.startedAt);
  if (Number.isNaN(startedAt.getTime())) {
    throw new BackupArtifactError("RESTORE_HISTORY_CURSOR_INVALID", 400, "cursor is invalid.");
  }

  return {
    startedAt,
    id: parsed.id,
  };
}

function encodeCursor(value: { startedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function toDateCursor(row: Record<string, unknown>): { startedAt: string; id: string } {
  return {
    startedAt: asDate(row.startedAt).toISOString(),
    id: asString(row.id),
  };
}

function getAttemptsUsed(error: unknown): 1 | 2 | 3 {
  if (error && typeof error === "object") {
    const candidate = error as { attemptsUsed?: unknown };
    if (typeof candidate.attemptsUsed === "number") {
      const attempt = Math.trunc(candidate.attemptsUsed);
      if (attempt >= 1 && attempt <= MAX_RESTORE_ATTEMPTS) {
        return attempt as 1 | 2 | 3;
      }
    }
  }

  return 1;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(0);
}

function asNullableDate(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function asStatus(value: unknown): BackupRestoreRunStatus {
  if (value === "completed" || value === "failed" || value === "indeterminate") {
    return value;
  }

  return "started";
}

function safeLogMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
