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

type AnalysisJobTransaction = Pick<
  Prisma.TransactionClient,
  "imageAnalysis" | "imageAnalysisProviderAttempt" | "imageAsset"
>;

// The exact providerName upload-time placeholders are created with (M21) --
// signals "no automated analysis has ever been attempted for this row" when
// paired with a null externalAiConsentGrantedAt. Never touched by a
// successful or failed real-provider run (only markAnalysisSucceeded ever
// overwrites providerName, and only on success).
const PLACEHOLDER_PROVIDER_NAME = "manual-only";

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

export interface QueueAnalysisResult {
  analysisId: string;
  created: boolean;
}

/**
 * Ensures an owner-scoped, claimable ImageAnalysis row exists for an asset.
 * Exactly one row is ever the "target" for a given asset at a time -- this
 * function never creates a second row while an eligible one already exists.
 * Priority, evaluated inside one Serializable transaction:
 *
 *   1. An active row (queued or processing) -- reused as-is (unchanged from
 *      the row's pre-M21 behavior).
 *   2. Exactly one "fresh" upload-time placeholder (draft, providerName
 *      still PLACEHOLDER_PROVIDER_NAME, never consented) -- reused via an
 *      atomic in-place transition to queued. Never a second draft row.
 *   3. Exactly one failed row still eligible for another attempt under the
 *      existing M18 retry policy (not a permanent failure code, and fewer
 *      than MAX_ATTEMPTS_PER_ANALYSIS attempts recorded) -- reused via an
 *      atomic in-place transition to queued. Consent and the
 *      ImageAnalysisProviderAttempt history are never touched or reset here;
 *      only markAnalysisFailed/markAnalysisSucceeded/consent-recording ever
 *      write those.
 *   4. Anything else for this asset (a draft that already carries a real
 *      analysis awaiting review, a confirmed analysis, a failed row with no
 *      retry left, or more than one row eligible under 2+3 at once) fails
 *      closed with ImageAnalysisJobStateError -- never an arbitrary pick,
 *      never a second row created alongside it.
 *   5. No row at all for this asset -- creates a fresh queued row (unchanged
 *      compatibility path for assets that predate the M21 placeholder).
 *
 * Two concurrent callers racing on the same eligible row (case 2 or 3) both
 * resolve to that same single row: whichever transitions it first wins, and
 * the loser reconciles by re-reading rather than creating a duplicate or
 * erroring.
 */
export async function queueAnalysisForExternalProvider(
  assetId: string,
  ownerUserId: string,
): Promise<QueueAnalysisResult> {
  return runAnalysisJobQuery(() => runSerializableClaimTransaction((tx) =>
    queueAnalysisForExternalProviderTx(tx, assetId, ownerUserId)
  ));
}

async function queueAnalysisForExternalProviderTx(
  tx: AnalysisJobTransaction,
  assetId: string,
  ownerUserId: string,
): Promise<QueueAnalysisResult> {
  const rows = await tx.imageAnalysis.findMany({
    where: { assetId, asset: { ownerUserId } },
    orderBy: { createdAt: "desc" },
  });

  const activeRow = rows.find(
    (row) => row.status === ANALYSIS_STATUS_QUEUED || row.status === ANALYSIS_STATUS_PROCESSING,
  );
  if (activeRow) {
    return { analysisId: activeRow.id, created: false };
  }

  const freshPlaceholders = rows.filter(
    (row) =>
      row.status === ANALYSIS_STATUS_DRAFT &&
      row.providerName === PLACEHOLDER_PROVIDER_NAME &&
      row.externalAiConsentGrantedAt === null,
  );

  const retryableFailed = [];
  for (const row of rows) {
    if (row.status !== ANALYSIS_STATUS_FAILED) continue;
    const attemptCount = await tx.imageAnalysisProviderAttempt.count({
      where: { imageAnalysisId: row.id },
    });
    const isPermanent =
      row.lastFailureCode !== null &&
      (PERMANENT_FAILURE_CODES as readonly string[]).includes(row.lastFailureCode);
    if (!isPermanent && attemptCount < MAX_ATTEMPTS_PER_ANALYSIS) {
      retryableFailed.push(row);
    }
  }

  const eligible = [...freshPlaceholders, ...retryableFailed];

  if (eligible.length > 1) {
    throw new ImageAnalysisJobStateError();
  }

  if (eligible.length === 1) {
    const candidate = eligible[0];
    const isFreshPlaceholder = freshPlaceholders.length === 1;
    const guardWhere = isFreshPlaceholder
      ? {
          id: candidate.id,
          status: ANALYSIS_STATUS_DRAFT,
          providerName: PLACEHOLDER_PROVIDER_NAME,
          externalAiConsentGrantedAt: null,
        }
      : { id: candidate.id, status: ANALYSIS_STATUS_FAILED };

    const claimed = await tx.imageAnalysis.updateMany({
      where: guardWhere,
      data: { status: ANALYSIS_STATUS_QUEUED },
    });

    if (claimed.count === 1) {
      return { analysisId: candidate.id, created: false };
    }

    // Lost a race: another concurrent call already transitioned this exact
    // row. Reconcile by re-reading rather than erroring or creating a second
    // row -- both callers must resolve to the same single row.
    const current = await tx.imageAnalysis.findUniqueOrThrow({ where: { id: candidate.id } });
    if (current.status === ANALYSIS_STATUS_QUEUED || current.status === ANALYSIS_STATUS_PROCESSING) {
      return { analysisId: current.id, created: false };
    }
    throw new ImageAnalysisJobStateError();
  }

  if (rows.length > 0) {
    // Rows exist for this asset, but none are eligible for reuse: already
    // confirmed, a draft that already carries a real analysis awaiting
    // review, or a terminally failed row with no retry remaining. Fail
    // closed rather than creating a second, ambiguous row or silently
    // picking one.
    throw new ImageAnalysisJobStateError();
  }

  const asset = await tx.imageAsset.findFirst({ where: { id: assetId, ownerUserId } });
  if (!asset || asset.deletedAt) {
    throw new ImageAnalysisJobStateError();
  }

  const created = await tx.imageAnalysis.create({
    data: { assetId, status: ANALYSIS_STATUS_QUEUED },
  });
  return { analysisId: created.id, created: true };
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

export interface AnalysisSuccessPayload {
  result: Prisma.InputJsonValue;
  confidences: Prisma.InputJsonValue;
  providerName: string;
  modelVersion: string;
  warnings: string[];
}

export async function markAnalysisSucceeded(
  analysisId: string,
  ownerUserId: string,
  payload: AnalysisSuccessPayload,
): Promise<void> {
  return runAnalysisJobQuery(async () => {
    const claimed = await prisma.imageAnalysis.updateMany({
      where: { id: analysisId, asset: { ownerUserId }, status: ANALYSIS_STATUS_PROCESSING },
      data: {
        status: ANALYSIS_STATUS_DRAFT,
        lastFailureCode: null,
        analysisPayload: payload.result,
        confidences: payload.confidences,
        providerName: payload.providerName,
        modelVersion: payload.modelVersion,
        warnings: payload.warnings,
      },
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
