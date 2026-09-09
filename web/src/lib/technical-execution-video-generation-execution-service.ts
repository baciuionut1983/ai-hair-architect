import { recordAiUsageEvent } from "@/lib/ai-usage-repository";
import { getTechnicalExecutionGenerationReadiness, findTechnicalExecutionGenerationRequestForOwner } from "@/lib/technical-execution-generation-repository";
import { compileEstablishCentralNapeGuideProviderAdapterOutput } from "@/lib/cutting-skill-establish-central-nape-guide-provider-request";
import { assembleTechnicalExecutionVeoInstruction, type TechnicalExecutionVeoDemonstrationHints } from "@/lib/technical-execution-video-veo-serializer";
import type { ProviderAdapterVisualReference, AuthorizationPreconditionStatus, VisualReferenceQualificationStatus } from "@/lib/professional-skill-provider-adapter-contracts";
import type { ProviderAdapterTranslationResult } from "@/lib/cutting-skill-provider-adapter-compiler";
import {
  claimTechnicalExecutionVideoGenerationForCompletionProcessing,
  claimTechnicalExecutionVideoGenerationForSubmit,
  createTechnicalExecutionVideoGeneration,
  findTechnicalExecutionVideoGenerationForOwner,
  isTechnicalExecutionVideoFailureRetryable,
  markTechnicalExecutionVideoGenerationCompleted,
  markTechnicalExecutionVideoGenerationFailed,
  markTechnicalExecutionVideoGenerationSubmitted,
  rescheduleTechnicalExecutionVideoGenerationPoll,
  type TechnicalExecutionVideoGenerationRecord,
} from "@/lib/technical-execution-video-generation-repository";
import { resolveVideoDemonstrationProviderConfig } from "@/lib/video-generation-provider-config";
import { TechnicalExecutionVeoProvider } from "@/lib/technical-execution-video-veo-provider";
import type { VideoDemonstrationProviderError } from "@/lib/video-provider";
import { persistGeneratedVideoDemonstrationAsset, VideoAssetStorageError } from "@/lib/video-asset-storage";
import { ProcessingPreClaimError, loadValidatedImageBuffer, type AssetStorageRow } from "@/lib/image-analysis-processing-service";
import { createObjectStorageAliasResolver } from "@/lib/object-storage-alias-resolver";
import type { ObjectStorage } from "@/lib/object-storage";
import { computeVideoDemonstrationNextPollDelayMs, isVideoDemonstrationProcessingStale } from "@/lib/video-worker-policy";
import { prisma } from "@/lib/prisma";

// AI Hair Architect, Stage 2.5.i.23 -- TECHNICAL EXECUTION VIDEO, CONCRETE
// PROVIDER INTEGRATION, execution orchestrator. Mirrors
// video-generation-execution-service.ts's own dependency-injection shape
// exactly (task's own precedent): every real dependency (provider
// construction, storage resolution, clock, usage recording) is injectable,
// defaulting to the real implementation -- no test in this codebase ever
// reaches the real (default) provider construction path.
//
// THE GATE (task Section 7): before ANY provider call, the i.22 readiness
// gate (getTechnicalExecutionGenerationReadiness) is re-verified FRESH,
// every single call -- never cached, never trusted from a prior call. Any
// status other than exactly READY is fail-closed BLOCKED, zero provider
// request. This is the ONLY consent/quality decision this file ever makes:
// it consumes the i.22 gate's own verdict, never re-derives or overrides it.
//
// SINGLE PROVIDER REQUEST (task Section 2/6): the real Central Nape Guide
// chain is compiled into exactly ONE ProviderAdapterTranslationOutput
// (cutting-skill-establish-central-nape-guide-provider-request.ts), then
// serialized into exactly ONE instruction string
// (technical-execution-video-veo-serializer.ts) -- there is no code path
// here capable of splitting this into multiple provider calls, and the
// EXACT image bound to the sealed request (never re-selected, never
// swapped) is the only image ever sent.
//
// REUSED, PROVEN INFRASTRUCTURE, NEVER RESULT VIDEO'S OWN SEMANTICS: the
// provider config resolver (resolveVideoDemonstrationProviderConfig -- the
// SAME already-operator-configured provider/model, task Section 3's own
// "must use the already-configured provider/model unless genuinely
// incompatible" -- image+instruction shape here is identical to Result
// Video's own, so no incompatibility exists), the image-byte loading path
// (loadValidatedImageBuffer), the video-asset durable storage path
// (persistGeneratedVideoDemonstrationAsset), and the polling-cadence policy
// (video-worker-policy.ts) are all reused UNCHANGED. Never imports
// video-generation-instruction-assembler.ts, video-generation-contracts.ts,
// or video-generation-repository.ts/-execution-repository.ts -- those carry
// Result Video's own semantics and state, entirely separate from this file's
// own technical-execution-video-generation-repository.ts.

