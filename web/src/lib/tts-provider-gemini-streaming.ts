import { GoogleGenAI, Modality, type GenerateContentResponse } from "@google/genai";

import type { TtsProviderError } from "./tts-provider-gemini";

// TRUE Gemini TTS streaming -- ARCHITECTURE experiment (streaming vs.
// buffer-then-play), not a model swap. This round's own real research
// already confirmed empirically: ai.models.generateContentStream (the
// SAME @google/genai SDK tts-provider-gemini.ts already uses) called with
// model 'gemini-3.1-flash-tts-preview' and the exact same
// responseModalities:[Modality.AUDIO] + speechConfig shape yields REAL
// incremental audio chunks (~1920-byte PCM chunks, first chunk in ~1s, vs.
// 8.5-13s for the existing non-streaming generateContent call). The
// current production default model, 'gemini-2.5-flash-preview-tts', does
// NOT stream meaningfully through this same API -- it returns one single
// chunk only after the full generation completes.
//
// Deliberately a NEW, standalone file -- does not modify or import any
// private/internal piece of tts-provider-gemini.ts, only reuses its
// exported TtsProviderError type so error-shape consumers (this file's
// own callers, e.g. voice-reply-stream/route.ts) can treat both
// providers' errors identically. tts-provider-gemini.ts's own production
// default (GeminiTtsProvider + TEXT_TO_SPEECH_MODEL) is completely
// untouched by this file's existence.
export const GEMINI_TTS_STREAMING_PROVIDER_NAME = "gemini";
export const GEMINI_TTS_STREAMING_DEFAULT_TIMEOUT_MS = 20_000;
// Same fixed, neutral prebuilt voice as tts-provider-gemini.ts's own
// GEMINI_TTS_DEFAULT_VOICE_NAME -- this experiment is about streaming vs.
// buffer-then-play architecture, not voice personality selection.
export const GEMINI_TTS_STREAMING_DEFAULT_VOICE_NAME = "Kore";

export interface StreamingTtsChunk {
  pcm: Buffer;
  mimeType: string;
}

export interface SynthesizeStreamInput {
  text: string;
  languageCode: string;
  model: string;
  signal: AbortSignal;
}

/**
 * Minimal client seam, mirroring tts-provider-gemini.ts's own
 * GeminiTtsClient pattern exactly: keeps GeminiTtsStreamingProvider's own
 * chunk-mapping/error-classification logic testable with a plain mock
 * async generator, no live network calls, no SDK internals leaking into
 * tests. generateContentStream returns the RAW SDK response stream (not
 * pre-mapped to StreamingTtsChunk) so the inlineData-present/absent
 * mapping and skip-the-terminal-chunk logic lives, and is directly
 * testable, in synthesizeStream itself -- see that method's own comment.
 */
export interface GeminiTtsStreamingClient {
  generateContentStream(input: SynthesizeStreamInput): Promise<AsyncGenerator<GenerateContentResponse>>;
}

export interface GeminiTtsStreamingProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export class GeminiTtsStreamingProvider {
  readonly name = GEMINI_TTS_STREAMING_PROVIDER_NAME;
  readonly modelVersion: string;

