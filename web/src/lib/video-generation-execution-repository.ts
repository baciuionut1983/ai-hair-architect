import { Prisma } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { computeVideoDemonstrationNextPollDelayMs } from "@/lib/video-worker-policy";

// Real AI Video Demonstration, Stage 1 -- durable claim/submitted/
// completion/failure semantics. Mirrors photo-preview-execution-repository.ts's
// own atomic WHERE-guarded updateMany discipline exactly ("database
// atomicity, not process memory"), extended for a genuinely two-phase async
// job: claim-for-submit vs. mark-submitted are TWO separate, independently
// guarded writes (Photo Preview never needed this split -- its provider
// call is synchronous, claim and completion happen in the same call stack).
//
// The single most important invariant this file enforces (Video Stage 0
// Decision Lock, section 6/10; this stage's task §10/§12): once
// providerOperationId is durably persisted, NOTHING in this file ever lets
// a row be claimed for a FRESH submit again while that operation id is
// still present -- only polling (a read-only, free, idempotent-safe
// operation) is legal from that point until a terminal outcome is reached.

export const MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION = 2;

// Mirrors PHOTO_PREVIEW_STALE_PROCESSING_TIMEOUT_MS's own exact value and
// reasoning -- if a process crashes between claim and either submit or
// markSubmitted, the row is recoverable by a LATER claim attempt once this
// much time has passed, rather than being permanently stuck. Reused
// (Stage 2) as the identical staleness window for a crashed COMPLETION
// claim (see claimVideoDemonstrationGenerationForCompletionProcessing) --
// both are "did the last process handling this die mid-flight" recovery
// windows, and there is no reason for them to differ.
export const VIDEO_DEMONSTRATION_STALE_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

// Stage 2 hardening (task §3): the single highest-value retry in this file.
// By the time markVideoDemonstrationGenerationSubmitted is called, the
// provider has ALREADY accepted (and may already be billing for) the
// generation -- a transient failure recording that fact locally must be
// retried harder than an ordinary write, because giving up here risks the
// exact "provider accepted it, we lost track, and a later recovery path
// resubmits" scenario this whole file exists to prevent. Short, bounded
// backoff -- this call sits in the synchronous request path.
const MARK_SUBMITTED_RETRY_DELAYS_MS = [100, 300, 900];

const MAX_TRANSACTION_ATTEMPTS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VideoDemonstrationExecutionPersistenceError extends Error {
  readonly code = "VIDEO_DEMONSTRATION_EXECUTION_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Video Demonstration execution data is temporarily unavailable.");
    this.name = "VideoDemonstrationExecutionPersistenceError";
  }
}

export class VideoDemonstrationExecutionStateError extends Error {
  readonly code = "VIDEO_DEMONSTRATION_EXECUTION_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor() {
    super("Video Demonstration generation is not in a state that allows this transition.");
    this.name = "VideoDemonstrationExecutionStateError";
  }
}

export type VideoDemonstrationClaimRejectionCode = "NOT_FOUND" | "NOT_ELIGIBLE" | "MAX_ATTEMPTS_EXCEEDED";

export type VideoDemonstrationClaimResult =
  | { outcome: "claimed"; attemptNumber: number }
  | { outcome: "rejected"; code: VideoDemonstrationClaimRejectionCode };

/**
 * Atomically transitions exactly one eligible row to PROCESSING for exactly
 * one caller, for the purpose of a real SUBMIT attempt. Eligible means:
 * currently REQUESTED, OR currently PROCESSING with NO providerOperationId
 * yet AND stale (startedAt older than VIDEO_DEMONSTRATION_STALE_CLAIM_TIMEOUT_MS)
 * -- a row that already has a providerOperationId is NEVER eligible here,
 * regardless of staleness; it can only ever be polled (see
 * pollVideoDemonstrationGeneration below), never resubmitted.
 */
