import { recordAiUsageEvent } from "@/lib/ai-usage-repository";
import {
  buildVideoDemonstrationUsageEventInput,
  findVideoDemonstrationGenerationForOwner,
  type VideoDemonstrationGenerationRecord,
} from "@/lib/video-generation-repository";
import {
  claimVideoDemonstrationGenerationForCompletionProcessing,
  claimVideoDemonstrationGenerationForSubmit,
  isVideoDemonstrationFailureRetryable,
  markVideoDemonstrationGenerationCompleted,
  markVideoDemonstrationGenerationFailed,
  markVideoDemonstrationGenerationSubmitted,
} from "@/lib/video-generation-execution-repository";
import { resolveVideoDemonstrationProviderConfig } from "@/lib/video-generation-provider-config";
import { VeoVideoDemonstrationProvider } from "@/lib/video-provider-veo";
import type { VideoDemonstrationProvider, VideoDemonstrationProviderError } from "@/lib/video-provider";
import { persistGeneratedVideoDemonstrationAsset, VideoAssetStorageError } from "@/lib/video-asset-storage";
import { ProcessingPreClaimError, loadValidatedImageBuffer, type AssetStorageRow } from "@/lib/image-analysis-processing-service";
import { createObjectStorageAliasResolver } from "@/lib/object-storage-alias-resolver";
import type { ObjectStorage } from "@/lib/object-storage";
import { prisma } from "@/lib/prisma";

// Real AI Video Demonstration, Stage 1 -- the execution orchestrator.
// Mirrors photo-preview-execution-service.ts's own dependency-injection
// shape exactly: every real dependency (provider construction, storage
// resolution, clock, usage recording) is injectable, defaulting to the real
// implementation -- this is what makes it possible to prove (this stage's
// own task §7/§13: "no paid test") that the test suite can NEVER reach a
// real Veo endpoint: every test constructs this function with an explicit
// fake `createProvider`, never the real default.
//
// Genuinely two-phase, unlike Photo Preview's single synchronous call
// (Video Stage 0 Decision Lock, section 5/6): a REQUESTED row is claimed
// and SUBMITTED (one real, billable provider call, whose result is a
// providerOperationId persisted atomically before anything else happens);
// a PROCESSING row that already has a providerOperationId is POLLED
// instead (free, read-only, idempotent-safe, never resubmitted). Both
// paths share the same call site (executeVideoDemonstrationGeneration) so
// callers (the API routes) never need to know which phase a given
// generation is in -- they just call this function again.

export type VideoDemonstrationExecutionResultCode =
  | "PROCESSING_DISABLED"
  | "PROVIDER_CONFIGURATION_INVALID"
  | "GENERATION_NOT_FOUND"
  | "GENERATION_ALREADY_TERMINAL"
  | "CLAIM_CONFLICT"
  | "MAX_ATTEMPTS_EXCEEDED"
  | "SOURCE_UNAVAILABLE"
  | "PROVIDER_REFUSED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "PROVIDER_INVALID_RESPONSE"
  | "OPERATION_NOT_FOUND"
  | "STORAGE_FAILED"
  | "PERSISTENCE_FAILURE"
  | "INTERNAL_EXECUTION_FAILURE";

// Stable, safe, never-leaks-a-secret application error codes -- the ONLY
// vocabulary ever persisted to VideoDemonstrationGeneration.errorCode.
export type VideoDemonstrationApplicationErrorCode =
  | "VIDEO_DEMONSTRATION_PROVIDER_REFUSED"
  | "VIDEO_DEMONSTRATION_PROVIDER_RATE_LIMITED"
  | "VIDEO_DEMONSTRATION_PROVIDER_TIMEOUT"
  | "VIDEO_DEMONSTRATION_PROVIDER_ERROR"
  | "VIDEO_DEMONSTRATION_PROVIDER_INVALID_RESPONSE"
  | "VIDEO_DEMONSTRATION_OPERATION_NOT_FOUND"
  | "VIDEO_DEMONSTRATION_STORAGE_FAILED"
  | "VIDEO_DEMONSTRATION_SOURCE_UNAVAILABLE"
  | "VIDEO_DEMONSTRATION_CONFIGURATION_ERROR";