  private readonly client: GeminiTtsStreamingClient;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiTtsStreamingProviderOptions, client?: GeminiTtsStreamingClient) {
    // Same NOT_CONFIGURED validation as GeminiTtsProvider's own
    // constructor -- an empty/blank apiKey or model is a configuration
    // bug, never silently tolerated.
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw createStreamingTtsProviderError("NOT_CONFIGURED", "Gemini TTS streaming provider requires an API key.");
    }
    if (!options.model || options.model.trim().length === 0) {
      throw createStreamingTtsProviderError("NOT_CONFIGURED", "Gemini TTS streaming provider requires a model identifier.");
    }

    this.model = options.model;
    this.modelVersion = options.model;
    this.timeoutMs = options.timeoutMs ?? GEMINI_TTS_STREAMING_DEFAULT_TIMEOUT_MS;
    this.client = client ?? createDefaultGeminiTtsStreamingClient(options.apiKey);
  }

  /**
   * Calls ai.models.generateContentStream (via this.client, the real
   * default implementation of which does exactly that call -- see
   * createDefaultGeminiTtsStreamingClient below) and yields one
   * StreamingTtsChunk per real incremental audio chunk the provider
   * returns.
   *
   * generateContentStream returns Promise<AsyncGenerator<...>> -- awaited
   * once, then iterated with `for await`. For each yielded response, only
   * candidates[0].content.parts[0].inlineData.data is read: when present
   * (a base64 PCM chunk), it's decoded and yielded as a StreamingTtsChunk;
   * when absent (the real terminal chunk observed live carries no
   * inlineData, only a finishReason), that response is silently skipped
   * -- never yielded as an empty/fabricated chunk.
   */
  async *synthesizeStream(text: string, languageCode: string): AsyncGenerator<StreamingTtsChunk> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const stream = await this.client.generateContentStream({
        text,
        languageCode,
        model: this.model,
        signal: controller.signal,
      });

      for await (const response of stream) {
        const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!inlineData?.data) continue;
        yield { pcm: Buffer.from(inlineData.data, "base64"), mimeType: inlineData.mimeType ?? "audio/L16;rate=24000" };
      }
    } catch (error) {
      throw classifyStreamingTtsError(error, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
}

function createDefaultGeminiTtsStreamingClient(apiKey: string): GeminiTtsStreamingClient {
  const ai = new GoogleGenAI({ apiKey });

  return {
    generateContentStream({ text, languageCode, model, signal }: SynthesizeStreamInput) {
      return ai.models.generateContentStream({
        model,
        contents: [{ role: "user", parts: [{ text }] }],
        config: {
          abortSignal: signal,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            languageCode,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_STREAMING_DEFAULT_VOICE_NAME } },
          },
        },
      });
    },
  };
}

// A local, self-contained subset of TtsProviderErrorCode -- this file
// never imports the private code union from tts-provider-gemini.ts, only
// its public TtsProviderError interface type. INVALID_FORMAT is
// deliberately omitted: this provider never "returns no audio" the way
// the non-streaming one can (an empty stream is simply zero chunks, not
// an error) -- see voice-reply-stream/route.ts for how that case is
// handled at the route level instead.
type StreamingTtsErrorCode = "TIMEOUT" | "RATE_LIMITED" | "NOT_CONFIGURED" | "PROVIDER_ERROR";

function createStreamingTtsProviderError(code: StreamingTtsErrorCode, message: string, retryable = false, status?: number): TtsProviderError {
  const error = new Error(message) as TtsProviderError;
  error.code = code;
  error.retryable = retryable;
  if (status !== undefined) error.status = status;
  return error;
}

function isStreamingTtsProviderError(error: unknown): error is TtsProviderError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string";
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

// Own, self-contained implementation -- deliberately NOT imported from
// tts-provider-gemini.ts's own (private, unexported) classifyTtsError --
// but the exact same classification shape, on purpose: TIMEOUT/
// RATE_LIMITED/5xx are retryable, a 401/403 is NOT_CONFIGURED (non-
// retryable), and anything else collapses into a non-retryable
// PROVIDER_ERROR without leaking the underlying message.
function classifyStreamingTtsError(error: unknown, signal: AbortSignal): TtsProviderError {
  if (isStreamingTtsProviderError(error)) return error;
  if (signal.aborted) {
    return createStreamingTtsProviderError("TIMEOUT", "Gemini TTS streaming request timed out.", true);
  }

  const status = extractHttpStatus(error);
  if (status === 401 || status === 403) {
    return createStreamingTtsProviderError("NOT_CONFIGURED", "Gemini TTS streaming authentication failed.", false, status);
  }
  if (status === 429) {
    return createStreamingTtsProviderError("RATE_LIMITED", "Gemini TTS streaming rate limit exceeded.", true, status);
  }
  if (typeof status === "number" && status >= 500) {
    return createStreamingTtsProviderError("PROVIDER_ERROR", "Gemini TTS streaming service unavailable.", true, status);
  }
  return createStreamingTtsProviderError("PROVIDER_ERROR", "Gemini TTS streaming request failed.", false, status);
}
