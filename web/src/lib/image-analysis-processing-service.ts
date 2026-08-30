import { createHash, randomUUID } from "crypto";
import { Readable } from "stream";

import type { Prisma } from "@prisma/client";

import { recordAiUsageEvent } from "@/lib/ai-usage-repository";
import { prisma } from "@/lib/prisma";
import {
  ANALYSIS_STATUS_DRAFT,
  ANALYSIS_STATUS_FAILED,
  ANALYSIS_STATUS_PROCESSING,
  ANALYSIS_STATUS_QUEUED,
  claimQueuedAnalysisForProcessing,
  markAnalysisFailed,
  markAnalysisSucceeded,
  type AnalysisFailureCode,
} from "@/lib/image-analysis-job-repository";
import { resolveImageAnalysisProviderConfig } from "@/lib/image-analysis-provider-config";
import { GEMINI_PROVIDER_NAME, GeminiImageAnalysisProvider } from "@/lib/image-analysis-provider-gemini";
import type { ImageAnalysisProvider, ProviderError } from "@/lib/image-analysis-provider";
import { ALLOWED_MIMETYPES, MAX_FILE_SIZE, validateMagicBytes } from "@/lib/image-upload-validation";
import { ConfinedImageStorageError, createConfinedImageReadStream } from "@/lib/image-storage";
import { ImageAssetStorageRepository } from "@/lib/image-asset-storage-repository";
import { createObjectStorageAliasResolver } from "@/lib/object-storage-alias-resolver";
import { toExactObjectReference, type ObjectStorage } from "@/lib/object-storage";

const SERVABLE_OBJECT_STATES = new Set(["available", "delete_pending"]);

export type ProcessingResultCode =
  | "PROCESSING_DISABLED"
  | "PROVIDER_CONFIGURATION_INVALID"
  | "ANALYSIS_NOT_FOUND"
  | "ANALYSIS_NOT_ELIGIBLE"
  | "CONSENT_REQUIRED"
  | "QUOTA_EXCEEDED"
  | "CLAIM_CONFLICT"
  | "IMAGE_UNAVAILABLE"
  | "STORAGE_READ_FAILURE"
  | "OBJECT_STORAGE_READ_FAILURE"
  | "UNSUPPORTED_MIME_TYPE"
  | "UNSUPPORTED_IMAGE"
  | "IMAGE_TOO_LARGE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_AUTHENTICATION_FAILURE"
  | "MALFORMED_PROVIDER_RESPONSE"
  | "PERSISTENCE_FAILURE"
  | "RETRY_NOT_ALLOWED"
  | "INTERNAL_PROCESSING_FAILURE";

export const PROCESSING_RESULT_HTTP_STATUS: Record<ProcessingResultCode, number> = {
  PROCESSING_DISABLED: 503,
  PROVIDER_CONFIGURATION_INVALID: 503,
  ANALYSIS_NOT_FOUND: 404,
  ANALYSIS_NOT_ELIGIBLE: 409,
  CONSENT_REQUIRED: 403,
  QUOTA_EXCEEDED: 429,
  CLAIM_CONFLICT: 409,
  IMAGE_UNAVAILABLE: 409,
  STORAGE_READ_FAILURE: 500,
  OBJECT_STORAGE_READ_FAILURE: 503,
  UNSUPPORTED_MIME_TYPE: 415,
  UNSUPPORTED_IMAGE: 415,
  IMAGE_TOO_LARGE: 413,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_AUTHENTICATION_FAILURE: 502,
  MALFORMED_PROVIDER_RESPONSE: 502,
  PERSISTENCE_FAILURE: 500,
  RETRY_NOT_ALLOWED: 409,
  INTERNAL_PROCESSING_FAILURE: 500,
};

export interface SanitizedAnalysisView {
  id: string;
  status: string;
  providerName: string;
  modelVersion: string;
  analysisPayload: Prisma.JsonValue;
  confidences: Prisma.JsonValue;
  warnings: Prisma.JsonValue;
  createdAt: string;
  updatedAt: string;
}

