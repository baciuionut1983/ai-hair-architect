import { recordAiUsageEvent } from "@/lib/ai-usage-repository";
import {
  buildPhotoPreviewUsageEventInput,
  findPhotoPreviewGenerationForOwner,
  type PhotoPreviewGenerationRecord,
} from "@/lib/photo-preview-generation-repository";
import {
  claimPhotoPreviewGenerationForExecution,
  isPhotoPreviewFailureRetryable,
  markPhotoPreviewGenerationCompleted,
  markPhotoPreviewGenerationFailed,
} from "@/lib/photo-preview-execution-repository";
import { resolvePhotoPreviewProviderConfig } from "@/lib/photo-preview-provider-config";
import { GeminiPhotoPreviewProvider } from "@/lib/photo-preview-provider-gemini";
import type { PhotoPreviewProvider, PhotoPreviewProviderError } from "@/lib/photo-preview-provider";
import { persistGeneratedPhotoPreviewImage, PhotoPreviewOutputStorageError } from "@/lib/photo-preview-output-storage";
import { ProcessingPreClaimError, loadValidatedImageBuffer, type AssetStorageRow } from "@/lib/image-analysis-processing-service";
import { createObjectStorageAliasResolver } from "@/lib/object-storage-alias-resolver";
import type { ObjectStorage } from "@/lib/object-storage";
import { prisma } from "@/lib/prisma";

// Real AI Photo Preview, Stage 2 -- the execution orchestrator. Mirrors
// image-analysis-processing-service.ts's own processImageAnalysis shape
// exactly: every dependency (provider construction, storage resolution,
// clock, usage recording, the two test-only ordering hooks) is injectable,
// defaulting to the real implementations -- this is what makes it possible
// to prove (task §37/§38) that the ordinary test suite can NEVER reach a
// real Gemini endpoint: every test constructs this function with an
// explicit fake `createProvider`, never the real default.
//
// Claims exactly one already-created, already-sealed PhotoPreviewGeneration
// (task §1: "Worker/executor must NOT rebuild generation intent from
// current mutable database state" -- the sealedRequest field, frozen at
// Stage 1 creation time, is the ONLY source of generation intent read here;
// nothing in this file re-queries the Proposal/Map/SpatialBinding chain).

export type PhotoPreviewExecutionResultCode =
  | "PROCESSING_DISABLED"
  | "PROVIDER_CONFIGURATION_INVALID"
  | "GENERATION_NOT_FOUND"
  | "CLAIM_CONFLICT"
  | "MAX_ATTEMPTS_EXCEEDED"
  | "SOURCE_UNAVAILABLE"
  | "PROVIDER_REFUSED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "PROVIDER_INVALID_RESPONSE"
  | "STORAGE_FAILED"
  | "PERSISTENCE_FAILURE"
  | "INTERNAL_EXECUTION_FAILURE";

// Stable, safe, never-leaks-a-secret application error codes (task §31) --
// the ONLY vocabulary ever persisted to PhotoPreviewGeneration.errorCode.
export type PhotoPreviewApplicationErrorCode =
  | "PHOTO_PREVIEW_PROVIDER_REFUSED"
  | "PHOTO_PREVIEW_PROVIDER_RATE_LIMITED"
  | "PHOTO_PREVIEW_PROVIDER_TIMEOUT"
  | "PHOTO_PREVIEW_PROVIDER_ERROR"
  | "PHOTO_PREVIEW_PROVIDER_INVALID_RESPONSE"
  | "PHOTO_PREVIEW_STORAGE_FAILED"
  | "PHOTO_PREVIEW_SOURCE_UNAVAILABLE"
  | "PHOTO_PREVIEW_CONFIGURATION_ERROR";

export type PhotoPreviewExecutionResult =
  | { outcome: "completed"; generation: PhotoPreviewGenerationRecord }
  | { outcome: "requeued_for_retry"; code: PhotoPreviewExecutionResultCode }
  | { outcome: "failed"; code: PhotoPreviewExecutionResultCode };

export interface ExecutePhotoPreviewGenerationDependencies {
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
  createProvider?: (config: { apiKey: string; model: string }) => PhotoPreviewProvider;
  resolveObjectStorage?: (bucketAlias: string) => ObjectStorage | null | Promise<ObjectStorage | null>;
  recordAiUsageEvent?: typeof recordAiUsageEvent;
  persistGeneratedImage?: typeof persistGeneratedPhotoPreviewImage;
  /** Test-only hook invoked immediately before the atomic claim. Never used by any route. */
  beforeClaim?: () => Promise<void>;
  /** Test-only hook invoked immediately before persisting the terminal outcome. Never used by any route. */
  beforePersist?: () => Promise<void>;
}