export type VideoDemonstrationExecutionResult =
  | { outcome: "submitted"; generation: VideoDemonstrationGenerationRecord }
  | { outcome: "still_processing"; generation: VideoDemonstrationGenerationRecord }
  | { outcome: "completed"; generation: VideoDemonstrationGenerationRecord }
  | { outcome: "requeued_for_retry"; code: VideoDemonstrationExecutionResultCode }
  | { outcome: "failed"; code: VideoDemonstrationExecutionResultCode };

export interface ExecuteVideoDemonstrationGenerationDependencies {
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
  createProvider?: (config: { apiKey: string; model: string; timeoutMs?: number }) => VideoDemonstrationProvider;
  resolveObjectStorage?: (bucketAlias: string) => ObjectStorage | null | Promise<ObjectStorage | null>;
  recordAiUsageEvent?: typeof recordAiUsageEvent;
  persistGeneratedVideo?: typeof persistGeneratedVideoDemonstrationAsset;
  /** Test-only hook invoked immediately before the atomic claim. Never used by any route. */
  beforeClaim?: () => Promise<void>;
  /** Test-only hook invoked immediately before persisting a terminal outcome. Never used by any route. */
  beforePersist?: () => Promise<void>;
}

export async function executeVideoDemonstrationGeneration(
  generationId: string,
  ownerUserId: string,
  dependencies: ExecuteVideoDemonstrationGenerationDependencies = {},
): Promise<VideoDemonstrationExecutionResult> {
  const executionStartedAt = Date.now();
  const result = await runVideoDemonstrationExecution(generationId, ownerUserId, dependencies);
  logVideoDemonstrationExecution(generationId, ownerUserId, result, Date.now() - executionStartedAt);
  return result;
}

function logVideoDemonstrationExecution(generationId: string, ownerUserId: string, result: VideoDemonstrationExecutionResult, totalLatencyMs: number): void {
  const line = JSON.stringify({
    gate: "VIDEO_DEMONSTRATION_EXECUTION",
    generationId,
    ownerUserId,
    outcome: result.outcome,
    ...("code" in result ? { code: result.code } : {}),
    totalLatencyMs,
  });
  if (result.outcome === "failed") {
    console.error(line);
  } else {
    console.log(line);
  }
}