export type ProcessImageAnalysisResult =
  | { outcome: "current_state" | "succeeded"; analysis: SanitizedAnalysisView }
  | { outcome: "failed"; code: ProcessingResultCode };

export interface ProcessImageAnalysisDependencies {
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
  createProvider?: (config: { apiKey: string; model: string; timeoutMs: number }) => ImageAnalysisProvider;
  resolveObjectStorage?: ReturnType<typeof createObjectStorageAliasResolver>;
  /** Test-only hook invoked immediately before the atomic GO-1 claim. Never used by the route. */
  beforeClaim?: () => Promise<void>;
  /** Test-only hook invoked immediately before persisting the terminal outcome. Never used by the route. */
  beforePersist?: () => Promise<void>;
  // AI Usage & Cost Metering Phase 1: injectable like createProvider, so
  // tests never need a real database connection just because this
  // function now also records usage -- defaults to the real,
  // never-throwing recorder.
  recordAiUsageEvent?: typeof recordAiUsageEvent;
}

/**
 * Claims and processes exactly one already-queued, already-consented
 * ImageAnalysis for the given owner-scoped asset. Never creates
 * ImageAnalysis/ImageAsset rows and never records or infers consent --
 * both remain the responsibility of whatever phase queues the row (GO-4).
 *
 * Ordering is deliberate: every deterministic, zero-I/O check (provider
 * config, ownership, status eligibility, persisted MIME/size/consent) runs
 * before any byte is read from storage; the actual bounded storage read and
 * real-byte validation also run before the atomic GO-1 claim, so quota is
 * never spent on a request that could not have reached the provider. Quota
 * is consumed at exactly one point: the moment claimQueuedAnalysisForProcessing
 * succeeds, immediately before Gemini is invoked with the already-loaded buffer.
 */
