import { GoogleGenAI, Modality } from "@google/genai";

import { assembleGeminiPhotoPreviewInstruction } from "./photo-preview-instruction-assembler";
import {
  PhotoPreviewProvider,
  type PhotoPreviewGenerationOutcome,
  type PhotoPreviewProviderError,
  type PhotoPreviewSourceImageBytes,
} from "./photo-preview-provider";
import type { SealedPhotoPreviewRequest } from "./photo-preview-contracts";
import { mapGeminiUsageMetadata, type GeminiRawUsageMetadata } from "./gemini-usage-mapper";

// Real AI Photo Preview, Stage 2 -- the real Gemini image-editing adapter.
//
// Uses image-EDITING semantics, not the vision-analysis endpoint blindly
// reused: the request differs (an inlineData image PLUS a text instruction,
// same as vision) but the response differs materially -- vision asks for
// `responseMimeType: "application/json"` and reads `response.text`; image
// generation instead sets `responseModalities: [Modality.IMAGE]` and the
// generated image comes back as an `inlineData` PART on the first
// candidate, never as `.text`. This file never assumes position 0 is the
// image part -- it searches every part of the first candidate (task §14).
//
// Same @google/genai SDK version already used for vision/chat/TTS in this
// codebase (confirmed installed: 2.15.0) -- no new dependency.

export const GEMINI_PHOTO_PREVIEW_PROVIDER_NAME = "gemini";
// Image generation is measurably slower than a JSON-only vision call (a
// full image round-trip, not a short classification) -- start from a wider
// budget than GEMINI_DEFAULT_TIMEOUT_MS (45s, itself already raised once
// after a real production timeout incident on the vision path). Override
// via PHOTO_PREVIEW_TIMEOUT_MS if a real controlled test shows this is
// still too tight.
export const GEMINI_PHOTO_PREVIEW_DEFAULT_TIMEOUT_MS = 90_000;

export interface GeminiPhotoPreviewProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface GeminiGenerateImageInput {
  instruction: string;
  imageBase64: string;
  mimeType: string;
  model: string;
  signal: AbortSignal;
  onUsage?: (usage: GeminiRawUsageMetadata | undefined, providerRequestId: string | undefined) => void;
}

export interface GeminiGenerateImageResult {
  // Undefined whenever no image part was found anywhere in the response --
  // never assumed present (task §14's own required test: "response with no
  // image rejected").
  imageBase64: string | undefined;
  imageMimeType: string | undefined;
  finishReason: string | undefined;
  blockReason: string | undefined;
}

/**
 * Minimal client seam this adapter depends on, instead of the full
 * @google/genai surface -- mirrors GeminiGenerateContentClient's own exact
 * reasoning (image-analysis-provider-gemini.ts): keeps parsing/validation/
 * error-classification testable with a plain fake, zero live network calls,
 * zero SDK internals leaking into tests.
 */
export interface GeminiGenerateImageClient {
  generateImage(input: GeminiGenerateImageInput): Promise<GeminiGenerateImageResult>;
}

export class GeminiPhotoPreviewProvider extends PhotoPreviewProvider {
  readonly name = GEMINI_PHOTO_PREVIEW_PROVIDER_NAME;
  readonly modelVersion: string;