export async function executePhotoPreviewGeneration(
  generationId: string,
  ownerUserId: string,
  dependencies: ExecutePhotoPreviewGenerationDependencies = {},
): Promise<PhotoPreviewExecutionResult> {
  try {
    const now = dependencies.now ?? new Date();
    const env = dependencies.env ?? process.env;
    const resolveObjectStorage = dependencies.resolveObjectStorage ?? createObjectStorageAliasResolver();
    const createProvider = dependencies.createProvider ?? defaultCreateProvider;
    const recordUsage = dependencies.recordAiUsageEvent ?? recordAiUsageEvent;
    const persistImage = dependencies.persistGeneratedImage ?? persistGeneratedPhotoPreviewImage;

    // Real provider call gate (task §45/top-level prohibition): unset/
    // invalid configuration means NO provider call is even attempted, and
    // the row is left untouched (still REQUESTED, still safely retriable
    // once an operator fixes configuration) -- never a wasted, terminal
    // FAILED outcome for what is fundamentally an operator/deployment
    // issue, not a defect of this specific generation.
    const config = resolvePhotoPreviewProviderConfig(env);
    if (config.status === "disabled") return failure("PROCESSING_DISABLED");
    if (config.status === "invalid") return failure("PROVIDER_CONFIGURATION_INVALID");

    const generation = await findPhotoPreviewGenerationForOwner(ownerUserId, generationId);
    if (!generation) return failure("GENERATION_NOT_FOUND");

    if (dependencies.beforeClaim) await dependencies.beforeClaim();

    const claim = await claimPhotoPreviewGenerationForExecution(generationId, ownerUserId, now);
    if (claim.outcome === "rejected") {
      if (claim.code === "NOT_FOUND") return failure("GENERATION_NOT_FOUND");
      if (claim.code === "MAX_ATTEMPTS_EXCEEDED") return failure("MAX_ATTEMPTS_EXCEEDED");
      return failure("CLAIM_CONFLICT");
    }

    // Everything below is a legitimately claimed, chargeable attempt.
    const attemptNumber = claim.attemptNumber;
    const usageCorrelationBase = { ownerUserId: generation.ownerUserId, clientId: generation.clientId, provider: generation.provider, model: generation.model, id: generation.id };

    let sourceBuffer: Buffer;
    let sourceMimeType: string;
    try {
      const loaded = await loadSourceImageBuffer(generation, resolveObjectStorage);
      sourceBuffer = loaded.buffer;
      sourceMimeType = loaded.mimeType;
    } catch {
      // Source unavailable is checked BEFORE any provider call is made --
      // never billable, never metered (task §26/§33/§34's own required
      // test: "source unavailable -> FAILED without provider call").
      return finalizeFailure({ generationId, ownerUserId, now, dependencies, code: "PHOTO_PREVIEW_SOURCE_UNAVAILABLE", retryable: false, resultCode: "SOURCE_UNAVAILABLE" });
    }

    const provider = createProvider({ apiKey: config.apiKey, model: generation.model });

    let generated: Awaited<ReturnType<PhotoPreviewProvider["generate"]>>;
    const providerCallStartedAt = Date.now();
    try {
      generated = await provider.generate(generation.sealedRequest, { buffer: sourceBuffer, mimeType: sourceMimeType });
    } catch (error) {
      const { code, resultCode, retryable } = classifyProviderFailure(error);
      // A real provider call was ATTEMPTED (whether or not it "succeeded")
      // -- defense-in-depth, on top of recordAiUsageEvent's own never-
      // throws contract: a metering problem must never turn an already-
      // failed provider call into a DIFFERENT, worse failure for the caller.
      try {
        await recordUsage(
          buildPhotoPreviewUsageEventInput(usageCorrelationBase, {
            outcome: "FAILED",
            attemptNumber,
            errorCategory: resultCode,
            latencyMs: Date.now() - providerCallStartedAt,
          }),
        );
      } catch {
        // Intentionally swallowed -- see comment above.
      }
      return finalizeFailure({ generationId, ownerUserId, now, dependencies, code, retryable, resultCode });
    }

    // Defense-in-depth, on top of recordAiUsageEvent's own never-throws
    // contract: a metering problem must never turn a successful provider
    // call into a user-visible failure downstream.
    try {
      await recordUsage(
        buildPhotoPreviewUsageEventInput(usageCorrelationBase, {
          outcome: "SUCCEEDED",
          attemptNumber,
          providerRequestId: generated.providerRequestId,
          usage: generated.usage,
          latencyMs: Date.now() - providerCallStartedAt,
        }),
      );
    } catch {
      // Intentionally swallowed -- see comment above. The provider call
      // itself DID succeed; metering never gets to veto that.
    }

    // Provider succeeded -- usage above is already recorded and can never
    // be un-recorded by a downstream storage failure (task §18: "Do not
    // lose the fact that provider execution occurred").
    let generatedAsset;
    try {
      generatedAsset = await persistImage(ownerUserId, generation.clientId, generated.imageBuffer, generated.mimeType);
    } catch (error) {
      const message = error instanceof PhotoPreviewOutputStorageError ? error.message : "Storage failure.";
      return finalizeFailure({
        generationId,
        ownerUserId,
        now,
        dependencies,
        code: "PHOTO_PREVIEW_STORAGE_FAILED",
        retryable: false,
        resultCode: "STORAGE_FAILED",
        errorMetadata: { message },
      });
    }

    if (dependencies.beforePersist) await dependencies.beforePersist();

    try {
      await markPhotoPreviewGenerationCompleted(generationId, ownerUserId, {
        generatedImageAssetId: generatedAsset.id,
        providerRequestId: generated.providerRequestId ?? null,
      });
    } catch {
      return failure("PERSISTENCE_FAILURE");
    }

    const updated = await findPhotoPreviewGenerationForOwner(ownerUserId, generationId);
    if (!updated) return failure("PERSISTENCE_FAILURE");
    return { outcome: "completed", generation: updated };
  } catch {
    return failure("INTERNAL_EXECUTION_FAILURE");
  }
}

