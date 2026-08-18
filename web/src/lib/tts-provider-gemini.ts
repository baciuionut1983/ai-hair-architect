import { GoogleGenAI, Modality } from "@google/genai";

import type { AiUsageQuantities } from "./ai-usage-contracts";
import { mapGeminiUsageMetadata, type GeminiRawUsageMetadata } from "./gemini-usage-mapper";

// Speech generation via Gemini's native TTS (generateContent +
// responseModalities:[AUDIO] + speechConfig) -- the SAME @google/genai
// SDK, and the SAME generateContent call shape, already used by
// consultation-chat-provider-gemini.ts and image-analysis-provider-gemini.ts,
// confirmed against this app's actually-installed SDK version's own type
// declarations (genai.d.ts), not just public docs (an earlier fetch of
// the public docs page returned a materially different, likely stale/
// mismatched request shape). No new provider abstraction hierarchy here,
// deliberately -- this is a single call site, same reasoning voice-transcript/
// route.ts already gives for calling Gemini directly rather than inventing
// a speculative multi-provider contract for one integration.
export const GEMINI_TTS_PROVIDER_NAME = "gemini";
export const GEMINI_TTS_DEFAULT_TIMEOUT_MS = 20_000;
// A single, fixed, neutral prebuilt voice -- this task is about correct
// LANGUAGE/pronunciation coverage via speechConfig.languageCode, not voice
// personality selection (out of scope; the registry does not currently
// model per-language "best" voice choices, and Gemini's languageCode
// already steers pronunciation correctly regardless of which of the 30
// prebuilt voices is asked to speak it).
export const GEMINI_TTS_DEFAULT_VOICE_NAME = "Kore";

export type TtsProviderErrorCode = "TIMEOUT" | "RATE_LIMITED" | "NOT_CONFIGURED" | "INVALID_FORMAT" | "PROVIDER_ERROR";

export interface TtsProviderError extends Error {
  code: TtsProviderErrorCode;
  retryable: boolean;
  status?: number;
}

export interface SynthesizeSpeechInput {
  text: string;
  languageCode: string;
  model: string;
  signal: AbortSignal;
  // AI Usage & Cost Metering Phase 1: see GeminiChatGenerateInput's own
  // onUsage comment (consultation-chat-provider-gemini.ts) -- identical
  // reasoning and identical backward-compatibility guarantee for this
  // file's own existing tests.
  onUsage?: (usage: GeminiRawUsageMetadata | undefined, providerRequestId: string | undefined) => void;
}

export interface SynthesizeSpeechResult {
  // Base64-encoded raw PCM audio (see tts-audio-format.ts for why this
  // needs a WAV header before it's playable).
  audioBase64: string;
  mimeType: string;
  usage?: AiUsageQuantities;
  providerRequestId?: string;
}

/**
 * Minimal client seam, matching the same pattern as
 * GeminiGenerateContentClient/GeminiChatGenerateClient -- keeps this
 * provider's own error classification testable with a plain mock, no live
 * network calls, no SDK internals leaking into tests.
 */
export interface GeminiTtsClient {
  synthesizeSpeech(input: SynthesizeSpeechInput): Promise<SynthesizeSpeechResult | undefined>;
}

export interface GeminiTtsProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export class GeminiTtsProvider {
  readonly name = GEMINI_TTS_PROVIDER_NAME;
  readonly modelVersion: string;

  private readonly client: GeminiTtsClient;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiTtsProviderOptions, client?: GeminiTtsClient) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw createTtsProviderError("NOT_CONFIGURED", "Gemini TTS provider requires an API key.");
    }
    if (!options.model || options.model.trim().length === 0) {
      throw createTtsProviderError("NOT_CONFIGURED", "Gemini TTS provider requires a model identifier.");
    }

    this.model = options.model;
    this.modelVersion = options.model;
    this.timeoutMs = options.timeoutMs ?? GEMINI_TTS_DEFAULT_TIMEOUT_MS;
    this.client = client ?? createDefaultGeminiTtsClient(options.apiKey, this.timeoutMs);
  }

  async synthesize(text: string, languageCode: string): Promise<SynthesizeSpeechResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // Captured via closure, not provider-instance state -- see
    // GeminiConsultationChatProvider.respond's identical comment for why.
    let capturedUsage: GeminiRawUsageMetadata | undefined;
    let capturedRequestId: string | undefined;

    try {
      const result = await this.client.synthesizeSpeech({
        text,
        languageCode,
        model: this.model,
        signal: controller.signal,
        onUsage: (usage, requestId) => {
          capturedUsage = usage;
          capturedRequestId = requestId;
        },
      });
      if (!result || !result.audioBase64) {
        throw createTtsProviderError("INVALID_FORMAT", "Gemini TTS returned no audio.");
      }
      const usage = mapGeminiUsageMetadata(capturedUsage);
      return {
        ...result,
        ...(usage ? { usage } : {}),
        ...(capturedRequestId ? { providerRequestId: capturedRequestId } : {}),
      };
    } catch (error) {
      throw classifyTtsError(error, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
}

function createDefaultGeminiTtsClient(apiKey: string, timeoutMs: number): GeminiTtsClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    async synthesizeSpeech({ text, languageCode, model, signal, onUsage }: SynthesizeSpeechInput) {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text }] }],
        config: {
          abortSignal: signal,
          httpOptions: { timeout: timeoutMs },
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            languageCode,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_DEFAULT_VOICE_NAME } },
          },
        },
      });
      onUsage?.(response.usageMetadata, response.responseId);

      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inlineData?.data) return undefined;
      return { audioBase64: inlineData.data, mimeType: inlineData.mimeType ?? "audio/L16;rate=24000" };
    },
  };
}

function createTtsProviderError(code: TtsProviderErrorCode, message: string, retryable = false, status?: number): TtsProviderError {
  const error = new Error(message) as TtsProviderError;
  error.code = code;
  error.retryable = retryable;
  if (status !== undefined) error.status = status;
  return error;
}

function isTtsProviderError(error: unknown): error is TtsProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

// Same classification shape as consultation-chat-provider-gemini.ts's and
// image-analysis-provider-gemini.ts's own classifyError -- kept identical
// on purpose so voice-reply/route.ts can reuse the exact same
// code->HTTP-status mapping the chat service already uses
// (CONSULTATION_CHAT_RESULT_HTTP_STATUS), rather than inventing a third,
// slightly-different convention. This is also the direct fix for the
// live 429-masked-as-502 regression: RATE_LIMITED is classified
// explicitly here, never falls through to the generic PROVIDER_ERROR
// bucket.
function classifyTtsError(error: unknown, signal: AbortSignal): TtsProviderError {
  if (isTtsProviderError(error)) return error;
  if (signal.aborted) {
    return createTtsProviderError("TIMEOUT", "Gemini TTS request timed out.", true);
  }

  const status = extractHttpStatus(error);
  if (status === 401 || status === 403) {
    return createTtsProviderError("NOT_CONFIGURED", "Gemini TTS authentication failed.", false, status);
  }
  if (status === 429) {
    return createTtsProviderError("RATE_LIMITED", "Gemini TTS rate limit exceeded.", true, status);
  }
  if (typeof status === "number" && status >= 500) {
    return createTtsProviderError("PROVIDER_ERROR", "Gemini TTS service unavailable.", true, status);
  }
  return createTtsProviderError("PROVIDER_ERROR", "Gemini TTS request failed.", false, status);
}
