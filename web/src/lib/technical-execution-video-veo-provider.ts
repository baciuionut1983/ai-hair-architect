import { createDefaultVeoClient, type VeoVideoGenerationClient } from "@/lib/video-provider-veo";
import type {
  VideoDemonstrationPollOutcome,
  VideoDemonstrationProviderError,
  VideoDemonstrationSourceImageBytes,
  VideoDemonstrationSubmitOutcome,
} from "@/lib/video-provider";

// AI Hair Architect, Stage 2.5.i.23 -- TECHNICAL EXECUTION VIDEO, VEO
// PROVIDER CALLER. Reuses ONLY the safe, generic Veo mechanics already
// proven real (task Section 3): the client construction (createDefaultVeoClient,
// exported from video-provider-veo.ts for exactly this reuse), the
// VeoVideoGenerationClient submit/poll shape, the request/response bug
// fixes baked into that client's own real implementation, timeout handling,
// and the generic VideoDemonstrationProviderError vocabulary
// (video-provider.ts, fully universal, never Result-Video-specific).
//
// NEVER REUSES Result Video's own SEMANTICS (task Section 3's own explicit
// boundary): this file never imports SealedVideoDemonstrationRequest, never
// imports assembleVeoVideoDemonstrationInstruction, and never extends
// VeoVideoDemonstrationProvider (whose submit() signature is hardwired to
// that sealed-request shape and that instruction assembler). Instead this
// is a small, independent, sibling caller whose submit() takes an
// ALREADY-fully-assembled instruction string (built exclusively by
// technical-execution-video-veo-serializer.ts, task Section 5's own "sole
// source" rule) plus the exact already-selected source image bytes -- never
// a sealed request object of any kind.
//
// Same DI seam as VeoVideoDemonstrationProvider (task's own precedent,
// mirrored deliberately): an optional injectable `client` defaults to
// `createDefaultVeoClient(apiKey)` for real use. No test in this codebase
// ever exercises the default (real) client construction path -- every test
// constructs this class with an explicit fake client override, identical
// discipline to video-provider-veo.ts's own "network safety" guarantee.

export const TECHNICAL_EXECUTION_VEO_SUBMIT_TIMEOUT_MS = 30_000;
export const TECHNICAL_EXECUTION_VEO_POLL_TIMEOUT_MS = 30_000;
// Mirrors VEO_VIDEO_DEMONSTRATION_REQUESTED_DURATION_SECONDS's own exact
// reasoning (video-provider-veo.ts) -- no provider-reported duration exists
// for a real Veo response; this is both the REQUESTED value and the value
// reported back for metering.
export const TECHNICAL_EXECUTION_VEO_REQUESTED_DURATION_SECONDS = 6;

export interface TechnicalExecutionVeoProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export class TechnicalExecutionVeoProvider {
  readonly name = "google";
  readonly modelVersion: string;

  private readonly client: VeoVideoGenerationClient;
  private readonly model: string;
  private readonly submitTimeoutMs: number;
  private readonly pollTimeoutMs: number;

  constructor(options: TechnicalExecutionVeoProviderOptions, client?: VeoVideoGenerationClient) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw createTechnicalExecutionVeoError("NOT_CONFIGURED", "Technical Execution Veo provider requires an API key.");
    }
    if (!options.model || options.model.trim().length === 0) {
      throw createTechnicalExecutionVeoError("NOT_CONFIGURED", "Technical Execution Veo provider requires a model identifier.");
    }

    this.model = options.model;
    this.modelVersion = options.model;
    this.submitTimeoutMs = options.timeoutMs ?? TECHNICAL_EXECUTION_VEO_SUBMIT_TIMEOUT_MS;
    this.pollTimeoutMs = options.timeoutMs ?? TECHNICAL_EXECUTION_VEO_POLL_TIMEOUT_MS;
    this.client = client ?? createDefaultVeoClient(options.apiKey);
  }

  // Takes the ALREADY-assembled instruction string directly -- never builds
  // or re-derives one itself (task Section 5: the serializer is the sole
  // source).
  async submit(instruction: string, sourceImage: VideoDemonstrationSourceImageBytes): Promise<VideoDemonstrationSubmitOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.submitTimeoutMs);

    try {
      const result = await this.client.submit({
        instruction,
        imageBase64: sourceImage.buffer.toString("base64"),
        mimeType: sourceImage.mimeType,
        model: this.model,
        signal: controller.signal,
      });

      if (!result.operationName) {
        throw createTechnicalExecutionVeoError("INVALID_RESPONSE", "Veo did not return a usable operation identity.", false);
      }

      return { providerOperationId: result.operationName };
    } catch (error) {
      throw classifyTechnicalExecutionVeoError(error, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async poll(providerOperationId: string): Promise<VideoDemonstrationPollOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.pollTimeoutMs);

    try {
      const result = await this.client.poll({ operationName: providerOperationId, signal: controller.signal });

      if (!result.done) {
        return { done: false };
      }

      if (result.errorMessage) {
        throw createTechnicalExecutionVeoError("MODERATION_REFUSED", `Veo could not generate this video (${result.errorMessage}).`, false);
      }

      if (!result.videoBytesBase64) {
        throw createTechnicalExecutionVeoError("INVALID_RESPONSE", "Veo reported completion but no usable video bytes could be obtained.", false);
      }

      return {
        done: true,
        videoBuffer: Buffer.from(result.videoBytesBase64, "base64"),
        mimeType: result.videoMimeType ?? "video/mp4",
        durationSeconds: TECHNICAL_EXECUTION_VEO_REQUESTED_DURATION_SECONDS,
      };
    } catch (error) {
      throw classifyTechnicalExecutionVeoError(error, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
}

function createTechnicalExecutionVeoError(code: VideoDemonstrationProviderError["code"], message: string, retryable = false): VideoDemonstrationProviderError {
  const err = new Error(message) as VideoDemonstrationProviderError;
  err.code = code;
  err.retryable = retryable;
  return err;
}

function isTechnicalExecutionVeoError(error: unknown): error is VideoDemonstrationProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.response?.status === "number") return candidate.response.status;
  return undefined;
}

function classifyTechnicalExecutionVeoError(error: unknown, signal: AbortSignal): VideoDemonstrationProviderError {
  if (isTechnicalExecutionVeoError(error)) {
    return error;
  }
  if (signal.aborted) {
    return createTechnicalExecutionVeoError("TIMEOUT", "Veo request timed out.", true);
  }

  const status = extractHttpStatus(error);
  if (status === 401 || status === 403) {
    return createTechnicalExecutionVeoError("NOT_CONFIGURED", "Veo authentication failed.", false);
  }
  if (status === 404) {
    return createTechnicalExecutionVeoError("OPERATION_NOT_FOUND", "Veo operation not found.", false);
  }
  if (status === 429) {
    return createTechnicalExecutionVeoError("RATE_LIMITED", "Veo rate limit exceeded.", true);
  }
  if (typeof status === "number" && status >= 500) {
    return createTechnicalExecutionVeoError("PROVIDER_ERROR", "Veo service unavailable.", true);
  }
  return createTechnicalExecutionVeoError("PROVIDER_ERROR", "Veo request failed.", false);
}
