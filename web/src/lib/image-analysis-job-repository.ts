import { Prisma } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const IMAGE_ANALYSIS_JOB_PERSISTENCE_ERROR_CODE = "IMAGE_ANALYSIS_JOB_PERSISTENCE_UNAVAILABLE";
export const IMAGE_ANALYSIS_JOB_STATE_ERROR_CODE = "IMAGE_ANALYSIS_JOB_INVALID_STATE";

export const ANALYSIS_STATUS_QUEUED = "queued";
export const ANALYSIS_STATUS_PROCESSING = "processing";
export const ANALYSIS_STATUS_DRAFT = "draft";
export const ANALYSIS_STATUS_FAILED = "failed";

export const MONTHLY_ANALYSIS_QUOTA = 5;
export const MAX_ATTEMPTS_PER_ANALYSIS = 2;
export const STALE_PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

const MAX_CLAIM_TRANSACTION_ATTEMPTS = 3;

// Frozen taxonomy: permanent failures never retry, retryable failures may
// consume the single remaining attempt slot. Represented explicitly here so
// callers never infer retry eligibility from a provider's raw error text.
export const PERMANENT_FAILURE_CODES = [
  "CONSENT_MISSING",
  "QUOTA_EXCEEDED",
  "UNSUPPORTED_IMAGE",
  "MALFORMED_PROVIDER_RESPONSE",
  "POLICY_VIOLATION",
  "INVALID_ANALYSIS_STATE",
  "PROVIDER_CONFIGURATION_INVALID",
] as const;

export const RETRYABLE_FAILURE_CODES = [
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "STORAGE_READ_FAILURE",
  "DATABASE_CONFLICT",
  "NETWORK_FAILURE",
] as const;

export type PermanentFailureCode = (typeof PERMANENT_FAILURE_CODES)[number];
export type RetryableFailureCode = (typeof RETRYABLE_FAILURE_CODES)[number];
export type AnalysisFailureCode = PermanentFailureCode | RetryableFailureCode;

export type AnalysisClaimRejectionCode = "CONSENT_MISSING" | "QUOTA_EXCEEDED" | "INVALID_ANALYSIS_STATE";

export type AnalysisClaimResult =
  | { outcome: "claimed"; attemptNumber: number }
  | { outcome: "rejected"; code: AnalysisClaimRejectionCode };

export interface ClaimQueuedAnalysisInput {
  analysisId: string;
  ownerUserId: string;
  providerName: string;
  modelVersion: string;
  now?: Date;
}

export interface MarkAnalysisFailedResult {
  status: typeof ANALYSIS_STATUS_QUEUED | typeof ANALYSIS_STATUS_FAILED;
}

type AnalysisJobTransaction = Pick<Prisma.TransactionClient, "imageAnalysis" | "imageAnalysisProviderAttempt">;

export class ImageAnalysisJobPersistenceError extends Error {
  readonly code = IMAGE_ANALYSIS_JOB_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Image analysis job data is temporarily unavailable.");
    this.name = "ImageAnalysisJobPersistenceError";
  }
}

export class ImageAnalysisJobStateError extends Error {
  readonly code = IMAGE_ANALYSIS_JOB_STATE_ERROR_CODE;
  readonly httpStatus = 409;

  constructor() {
    super("Image analysis job is not in a state that allows this transition.");
    this.name = "ImageAnalysisJobStateError";
  }
}

/**
 * Records durable, mandatory consent evidence before any external-provider
 * claim can succeed. Deliberately the only writer of these two columns --
 * claimQueuedAnalysisForProcessing reads them but never accepts a
 * transient caller-supplied consent boolean as a substitute.
 */
export async function recordExternalAiConsent(
  analysisId: string,
  ownerUserId: string,
  consentVersion: string,
  grantedAt: Date = new Date(),
): Promise<void> {
  if (!isValidDate(grantedAt) || consentVersion.trim().length === 0) {
    throw new ImageAnalysisJobStateError();
  }

  return runAnalysisJobQuery(async () => {
    const claimed = await prisma.imageAnalysis.updateMany({
      where: { id: analysisId, asset: { ownerUserId } },
      data: { externalAiConsentGrantedAt: grantedAt, externalAiConsentVersion: consentVersion },
    });
    if (claimed.count !== 1) {
      throw new ImageAnalysisJobStateError();
    }
  });
}

/**
 * Atomically claims a queued analysis for external-provider processing.
 * A single attempt-count bound (MAX_ATTEMPTS_PER_ANALYSIS) covers both "the
 * one explicit retry after a retryable failure" and "one explicit recovery
 * claim after a stale (>15min) processing claim" -- they are the same
 * mechanism, not two independent budgets. Every claimed attempt (original,
 * retry, or stale recovery) consumes one monthly quota slot; a rejection
 * before the row is claimed consumes none.
 */