async function runVideoDemonstrationExecution(
  generationId: string,
  ownerUserId: string,
  dependencies: ExecuteVideoDemonstrationGenerationDependencies,
): Promise<VideoDemonstrationExecutionResult> {
  try {
    const now = dependencies.now ?? new Date();
    const env = dependencies.env ?? process.env;
    const resolveObjectStorage = dependencies.resolveObjectStorage ?? createObjectStorageAliasResolver();
    const createProvider = dependencies.createProvider ?? defaultCreateProvider;
    const recordUsage = dependencies.recordAiUsageEvent ?? recordAiUsageEvent;
    const persistVideo = dependencies.persistGeneratedVideo ?? persistGeneratedVideoDemonstrationAsset;

    const config = resolveVideoDemonstrationProviderConfig(env);
    if (config.status === "disabled") return failure("PROCESSING_DISABLED");
    if (config.status === "invalid") return failure("PROVIDER_CONFIGURATION_INVALID");

    const generation = await findVideoDemonstrationGenerationForOwner(ownerUserId, generationId);
    if (!generation) return failure("GENERATION_NOT_FOUND");
    if (generation.status === "COMPLETED" || generation.status === "FAILED") {
      return failure("GENERATION_ALREADY_TERMINAL");
    }

    // POLL path -- a providerOperationId already exists, meaning a real
    // submit already happened. Never resubmits, ever (module header
    // comment). This branch is reached without any claim step: polling is
    // free, read-only, and safe to run concurrently (the ONLY guarded write
    // is the eventual PROCESSING -> COMPLETED/FAILED transition below).
    if (generation.status === "PROCESSING" && generation.providerOperationId) {
      return pollExistingOperation({ generation, config, createProvider, resolveObjectStorage, recordUsage, persistVideo, now, dependencies });
    }

    // SUBMIT path -- REQUESTED, or a PROCESSING row that was claimed but
    // never reached a real submit (no providerOperationId yet). Both are
    // handled identically by the atomic claim below, which only accepts a
    // stale (crashed) unsubmitted PROCESSING row, never one with an
    // operation id already on file.
    if (dependencies.beforeClaim) await dependencies.beforeClaim();

    const claim = await claimVideoDemonstrationGenerationForSubmit(generationId, ownerUserId, now);
    if (claim.outcome === "rejected") {
      if (claim.code === "NOT_FOUND") return failure("GENERATION_NOT_FOUND");
      if (claim.code === "MAX_ATTEMPTS_EXCEEDED") return failure("MAX_ATTEMPTS_EXCEEDED");
      return failure("CLAIM_CONFLICT");
    }

    const attemptNumber = claim.attemptNumber;
    const usageCorrelationBase = { ownerUserId: generation.ownerUserId, clientId: generation.clientId, provider: generation.provider, model: generation.model, id: generation.id };

    let sourceBuffer: Buffer;
    let sourceMimeType: string;
    try {
      const loaded = await loadSourceImageBuffer(generation, resolveObjectStorage);
      sourceBuffer = loaded.buffer;
      sourceMimeType = loaded.mimeType;
    } catch {
      return finalizeFailure({ generationId, ownerUserId, now, dependencies, code: "VIDEO_DEMONSTRATION_SOURCE_UNAVAILABLE", retryable: false, resultCode: "SOURCE_UNAVAILABLE" });
    }

    const provider = createProvider({ apiKey: config.apiKey, model: generation.model, timeoutMs: config.timeoutMs });

    let submitOutcome: Awaited<ReturnType<VideoDemonstrationProvider["submit"]>>;
    const submitStartedAt = Date.now();
    try {
      submitOutcome = await provider.submit(generation.sealedRequest, { buffer: sourceBuffer, mimeType: sourceMimeType });
    } catch (error) {
      const { code, resultCode, retryable } = classifyProviderFailure(error);
      try {
        await recordUsage(buildVideoDemonstrationUsageEventInput(usageCorrelationBase, { outcome: "FAILED", attemptNumber, errorCategory: resultCode, latencyMs: Date.now() - submitStartedAt }));
      } catch {
        // Intentionally swallowed -- a metering problem must never turn an
        // already-failed submit into a DIFFERENT, worse failure.
      }
      return finalizeFailure({ generationId, ownerUserId, now, dependencies, code, retryable, resultCode });
    }

    if (dependencies.beforePersist) await dependencies.beforePersist();

    // THE CRITICAL CHECKPOINT (module header comment, this stage's own
    // task §10/§12): the provider now has a real, billable operation
    // running. This write must happen before anything else -- if the
    // process dies immediately after this line, recovery will correctly
    // find a PROCESSING row WITH a providerOperationId and poll it, never
    // resubmit.
    try {
      await markVideoDemonstrationGenerationSubmitted(generationId, ownerUserId, submitOutcome.providerOperationId, now);
    } catch {
      // The submit genuinely happened at the provider even though we
      // failed to record it -- this is the one honestly-acknowledged
      // residual risk this stage's own report documents (mirrors the
      // equivalent "Window D" already documented for Photo Preview's own
      // synchronous call in Stage 5's server-crash-window audit).
      return failure("PERSISTENCE_FAILURE");
    }

    // Deliberately NOT metered as SUCCEEDED here, unlike Photo Preview's own
    // synchronous "provider call returned -> metered" precedent: Google's
    // own documented Veo billing policy is "you are only charged if your
    // video is successfully generated" (video-generation-execution-repository.ts's
    // own module comment, cited from Stage 0's official-docs research) --
    // accepting a submit only means the operation STARTED, not that it was
    // billed. The SUCCEEDED usage event is recorded once the operation is
    // actually confirmed complete (pollExistingOperation below), which is
    // the first point real cost is known to have been incurred. A submit
    // that is later accepted but never completes (still PROCESSING forever,
    // or later fails/is refused on poll) correctly never gets a SUCCEEDED
    // usage event at all -- matching a real $0 charge.

    const updated = await findVideoDemonstrationGenerationForOwner(ownerUserId, generationId);
    if (!updated) return failure("PERSISTENCE_FAILURE");
    return { outcome: "submitted", generation: updated };
  } catch {
    return failure("INTERNAL_EXECUTION_FAILURE");
  }
}