export async function claimVideoDemonstrationGenerationForSubmit(
  generationId: string,
  ownerUserId: string,
  now: Date = new Date(),
): Promise<VideoDemonstrationClaimResult> {
  return runExecutionQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.videoDemonstrationGeneration.findFirst({
        where: { id: generationId, ownerUserId },
        select: { id: true, status: true, startedAt: true, attemptCount: true, providerOperationId: true },
      });
      if (!row) {
        return { outcome: "rejected", code: "NOT_FOUND" };
      }

      const staleUnsubmittedClaim =
        row.status === "PROCESSING" && !row.providerOperationId && row.startedAt !== null && isStale(row.startedAt, now);
      const eligible = row.status === "REQUESTED" || staleUnsubmittedClaim;
      if (!eligible) {
        return { outcome: "rejected", code: "NOT_ELIGIBLE" };
      }

      const nextAttemptNumber = row.attemptCount + 1;
      if (nextAttemptNumber > MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION) {
        return { outcome: "rejected", code: "MAX_ATTEMPTS_EXCEEDED" };
      }

      const claimed = await tx.videoDemonstrationGeneration.updateMany({
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

/**
 * The single most important write in this file (see module header comment).
 * Legal ONLY while the row is PROCESSING with NO providerOperationId set
 * yet -- the WHERE clause's `providerOperationId: null` guard is what makes
 * this a true "set exactly once" operation: a second call for the same row
 * (e.g. a retried/duplicated code path) safely no-ops into a state error
 * rather than silently overwriting a real operation id with a different one.
 *
 * Stage 2 hardening (task §3): two layers protect the window between "the
 * provider accepted the generation" and "we durably recorded that fact".
 *
 * 1. A short, bounded retry (MARK_SUBMITTED_RETRY_DELAYS_MS) absorbs a
 *    transient connectivity blip -- the write is naturally safe to retry
 *    (the WHERE clause guard means a retry can never double-apply).
 * 2. If a retry attempt itself throws the "already set" state error, that
 *    is genuinely ambiguous -- it means EITHER a real conflict (a
 *    different caller/attempt already owns this row), OR our own PRIOR
 *    attempt in this exact retry loop actually landed at the database and
 *    we simply never received the confirmation before the connection blip.
 *    Re-reading the row and comparing providerOperationId resolves the
 *    ambiguity: if it already equals the value we were trying to set, our
 *    own earlier attempt already succeeded, and this is treated as
 *    success, not an error -- never a resubmission, never a lost record.
 *
 * The one residual risk this cannot close (documented, not eliminated):
 * total database unavailability spanning every retry AND the confirming
 * re-read. Veo's API offers no client-supplied idempotency/request id
 * (confirmed by inspecting GenerateVideosConfig's real type this stage),
 * so there is no provider-side mechanism to reconcile "did I already
 * submit this" after a total local persistence outage -- eliminating this
 * fully would require such a provider capability, which does not exist.
 */
export async function markVideoDemonstrationGenerationSubmitted(
  generationId: string,
  ownerUserId: string,
  providerOperationId: string,
  now: Date = new Date(),
): Promise<void> {
  for (let attempt = 0; attempt <= MARK_SUBMITTED_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await runExecutionQuery(async () => {
        const claimed = await prisma.videoDemonstrationGeneration.updateMany({
          where: { id: generationId, ownerUserId, status: "PROCESSING", providerOperationId: null },
          // completionClaimedAt is reset here too -- a stale value from an
          // earlier, already-failed/requeued attempt on this same row must
          // never suppress the completion claim for THIS fresh operation
          // (see the schema's own field comment). nextPollAt is seeded to
          // the first backoff tier (Stage 3, task §6) -- Veo's own
          // documented floor is 11 seconds, so an immediate sweep poll
          // right after submit would almost always just observe
          // done:false; seeding it avoids that one predictable wasted call.
          data: { providerOperationId, submittedAt: now, completionClaimedAt: null, nextPollAt: new Date(now.getTime() + computeVideoDemonstrationNextPollDelayMs(0)) },
        });
        if (claimed.count !== 1) {
          throw new VideoDemonstrationExecutionStateError();
        }
      });
      return;
    } catch (error) {
      if (error instanceof VideoDemonstrationExecutionStateError) {
        const reread = await prisma.videoDemonstrationGeneration
          .findFirst({ where: { id: generationId, ownerUserId }, select: { providerOperationId: true } })
          .catch(() => null);
        if (reread?.providerOperationId === providerOperationId) {
          return; // our own earlier attempt in this loop already succeeded
        }
        throw error; // a real conflict -- never retried
      }
      if (attempt === MARK_SUBMITTED_RETRY_DELAYS_MS.length) throw error;
      await delay(MARK_SUBMITTED_RETRY_DELAYS_MS[attempt]);
    }
  }
}

export type VideoDemonstrationCompletionClaimRejectionCode = "NOT_FOUND" | "NOT_ELIGIBLE";

export type VideoDemonstrationCompletionClaimResult =
  | { outcome: "claimed" }
  | { outcome: "rejected"; code: VideoDemonstrationCompletionClaimRejectionCode };

/**
 * Stage 2 hardening (task §4/§12): guards the "provider poll reported
 * done:true -> download the video, meter it, persist a VideoAsset, mark
 * COMPLETED" window against two callers racing the SAME already-submitted
 * operation (e.g. two near-simultaneous /execute requests, or a route
 * call overlapping a future scheduled poller). Without this, both callers
 * would independently download the same video, create two VideoAsset rows
 * (one silently orphaned, still costing real storage), and both attempt to
 * meter -- the AiUsageEvent idempotency key happens to dedupe THAT part,
 * but the duplicate download/storage/orphaned-row problem is real and is
 * what this claim actually exists to prevent.
 *
 * Legal ONLY for a row that is PROCESSING and already has a
 * providerOperationId (i.e. genuinely mid-poll, never mid-submit -- the
 * submit claim above is a completely separate lock). Eligible when
 * `completionClaimedAt` is null (never claimed) OR stale (the last claimant
 * crashed before reaching a terminal outcome) -- mirrors
 * claimVideoDemonstrationGenerationForSubmit's own stale-recovery shape,
 * reusing the same timeout constant.
 */
export async function claimVideoDemonstrationGenerationForCompletionProcessing(
  generationId: string,
  ownerUserId: string,
  now: Date = new Date(),
): Promise<VideoDemonstrationCompletionClaimResult> {
  return runExecutionQuery(async () => {
    const row = await prisma.videoDemonstrationGeneration.findFirst({
      where: { id: generationId, ownerUserId },
      select: { id: true, status: true, providerOperationId: true, completionClaimedAt: true },
    });
    if (!row) {
      return { outcome: "rejected", code: "NOT_FOUND" };
    }
    if (row.status !== "PROCESSING" || !row.providerOperationId) {
      return { outcome: "rejected", code: "NOT_ELIGIBLE" };
    }

    const eligible = row.completionClaimedAt === null || isStale(row.completionClaimedAt, now);
    if (!eligible) {
      return { outcome: "rejected", code: "NOT_ELIGIBLE" };
    }

    // Guarded by the EXACT previously-read value (null, or the specific
    // stale timestamp) -- a genuine optimistic-concurrency check. Postgres's
    // own row-level locking on this UPDATE is what makes this safe under a
    // real concurrent race, without needing a serializable transaction
    // wrapper (the WHERE clause itself is the atomicity boundary, same
    // reasoning as markVideoDemonstrationGenerationSubmitted's single
    // guarded update).
    const claimed = await prisma.videoDemonstrationGeneration.updateMany({
      where: { id: row.id, ownerUserId, status: "PROCESSING", completionClaimedAt: row.completionClaimedAt },
      data: { completionClaimedAt: now },
    });
    if (claimed.count !== 1) {
      return { outcome: "rejected", code: "NOT_ELIGIBLE" };
    }

    return { outcome: "claimed" };
  });
}

export interface MarkVideoDemonstrationGenerationCompletedInput {
  generatedVideoAssetId: string;
}

export async function markVideoDemonstrationGenerationCompleted(
  generationId: string,
  ownerUserId: string,
  input: MarkVideoDemonstrationGenerationCompletedInput,
  now: Date = new Date(),
): Promise<void> {
  return runExecutionQuery(async () => {
    const claimed = await prisma.videoDemonstrationGeneration.updateMany({
      where: { id: generationId, ownerUserId, status: "PROCESSING" },
      data: { status: "COMPLETED", completedAt: now, generatedVideoAssetId: input.generatedVideoAssetId },
    });
    if (claimed.count !== 1) {
      throw new VideoDemonstrationExecutionStateError();
    }
  });
}

export interface MarkVideoDemonstrationGenerationFailedInput {
  errorCode: string;
  errorMetadata?: Record<string, unknown> | null;
  retryable: boolean;
}

export interface MarkVideoDemonstrationGenerationFailedResult {
  status: "REQUESTED" | "FAILED";
}

/**
 * Legal only while the row is currently PROCESSING. Requeues to REQUESTED
 * (eligible for a LATER claim, never an immediate in-process retry) ONLY
 * when `retryable` AND the submit-attempt cap has not been reached AND --
 * critically -- providerOperationId is still null.
 *
 * Stage 3 correctness fix: Stage 1/2's own version of this function
 * requeued to REQUESTED whenever `retryable` was true, REGARDLESS of
 * whether providerOperationId was already set, reasoning that Veo's "only
 * charged if successfully generated" policy made this safe. That reasoning
 * is correct for a SUBMIT-phase failure (no operation was ever created --
 * nothing to duplicate) but WRONG for a POLL-phase failure: a retryable
 * poll error (a network hiccup, a transient 5xx checking status) tells us
 * NOTHING about whether the underlying operation succeeded or is still
 * genuinely running -- it is a failure to CHECK, not evidence the
 * generation failed. Requeuing such a row to REQUESTED would make it
 * eligible for claimVideoDemonstrationGenerationForSubmit again (which
 * only checks `status === REQUESTED`, never providerOperationId), and the
 * next execution would call provider.submit() a SECOND time while the
 * FIRST real operation might still be alive -- exactly the duplicate-paid-
 * generation risk this whole file exists to prevent.
 *
 * This function is therefore now the correct, safe choice ONLY for (a) any
 * non-retryable failure (always terminal FAILED, any phase) and (b) a
 * SUBMIT-phase retryable failure (providerOperationId still null -- safe
 * to requeue, nothing to duplicate). A RETRYABLE POLL-PHASE failure must
 * use markVideoDemonstrationGenerationForPollRetry instead (below), which
 * keeps the row PROCESSING and never makes it submit-claimable again. The
 * `providerOperationId === null` guard below makes this function safe by
 * construction even if a future caller mistakenly reaches it for a
 * retryable poll-phase failure -- it degrades to a safe terminal FAILED
 * rather than a resubmission risk.
 */
export async function markVideoDemonstrationGenerationFailed(
  generationId: string,
  ownerUserId: string,
  input: MarkVideoDemonstrationGenerationFailedInput,
  now: Date = new Date(),
): Promise<MarkVideoDemonstrationGenerationFailedResult> {
  return runExecutionQuery(async () => {
    const row = await prisma.videoDemonstrationGeneration.findFirst({
      where: { id: generationId, ownerUserId },
      select: { attemptCount: true, providerOperationId: true },
    });
    if (!row) {
      throw new VideoDemonstrationExecutionStateError();
    }

    const canRetry = input.retryable && row.attemptCount < MAX_PROVIDER_SUBMIT_ATTEMPTS_PER_GENERATION && row.providerOperationId === null;
    const nextStatus: MarkVideoDemonstrationGenerationFailedResult["status"] = canRetry ? "REQUESTED" : "FAILED";

    const claimed = await prisma.videoDemonstrationGeneration.updateMany({
      where: { id: generationId, ownerUserId, status: "PROCESSING" },
      data: {
        status: nextStatus,
        failedAt: nextStatus === "FAILED" ? now : null,
        errorCode: input.errorCode,
        errorMetadata: (input.errorMetadata ?? null) as Prisma.InputJsonValue,
      },
    });
    if (claimed.count !== 1) {
      throw new VideoDemonstrationExecutionStateError();
    }

    return { status: nextStatus };
  });
}

/**
 * Stage 3: reschedules the next poll attempt for a row that is genuinely
 * still active -- used for BOTH (a) an ordinary "still processing, no
 * error" poll result and (b) a RETRYABLE poll-phase failure (see the
 * extensive comment on markVideoDemonstrationGenerationFailed above for
 * why the latter must never route through that function instead). Never
 * touches status or attemptCount -- the row stays PROCESSING with its
 * existing providerOperationId untouched, so it remains permanently
 * ineligible for claimVideoDemonstrationGenerationForSubmit (which
 * requires providerOperationId to be null). completionClaimedAt is
 * defensively cleared too, even though this path should never be reached
 * after a completion claim was actually taken (done:true was never
 * observed here) -- cheap insurance against a future refactor.
 */
export async function scheduleVideoDemonstrationNextPoll(generationId: string, ownerUserId: string, nextPollAt: Date): Promise<void> {
  return runExecutionQuery(async () => {
    const claimed = await prisma.videoDemonstrationGeneration.updateMany({
      where: { id: generationId, ownerUserId, status: "PROCESSING", providerOperationId: { not: null } },
      data: { nextPollAt, completionClaimedAt: null },
    });
    if (claimed.count !== 1) {
      throw new VideoDemonstrationExecutionStateError();
    }
  });
}

export interface DueVideoDemonstrationGeneration {
  id: string;
  ownerUserId: string;
}

/**
 * Stage 3 -- the recovery worker's own "which rows need work right now"
 * query (task §4). A row is due when it is genuinely actionable by
 * executeVideoDemonstrationGeneration's own existing branching, in exactly
 * the three shapes that function already recognizes:
 *
 * 1. REQUESTED -- always due (a fresh submit attempt is always legal).
 * 2. PROCESSING with providerOperationId set, and either never polled
 *    before (nextPollAt null) or its scheduled backoff has elapsed.
 * 3. PROCESSING with NO providerOperationId, stale past
 *    VIDEO_DEMONSTRATION_STALE_CLAIM_TIMEOUT_MS -- a crashed claim,
 *    recoverable exactly like claimVideoDemonstrationGenerationForSubmit's
 *    own stale-claim branch already handles.
 *
 * Deliberately excludes COMPLETED/FAILED (terminal, never due) and a
 * fresh (non-stale) PROCESSING-without-operationId row (someone else is
 * actively mid-submit right now). Ordered oldest-request-first so the
 * sweep's own bounded `limit` never starves an old job behind a stream of
 * newer ones.
 */
export async function findDueVideoDemonstrationGenerationsForRecovery(now: Date, limit: number): Promise<DueVideoDemonstrationGeneration[]> {
  return runExecutionQuery(async () => {
    const staleClaimThreshold = new Date(now.getTime() - VIDEO_DEMONSTRATION_STALE_CLAIM_TIMEOUT_MS);
    const rows = await prisma.videoDemonstrationGeneration.findMany({
      where: {
        OR: [
          { status: "REQUESTED" },
          {
            AND: [
              { status: "PROCESSING" },
              { providerOperationId: { not: null } },
              { OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }] },
            ],
          },
          { AND: [{ status: "PROCESSING" }, { providerOperationId: null }, { startedAt: { lte: staleClaimThreshold } }] },
        ],
      },
      select: { id: true, ownerUserId: true },
      orderBy: [{ requestedAt: "asc" }],
      take: limit,
    });
    return rows;
  });
}

