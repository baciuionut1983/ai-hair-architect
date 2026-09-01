import { randomUUID } from "crypto";
import { rm, readFile } from "fs/promises";
import os from "os";
import path from "path";

import { GoogleGenAI, type Video } from "@google/genai";

import { assembleVeoVideoDemonstrationInstruction } from "./video-generation-instruction-assembler";
import {
  VideoDemonstrationProvider,
  type VideoDemonstrationPollOutcome,
  type VideoDemonstrationProviderError,
  type VideoDemonstrationSourceImageBytes,
  type VideoDemonstrationSubmitOutcome,
} from "./video-provider";
import type { SealedVideoDemonstrationRequest } from "./video-generation-contracts";

// Real AI Video Demonstration -- the real Veo adapter. Built and
// SDK-verified in Stage 1 against the currently-installed @google/genai
// package's own real .d.ts types, not guessed -- ai.models.generateVideos /
// ai.operations.getVideosOperation both genuinely exist in the installed
// 2.15.0 SDK, confirmed by direct inspection of
// node_modules/@google/genai/dist/genai.d.ts.
//
// This adapter is REAL and functionally complete, but no test in this
// codebase ever exercises its default (real) client construction path --
// see video-generation-execution-service.ts's own "network safety" test,
// which mirrors photo-preview-execution-service.test.ts's identical
// guarantee.
//
// MODEL ID -- RESOLVED, Stage 2, and the request SHAPE separately
// RESOLVED after a real test: independently re-verified live against the
// CURRENT official docs -- ai.google.dev/gemini-api/docs/models (model
// catalog) AND ai.google.dev/gemini-api/docs/pricing (billing table,
// independently listing the same three ids with real per-second USD
// pricing). Both pages agree: the only real, current, billable Veo model
// ids are veo-3.1-generate-preview, veo-3.1-fast-generate-preview, and
// veo-3.1-lite-generate-preview (all status Preview, not GA) -- see
// video-generation-provider-config.ts's own VIDEO_DEMONSTRATION_ALLOWED_VEO_MODELS
// for the enforced allowlist. The installed SDK's own doc-comment example
// (`veo-2.0-generate-001`) is confirmed to be a stale example, not evidence
// against the newer ids -- the `model` parameter is a plain string, never
// validated by the SDK itself.
//
// The model id itself was CONFIRMED CORRECT by the first real, authorized
// paid test (2026-09-01, one submit, model veo-3.1-lite-generate-preview):
// the failure was traced to the request SHAPE (see the `source` fix at the
// submit() call site below), never to the model id -- no "unknown model"
// style error was ever reported.
//
// OUTPUT RETRIEVAL -- RESOLVED, Stage 2: live doc research (task §1) found
// that a real Veo response is URI-based by default (the SDK's own canonical
// example logs `operation.response.generatedVideos[0].video.uri`, not
// `.videoBytes`), and that "generated videos are stored on the server for
// 2 days, after which they are removed" -- confirming Stage 1's own
// "URI-based retrieval is not implemented by this adapter yet" path would
// have been the COMMON case for a real call, not a rare edge case. Fixed
// this stage: downloadGeneratedVeoVideo() below uses the SDK's own
// authenticated ai.files.download() (confirmed real via direct .d.ts
// inspection -- DownloadableFileUnion explicitly includes the SDK's own
// Video type) to fetch the real bytes server-side into a durable-storage-
// ready Buffer, never treating the temporary provider URI itself as
// permanent storage (task §9's own explicit rule).

export const VEO_VIDEO_DEMONSTRATION_PROVIDER_NAME = "google";
// Video generation is documented (task §7 of Video Stage 0, fetched from
// ai.google.dev/gemini-api/docs/veo) to take 11 seconds to up to 6 minutes
// at peak hours. This timeout bounds the SUBMIT call only (which the docs
// describe as returning near-instantly with an operation handle) -- it is
// deliberately NOT a bound on total generation time, since polling is a
// separate, repeated, short-lived operation, not one long-held connection.
export const VEO_VIDEO_DEMONSTRATION_SUBMIT_TIMEOUT_MS = 30_000;
export const VEO_VIDEO_DEMONSTRATION_POLL_TIMEOUT_MS = 30_000;

