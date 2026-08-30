import { Prisma } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";

// Real AI Photo Preview, Stage 2 -- durable claim/completion/failure
// semantics for REQUESTED PhotoPreviewGeneration rows. Mirrors
// image-analysis-job-repository.ts's own claim/markSucceeded/markFailed
// shape exactly: an atomic, WHERE-guarded `updateMany` is the real
// concurrency backstop (task §19 -- "database atomicity, not process
// memory"), never application-level locking. Every real provider attempt
// is attributable via AiUsageEvent (correlationId = the generation's own
// id, attemptNumber = the value this module hands back from the claim) --
// no separate per-attempt log table, matching this schema's own established
// "don't duplicate what AiUsageEvent already records" precedent.

// Mirrors MAX_ATTEMPTS_PER_ANALYSIS's own exact value and reasoning
// (image-analysis-job-repository.ts): a small, explicit, easily-reviewed
// cap on how many times ONE generation may spend a real paid provider call.
export const MAX_PROVIDER_ATTEMPTS_PER_GENERATION = 2;

// Mirrors STALE_PROCESSING_TIMEOUT_MS's own exact value
// (image-analysis-job-repository.ts) -- if a process crashes mid-execution
// (after claim, before completion/failure), the row is recoverable by a
// LATER claim attempt once this much time has passed, rather than being
// permanently stuck PROCESSING forever (task §20).
export const PHOTO_PREVIEW_STALE_PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

const MAX_TRANSACTION_ATTEMPTS = 3;

export class PhotoPreviewExecutionPersistenceError extends Error {
  readonly code = "PHOTO_PREVIEW_EXECUTION_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Photo Preview execution data is temporarily unavailable.");
    this.name = "PhotoPreviewExecutionPersistenceError";
  }
}

// A completion/failure call observed the row NOT in the expected PROCESSING
// state (e.g. a stale-recovery race already resolved it, or it was never
// validly claimed) -- always thrown BEFORE any further write.
export class PhotoPreviewExecutionStateError extends Error {
  readonly code = "PHOTO_PREVIEW_EXECUTION_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor() {
    super("Photo Preview generation is not in a state that allows this transition.");
    this.name = "PhotoPreviewExecutionStateError";
  }
}

export type PhotoPreviewClaimRejectionCode = "NOT_FOUND" | "NOT_ELIGIBLE" | "MAX_ATTEMPTS_EXCEEDED";

export type PhotoPreviewClaimResult =
  | { outcome: "claimed"; attemptNumber: number }
  | { outcome: "rejected"; code: PhotoPreviewClaimRejectionCode };

/**
 * Atomically transitions exactly one eligible row to PROCESSING for exactly
 * one caller (task §19). Eligible means: currently REQUESTED, OR currently
 * PROCESSING but stale (its own startedAt is older than
 * PHOTO_PREVIEW_STALE_PROCESSING_TIMEOUT_MS -- task §20's stale-processing
 * recovery). The WHERE clause on the final `updateMany` re-checks the EXACT
 * status this call itself just observed -- if a concurrent caller already
 * won the race and changed it, this call matches zero rows and reports
 * "rejected", never silently proceeding. Two concurrent callers racing on
 * the same row can never both receive "claimed" (proven live in this
 * module's own concurrency test).
 */
export async function claimPhotoPreviewGenerationForExecution(
  generationId: string,
  ownerUserId: string,
  now: Date = new Date(),
): Promise<PhotoPreviewClaimResult> {
  return runExecutionQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.photoPreviewGeneration.findFirst({
        where: { id: generationId, ownerUserId },
        select: { id: true, status: true, startedAt: true, attemptCount: true },
      });
      if (!row) {
        return { outcome: "rejected", code: "NOT_FOUND" };
      }

      const eligible =
        row.status === "REQUESTED" ||
        (row.status === "PROCESSING" && row.startedAt !== null && isStaleProcessing(row.startedAt, now));
      if (!eligible) {
        return { outcome: "rejected", code: "NOT_ELIGIBLE" };
      }

      const nextAttemptNumber = row.attemptCount + 1;
      if (nextAttemptNumber > MAX_PROVIDER_ATTEMPTS_PER_GENERATION) {
        return { outcome: "rejected", code: "MAX_ATTEMPTS_EXCEEDED" };
      }

      const claimed = await tx.photoPreviewGeneration.updateMany({
        where: { id: row.id, ownerUserId, status: row.status },
        data: { status: "PROCESSING", startedAt: now, attemptCount: nextAttemptNumber },
      });
      if (claimed.count !== 1) {
        return { outcome: "rejected", code: "NOT_ELIGIBLE" };
      }

      return { outcome: "claimed", attemptNumber: nextAttemptNumber };
    }),
  );
}

export interface MarkPhotoPreviewGenerationCompletedInput {
  generatedImageAssetId: string;
  providerRequestId?: string | null;
}