interface FinalizeFailureInput {
  generationId: string;
  ownerUserId: string;
  now: Date;
  dependencies: ExecutePhotoPreviewGenerationDependencies;
  code: PhotoPreviewApplicationErrorCode;
  retryable: boolean;
  resultCode: PhotoPreviewExecutionResultCode;
  errorMetadata?: Record<string, unknown> | null;
}

async function finalizeFailure(input: FinalizeFailureInput): Promise<PhotoPreviewExecutionResult> {
  if (input.dependencies.beforePersist) await input.dependencies.beforePersist();
  try {
    const marked = await markPhotoPreviewGenerationFailed(
      input.generationId,
      input.ownerUserId,
      { errorCode: input.code, errorMetadata: input.errorMetadata ?? null, retryable: input.retryable },
      input.now,
    );
    return marked.status === "REQUESTED" ? { outcome: "requeued_for_retry", code: input.resultCode } : failure(input.resultCode);
  } catch {
    return failure("PERSISTENCE_FAILURE");
  }
}

async function loadSourceImageBuffer(
  generation: PhotoPreviewGenerationRecord,
  resolveObjectStorage: (bucketAlias: string) => ObjectStorage | null | Promise<ObjectStorage | null>,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const asset = await prisma.imageAsset.findFirst({ where: { id: generation.sourceImageAssetId, ownerUserId: generation.ownerUserId, deletedAt: null } });
  if (!asset) {
    throw new ProcessingPreClaimError("IMAGE_UNAVAILABLE");
  }

  // Verify the LIVE asset's own recorded identity still matches what was
  // frozen at sealed-request-creation time (task §4/§33) -- ImageAsset
  // bytes are never rewritten in place in this system, so a real mismatch
  // means something is genuinely wrong; fail safely rather than silently
  // using bytes that may no longer be the ones this generation was sealed
  // against. Only checked when a frozen hash actually exists (never
  // universally available -- see the frozen-field's own schema comment).
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

function defaultCreateProvider(config: { apiKey: string; model: string }): PhotoPreviewProvider {
  return new GeminiPhotoPreviewProvider(config);
}

function classifyProviderFailure(
  error: unknown,
): { code: PhotoPreviewApplicationErrorCode; resultCode: PhotoPreviewExecutionResultCode; retryable: boolean } {
  const providerError = error as Partial<PhotoPreviewProviderError>;
  switch (providerError?.code) {
    case "TIMEOUT":
      return { code: "PHOTO_PREVIEW_PROVIDER_TIMEOUT", resultCode: "PROVIDER_TIMEOUT", retryable: isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_TIMEOUT") };
    case "RATE_LIMITED":
      return {
        code: "PHOTO_PREVIEW_PROVIDER_RATE_LIMITED",
        resultCode: "PROVIDER_RATE_LIMITED",
        retryable: isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_RATE_LIMITED"),
      };
    case "NOT_CONFIGURED":
      return { code: "PHOTO_PREVIEW_CONFIGURATION_ERROR", resultCode: "PROVIDER_CONFIGURATION_INVALID", retryable: false };
    case "MODERATION_REFUSED":
      return { code: "PHOTO_PREVIEW_PROVIDER_REFUSED", resultCode: "PROVIDER_REFUSED", retryable: false };
    case "INVALID_RESPONSE":
      return {
        code: "PHOTO_PREVIEW_PROVIDER_INVALID_RESPONSE",
        resultCode: "PROVIDER_INVALID_RESPONSE",
        retryable: isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_INVALID_RESPONSE"),
      };
    case "PROVIDER_ERROR": {
      const retryable = providerError.retryable === true;
      return { code: "PHOTO_PREVIEW_PROVIDER_ERROR", resultCode: "PROVIDER_ERROR", retryable: isPhotoPreviewFailureRetryable("PHOTO_PREVIEW_PROVIDER_ERROR", retryable) };
    }
    default:
      // Anything else (a thrown value that isn't a recognized
      // PhotoPreviewProviderError at all, e.g. a raw network exception the
      // adapter failed to classify) -- conservative, non-retryable.
      return { code: "PHOTO_PREVIEW_PROVIDER_ERROR", resultCode: "PROVIDER_ERROR", retryable: false };
  }
}

function failure(code: PhotoPreviewExecutionResultCode): PhotoPreviewExecutionResult {
  return { outcome: "failed", code };
}