// Stage 2 metering fix (task §10): the real Veo `Video` response object
// carries NO duration field at all (confirmed by direct .d.ts inspection --
// {uri?, videoBytes?, mimeType?}, nothing else) -- there is no
// provider-reported duration to read back after generation. Duration IS,
// however, one of a small set of DISCRETE values the request itself
// chooses (docs: 4s / 6s / 8s, not a range) -- so this adapter requests a
// FIXED, explicit value here and reports that SAME value back as the
// duration for metering, rather than either inventing a measured number or
// leaving usage.videoSeconds silently empty for every real call. This is
// explicitly a REQUESTED value, not an independently-verified
// provider-confirmed one -- video-generation-execution-service.ts's own
// metering call sources it from here, never from re-inspecting the
// downloaded file (no video-parsing dependency exists in this codebase,
// and adding one is out of this stage's scope).
export const VEO_VIDEO_DEMONSTRATION_REQUESTED_DURATION_SECONDS = 6;

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
        // Stage 2: the real client (createDefaultVeoClient below) now
        // downloads a URI-based response's real bytes itself (task §9) and
        // always returns videoBytesBase64 populated for a genuine
        // done:true success -- so reaching this branch means the
        // VeoVideoGenerationClient this provider was constructed with
        // (real or a test double) reported completion without ever
        // producing usable bytes, which is a distinct, honest
        // INVALID_RESPONSE outcome, never silently treated as success with
        // no video.
        throw this.createProviderError("INVALID_RESPONSE", "Veo reported completion but no usable video bytes could be obtained.", false);
      }

      return {
        done: true,
        videoBuffer: Buffer.from(result.videoBytesBase64, "base64"),
        mimeType: result.videoMimeType ?? "video/mp4",
        // Requested, not provider-confirmed -- see this constant's own
        // doc comment for why no provider-reported alternative exists.
        durationSeconds: VEO_VIDEO_DEMONSTRATION_REQUESTED_DURATION_SECONDS,
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
      // Real-test fix: the FIRST (and only) authorized real Veo submit
      // (2026-09-01) failed in ~24ms, before any providerOperationId was
      // ever produced -- the server log showed the SDK's own runtime
      // warning: "The generateVideos method with prompt/image/video
      // arguments is deprecated and will be removed in a future major
      // release... Please use the source argument instead." Both shapes
      // are still present in the installed SDK's own GenerateVideosParameters
      // type (re-confirmed directly from node_modules/@google/genai/dist/genai.d.ts
      // before making this change -- GenerateVideosSource has the identical
      // {prompt?, image?, video?} shape), so this was never a type error,
      // only a runtime one. Nesting under `source` is a pure request-shape
      // change -- nothing about model/config/duration/aspectRatio/
      // personGeneration below is touched.
      const operation = await ai.models.generateVideos({
        model,
        source: { image: { imageBytes: imageBase64, mimeType }, prompt: instruction },
        config: {
          aspectRatio: "9:16",
          generateAudio: false,
          // Confirmed this stage (live doc research, task §1): EU/UK/CH/MENA
          // regions REQUIRE personGeneration: "allow_adult" -- hardcoded here
          // deliberately, since it is the one value valid in every region,
          // never a caller-configurable choice.
          personGeneration: "allow_adult",
          // Explicit, not left to an undocumented provider default -- see
          // VEO_VIDEO_DEMONSTRATION_REQUESTED_DURATION_SECONDS's own doc
          // comment (Stage 2, task §10) for why this exact value is also
          // what gets reported for metering.
          durationSeconds: VEO_VIDEO_DEMONSTRATION_REQUESTED_DURATION_SECONDS,
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
      if (generated?.videoBytes) {
        // Inline bytes -- not the common real-world case (see this file's
        // own header comment), but handled directly when the provider does
        // supply them, with no download round-trip needed.
        return { done: true, errorMessage: undefined, videoUri: generated.uri, videoBytesBase64: generated.videoBytes, videoMimeType: generated.mimeType };
      }
      if (generated?.uri) {
        // The real, common case: fetch the actual bytes server-side, now,
        // while the provider's own 2-day retention window is fresh --
        // never hand the temporary provider URI back as if it were
        // permanent storage (task §9).
        const videoBytesBase64 = (await downloadGeneratedVeoVideo(ai, generated)).toString("base64");
        return { done: true, errorMessage: undefined, videoUri: generated.uri, videoBytesBase64, videoMimeType: generated.mimeType };
      }
      return { done: true, errorMessage: undefined, videoUri: undefined, videoBytesBase64: undefined, videoMimeType: undefined };
    },
  };
}

/**
 * Downloads a completed Veo video's real bytes server-side, using the
 * SDK's own authenticated ai.files.download() (never a raw unauthenticated
 * fetch of the provider URI, and never the provider URI treated as
 * permanent storage -- task §9). The SDK only offers a download-to-path
 * method (no direct in-memory bytes method exists for a generated video --
 * confirmed by inspecting the real DownloadableFileUnion/Files types this
 * stage), so this writes to a per-call temp file under the OS temp
 * directory and reads it back into a Buffer, always cleaning up the temp
 * file in a `finally` -- even on a failed/partial download.
 */
async function downloadGeneratedVeoVideo(ai: GoogleGenAI, video: Video): Promise<Buffer> {
  const tempPath = path.join(os.tmpdir(), `veo-video-download-${randomUUID()}.tmp`);
  try {
    await ai.files.download({ file: video, downloadPath: tempPath });
    return await readFile(tempPath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
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
