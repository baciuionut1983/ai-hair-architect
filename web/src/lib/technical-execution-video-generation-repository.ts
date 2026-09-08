import { createHash, randomUUID } from "crypto";

import { Prisma, type TechnicalExecutionVideoGeneration as PrismaRow } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { computeVideoDemonstrationNextPollDelayMs } from "@/lib/video-worker-policy";

// AI Hair Architect, Stage 2.5.i.23 -- TECHNICAL EXECUTION VIDEO, CONCRETE
// PROVIDER INTEGRATION, durable domain/repository layer. Mirrors
// video-generation-repository.ts + video-generation-execution-repository.ts's
// own conventions exactly (task Section 12: "reuse the proven
// REQUESTED->PROCESSING->COMPLETED/FAILED pattern... reuse the existing
// providerOperationId pattern from Result Video if safe") -- the runXQuery
// fail-closed wrapper, the runSerializableTransaction retry-on-conflict
// helper, the atomic WHERE-guarded updateMany claim/complete discipline,
// and the DB-level requestFingerprint idempotency backstop are all reused
// UNCHANGED IN SHAPE, on this entirely separate model.
//
// NEVER professional/technique authority, NEVER a provider call, NEVER
// consent/qualification logic of its own -- this file only persists an
// already-fully-resolved (serializer output + i.22-verified READY gate)
// generation attempt and its own state machine. The i.22 readiness gate
// itself is verified by the CALLER (technical-execution-video-generation-execution-service.ts)
// via getTechnicalExecutionGenerationReadiness, never re-implemented here.

export const MAX_TECHNICAL_EXECUTION_VIDEO_SUBMIT_ATTEMPTS = 2;
// Identical precedent and value to VIDEO_DEMONSTRATION_STALE_CLAIM_TIMEOUT_MS.
export const TECHNICAL_EXECUTION_VIDEO_STALE_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

const MAX_TRANSACTION_ATTEMPTS = 3;

export class TechnicalExecutionVideoGenerationPersistenceError extends Error {
  readonly code = "TECHNICAL_EXECUTION_VIDEO_GENERATION_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Technical Execution Video generation data is temporarily unavailable.");
    this.name = "TechnicalExecutionVideoGenerationPersistenceError";
  }
}

export class TechnicalExecutionVideoGenerationDependencyError extends Error {
  constructor(
    readonly code: "TECHNICAL_EXECUTION_VIDEO_GENERATION_REQUEST_NOT_FOUND" | "TECHNICAL_EXECUTION_VIDEO_GENERATION_REQUEST_NOT_READY",
    readonly httpStatus: 404 | 422,
    message: string,
  ) {
    super(message);
    this.name = "TechnicalExecutionVideoGenerationDependencyError";
  }
}

export class TechnicalExecutionVideoGenerationStateError extends Error {
  readonly code = "TECHNICAL_EXECUTION_VIDEO_GENERATION_ILLEGAL_STATE_TRANSITION";
  readonly httpStatus = 409;

  constructor() {
    super("Technical Execution Video generation is not in a state that allows this transition.");
    this.name = "TechnicalExecutionVideoGenerationStateError";
  }
}

export class TechnicalExecutionVideoGenerationConcurrencyError extends Error {
  readonly code = "TECHNICAL_EXECUTION_VIDEO_GENERATION_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Technical Execution Video generation could not be created because of a concurrent conflict. Please try again.");
    this.name = "TechnicalExecutionVideoGenerationConcurrencyError";
  }
}

export type TechnicalExecutionVideoGenerationStatus = "REQUESTED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface TechnicalExecutionVideoGenerationRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  technicalExecutionGenerationRequestId: string;
  provider: string;
  model: string;
  providerInstruction: string;
  requestFingerprint: string;
  status: TechnicalExecutionVideoGenerationStatus;
  attemptCount: number;
  providerOperationId: string | null;
  generatedVideoAssetId: string | null;
  completionClaimedAt: string | null;
  nextPollAt: string | null;
  errorCode: string | null;
  errorMetadata: Record<string, unknown> | null;
  requestedAt: string;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTechnicalExecutionVideoGenerationOutcome {
  record: TechnicalExecutionVideoGenerationRecord;
  created: boolean;
}