export type TechnicalExecutionVideoExecutionResultCode =
  | "NOT_READY"
  | "PROCESSING_DISABLED"
  | "PROVIDER_CONFIGURATION_INVALID"
  | "COMPILATION_FAILED"
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
  | "PROCESSING_TIMEOUT"
  | "PERSISTENCE_FAILURE"
  | "INTERNAL_EXECUTION_FAILURE";

export type TechnicalExecutionVideoApplicationErrorCode =
  | "TECHNICAL_EXECUTION_VIDEO_PROVIDER_REFUSED"
  | "TECHNICAL_EXECUTION_VIDEO_PROVIDER_RATE_LIMITED"
  | "TECHNICAL_EXECUTION_VIDEO_PROVIDER_TIMEOUT"
  | "TECHNICAL_EXECUTION_VIDEO_PROVIDER_ERROR"
  | "TECHNICAL_EXECUTION_VIDEO_PROVIDER_INVALID_RESPONSE"
  | "TECHNICAL_EXECUTION_VIDEO_OPERATION_NOT_FOUND"
  | "TECHNICAL_EXECUTION_VIDEO_STORAGE_FAILED"
  | "TECHNICAL_EXECUTION_VIDEO_SOURCE_UNAVAILABLE"
  | "TECHNICAL_EXECUTION_VIDEO_CONFIGURATION_ERROR"
  | "TECHNICAL_EXECUTION_VIDEO_PROCESSING_TIMEOUT";

export type TechnicalExecutionVideoExecutionResult =
  | { outcome: "submitted"; generation: TechnicalExecutionVideoGenerationRecord }
  | { outcome: "still_processing"; generation: TechnicalExecutionVideoGenerationRecord }
  | { outcome: "completed"; generation: TechnicalExecutionVideoGenerationRecord }
  | { outcome: "requeued_for_retry"; code: TechnicalExecutionVideoExecutionResultCode }
  | { outcome: "failed"; code: TechnicalExecutionVideoExecutionResultCode; reason?: string };