// ---------------------------------------------------------------------------
// Retry policy (mirrors isPhotoPreviewFailureRetryable's own single-source-
// of-truth discipline exactly).
// ---------------------------------------------------------------------------

const RETRYABLE_FAILURE_CODES = new Set(["VIDEO_DEMONSTRATION_PROVIDER_RATE_LIMITED", "VIDEO_DEMONSTRATION_PROVIDER_TIMEOUT", "VIDEO_DEMONSTRATION_PROVIDER_INVALID_RESPONSE"]);

const NON_RETRYABLE_FAILURE_CODES = new Set([
  "VIDEO_DEMONSTRATION_PROVIDER_REFUSED",
  "VIDEO_DEMONSTRATION_STORAGE_FAILED",
  "VIDEO_DEMONSTRATION_SOURCE_UNAVAILABLE",
  "VIDEO_DEMONSTRATION_CONFIGURATION_ERROR",
  "VIDEO_DEMONSTRATION_OPERATION_NOT_FOUND",
  // Stage 3 (task §7): a job PROCESSING far longer than Veo's own
  // documented maximum is treated as unrecoverable under THIS row --
  // never auto-resubmitted (see markVideoDemonstrationGenerationFailed's
  // own extensive comment on why providerOperationId must never be
  // silently reused). The user's/caller's retry path is creating a fresh
  // variation, never resurrecting this exact row.
  "VIDEO_DEMONSTRATION_PROCESSING_TIMEOUT",
]);

export function isVideoDemonstrationFailureRetryable(errorCode: string, providerErrorRetryable?: boolean): boolean {
  if (errorCode === "VIDEO_DEMONSTRATION_PROVIDER_ERROR") {
    return providerErrorRetryable === true;
  }
  if (RETRYABLE_FAILURE_CODES.has(errorCode)) return true;
  if (NON_RETRYABLE_FAILURE_CODES.has(errorCode)) return false;
  return false;
}

function isStale(startedAt: Date, now: Date): boolean {
  return now.getTime() - startedAt.getTime() >= VIDEO_DEMONSTRATION_STALE_CLAIM_TIMEOUT_MS;
}

async function runExecutionQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new VideoDemonstrationExecutionPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof VideoDemonstrationExecutionPersistenceError || error instanceof VideoDemonstrationExecutionStateError) {
      throw error;
    }
    throw new VideoDemonstrationExecutionPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new VideoDemonstrationExecutionPersistenceError();
    }
  }
  throw new VideoDemonstrationExecutionPersistenceError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}