interface PollExistingOperationInput {
  generation: VideoDemonstrationGenerationRecord;
  config: { status: "enabled"; apiKey: string; model: string; timeoutMs: number | undefined };
  createProvider: NonNullable<ExecuteVideoDemonstrationGenerationDependencies["createProvider"]>;
  resolveObjectStorage: NonNullable<ExecuteVideoDemonstrationGenerationDependencies["resolveObjectStorage"]>;
  recordUsage: NonNullable<ExecuteVideoDemonstrationGenerationDependencies["recordAiUsageEvent"]>;
  persistVideo: NonNullable<ExecuteVideoDemonstrationGenerationDependencies["persistGeneratedVideo"]>;
  now: Date;
  dependencies: ExecuteVideoDemonstrationGenerationDependencies;
}

async function pollExistingOperation(input: PollExistingOperationInput): Promise<VideoDemonstrationExecutionResult> {
  const { generation, config, createProvider, recordUsage, persistVideo, now, dependencies } = input;
  const provider = createProvider({ apiKey: config.apiKey, model: generation.model, timeoutMs: config.timeoutMs });
  const usageCorrelationBase = { ownerUserId: generation.ownerUserId, clientId: generation.clientId, provider: generation.provider, model: generation.model, id: generation.id };
  const pollStartedAt = Date.now();

  let pollResult: Awaited<ReturnType<VideoDemonstrationProvider["poll"]>>;
  try {
    pollResult = await provider.poll(generation.providerOperationId as string);
  } catch (error) {
    const { code, resultCode, retryable } = classifyProviderFailure(error);
    // A poll-detected terminal failure (e.g. a moderation block discovered
    // only once the provider finished evaluating the job) is metered here,
    // under the SAME attemptCount the submit that started this exact
    // operation was recorded under -- this is the one place a submit's
    // eventual real-world outcome is knowable, and per Veo's own billing
    // policy (this function's sibling comment in the submit branch above),
    // a failed/blocked generation was never charged, so FAILED here
    // correctly represents zero real cost, not a double-counted attempt.
    try {
      await recordUsage(buildVideoDemonstrationUsageEventInput(usageCorrelationBase, { outcome: "FAILED", attemptNumber: generation.attemptCount, errorCategory: resultCode, latencyMs: Date.now() - pollStartedAt }));
    } catch {
      // Intentionally swallowed -- a metering problem must never turn an
      // already-failed poll into a DIFFERENT, worse failure.
    }
    return finalizeFailure({ generationId: generation.id, ownerUserId: generation.ownerUserId, now, dependencies, code, retryable, resultCode });
  }

  if (!pollResult.done) {
    return { outcome: "still_processing", generation };
  }

  // Stage 2 hardening (task §4/§12): a SEPARATE atomic claim from the
  // submit claim -- guards the window between "provider reports done" and
  // "we finished downloading/metering/persisting/marking COMPLETED"
  // against two concurrent callers (e.g. two overlapping /execute
  // requests) both observing done:true for the same operation. A caller
  // that loses this race takes the safe, already-existing "still
  // processing" outcome -- from its own point of view, someone else is
  // already handling the completion, which is exactly true.
  if (dependencies.beforeClaim) await dependencies.beforeClaim();
  const completionClaim = await claimVideoDemonstrationGenerationForCompletionProcessing(generation.id, generation.ownerUserId, now);
  if (completionClaim.outcome === "rejected") {
    if (completionClaim.code === "NOT_FOUND") return failure("GENERATION_NOT_FOUND");
    return { outcome: "still_processing", generation };
  }

  if (dependencies.beforePersist) await dependencies.beforePersist();

  // The operation is now CONFIRMED complete -- per Veo's own documented
  // billing policy, this is the first point real cost is known to have
  // been incurred, so this is where the SUCCEEDED usage event belongs
  // (never at submit time -- see the submit branch's own comment).
  // Recorded BEFORE the storage attempt below, and unconditionally on the
  // outcome of that attempt: mirrors Photo Preview's own established
  // precedent (photo-preview-execution-service.ts's "provider success +
  // storage failure -> FAILED, never COMPLETED, but the successful
  // provider attempt is still metered") -- a real video WAS generated (and
  // billed) even if this application then fails to durably store it.
  try {
    await recordUsage(
      buildVideoDemonstrationUsageEventInput(usageCorrelationBase, {
        outcome: "SUCCEEDED",
        attemptNumber: generation.attemptCount,
        providerRequestId: generation.providerOperationId ?? undefined,
        ...(pollResult.durationSeconds !== undefined ? { usage: { videoSeconds: pollResult.durationSeconds } } : {}),
        latencyMs: Date.now() - pollStartedAt,
      }),
    );
  } catch {
    // Intentionally swallowed -- a metering problem must never block
    // persisting a real, successfully generated video.
  }

  let generatedAsset;
  try {
    generatedAsset = await persistVideo(generation.ownerUserId, generation.clientId, pollResult.videoBuffer, pollResult.mimeType, pollResult.durationSeconds);
  } catch (error) {
    const message = error instanceof VideoAssetStorageError ? error.message : "Storage failure.";
    return finalizeFailure({
      generationId: generation.id,
      ownerUserId: generation.ownerUserId,
      now,
      dependencies,
      code: "VIDEO_DEMONSTRATION_STORAGE_FAILED",
      retryable: false,
      resultCode: "STORAGE_FAILED",
      errorMetadata: { message },
    });
  }

  try {
    await markVideoDemonstrationGenerationCompleted(generation.id, generation.ownerUserId, { generatedVideoAssetId: generatedAsset.id }, now);
  } catch {
    return failure("PERSISTENCE_FAILURE");
  }

  const updated = await findVideoDemonstrationGenerationForOwner(generation.ownerUserId, generation.id);
  if (!updated) return failure("PERSISTENCE_FAILURE");
  return { outcome: "completed", generation: updated };
}