// Legal only while the row is currently PROCESSING (guarded by the
// updateMany's own WHERE clause) -- storage must have ALREADY genuinely
// succeeded before this is ever called (task §18: a provider success
// followed by a storage failure must never reach this function).
export async function markPhotoPreviewGenerationCompleted(
  generationId: string,
  ownerUserId: string,
  input: MarkPhotoPreviewGenerationCompletedInput,
  now: Date = new Date(),
): Promise<void> {
  return runExecutionQuery(async () => {
    const claimed = await prisma.photoPreviewGeneration.updateMany({
      where: { id: generationId, ownerUserId, status: "PROCESSING" },
      data: {
        status: "COMPLETED",
        completedAt: now,
        generatedImageAssetId: input.generatedImageAssetId,
        providerRequestId: input.providerRequestId ?? null,
      },
    });
    if (claimed.count !== 1) {
      throw new PhotoPreviewExecutionStateError();
    }
  });
}

export interface MarkPhotoPreviewGenerationFailedInput {
  errorCode: string;
  errorMetadata?: Record<string, unknown> | null;
  // Decided by the CALLER (photo-preview-execution-service.ts), via
  // isPhotoPreviewFailureRetryable below -- kept as an explicit parameter
  // here rather than inferred solely from errorCode, because one code
  // (PHOTO_PREVIEW_PROVIDER_ERROR) is retryable or not depending on the
  // underlying provider error's own signal (e.g. a 5xx vs. a hard 4xx),
  // which only the caller has visibility into.
  retryable: boolean;
}

export interface MarkPhotoPreviewGenerationFailedResult {
  status: "REQUESTED" | "FAILED";
}

// Legal only while the row is currently PROCESSING. If `retryable` and the
// attempt cap (already spent by the claim that got us here) has not been
// reached, the row returns to REQUESTED -- eligible for a LATER claim, never
// an immediate in-process retry (task §21: automatic retry must never
// silently re-spend a paid call within the same call stack). Otherwise it
// becomes terminally FAILED.
export async function markPhotoPreviewGenerationFailed(
  generationId: string,
  ownerUserId: string,
  input: MarkPhotoPreviewGenerationFailedInput,
  now: Date = new Date(),
): Promise<MarkPhotoPreviewGenerationFailedResult> {
  return runExecutionQuery(async () => {
    const row = await prisma.photoPreviewGeneration.findFirst({
      where: { id: generationId, ownerUserId },
      select: { attemptCount: true },
    });
    if (!row) {
      throw new PhotoPreviewExecutionStateError();
    }

    const canRetry = input.retryable && row.attemptCount < MAX_PROVIDER_ATTEMPTS_PER_GENERATION;
    const nextStatus: MarkPhotoPreviewGenerationFailedResult["status"] = canRetry ? "REQUESTED" : "FAILED";

    const claimed = await prisma.photoPreviewGeneration.updateMany({
      where: { id: generationId, ownerUserId, status: "PROCESSING" },
      data: {
        status: nextStatus,
        failedAt: nextStatus === "FAILED" ? now : null,
        errorCode: input.errorCode,
        errorMetadata: (input.errorMetadata ?? null) as Prisma.InputJsonValue,
      },
    });
    if (claimed.count !== 1) {
      throw new PhotoPreviewExecutionStateError();
    }

    return { status: nextStatus };
  });
}

// ---------------------------------------------------------------------------
// Retry policy (task §21/§31) -- the ONE place a failure code is classified
// retryable or not. `providerErrorRetryable` (from PhotoPreviewProviderError
// .retryable, when the failure came from a provider call) overrides the
// static default for PHOTO_PREVIEW_PROVIDER_ERROR specifically; every other
// code's retryability never depends on it.
// ---------------------------------------------------------------------------

const RETRYABLE_FAILURE_CODES = new Set(["PHOTO_PREVIEW_PROVIDER_RATE_LIMITED", "PHOTO_PREVIEW_PROVIDER_TIMEOUT", "PHOTO_PREVIEW_PROVIDER_INVALID_RESPONSE"]);

const NON_RETRYABLE_FAILURE_CODES = new Set([
  "PHOTO_PREVIEW_PROVIDER_REFUSED",
  "PHOTO_PREVIEW_STORAGE_FAILED",
  "PHOTO_PREVIEW_SOURCE_UNAVAILABLE",
  "PHOTO_PREVIEW_CONFIGURATION_ERROR",
]);

export function isPhotoPreviewFailureRetryable(errorCode: string, providerErrorRetryable?: boolean): boolean {
  if (errorCode === "PHOTO_PREVIEW_PROVIDER_ERROR") {
    return providerErrorRetryable === true;
  }
  if (RETRYABLE_FAILURE_CODES.has(errorCode)) return true;
  if (NON_RETRYABLE_FAILURE_CODES.has(errorCode)) return false;
  // An unrecognized code is treated conservatively as non-retryable --
  // never automatically re-spend a paid call for a failure mode this
  // policy doesn't explicitly recognize.
  return false;
}

function isStaleProcessing(startedAt: Date, now: Date): boolean {
  return now.getTime() - startedAt.getTime() >= PHOTO_PREVIEW_STALE_PROCESSING_TIMEOUT_MS;
}

async function runExecutionQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new PhotoPreviewExecutionPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof PhotoPreviewExecutionPersistenceError || error instanceof PhotoPreviewExecutionStateError) {
      throw error;
    }
    throw new PhotoPreviewExecutionPersistenceError();
  }
}

async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new PhotoPreviewExecutionPersistenceError();
    }
  }
  throw new PhotoPreviewExecutionPersistenceError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}