export interface ExecuteTechnicalExecutionVideoGenerationDependencies {
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
  createProvider?: (config: { apiKey: string; model: string; timeoutMs?: number }) => TechnicalExecutionVeoProvider;
  resolveObjectStorage?: (bucketAlias: string) => ObjectStorage | null | Promise<ObjectStorage | null>;
  recordAiUsageEvent?: typeof recordAiUsageEvent;
  persistGeneratedVideo?: typeof persistGeneratedVideoDemonstrationAsset;
  beforeClaim?: () => Promise<void>;
  beforePersist?: () => Promise<void>;
  // Stage 2.5.i.26 -- injectable ONLY so a future pilot targeting a
  // DIFFERENT real Skill (e.g. Continue Central Nape Construction, Stage
  // 2.5.i.25) can be exercised through this SAME, already-proven
  // orchestrator, without hardcoding a second Skill into it permanently.
  // Defaults to the EXACT i.23 behavior (compileEstablishCentralNapeGuideProviderAdapterOutput)
  // -- every existing caller is unaffected, byte-identical, unless it
  // explicitly overrides this.
  compileProviderAdapterOutput?: (input: {
    sealedRequestId: string;
    visualReference: ProviderAdapterVisualReference;
    authorizationStatus: AuthorizationPreconditionStatus;
    visualReferenceQualification: VisualReferenceQualificationStatus;
    compiledAt: string;
  }) => ProviderAdapterTranslationResult;
  // Stage 2.5.i.26 -- see technical-execution-video-veo-serializer.ts's own
  // "demonstration hints are not authority" discipline: purely optional,
  // purely descriptive, never read from any Skill/Execution Unit/Atomic
  // Action. Defaults to undefined (no hint sentence rendered), identical to
  // i.23's own prior behavior.
  demonstrationHints?: TechnicalExecutionVeoDemonstrationHints;
}

// Entry point: idempotent to call repeatedly (same shape as
// executeVideoDemonstrationGeneration) -- REQUESTED gets a fresh submit
// attempt (creating the row first if none exists yet for this sealed
// request), PROCESSING-with-operationId gets polled, terminal states return
// immediately.
export async function executeTechnicalExecutionVideoGeneration(
  technicalExecutionGenerationRequestId: string,
  ownerUserId: string,
  dependencies: ExecuteTechnicalExecutionVideoGenerationDependencies = {},
): Promise<TechnicalExecutionVideoExecutionResult> {
  const startedAt = Date.now();
  const result = await run(technicalExecutionGenerationRequestId, ownerUserId, dependencies);
  logExecution(technicalExecutionGenerationRequestId, ownerUserId, result, Date.now() - startedAt);
  return result;
}