interface FinalizeFailureInput {
  generationId: string;
  ownerUserId: string;
  now: Date;
  dependencies: ExecuteVideoDemonstrationGenerationDependencies;
  code: VideoDemonstrationApplicationErrorCode;
  retryable: boolean;
  resultCode: VideoDemonstrationExecutionResultCode;
  errorMetadata?: Record<string, unknown> | null;
}

async function finalizeFailure(input: FinalizeFailureInput): Promise<VideoDemonstrationExecutionResult> {
  if (input.dependencies.beforePersist) await input.dependencies.beforePersist();
  try {
    const marked = await markVideoDemonstrationGenerationFailed(input.generationId, input.ownerUserId, { errorCode: input.code, errorMetadata: input.errorMetadata ?? null, retryable: input.retryable }, input.now);
    return marked.status === "REQUESTED" ? { outcome: "requeued_for_retry", code: input.resultCode } : failure(input.resultCode);
  } catch {
    return failure("PERSISTENCE_FAILURE");
  }
}

async function loadSourceImageBuffer(
  generation: VideoDemonstrationGenerationRecord,
  resolveObjectStorage: (bucketAlias: string) => ObjectStorage | null | Promise<ObjectStorage | null>,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const asset = await prisma.imageAsset.findFirst({ where: { id: generation.sourceGeneratedImageAssetId, ownerUserId: generation.ownerUserId, deletedAt: null } });
  if (!asset) {
    throw new ProcessingPreClaimError("IMAGE_UNAVAILABLE");
  }

  if (generation.frozenSourceContentSha256 && asset.contentSha256 && generation.frozenSourceContentSha256 !== asset.contentSha256) {
    throw new ProcessingPreClaimError("IMAGE_UNAVAILABLE");
  }

  const row: AssetStorageRow = {
    id: asset.id,
    ownerUserId: asset.ownerUserId,
    clientId: asset.clientId,
    mimeType: asset.mimeType,
    storageBackend: asset.storageBackend,
    storagePath: asset.storagePath,
    storageState: asset.storageState,
    contentSha256: asset.contentSha256,
  };
  const buffer = await loadValidatedImageBuffer(row, resolveObjectStorage);
  return { buffer, mimeType: asset.mimeType };
}