export function computeTechnicalExecutionVideoGenerationRequestFingerprint(input: {
  ownerUserId: string;
  clientId: string;
  technicalExecutionGenerationRequestId: string;
  provider: string;
  model: string;
}): string {
  const canonical = [input.ownerUserId, input.clientId, input.technicalExecutionGenerationRequestId, input.provider, input.model].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// createTechnicalExecutionVideoGeneration
// ---------------------------------------------------------------------------

// Creates a new generation row bound to exactly one already-sealed
// TechnicalExecutionGenerationRequest id + one already-assembled provider
// instruction string. This function does NOT verify i.22 readiness itself
// (task's own "Provider Adapter/serializer never creates consent/
// qualification" boundary, extended here) -- the caller (the execution
// service) must have already confirmed READY before calling this. Fresh
// requestFingerprint pre-check-then-insert, identical precedent to
// video-generation-repository.ts's own createOrResolveExisting.
export async function createTechnicalExecutionVideoGeneration(input: {
  ownerUserId: string;
  clientId: string;
  technicalExecutionGenerationRequestId: string;
  provider: string;
  model: string;
  providerInstruction: string;
}): Promise<CreateTechnicalExecutionVideoGenerationOutcome> {
  const requestFingerprint = computeTechnicalExecutionVideoGenerationRequestFingerprint(input);

  return runQuery(() =>
    runSerializableTransaction(async (tx) => {
      const existing = await tx.technicalExecutionVideoGeneration.findFirst({ where: { requestFingerprint } });
      if (existing) {
        return { record: toRecord(existing), created: false };
      }

      const row = await tx.technicalExecutionVideoGeneration.create({
        data: {
          id: randomUUID(),
          ownerUserId: input.ownerUserId,
          clientId: input.clientId,
          technicalExecutionGenerationRequestId: input.technicalExecutionGenerationRequestId,
          provider: input.provider,
          model: input.model,
          providerInstruction: input.providerInstruction,
          requestFingerprint,
          status: "REQUESTED",
        },
      });
      return { record: toRecord(row), created: true };
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findTechnicalExecutionVideoGenerationForOwner(ownerUserId: string, id: string): Promise<TechnicalExecutionVideoGenerationRecord | null> {
  return runQuery(async () => {
    const row = await prisma.technicalExecutionVideoGeneration.findFirst({ where: { id, ownerUserId } });
    return row ? toRecord(row) : null;
  });
}

// ---------------------------------------------------------------------------
// State machine -- identical shape to video-generation-execution-repository.ts.
// ---------------------------------------------------------------------------

export type TechnicalExecutionVideoClaimRejectionCode = "NOT_FOUND" | "NOT_ELIGIBLE" | "MAX_ATTEMPTS_EXCEEDED";
export type TechnicalExecutionVideoClaimResult = { outcome: "claimed"; attemptNumber: number } | { outcome: "rejected"; code: TechnicalExecutionVideoClaimRejectionCode };

export async function claimTechnicalExecutionVideoGenerationForSubmit(id: string, ownerUserId: string, now: Date = new Date()): Promise<TechnicalExecutionVideoClaimResult> {
  return runQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.technicalExecutionVideoGeneration.findFirst({
        where: { id, ownerUserId },
        select: { id: true, status: true, startedAt: true, attemptCount: true, providerOperationId: true },
      });
      if (!row) return { outcome: "rejected", code: "NOT_FOUND" };

      const staleUnsubmittedClaim = row.status === "PROCESSING" && !row.providerOperationId && row.startedAt !== null && isStale(row.startedAt, now);
      const eligible = row.status === "REQUESTED" || staleUnsubmittedClaim;
      if (!eligible) return { outcome: "rejected", code: "NOT_ELIGIBLE" };

      const nextAttemptNumber = row.attemptCount + 1;
      if (nextAttemptNumber > MAX_TECHNICAL_EXECUTION_VIDEO_SUBMIT_ATTEMPTS) {
        return { outcome: "rejected", code: "MAX_ATTEMPTS_EXCEEDED" };
      }

      const claimed = await tx.technicalExecutionVideoGeneration.updateMany({
        where: { id: row.id, ownerUserId, status: row.status },
        data: { status: "PROCESSING", startedAt: now, attemptCount: nextAttemptNumber },
      });
      if (claimed.count !== 1) return { outcome: "rejected", code: "NOT_ELIGIBLE" };

      return { outcome: "claimed", attemptNumber: nextAttemptNumber };
    }),
  );
}

// Legal ONLY while PROCESSING with providerOperationId still null -- a true
// "set exactly once" write, identical precedent to
// markVideoDemonstrationGenerationSubmitted (short retry omitted here: this
// pilot's own task Section 15 runs exactly one real submit under direct
// operator observation, not an unattended background worker, so the extra
// retry/reconciliation machinery that precedent adds for unattended
// recovery is not reproduced -- a single retryable write is enough for a
// directly-observed pilot call, and the WHERE-guarded write is still safe
// for any retry a caller wants to layer on top, by construction).
export async function markTechnicalExecutionVideoGenerationSubmitted(id: string, ownerUserId: string, providerOperationId: string, now: Date = new Date()): Promise<void> {
  return runQuery(async () => {
    const claimed = await prisma.technicalExecutionVideoGeneration.updateMany({
      where: { id, ownerUserId, status: "PROCESSING", providerOperationId: null },
      data: { providerOperationId, submittedAt: now, completionClaimedAt: null, nextPollAt: new Date(now.getTime() + computeVideoDemonstrationNextPollDelayMs(0)) },
    });
    if (claimed.count !== 1) throw new TechnicalExecutionVideoGenerationStateError();
  });
}

export type TechnicalExecutionVideoCompletionClaimRejectionCode = "NOT_FOUND" | "NOT_ELIGIBLE";
export type TechnicalExecutionVideoCompletionClaimResult = { outcome: "claimed" } | { outcome: "rejected"; code: TechnicalExecutionVideoCompletionClaimRejectionCode };

export async function claimTechnicalExecutionVideoGenerationForCompletionProcessing(
  id: string,
  ownerUserId: string,
  now: Date = new Date(),
): Promise<TechnicalExecutionVideoCompletionClaimResult> {
  return runQuery(async () => {
    const row = await prisma.technicalExecutionVideoGeneration.findFirst({
      where: { id, ownerUserId },
      select: { id: true, status: true, providerOperationId: true, completionClaimedAt: true },
    });
    if (!row) return { outcome: "rejected", code: "NOT_FOUND" };
    if (row.status !== "PROCESSING" || !row.providerOperationId) return { outcome: "rejected", code: "NOT_ELIGIBLE" };

    const eligible = row.completionClaimedAt === null || isStale(row.completionClaimedAt, now);
    if (!eligible) return { outcome: "rejected", code: "NOT_ELIGIBLE" };

    const claimed = await prisma.technicalExecutionVideoGeneration.updateMany({
      where: { id: row.id, ownerUserId, status: "PROCESSING", completionClaimedAt: row.completionClaimedAt },
      data: { completionClaimedAt: now },
    });
    if (claimed.count !== 1) return { outcome: "rejected", code: "NOT_ELIGIBLE" };

    return { outcome: "claimed" };
  });
}

export async function markTechnicalExecutionVideoGenerationCompleted(id: string, ownerUserId: string, generatedVideoAssetId: string, now: Date = new Date()): Promise<void> {
  return runQuery(async () => {
    const claimed = await prisma.technicalExecutionVideoGeneration.updateMany({
      where: { id, ownerUserId, status: "PROCESSING" },
      data: { status: "COMPLETED", completedAt: now, generatedVideoAssetId },
    });
    if (claimed.count !== 1) throw new TechnicalExecutionVideoGenerationStateError();
  });
}

export interface MarkTechnicalExecutionVideoGenerationFailedInput {
  errorCode: string;
  errorMetadata?: Record<string, unknown> | null;
  retryable: boolean;
}
export interface MarkTechnicalExecutionVideoGenerationFailedResult {
  status: "REQUESTED" | "FAILED";
}

// Identical precedent and reasoning to markVideoDemonstrationGenerationFailed
// (video-generation-execution-repository.ts's own extensive comment): only
// requeues to REQUESTED when retryable AND the attempt cap has not been
// reached AND providerOperationId is still null (a submit-phase failure --
// nothing to duplicate). A retryable POLL-phase failure must instead use
// rescheduleTechnicalExecutionVideoGenerationPoll below, never this
// function -- the `providerOperationId === null` guard makes this function
// safe by construction even if a future caller reaches it mistakenly.
export async function markTechnicalExecutionVideoGenerationFailed(
  id: string,
  ownerUserId: string,
  input: MarkTechnicalExecutionVideoGenerationFailedInput,
  now: Date = new Date(),
): Promise<MarkTechnicalExecutionVideoGenerationFailedResult> {
  return runQuery(async () => {
    const row = await prisma.technicalExecutionVideoGeneration.findFirst({ where: { id, ownerUserId }, select: { attemptCount: true, providerOperationId: true } });
    if (!row) throw new TechnicalExecutionVideoGenerationStateError();

    const canRetry = input.retryable && row.attemptCount < MAX_TECHNICAL_EXECUTION_VIDEO_SUBMIT_ATTEMPTS && row.providerOperationId === null;
    const nextStatus: MarkTechnicalExecutionVideoGenerationFailedResult["status"] = canRetry ? "REQUESTED" : "FAILED";

    const claimed = await prisma.technicalExecutionVideoGeneration.updateMany({
      where: { id, ownerUserId, status: "PROCESSING" },
      data: {
        status: nextStatus,
        failedAt: nextStatus === "FAILED" ? now : null,
        errorCode: input.errorCode,
        errorMetadata: (input.errorMetadata ?? null) as Prisma.InputJsonValue,
      },
    });
    if (claimed.count !== 1) throw new TechnicalExecutionVideoGenerationStateError();

    return { status: nextStatus };
  });
}

export async function rescheduleTechnicalExecutionVideoGenerationPoll(id: string, ownerUserId: string, nextPollAt: Date): Promise<void> {
  return runQuery(async () => {
    const claimed = await prisma.technicalExecutionVideoGeneration.updateMany({
      where: { id, ownerUserId, status: "PROCESSING", providerOperationId: { not: null } },
      data: { nextPollAt, completionClaimedAt: null },
    });
    if (claimed.count !== 1) throw new TechnicalExecutionVideoGenerationStateError();
  });
}

const RETRYABLE_FAILURE_CODES = new Set(["TECHNICAL_EXECUTION_VIDEO_PROVIDER_RATE_LIMITED", "TECHNICAL_EXECUTION_VIDEO_PROVIDER_TIMEOUT", "TECHNICAL_EXECUTION_VIDEO_PROVIDER_INVALID_RESPONSE"]);
const NON_RETRYABLE_FAILURE_CODES = new Set([
  "TECHNICAL_EXECUTION_VIDEO_PROVIDER_REFUSED",
  "TECHNICAL_EXECUTION_VIDEO_STORAGE_FAILED",
  "TECHNICAL_EXECUTION_VIDEO_SOURCE_UNAVAILABLE",
  "TECHNICAL_EXECUTION_VIDEO_CONFIGURATION_ERROR",
  "TECHNICAL_EXECUTION_VIDEO_OPERATION_NOT_FOUND",
]);

export function isTechnicalExecutionVideoFailureRetryable(errorCode: string, providerErrorRetryable?: boolean): boolean {
  if (errorCode === "TECHNICAL_EXECUTION_VIDEO_PROVIDER_ERROR") return providerErrorRetryable === true;
  if (RETRYABLE_FAILURE_CODES.has(errorCode)) return true;
  if (NON_RETRYABLE_FAILURE_CODES.has(errorCode)) return false;
  return false;
}

function isStale(startedAt: Date, now: Date): boolean {
  return now.getTime() - startedAt.getTime() >= TECHNICAL_EXECUTION_VIDEO_STALE_CLAIM_TIMEOUT_MS;
}

async function runQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new TechnicalExecutionVideoGenerationPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof TechnicalExecutionVideoGenerationPersistenceError ||
      error instanceof TechnicalExecutionVideoGenerationDependencyError ||
      error instanceof TechnicalExecutionVideoGenerationStateError ||
      error instanceof TechnicalExecutionVideoGenerationConcurrencyError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new TechnicalExecutionVideoGenerationDependencyError("TECHNICAL_EXECUTION_VIDEO_GENERATION_REQUEST_NOT_FOUND", 404, "Technical Execution Video generation dependencies changed.");
    }
    throw new TechnicalExecutionVideoGenerationPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new TechnicalExecutionVideoGenerationConcurrencyError();
    }
  }
  throw new TechnicalExecutionVideoGenerationConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return true;
    if (error.code === "P2002" && hitsFingerprintUniqueIndex(error)) return true;
    return false;
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function hitsFingerprintUniqueIndex(error: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = (error.meta ?? {}) as Record<string, unknown>;
  const target = meta.target;
  const targetText = typeof target === "string" ? target : Array.isArray(target) ? target.filter((entry): entry is string => typeof entry === "string").join(",") : "";
  return targetText.toLowerCase().includes("requestfingerprint");
}

function toRecord(row: PrismaRow): TechnicalExecutionVideoGenerationRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    technicalExecutionGenerationRequestId: row.technicalExecutionGenerationRequestId,
    provider: row.provider,
    model: row.model,
    providerInstruction: row.providerInstruction,
    requestFingerprint: row.requestFingerprint,
    status: row.status as TechnicalExecutionVideoGenerationStatus,
    attemptCount: row.attemptCount,
    providerOperationId: row.providerOperationId,
    generatedVideoAssetId: row.generatedVideoAssetId,
    completionClaimedAt: row.completionClaimedAt ? row.completionClaimedAt.toISOString() : null,
    nextPollAt: row.nextPollAt ? row.nextPollAt.toISOString() : null,
    errorCode: row.errorCode,
    errorMetadata: row.errorMetadata as Record<string, unknown> | null,
    requestedAt: row.requestedAt.toISOString(),
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    failedAt: row.failedAt ? row.failedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
