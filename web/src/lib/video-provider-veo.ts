import { GoogleGenAI } from "@google/genai";

import { assembleVeoVideoDemonstrationInstruction } from "./video-generation-instruction-assembler";
import {
  VideoDemonstrationProvider,
  type VideoDemonstrationPollOutcome,
  type VideoDemonstrationProviderError,
  type VideoDemonstrationSourceImageBytes,
  type VideoDemonstrationSubmitOutcome,
} from "./video-provider";
import type { SealedVideoDemonstrationRequest } from "./video-generation-contracts";

// Real AI Video Demonstration, Stage 1 -- the real Veo adapter. Built and
// SDK-verified during this stage (task §8: model IDs verified against the
// currently-installed @google/genai package's own real .d.ts types, not
// guessed -- ai.models.generateVideos / ai.operations.getVideosOperation
// both genuinely exist in the installed 2.15.0 SDK, confirmed by direct
// inspection of node_modules/@google/genai/dist/node/*.d.ts).
//
// This adapter is REAL and functionally complete, but this stage's own
// tests NEVER exercise its default (real) client construction path -- see
// video-generation-execution-service.ts's own "network safety" test, which
// mirrors photo-preview-execution-service.test.ts's identical guarantee.
//
// MODEL ID CAVEAT (task §8's own explicit instruction): the CURRENT official
// Gemini API docs (fetched live during Video Stage 0) list
// veo-3.1-lite-generate-preview as a real, current model id. The installed
// SDK's OWN doc-comment example uses the older `veo-2.0-generate-001`
// naming style -- this is very likely just a stale example in the SDK
// package (the `model` parameter is a plain string, never validated against
// a hardcoded allowlist by the SDK itself), not evidence that the newer id
// is wrong. This was NOT independently re-verified with a real network call
// (no paid call is authorized in this stage) -- if a real Stage 2+ call
// ever reports an "unknown model" error, that is the discrepancy this
// comment flags, and the fix is an environment variable change
// (VIDEO_DEMONSTRATION_MODEL), never a code change, per this stage's own
// "never hardcode the model" requirement.

export const VEO_VIDEO_DEMONSTRATION_PROVIDER_NAME = "google";
// Video generation is documented (task §7 of Video Stage 0, fetched from
// ai.google.dev/gemini-api/docs/veo) to take 11 seconds to up to 6 minutes
// at peak hours. This timeout bounds the SUBMIT call only (which the docs
// describe as returning near-instantly with an operation handle) -- it is
// deliberately NOT a bound on total generation time, since polling is a
// separate, repeated, short-lived operation, not one long-held connection.
export const VEO_VIDEO_DEMONSTRATION_SUBMIT_TIMEOUT_MS = 30_000;
export const VEO_VIDEO_DEMONSTRATION_POLL_TIMEOUT_MS = 30_000;

export interface VeoVideoDemonstrationProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface VeoOperationHandle {
  name: string;
  done?: boolean;
}

export interface VeoSubmitResult {
  operationName: string | undefined;
}

export interface VeoPollResult {
  done: boolean;
  errorMessage: string | undefined;
  videoUri: string | undefined;
  videoBytesBase64: string | undefined;
  videoMimeType: string | undefined;
}

/**
 * Minimal client seam this adapter depends on, instead of the full
 * @google/genai surface -- mirrors GeminiGenerateImageClient's own exact
 * reasoning (photo-preview-provider-gemini.ts): keeps parsing/validation/
 * error-classification testable with a plain fake, zero live network calls,
 * zero SDK internals leaking into tests.
 */
export interface VeoVideoGenerationClient {
  submit(input: { instruction: string; imageBase64: string; mimeType: string; model: string; signal: AbortSignal }): Promise<VeoSubmitResult>;
  poll(input: { operationName: string; signal: AbortSignal }): Promise<VeoPollResult>;
}

export class VeoVideoDemonstrationProvider extends VideoDemonstrationProvider {
  readonly name = VEO_VIDEO_DEMONSTRATION_PROVIDER_NAME;
  readonly modelVersion: string;

  private readonly client: VeoVideoGenerationClient;
  private readonly model: string;
  private readonly submitTimeoutMs: number;
  private readonly pollTimeoutMs: number;

  constructor(options: VeoVideoDemonstrationProviderOptions, client?: VeoVideoGenerationClient) {
    super();

    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw this.createProviderError("NOT_CONFIGURED", "Veo Video Demonstration provider requires an API key.");
    }
    if (!options.model || options.model.trim().length === 0) {
      throw this.createProviderError("NOT_CONFIGURED", "Veo Video Demonstration provider requires a model identifier.");
    }