export async function processImageAnalysis(
  assetId: string,
  ownerUserId: string,
  dependencies: ProcessImageAnalysisDependencies = {},
): Promise<ProcessImageAnalysisResult> {
  try {
    const now = dependencies.now ?? new Date();
    const env = dependencies.env ?? process.env;
    const resolveObjectStorage = dependencies.resolveObjectStorage ?? createObjectStorageAliasResolver();
    const createProvider = dependencies.createProvider ?? defaultCreateProvider;
    const recordUsage = dependencies.recordAiUsageEvent ?? recordAiUsageEvent;

    const config = resolveImageAnalysisProviderConfig(env);
    if (config.status === "disabled") {
      return failure("PROCESSING_DISABLED");
    }
    if (config.status === "invalid") {
      return failure("PROVIDER_CONFIGURATION_INVALID");
    }

    const asset = await prisma.imageAsset.findFirst({ where: { id: assetId, ownerUserId } });
    if (!asset || asset.deletedAt) {
      return failure("ANALYSIS_NOT_FOUND");
    }

    const analyses = await prisma.imageAnalysis.findMany({
      where: { assetId },
      orderBy: { createdAt: "desc" },
    });
    if (analyses.length === 0) {
      return failure("ANALYSIS_NOT_FOUND");
    }

    const active = analyses.find(
      (row) => row.status === ANALYSIS_STATUS_QUEUED || row.status === ANALYSIS_STATUS_PROCESSING,
    );

    if (!active) {
      const mostRecent = analyses[0];
      if (mostRecent.status === ANALYSIS_STATUS_DRAFT || mostRecent.status === "confirmed") {
        return { outcome: "current_state", analysis: sanitizeAnalysis(mostRecent) };
      }
      if (mostRecent.status === ANALYSIS_STATUS_FAILED) {
        return failure("RETRY_NOT_ALLOWED");
      }
      return failure("ANALYSIS_NOT_ELIGIBLE");
    }

    const analysisId = active.id;

    // Preliminary, non-authoritative optimization: skip storage I/O entirely
    // for a request that's obviously going to be rejected. The atomic claim
    // below re-verifies consent from the database regardless -- this check
    // is never trusted as the actual gate.
    if (!active.externalAiConsentGrantedAt) {
      return failure("CONSENT_REQUIRED");
    }

    if (!ALLOWED_MIMETYPES.includes(asset.mimeType as (typeof ALLOWED_MIMETYPES)[number])) {
      return failure("UNSUPPORTED_MIME_TYPE");
    }
    if (asset.sizeBytes > MAX_FILE_SIZE) {
      return failure("IMAGE_TOO_LARGE");
    }

    let buffer: Buffer;
    try {
      buffer = await loadValidatedImageBuffer(asset, resolveObjectStorage);
    } catch (error) {
      if (error instanceof ProcessingPreClaimError) {
        logStorageReadFailure({ assetId, ownerUserId, storageBackend: asset.storageBackend, code: error.code, error });
        return failure(error.code);
      }
      throw error;
    }

    if (dependencies.beforeClaim) {
      await dependencies.beforeClaim();
    }

    const claim = await claimQueuedAnalysisForProcessing({
      analysisId,
      ownerUserId,
      providerName: GEMINI_PROVIDER_NAME,
      modelVersion: config.model,
      now,
    });

    if (claim.outcome === "rejected") {
      // Buffer is discarded by falling out of scope -- never reused, never
      // logged, never sent anywhere once the claim is lost.
      if (claim.code === "CONSENT_MISSING") {
        return failure("CONSENT_REQUIRED");
      }
      if (claim.code === "QUOTA_EXCEEDED") {
        return failure("QUOTA_EXCEEDED");
      }
      return failure("CLAIM_CONFLICT");
    }

    // Quota is consumed as of this point (the claim above). Everything from
    // here on is a chargeable attempt, regardless of outcome.
    const provider = createProvider({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs });

    let analyzed: Awaited<ReturnType<ImageAnalysisProvider["analyze"]>>;
    const providerCallStartedAt = Date.now();
    // AI Usage & Cost Metering Phase 1: one correlationId per logical
    // analyze attempt -- this function never retries the provider call
    // itself internally (a stylist re-request is a brand new call to this
    // whole function, with its own id), so attemptNumber is always the
    // default (1).
    const usageCorrelationId = randomUUID();
    try {
      analyzed = await provider.analyze({
        imageBuffer: buffer,
        mimeType: asset.mimeType,
        userId: ownerUserId,
        clientId: asset.clientId,
      });
    } catch (error) {
      const { analysisFailureCode, resultCode } = classifyProviderFailure(error);
      logProviderFailure({
        providerName: GEMINI_PROVIDER_NAME,
        modelVersion: config.model,
        assetId,
        analysisId,
        ownerUserId,
        durationMs: Date.now() - providerCallStartedAt,
        resultCode,
        error,
      });
      // Defense-in-depth, on top of recordAiUsageEvent's own never-throws
      // contract: a metering problem must never turn an already-failed
      // provider call into a DIFFERENT, worse failure for the caller.
      try {
        await recordUsage({
          ownerUserId,
          clientId: asset.clientId,
          analysisId,
          feature: "image_analysis",
          modality: "IMAGE_ANALYSIS",
          correlationId: usageCorrelationId,
          provider: GEMINI_PROVIDER_NAME,
          model: config.model,
          outcome: "FAILED",
          errorCategory: resultCode,
          latencyMs: Date.now() - providerCallStartedAt,
        });
      } catch {
        // Intentionally swallowed -- see comment above.
      }
      if (dependencies.beforePersist) {
        await dependencies.beforePersist();
      }
      try {
        await markAnalysisFailed(analysisId, ownerUserId, analysisFailureCode);
      } catch {
        return failure("PERSISTENCE_FAILURE");
      }
      return failure(resultCode);
    }

    // Defense-in-depth, on top of recordAiUsageEvent's own never-throws
    // contract: a metering problem must never turn a successful analysis
    // into a user-visible failure.
    try {
      await recordUsage({
        ownerUserId,
        clientId: asset.clientId,
        analysisId,
        feature: "image_analysis",
        modality: "IMAGE_ANALYSIS",
        correlationId: usageCorrelationId,
        provider: GEMINI_PROVIDER_NAME,
        model: config.model,
        providerRequestId: analyzed.providerRequestId,
        usage: analyzed.usage,
        outcome: "SUCCEEDED",
        latencyMs: Date.now() - providerCallStartedAt,
      });
    } catch {
      // Intentionally swallowed -- see comment above.
    }

    if (dependencies.beforePersist) {
      await dependencies.beforePersist();
    }

    try {
      await markAnalysisSucceeded(analysisId, ownerUserId, {
        result: analyzed.result as unknown as Prisma.InputJsonValue,
        confidences: analyzed.confidences as unknown as Prisma.InputJsonValue,
        providerName: GEMINI_PROVIDER_NAME,
        modelVersion: config.model,
        warnings: analyzed.warnings,
      });
    } catch {
      return failure("PERSISTENCE_FAILURE");
    }

    const updated = await prisma.imageAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    return { outcome: "succeeded", analysis: sanitizeAnalysis(updated) };
  } catch {
    return failure("INTERNAL_PROCESSING_FAILURE");
  }
}