function logExecution(requestId: string, ownerUserId: string, result: TechnicalExecutionVideoExecutionResult, totalLatencyMs: number): void {
  const line = JSON.stringify({
    gate: "TECHNICAL_EXECUTION_VIDEO_EXECUTION",
    technicalExecutionGenerationRequestId: requestId,
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

async function run(
  technicalExecutionGenerationRequestId: string,
  ownerUserId: string,
  dependencies: ExecuteTechnicalExecutionVideoGenerationDependencies,
): Promise<TechnicalExecutionVideoExecutionResult> {
  try {
    const now = dependencies.now ?? new Date();
    const env = dependencies.env ?? process.env;
    const resolveObjectStorage = dependencies.resolveObjectStorage ?? createObjectStorageAliasResolver();
    const createProvider = dependencies.createProvider ?? defaultCreateProvider;
    const recordUsage = dependencies.recordAiUsageEvent ?? recordAiUsageEvent;
    const persistVideo = dependencies.persistGeneratedVideo ?? persistGeneratedVideoDemonstrationAsset;

    // THE GATE -- verified fresh, every call, never cached. Fail-closed on
    // anything other than exactly READY (task Section 7).
    const readiness = await getTechnicalExecutionGenerationReadiness(ownerUserId, technicalExecutionGenerationRequestId);
    if (readiness.status !== "READY") {
      return { outcome: "failed", code: "NOT_READY", reason: readiness.status === "BLOCKED" ? readiness.reason : "not ready" };
    }

    const sealedRequest = await findTechnicalExecutionGenerationRequestForOwner(ownerUserId, technicalExecutionGenerationRequestId);
    if (!sealedRequest) {
      return { outcome: "failed", code: "NOT_READY", reason: "sealed request not found after a READY readiness check" };
    }

    const config = resolveVideoDemonstrationProviderConfig(env);
    if (config.status === "disabled") return failure("PROCESSING_DISABLED");
    if (config.status === "invalid") return failure("PROVIDER_CONFIGURATION_INVALID");

    // Compile the real Central Nape Guide chain -> ONE
    // ProviderAdapterTranslationOutput, using EXACTLY the i.22-bound image
    // (never re-selected) and the i.22 READY verdict itself as the
    // Provider Adapter's own precondition signals (task Section 7:
    // consuming the ALREADY-verified fact, never re-deciding it).
    const compile = dependencies.compileProviderAdapterOutput ?? compileEstablishCentralNapeGuideProviderAdapterOutput;
    const compiled = compile({
      sealedRequestId: sealedRequest.id,
      visualReference: { imageAssetId: sealedRequest.imageAssetId, classification: "VISUAL_REFERENCE_ONLY" },
      authorizationStatus: "VALIDATED",
      visualReferenceQualification: "QUALIFIED",
      compiledAt: now.toISOString(),
    });
    if (compiled.status !== "TRANSLATED") {
      return { outcome: "failed", code: "COMPILATION_FAILED", reason: compiled.reason };
    }

    const instruction = assembleTechnicalExecutionVeoInstruction(compiled.output, dependencies.demonstrationHints);

    const created = await createTechnicalExecutionVideoGeneration({
      ownerUserId,
      clientId: sealedRequest.clientId,
      technicalExecutionGenerationRequestId: sealedRequest.id,
      provider: config.provider,
      model: config.model,
      providerInstruction: instruction,
    });
    const generation = created.record;

    if (generation.status === "COMPLETED" || generation.status === "FAILED") {
      return failure("GENERATION_ALREADY_TERMINAL");
    }

    if (generation.status === "PROCESSING" && generation.providerOperationId) {
      return pollExistingOperation({ generation, config, createProvider, recordUsage, persistVideo, now, dependencies });
    }

    if (dependencies.beforeClaim) await dependencies.beforeClaim();

    const claim = await claimTechnicalExecutionVideoGenerationForSubmit(generation.id, ownerUserId, now);
    if (claim.outcome === "rejected") {
      if (claim.code === "NOT_FOUND") return failure("GENERATION_NOT_FOUND");
      if (claim.code === "MAX_ATTEMPTS_EXCEEDED") return failure("MAX_ATTEMPTS_EXCEEDED");
      return failure("CLAIM_CONFLICT");
    }

    const attemptNumber = claim.attemptNumber;
    const usageBase = { ownerUserId: generation.ownerUserId, clientId: generation.clientId, provider: generation.provider, model: generation.model, id: generation.id };

    let sourceBuffer: Buffer;
    let sourceMimeType: string;
    try {
      const loaded = await loadSourceImageBuffer(sealedRequest.imageAssetId, generation.ownerUserId, resolveObjectStorage);
      sourceBuffer = loaded.buffer;
      sourceMimeType = loaded.mimeType;
    } catch {
      return finalizeFailure({ generationId: generation.id, ownerUserId, now, dependencies, code: "TECHNICAL_EXECUTION_VIDEO_SOURCE_UNAVAILABLE", retryable: false, resultCode: "SOURCE_UNAVAILABLE" });
    }

    const provider = createProvider({ apiKey: config.apiKey, model: generation.model, timeoutMs: config.timeoutMs });

    let submitOutcome: Awaited<ReturnType<TechnicalExecutionVeoProvider["submit"]>>;
    const submitStartedAt = Date.now();
    try {
      submitOutcome = await provider.submit(instruction, { buffer: sourceBuffer, mimeType: sourceMimeType });
    } catch (error) {
      const { code, resultCode, retryable } = classifyProviderFailure(error);
      try {
        await recordUsage(buildUsageEventInput(usageBase, { outcome: "FAILED", attemptNumber, errorCategory: resultCode, latencyMs: Date.now() - submitStartedAt, feature: "technical_execution_video" }));
      } catch {
        // never let a metering problem turn an already-failed submit into a
        // different, worse failure.
      }
      return finalizeFailure({ generationId: generation.id, ownerUserId, now, dependencies, code, retryable, resultCode });
    }

    if (dependencies.beforePersist) await dependencies.beforePersist();

    try {
      await markTechnicalExecutionVideoGenerationSubmitted(generation.id, ownerUserId, submitOutcome.providerOperationId, now);
    } catch {
      return failure("PERSISTENCE_FAILURE");
    }

    const updated = await findTechnicalExecutionVideoGenerationForOwner(ownerUserId, generation.id);
    if (!updated) return failure("PERSISTENCE_FAILURE");
    return { outcome: "submitted", generation: updated };
  } catch {
    return failure("INTERNAL_EXECUTION_FAILURE");
  }
}

interface PollInput {
  generation: TechnicalExecutionVideoGenerationRecord;
  config: { status: "enabled"; apiKey: string; model: string; timeoutMs: number | undefined };
  createProvider: NonNullable<ExecuteTechnicalExecutionVideoGenerationDependencies["createProvider"]>;
  recordUsage: NonNullable<ExecuteTechnicalExecutionVideoGenerationDependencies["recordAiUsageEvent"]>;
  persistVideo: NonNullable<ExecuteTechnicalExecutionVideoGenerationDependencies["persistGeneratedVideo"]>;
  now: Date;
  dependencies: ExecuteTechnicalExecutionVideoGenerationDependencies;
}

async function pollExistingOperation(input: PollInput): Promise<TechnicalExecutionVideoExecutionResult> {
  const { generation, config, createProvider, recordUsage, persistVideo, now, dependencies } = input;
  const usageBase = { ownerUserId: generation.ownerUserId, clientId: generation.clientId, provider: generation.provider, model: generation.model, id: generation.id };

  if (generation.submittedAt && isVideoDemonstrationProcessingStale(new Date(generation.submittedAt), now)) {
    return finalizeFailure({
      generationId: generation.id,
      ownerUserId: generation.ownerUserId,
      now,
      dependencies,
      code: "TECHNICAL_EXECUTION_VIDEO_PROCESSING_TIMEOUT",
      retryable: false,
      resultCode: "PROCESSING_TIMEOUT",
    });
  }

  const provider = createProvider({ apiKey: config.apiKey, model: generation.model, timeoutMs: config.timeoutMs });
  const pollStartedAt = Date.now();
  const elapsedSinceSubmittedMs = generation.submittedAt ? now.getTime() - new Date(generation.submittedAt).getTime() : 0;

  let pollResult: Awaited<ReturnType<TechnicalExecutionVeoProvider["poll"]>>;
  try {
    pollResult = await provider.poll(generation.providerOperationId as string);
  } catch (error) {
    const { code, resultCode, retryable } = classifyProviderFailure(error);

    if (retryable) {
      const nextPollAt = new Date(now.getTime() + computeVideoDemonstrationNextPollDelayMs(elapsedSinceSubmittedMs));
      try {
        await rescheduleTechnicalExecutionVideoGenerationPoll(generation.id, generation.ownerUserId, nextPollAt);
      } catch {
        return failure("PERSISTENCE_FAILURE");
      }
      return { outcome: "requeued_for_retry", code: resultCode };
    }

    try {
      await recordUsage(
        buildUsageEventInput(usageBase, { outcome: "FAILED", attemptNumber: generation.attemptCount, errorCategory: resultCode, latencyMs: Date.now() - pollStartedAt, feature: "technical_execution_video" }),
      );
    } catch {
      // never let a metering problem turn an already-failed poll into a
      // different, worse failure.
    }
    return finalizeFailure({ generationId: generation.id, ownerUserId: generation.ownerUserId, now, dependencies, code, retryable, resultCode });
  }

  if (!pollResult.done) {
    const nextPollAt = new Date(now.getTime() + computeVideoDemonstrationNextPollDelayMs(elapsedSinceSubmittedMs));
    await rescheduleTechnicalExecutionVideoGenerationPoll(generation.id, generation.ownerUserId, nextPollAt).catch(() => undefined);
    return { outcome: "still_processing", generation };
  }

  if (dependencies.beforeClaim) await dependencies.beforeClaim();
  const completionClaim = await claimTechnicalExecutionVideoGenerationForCompletionProcessing(generation.id, generation.ownerUserId, now);
  if (completionClaim.outcome === "rejected") {
    if (completionClaim.code === "NOT_FOUND") return failure("GENERATION_NOT_FOUND");
    return { outcome: "still_processing", generation };
  }

  if (dependencies.beforePersist) await dependencies.beforePersist();

  try {
    await recordUsage(
      buildUsageEventInput(usageBase, {
        outcome: "SUCCEEDED",
        attemptNumber: generation.attemptCount,
        providerRequestId: generation.providerOperationId ?? undefined,
        ...(pollResult.durationSeconds !== undefined ? { usage: { videoSeconds: pollResult.durationSeconds } } : {}),
        latencyMs: Date.now() - pollStartedAt,
        feature: "technical_execution_video",
      }),
    );
  } catch {
    // never let a metering problem block persisting a real, successfully
    // generated video.
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
      code: "TECHNICAL_EXECUTION_VIDEO_STORAGE_FAILED",
      retryable: false,
      resultCode: "STORAGE_FAILED",
      errorMetadata: { message },
    });
  }

  try {
    await markTechnicalExecutionVideoGenerationCompleted(generation.id, generation.ownerUserId, generatedAsset.id, now);
  } catch {
    return failure("PERSISTENCE_FAILURE");
  }

  const updated = await findTechnicalExecutionVideoGenerationForOwner(generation.ownerUserId, generation.id);
  if (!updated) return failure("PERSISTENCE_FAILURE");
  return { outcome: "completed", generation: updated };
}

interface FinalizeFailureInput {
  generationId: string;
  ownerUserId: string;
  now: Date;
  dependencies: ExecuteTechnicalExecutionVideoGenerationDependencies;
  code: TechnicalExecutionVideoApplicationErrorCode;
  retryable: boolean;
  resultCode: TechnicalExecutionVideoExecutionResultCode;
  errorMetadata?: Record<string, unknown> | null;
}

async function finalizeFailure(input: FinalizeFailureInput): Promise<TechnicalExecutionVideoExecutionResult> {
  if (input.dependencies.beforePersist) await input.dependencies.beforePersist();
  try {
    const marked = await markTechnicalExecutionVideoGenerationFailed(input.generationId, input.ownerUserId, { errorCode: input.code, errorMetadata: input.errorMetadata ?? null, retryable: input.retryable }, input.now);
    return marked.status === "REQUESTED" ? { outcome: "requeued_for_retry", code: input.resultCode } : failure(input.resultCode);
  } catch {
    return failure("PERSISTENCE_FAILURE");
  }
}

async function loadSourceImageBuffer(
  imageAssetId: string,
  ownerUserId: string,
  resolveObjectStorage: (bucketAlias: string) => ObjectStorage | null | Promise<ObjectStorage | null>,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const asset = await prisma.imageAsset.findFirst({ where: { id: imageAssetId, ownerUserId, deletedAt: null } });
  if (!asset) {
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

function defaultCreateProvider(config: { apiKey: string; model: string; timeoutMs?: number }): TechnicalExecutionVeoProvider {
  return new TechnicalExecutionVeoProvider(config);
}

function classifyProviderFailure(error: unknown): { code: TechnicalExecutionVideoApplicationErrorCode; resultCode: TechnicalExecutionVideoExecutionResultCode; retryable: boolean } {
  const providerError = error as Partial<VideoDemonstrationProviderError>;
  switch (providerError?.code) {
    case "TIMEOUT":
      return { code: "TECHNICAL_EXECUTION_VIDEO_PROVIDER_TIMEOUT", resultCode: "PROVIDER_TIMEOUT", retryable: isTechnicalExecutionVideoFailureRetryable("TECHNICAL_EXECUTION_VIDEO_PROVIDER_TIMEOUT") };
    case "RATE_LIMITED":
      return { code: "TECHNICAL_EXECUTION_VIDEO_PROVIDER_RATE_LIMITED", resultCode: "PROVIDER_RATE_LIMITED", retryable: isTechnicalExecutionVideoFailureRetryable("TECHNICAL_EXECUTION_VIDEO_PROVIDER_RATE_LIMITED") };
    case "NOT_CONFIGURED":
      return { code: "TECHNICAL_EXECUTION_VIDEO_CONFIGURATION_ERROR", resultCode: "PROVIDER_CONFIGURATION_INVALID", retryable: false };
    case "MODERATION_REFUSED":
      return { code: "TECHNICAL_EXECUTION_VIDEO_PROVIDER_REFUSED", resultCode: "PROVIDER_REFUSED", retryable: false };
    case "INVALID_RESPONSE":
      return {
        code: "TECHNICAL_EXECUTION_VIDEO_PROVIDER_INVALID_RESPONSE",
        resultCode: "PROVIDER_INVALID_RESPONSE",
        retryable: isTechnicalExecutionVideoFailureRetryable("TECHNICAL_EXECUTION_VIDEO_PROVIDER_INVALID_RESPONSE"),
      };
    case "OPERATION_NOT_FOUND":
      return { code: "TECHNICAL_EXECUTION_VIDEO_OPERATION_NOT_FOUND", resultCode: "OPERATION_NOT_FOUND", retryable: false };
    case "INVALID_SOURCE_IMAGE":
      return { code: "TECHNICAL_EXECUTION_VIDEO_SOURCE_UNAVAILABLE", resultCode: "SOURCE_UNAVAILABLE", retryable: false };
    case "PROVIDER_ERROR": {
      const retryable = providerError.retryable === true;
      return { code: "TECHNICAL_EXECUTION_VIDEO_PROVIDER_ERROR", resultCode: "PROVIDER_ERROR", retryable: isTechnicalExecutionVideoFailureRetryable("TECHNICAL_EXECUTION_VIDEO_PROVIDER_ERROR", retryable) };
    }
    default:
      return { code: "TECHNICAL_EXECUTION_VIDEO_PROVIDER_ERROR", resultCode: "PROVIDER_ERROR", retryable: false };
  }
}

function buildUsageEventInput(
  base: { ownerUserId: string; clientId: string; provider: string; model: string; id: string },
  outcome: {
    outcome: "SUCCEEDED" | "FAILED";
    providerRequestId?: string;
    usage?: { videoSeconds?: number };
    attemptNumber?: number;
    errorCategory?: string;
    latencyMs?: number;
    feature: string;
  },
): Parameters<typeof recordAiUsageEvent>[0] {
  return {
    ownerUserId: base.ownerUserId,
    clientId: base.clientId,
    feature: outcome.feature,
    modality: "VIDEO_GENERATION",
    // The generation request's own id is the correlation id -- shared by
    // every real provider attempt for this exact request, identical
    // precedent to buildVideoDemonstrationUsageEventInput.
    correlationId: base.id,
    ...(outcome.attemptNumber !== undefined ? { attemptNumber: outcome.attemptNumber } : {}),
    provider: base.provider,
    model: base.model,
    ...(outcome.providerRequestId ? { providerRequestId: outcome.providerRequestId } : {}),
    ...(outcome.usage ? { usage: outcome.usage } : {}),
    outcome: outcome.outcome,
    ...(outcome.errorCategory ? { errorCategory: outcome.errorCategory } : {}),
    ...(outcome.latencyMs !== undefined ? { latencyMs: outcome.latencyMs } : {}),
  };
}

function failure(code: TechnicalExecutionVideoExecutionResultCode): TechnicalExecutionVideoExecutionResult {
  return { outcome: "failed", code };
}