function defaultCreateProvider(config: { apiKey: string; model: string; timeoutMs?: number }): VideoDemonstrationProvider {
  return new VeoVideoDemonstrationProvider(config);
}

function classifyProviderFailure(error: unknown): { code: VideoDemonstrationApplicationErrorCode; resultCode: VideoDemonstrationExecutionResultCode; retryable: boolean } {
  const providerError = error as Partial<VideoDemonstrationProviderError>;
  switch (providerError?.code) {
    case "TIMEOUT":
      return { code: "VIDEO_DEMONSTRATION_PROVIDER_TIMEOUT", resultCode: "PROVIDER_TIMEOUT", retryable: isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_TIMEOUT") };
    case "RATE_LIMITED":
      return { code: "VIDEO_DEMONSTRATION_PROVIDER_RATE_LIMITED", resultCode: "PROVIDER_RATE_LIMITED", retryable: isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_RATE_LIMITED") };
    case "NOT_CONFIGURED":
      return { code: "VIDEO_DEMONSTRATION_CONFIGURATION_ERROR", resultCode: "PROVIDER_CONFIGURATION_INVALID", retryable: false };
    case "MODERATION_REFUSED":
      return { code: "VIDEO_DEMONSTRATION_PROVIDER_REFUSED", resultCode: "PROVIDER_REFUSED", retryable: false };
    case "INVALID_RESPONSE":
      return { code: "VIDEO_DEMONSTRATION_PROVIDER_INVALID_RESPONSE", resultCode: "PROVIDER_INVALID_RESPONSE", retryable: isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_INVALID_RESPONSE") };
    case "OPERATION_NOT_FOUND":
      return { code: "VIDEO_DEMONSTRATION_OPERATION_NOT_FOUND", resultCode: "OPERATION_NOT_FOUND", retryable: false };
    case "INVALID_SOURCE_IMAGE":
      // Reserved by the provider-error vocabulary (video-provider.ts) but
      // not currently thrown by the Veo adapter -- handled explicitly
      // rather than falling through to the generic PROVIDER_ERROR default,
      // so a future adapter that does throw it is classified correctly
      // without touching this switch.
      return { code: "VIDEO_DEMONSTRATION_SOURCE_UNAVAILABLE", resultCode: "SOURCE_UNAVAILABLE", retryable: false };
    case "PROVIDER_ERROR": {
      const retryable = providerError.retryable === true;
      return { code: "VIDEO_DEMONSTRATION_PROVIDER_ERROR", resultCode: "PROVIDER_ERROR", retryable: isVideoDemonstrationFailureRetryable("VIDEO_DEMONSTRATION_PROVIDER_ERROR", retryable) };
    }
    default:
      return { code: "VIDEO_DEMONSTRATION_PROVIDER_ERROR", resultCode: "PROVIDER_ERROR", retryable: false };
  }
}

function failure(code: VideoDemonstrationExecutionResultCode): VideoDemonstrationExecutionResult {
  return { outcome: "failed", code };
}