// Exported alongside loadValidatedImageBuffer above -- a caller reusing that
// function needs to be able to recognize (via instanceof) and map its one
// thrown error type, since its `code` is drawn from this module's own
// ProcessingResultCode vocabulary.
export class ProcessingPreClaimError extends Error {
  constructor(readonly code: ProcessingResultCode) {
    super(code);
    this.name = "ProcessingPreClaimError";
  }
}

class OversizedStreamError extends Error {}

// Exported (unchanged, unbehaviored) -- Real AI Photo Preview, Stage 2's own
// executor reuses this exact dual-backend (S3 / legacy-local) read +
// integrity-verification logic to load a generation's frozen source image,
// rather than a second, competing implementation of the same S3 get()/
// head()/hash-verification dance (photo-preview-execution-service.ts).
export interface AssetStorageRow {
  id: string;
  ownerUserId: string;
  clientId: string;
  mimeType: string;
  storageBackend: string | null;
  storagePath: string;
  storageState: string | null;
  contentSha256: string | null;
}

export async function loadValidatedImageBuffer(
  asset: AssetStorageRow,
  resolveObjectStorage: (bucketAlias: string) => ObjectStorage | null | Promise<ObjectStorage | null>,
): Promise<Buffer> {
  let buffer: Buffer;

  if (asset.storageBackend === null || asset.storageBackend === undefined) {
    if (asset.storagePath === "pending") {
      throw new ProcessingPreClaimError("IMAGE_UNAVAILABLE");
    }

    let stream;
    let statedSizeBytes: number;
    try {
      const opened = await createConfinedImageReadStream(asset.storagePath);
      stream = opened.stream;
      statedSizeBytes = opened.sizeBytes;
    } catch (error) {
      if (error instanceof ConfinedImageStorageError) {
        throw new ProcessingPreClaimError("STORAGE_READ_FAILURE");
      }
      throw new ProcessingPreClaimError("STORAGE_READ_FAILURE");
    }

    if (statedSizeBytes > MAX_FILE_SIZE) {
      stream.destroy();
      throw new ProcessingPreClaimError("IMAGE_TOO_LARGE");
    }

    try {
      buffer = await drainBoundedWebStream(Readable.toWeb(stream) as ReadableStream<Uint8Array>, MAX_FILE_SIZE);
    } catch (error) {
      if (error instanceof OversizedStreamError) {
        throw new ProcessingPreClaimError("IMAGE_TOO_LARGE");
      }
      throw new ProcessingPreClaimError("STORAGE_READ_FAILURE");
    }

    // No content hash exists for legacy-local rows: writeImageToObjectStorage
    // is the only write path that ever populates ImageAsset.contentSha256,
    // and legacy-local rows never go through it. Confinement (already
    // enforced by createConfinedImageReadStream), bounded size, and the
    // real-byte MIME check below are the only integrity guarantees
    // available for this backend -- matching the existing M16 serving
    // contract in image-assets/[id]/content/route.ts, which likewise never
    // checks a hash for legacy-local reads. This limitation is inherent to
    // historical rows and is not invented or worked around here.
  } else if (asset.storageBackend === "s3") {
    if (!asset.storageState || !SERVABLE_OBJECT_STATES.has(asset.storageState)) {
      throw new ProcessingPreClaimError("IMAGE_UNAVAILABLE");
    }

    const repository = new ImageAssetStorageRepository(prisma);
    let reference;
    try {
      reference = await repository.findObjectReferenceByOwner(asset.ownerUserId, asset.id);
    } catch {
      throw new ProcessingPreClaimError("OBJECT_STORAGE_READ_FAILURE");
    }
    if (!reference) {
      throw new ProcessingPreClaimError("IMAGE_UNAVAILABLE");
    }

    let exact;
    try {
      exact = toExactObjectReference(reference);
    } catch {
      throw new ProcessingPreClaimError("IMAGE_UNAVAILABLE");
    }

    let storage: ObjectStorage | null;
    try {
      storage = await resolveObjectStorage(exact.bucketAlias);
    } catch {
      throw new ProcessingPreClaimError("OBJECT_STORAGE_READ_FAILURE");
    }
    if (!storage) {
      throw new ProcessingPreClaimError("OBJECT_STORAGE_READ_FAILURE");
    }

    let stored;
    try {
      // Exact version only -- never "latest" -- and always the same bucket
      // alias/key the persisted reference names. No request-supplied
      // identity is ever used.
      stored = await storage.get({ bucketAlias: exact.bucketAlias, key: exact.key, versionId: exact.versionId });
    } catch {
      throw new ProcessingPreClaimError("OBJECT_STORAGE_READ_FAILURE");
    }

    // The storage layer echoes identity in its response rather than proving
    // it cryptographically -- verify it explicitly rather than trusting that
    // get() necessarily honored the exact bucket/key/version it was asked
    // for. Defense in depth against a misbehaving or misconfigured backend.
    if (
      stored.bucketAlias !== exact.bucketAlias ||
      stored.key !== exact.key ||
      stored.versionId !== exact.versionId
    ) {
      throw new ProcessingPreClaimError("OBJECT_STORAGE_READ_FAILURE");
    }

    try {
      buffer = await drainBoundedWebStream(stored.body, MAX_FILE_SIZE);
    } catch (error) {
      if (error instanceof OversizedStreamError) {
        throw new ProcessingPreClaimError("IMAGE_TOO_LARGE");
      }
      throw new ProcessingPreClaimError("OBJECT_STORAGE_READ_FAILURE");
    }

    if (buffer.length !== exact.sizeBytes) {
      throw new ProcessingPreClaimError("OBJECT_STORAGE_READ_FAILURE");
    }
    const actualHash = createHash("sha256").update(buffer).digest("hex");
    if (actualHash !== exact.contentSha256) {
      throw new ProcessingPreClaimError("OBJECT_STORAGE_READ_FAILURE");
    }
  } else {
    throw new ProcessingPreClaimError("IMAGE_UNAVAILABLE");
  }

  const magicValid = await validateMagicBytes(toArrayBuffer(buffer), asset.mimeType);
  if (!magicValid) {
    throw new ProcessingPreClaimError("UNSUPPORTED_IMAGE");
  }

  return buffer;
}