  private readonly client: GeminiGenerateImageClient;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiPhotoPreviewProviderOptions, client?: GeminiGenerateImageClient) {
    super();

    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw this.createProviderError("NOT_CONFIGURED", "Gemini Photo Preview provider requires an API key.");
    }
    if (!options.model || options.model.trim().length === 0) {
      throw this.createProviderError("NOT_CONFIGURED", "Gemini Photo Preview provider requires a model identifier.");
    }

    this.model = options.model;
    this.modelVersion = options.model;
    this.timeoutMs = options.timeoutMs ?? GEMINI_PHOTO_PREVIEW_DEFAULT_TIMEOUT_MS;
    this.client = client ?? createDefaultGeminiImageClient(options.apiKey, this.timeoutMs);
  }

  async generate(sealedRequest: SealedPhotoPreviewRequest, sourceImage: PhotoPreviewSourceImageBytes): Promise<PhotoPreviewGenerationOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let capturedUsage: GeminiRawUsageMetadata | undefined;
    let capturedRequestId: string | undefined;

    try {
      const instruction = assembleGeminiPhotoPreviewInstruction(sealedRequest);

      const result = await this.client.generateImage({
        instruction,
        imageBase64: sourceImage.buffer.toString("base64"),
        mimeType: sourceImage.mimeType,
        model: this.model,
        signal: controller.signal,
        onUsage: (usage, requestId) => {
          capturedUsage = usage;
          capturedRequestId = requestId;
        },
      });

      if (result.blockReason || (result.finishReason && result.finishReason !== "STOP")) {
        throw this.createProviderError(
          "MODERATION_REFUSED",
          `Gemini declined to generate an image (${result.blockReason ?? result.finishReason}).`,
          false,
        );
      }
      if (!result.imageBase64 || !result.imageMimeType) {
        throw this.createProviderError("INVALID_RESPONSE", "Gemini did not return an image.", false);
      }

      // Real token counts (input/output/total) when Gemini exposed them,
      // PLUS imageCount -- we know exactly one image was requested and
      // returned at this point, that is a fact, not a fabrication.
      // mapGeminiUsageMetadata already returns undefined for an empty/
      // absent metadata object, so `usage` stays correctly absent (never a
      // fabricated all-zero object) when Gemini reported nothing at all.
      const tokenUsage = mapGeminiUsageMetadata(capturedUsage);
      const usage = tokenUsage ? { ...tokenUsage, imageCount: 1 } : { imageCount: 1 };

      return {
        imageBuffer: Buffer.from(result.imageBase64, "base64"),
        mimeType: result.imageMimeType,
        ...(capturedRequestId ? { providerRequestId: capturedRequestId } : {}),
        usage,
      };
    } catch (error) {
      throw this.classifyError(error, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private classifyError(error: unknown, signal: AbortSignal): PhotoPreviewProviderError {
    if (isPhotoPreviewProviderError(error)) {
      return error;
    }
    if (signal.aborted) {
      return this.createProviderError("TIMEOUT", "Gemini Photo Preview request timed out.", true);
    }

    const status = extractHttpStatus(error);
    if (status === 401 || status === 403) {
      return this.createProviderError("NOT_CONFIGURED", "Gemini authentication failed.", false);
    }
    if (status === 429) {
      return this.createProviderError("RATE_LIMITED", "Gemini rate limit exceeded.", true);
    }
    if (typeof status === "number" && status >= 500) {
      return this.createProviderError("PROVIDER_ERROR", "Gemini service unavailable.", true);
    }
    return this.createProviderError("PROVIDER_ERROR", "Gemini Photo Preview request failed.", false);
  }
}

function createDefaultGeminiImageClient(apiKey: string, timeoutMs: number): GeminiGenerateImageClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generateImage({ instruction, imageBase64, mimeType, model, signal, onUsage }: GeminiGenerateImageInput) {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: instruction }, { inlineData: { mimeType, data: imageBase64 } }],
          },
        ],
        config: {
          abortSignal: signal,
          httpOptions: { timeout: timeoutMs },
          // Image only -- this adapter never needs accompanying commentary
          // text back, which also keeps response validation simpler (task
          // §14: never assume the first part is the image -- still
          // defensively searched for below regardless).
          responseModalities: [Modality.IMAGE],
        },
      });

      onUsage?.(response.usageMetadata, response.responseId);

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const imagePart = parts.find((part) => part.inlineData?.data && (part.inlineData.mimeType ?? "").startsWith("image/"));

      return {
        imageBase64: imagePart?.inlineData?.data,
        imageMimeType: imagePart?.inlineData?.mimeType,
        finishReason: candidate?.finishReason,
        blockReason: response.promptFeedback?.blockReason,
      };
    },
  };
}

function isPhotoPreviewProviderError(error: unknown): error is PhotoPreviewProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.response?.status === "number") return candidate.response.status;
  return undefined;
}