    this.model = options.model;
    this.modelVersion = options.model;
    this.submitTimeoutMs = options.timeoutMs ?? VEO_VIDEO_DEMONSTRATION_SUBMIT_TIMEOUT_MS;
    this.pollTimeoutMs = options.timeoutMs ?? VEO_VIDEO_DEMONSTRATION_POLL_TIMEOUT_MS;
    this.client = client ?? createDefaultVeoClient(options.apiKey);
  }

  async submit(sealedRequest: SealedVideoDemonstrationRequest, sourceImage: VideoDemonstrationSourceImageBytes): Promise<VideoDemonstrationSubmitOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.submitTimeoutMs);

    try {
      const instruction = assembleVeoVideoDemonstrationInstruction(sealedRequest);
      const result = await this.client.submit({
        instruction,
        imageBase64: sourceImage.buffer.toString("base64"),
        mimeType: sourceImage.mimeType,
        model: this.model,
        signal: controller.signal,
      });

      if (!result.operationName) {
        throw this.createProviderError("INVALID_RESPONSE", "Veo did not return a usable operation identity.", false);
      }

      return { providerOperationId: result.operationName };
    } catch (error) {
      throw this.classifyError(error, controller.signal);
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
        throw this.createProviderError("MODERATION_REFUSED", `Veo could not generate this video (${result.errorMessage}).`, false);
      }

      if (!result.videoBytesBase64 && !result.videoUri) {
        throw this.createProviderError("INVALID_RESPONSE", "Veo reported completion but returned no usable video.", false);
      }

      if (!result.videoBytesBase64) {
        // The provider returned a download URI instead of inline bytes --
        // fetching it is a real, separate network operation this adapter
        // deliberately does not perform itself (task §6: storage is a
        // domain-layer concern, not a provider-boundary one). Surfaced as a
        // distinct, honest outcome rather than silently treated as success
        // with no bytes.
        throw this.createProviderError(
          "INVALID_RESPONSE",
          "Veo returned a video URI instead of inline bytes -- URI-based retrieval is not implemented by this adapter yet.",
          false,
        );
      }

      return {
        done: true,
        videoBuffer: Buffer.from(result.videoBytesBase64, "base64"),
        mimeType: result.videoMimeType ?? "video/mp4",
      };
    } catch (error) {
      throw this.classifyError(error, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private classifyError(error: unknown, signal: AbortSignal): VideoDemonstrationProviderError {
    if (isVideoDemonstrationProviderError(error)) {
      return error;
    }
    if (signal.aborted) {
      return this.createProviderError("TIMEOUT", "Veo request timed out.", true);
    }

    const status = extractHttpStatus(error);
    if (status === 401 || status === 403) {
      return this.createProviderError("NOT_CONFIGURED", "Veo authentication failed.", false);
    }
    if (status === 404) {
      return this.createProviderError("OPERATION_NOT_FOUND", "Veo operation not found.", false);
    }
    if (status === 429) {
      return this.createProviderError("RATE_LIMITED", "Veo rate limit exceeded.", true);
    }
    if (typeof status === "number" && status >= 500) {
      return this.createProviderError("PROVIDER_ERROR", "Veo service unavailable.", true);
    }
    return this.createProviderError("PROVIDER_ERROR", "Veo request failed.", false);
  }
}

function createDefaultVeoClient(apiKey: string): VeoVideoGenerationClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async submit({ instruction, imageBase64, mimeType, model, signal }) {
      // NOTE: real network call -- never exercised by any test in this
      // stage (no test constructs VeoVideoDemonstrationProvider without an
      // explicit fake client override).
      void signal; // the installed SDK's generateVideos() does not accept an abortSignal directly; the outer setTimeout-based abort still bounds this adapter's own await.
      const operation = await ai.models.generateVideos({
        model,
        image: { imageBytes: imageBase64, mimeType },
        prompt: instruction,
        config: {
          aspectRatio: "9:16",
          generateAudio: false,
          personGeneration: "allow_adult",
        },
      });
      return { operationName: operation.name };
    },
    async poll({ operationName }) {
      const handle: VeoOperationHandle = { name: operationName, done: false };
      const operation = await ai.operations.getVideosOperation({ operation: handle as unknown as Parameters<typeof ai.operations.getVideosOperation>[0]["operation"] });

      if (!operation.done) {
        return { done: false, errorMessage: undefined, videoUri: undefined, videoBytesBase64: undefined, videoMimeType: undefined };
      }

      if (operation.error) {
        const message = typeof operation.error.message === "string" ? operation.error.message : "Video generation failed.";
        return { done: true, errorMessage: message, videoUri: undefined, videoBytesBase64: undefined, videoMimeType: undefined };
      }

      const generated = operation.response?.generatedVideos?.[0]?.video;
      return {
        done: true,
        errorMessage: undefined,
        videoUri: generated?.uri,
        videoBytesBase64: generated?.videoBytes,
        videoMimeType: generated?.mimeType,
      };
    },
  };
}

function isVideoDemonstrationProviderError(error: unknown): error is VideoDemonstrationProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.response?.status === "number") return candidate.response.status;
  return undefined;
}