async function drainBoundedWebStream(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        throw new OversizedStreamError();
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function classifyProviderFailure(
  error: unknown,
): { analysisFailureCode: AnalysisFailureCode; resultCode: ProcessingResultCode } {
  const providerError = error as Partial<ProviderError>;
  switch (providerError?.code) {
    case "TIMEOUT":
      return { analysisFailureCode: "PROVIDER_TIMEOUT", resultCode: "PROVIDER_TIMEOUT" };
    case "RATE_LIMITED":
      return { analysisFailureCode: "PROVIDER_UNAVAILABLE", resultCode: "PROVIDER_UNAVAILABLE" };
    case "NOT_CONFIGURED":
      return { analysisFailureCode: "PROVIDER_CONFIGURATION_INVALID", resultCode: "PROVIDER_AUTHENTICATION_FAILURE" };
    case "INVALID_FORMAT":
      return { analysisFailureCode: "MALFORMED_PROVIDER_RESPONSE", resultCode: "MALFORMED_PROVIDER_RESPONSE" };
    case "PROVIDER_ERROR":
      return providerError.retryable === true
        ? { analysisFailureCode: "PROVIDER_UNAVAILABLE", resultCode: "PROVIDER_UNAVAILABLE" }
        : { analysisFailureCode: "PROVIDER_CONFIGURATION_INVALID", resultCode: "PROVIDER_AUTHENTICATION_FAILURE" };
    default:
      return { analysisFailureCode: "NETWORK_FAILURE", resultCode: "INTERNAL_PROCESSING_FAILURE" };
  }
}

function defaultCreateProvider(config: { apiKey: string; model: string; timeoutMs: number }): ImageAnalysisProvider {
  return new GeminiImageAnalysisProvider(config);
}

// Structured, safe-fields-only diagnostic logs (same JSON-record convention
// as storage-readiness-canary.ts) -- never the image buffer/base64, never
// the API key. ProviderError.message is always one of the fixed, safe
// strings GeminiImageAnalysisProvider.classifyError constructs itself
// (e.g. "Gemini request timed out."), never raw SDK/network internals.
function logProviderFailure(input: {
  providerName: string;
  modelVersion: string;
  assetId: string;
  analysisId: string;
  ownerUserId: string;
  durationMs: number;
  resultCode: ProcessingResultCode;
  error: unknown;
}): void {
  const providerError = input.error as Partial<ProviderError> | undefined;
  console.error(
    JSON.stringify({
      gate: "AI_IMAGE_ANALYSIS_PROVIDER",
      status: "FAILED",
      resultCode: input.resultCode,
      providerName: input.providerName,
      modelVersion: input.modelVersion,
      assetId: input.assetId,
      analysisId: input.analysisId,
      ownerUserId: input.ownerUserId,
      durationBucket: bucketDurationMs(input.durationMs),
      providerErrorCode: providerError?.code ?? "unknown",
      providerErrorMessage: providerError?.message ?? "unknown",
    }),
  );
}

function logStorageReadFailure(input: {
  assetId: string;
  ownerUserId: string;
  storageBackend: string | null;
  code: ProcessingResultCode;
  error: unknown;
}): void {
  console.error(
    JSON.stringify({
      gate: "AI_IMAGE_ANALYSIS_STORAGE_READ",
      status: "FAILED",
      resultCode: input.code,
      storageBackend: input.storageBackend ?? "legacy_local",
      assetId: input.assetId,
      ownerUserId: input.ownerUserId,
      errorName: input.error instanceof Error ? input.error.name : "unknown",
    }),
  );
}

function bucketDurationMs(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 5000) return "1-5s";
  if (ms < 15000) return "5-15s";
  if (ms < 30000) return "15-30s";
  if (ms < 60000) return "30-60s";
  return ">=60s";
}

function sanitizeAnalysis(row: {
  id: string;
  status: string;
  providerName: string;
  modelVersion: string;
  analysisPayload: Prisma.JsonValue;
  confidences: Prisma.JsonValue;
  warnings: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): SanitizedAnalysisView {
  return {
    id: row.id,
    status: row.status,
    providerName: row.providerName,
    modelVersion: row.modelVersion,
    analysisPayload: row.analysisPayload,
    confidences: row.confidences,
    warnings: row.warnings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function failure(code: ProcessingResultCode): ProcessImageAnalysisResult {
  return { outcome: "failed", code };
}