export async function claimQueuedAnalysisForProcessing({
  analysisId,
  ownerUserId,
  providerName,
  modelVersion,
  now = new Date(),
}: ClaimQueuedAnalysisInput): Promise<AnalysisClaimResult> {
  if (!isValidDate(now)) {
    throw new ImageAnalysisJobPersistenceError();
  }

  return runAnalysisJobQuery(() => runSerializableClaimTransaction(async (tx) => {
    const analysis = await tx.imageAnalysis.findFirst({
      where: { id: analysisId, asset: { ownerUserId } },
      select: { id: true, status: true, externalAiConsentGrantedAt: true },
    });
    if (!analysis) {
      return { outcome: "rejected", code: "INVALID_ANALYSIS_STATE" };
    }

    if (!analysis.externalAiConsentGrantedAt) {
      return { outcome: "rejected", code: "CONSENT_MISSING" };
    }

    const lastAttempt = await tx.imageAnalysisProviderAttempt.findFirst({
      where: { imageAnalysisId: analysis.id },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true, createdAt: true },
    });
    const nextAttemptNumber = (lastAttempt?.attemptNumber ?? 0) + 1;

    const eligible =
      analysis.status === ANALYSIS_STATUS_QUEUED ||
      (analysis.status === ANALYSIS_STATUS_PROCESSING &&
        lastAttempt !== null &&
        isStaleProcessing(lastAttempt.createdAt, now));

    if (!eligible || nextAttemptNumber > MAX_ATTEMPTS_PER_ANALYSIS) {
      return { outcome: "rejected", code: "INVALID_ANALYSIS_STATE" };
    }

    const { start, end } = calendarMonthBounds(now);
    const monthlyCount = await tx.imageAnalysisProviderAttempt.count({
      where: { ownerUserId, createdAt: { gte: start, lt: end } },
    });
    if (monthlyCount >= MONTHLY_ANALYSIS_QUOTA) {
      return { outcome: "rejected", code: "QUOTA_EXCEEDED" };
    }

    const claimed = await tx.imageAnalysis.updateMany({
      where: { id: analysis.id, asset: { ownerUserId }, status: analysis.status },
      data: { status: ANALYSIS_STATUS_PROCESSING, lastFailureCode: null },
    });
    if (claimed.count !== 1) {
      return { outcome: "rejected", code: "INVALID_ANALYSIS_STATE" };
    }

    await tx.imageAnalysisProviderAttempt.create({
      data: {
        imageAnalysisId: analysis.id,
        ownerUserId,
        providerName,
        modelVersion,
        attemptNumber: nextAttemptNumber,
        createdAt: now,
      },
    });

    return { outcome: "claimed", attemptNumber: nextAttemptNumber };
  }));
}

export async function markAnalysisSucceeded(analysisId: string, ownerUserId: string): Promise<void> {
  return runAnalysisJobQuery(async () => {
    const claimed = await prisma.imageAnalysis.updateMany({
      where: { id: analysisId, asset: { ownerUserId }, status: ANALYSIS_STATUS_PROCESSING },
      data: { status: ANALYSIS_STATUS_DRAFT, lastFailureCode: null },
    });
    if (claimed.count !== 1) {
      throw new ImageAnalysisJobStateError();
    }
  });
}

export async function markAnalysisFailed(
  analysisId: string,
  ownerUserId: string,
  failureCode: AnalysisFailureCode,
): Promise<MarkAnalysisFailedResult> {
  return runAnalysisJobQuery(() => prisma.$transaction(async (tx) => {
    const attemptCount = await tx.imageAnalysisProviderAttempt.count({
      where: { imageAnalysisId: analysisId, ownerUserId },
    });

    const isPermanent = (PERMANENT_FAILURE_CODES as readonly string[]).includes(failureCode);
    const canRetry = !isPermanent && attemptCount < MAX_ATTEMPTS_PER_ANALYSIS;
    const nextStatus = canRetry ? ANALYSIS_STATUS_QUEUED : ANALYSIS_STATUS_FAILED;

    const claimed = await tx.imageAnalysis.updateMany({
      where: { id: analysisId, asset: { ownerUserId }, status: ANALYSIS_STATUS_PROCESSING },
      data: { status: nextStatus, lastFailureCode: failureCode },
    });
    if (claimed.count !== 1) {
      throw new ImageAnalysisJobStateError();
    }

    return { status: nextStatus };
  }));
}

export async function countMonthlyRealAnalysisAttempts(
  ownerUserId: string,
  now: Date = new Date(),
): Promise<number> {
  if (!isValidDate(now)) {
    throw new ImageAnalysisJobPersistenceError();
  }

  return runAnalysisJobQuery(() => {
    const { start, end } = calendarMonthBounds(now);
    return prisma.imageAnalysisProviderAttempt.count({
      where: { ownerUserId, createdAt: { gte: start, lt: end } },
    });
  });
}

export function isImageAnalysisJobPersistenceError(error: unknown): error is ImageAnalysisJobPersistenceError {
  return error instanceof ImageAnalysisJobPersistenceError;
}

export function isImageAnalysisJobStateError(error: unknown): error is ImageAnalysisJobStateError {
  return error instanceof ImageAnalysisJobStateError;
}

function calendarMonthBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

function isStaleProcessing(lastAttemptCreatedAt: Date, now: Date): boolean {
  return now.getTime() - lastAttemptCreatedAt.getTime() >= STALE_PROCESSING_TIMEOUT_MS;
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

async function runAnalysisJobQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new ImageAnalysisJobPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof ImageAnalysisJobPersistenceError || error instanceof ImageAnalysisJobStateError) {
      throw error;
    }
    throw new ImageAnalysisJobPersistenceError();
  }
}

async function runSerializableClaimTransaction<T>(
  operation: (tx: AnalysisJobTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_CLAIM_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableConcurrencyError(error) || attempt === MAX_CLAIM_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new ImageAnalysisJobPersistenceError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2034";
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}
