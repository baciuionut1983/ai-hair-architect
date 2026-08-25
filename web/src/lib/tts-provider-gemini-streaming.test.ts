import { describe, expect, it } from "vitest";
import type { GenerateContentResponse } from "@google/genai";

import {
  GEMINI_TTS_STREAMING_DEFAULT_TIMEOUT_MS,
  GEMINI_TTS_STREAMING_PROVIDER_NAME,
  GeminiTtsStreamingProvider,
  type GeminiTtsStreamingClient,
  type StreamingTtsChunk,
  type SynthesizeStreamInput,
} from "./tts-provider-gemini-streaming";

// Builds a fake raw response shaped exactly like the real, live-confirmed
// Gemini stream chunk: candidates[0].content.parts[0].inlineData.{data,
// mimeType}. `as unknown as GenerateContentResponse` sidesteps
// GenerateContentResponse's own getter-bearing class shape -- the
// provider only ever reads `.candidates`, never constructs one.
function rawChunkResponse(base64Data: string, mimeType: string): GenerateContentResponse {
  return {
    candidates: [{ content: { parts: [{ inlineData: { data: base64Data, mimeType } }] } }],
  } as unknown as GenerateContentResponse;
}

// The real terminal chunk observed live: no inlineData at all, only a
// finishReason -- must be skipped, never yielded as an empty chunk.
function terminalResponseWithNoInlineData(): GenerateContentResponse {
  return {
    candidates: [{ content: { parts: [{}] }, finishReason: "STOP" }],
  } as unknown as GenerateContentResponse;
}

async function* asyncGeneratorOf(responses: GenerateContentResponse[]): AsyncGenerator<GenerateContentResponse> {
  for (const response of responses) {
    yield response;
  }
}

function fixedStreamClient(responses: GenerateContentResponse[]): GeminiTtsStreamingClient {
  return { async generateContentStream() { return asyncGeneratorOf(responses); } };
}

function recordingStreamClient(sink: { input?: SynthesizeStreamInput }, responses: GenerateContentResponse[]): GeminiTtsStreamingClient {
  return {
    async generateContentStream(input) {
      sink.input = input;
      return asyncGeneratorOf(responses);
    },
  };
}

function rejectingStreamClient(error: unknown): GeminiTtsStreamingClient {
  return { async generateContentStream() { throw error; } };
}

function hangingUntilAbortedStreamClient(): GeminiTtsStreamingClient {
  return {
    generateContentStream({ signal }) {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    },
  };
}

function httpError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of generator) items.push(item);
  return items;
}

const CHUNK_ONE_BASE64 = Buffer.from("chunk-one-pcm-bytes").toString("base64");
const CHUNK_TWO_BASE64 = Buffer.from("chunk-two-pcm-bytes").toString("base64");

describe("GeminiTtsStreamingProvider construction", () => {
  it("throws NOT_CONFIGURED for a missing or blank API key", () => {
    expect(() => new GeminiTtsStreamingProvider({ apiKey: "", model: "gemini-3.1-flash-tts-preview" })).toThrow();
    expect(() => new GeminiTtsStreamingProvider({ apiKey: "   ", model: "gemini-3.1-flash-tts-preview" })).toThrow();
  });

  it("throws NOT_CONFIGURED for a missing or blank model", () => {
    expect(() => new GeminiTtsStreamingProvider({ apiKey: "key", model: "" })).toThrow();
  });

  it("exposes its own name and model version", () => {
    const provider = new GeminiTtsStreamingProvider({ apiKey: "key", model: "gemini-3.1-flash-tts-preview" }, fixedStreamClient([]));
    expect(provider.name).toBe(GEMINI_TTS_STREAMING_PROVIDER_NAME);
    expect(provider.modelVersion).toBe("gemini-3.1-flash-tts-preview");
  });

  it("defaults the timeout to 20 seconds when not overridden", () => {
    expect(GEMINI_TTS_STREAMING_DEFAULT_TIMEOUT_MS).toBe(20_000);
  });
});

describe("GeminiTtsStreamingProvider.synthesizeStream -- success path", () => {
  it("yields multiple chunks with correct pcm/mimeType, in order", async () => {
    const provider = new GeminiTtsStreamingProvider(
      { apiKey: "key", model: "gemini-3.1-flash-tts-preview" },
      fixedStreamClient([
        rawChunkResponse(CHUNK_ONE_BASE64, "audio/L16;rate=24000"),
        rawChunkResponse(CHUNK_TWO_BASE64, "audio/L16;rate=24000"),
      ]),
    );

    const chunks: StreamingTtsChunk[] = await collect(provider.synthesizeStream("Hello there", "en"));

    expect(chunks).toHaveLength(2);
    expect(chunks[0].pcm).toEqual(Buffer.from("chunk-one-pcm-bytes"));
    expect(chunks[0].mimeType).toBe("audio/L16;rate=24000");
    expect(chunks[1].pcm).toEqual(Buffer.from("chunk-two-pcm-bytes"));
    expect(chunks[1].mimeType).toBe("audio/L16;rate=24000");
  });

  it("falls back to the documented default mimeType when a chunk omits it", async () => {
    const provider = new GeminiTtsStreamingProvider(
      { apiKey: "key", model: "m" },
      fixedStreamClient([{ candidates: [{ content: { parts: [{ inlineData: { data: CHUNK_ONE_BASE64 } }] } }] } as unknown as GenerateContentResponse]),
    );

    const [chunk] = await collect(provider.synthesizeStream("text", "en"));
    expect(chunk.mimeType).toBe("audio/L16;rate=24000");
  });

  it("skips a terminal chunk with no inlineData -- the real terminal chunk observed live carries only a finishReason", async () => {
    const provider = new GeminiTtsStreamingProvider(
      { apiKey: "key", model: "m" },
      fixedStreamClient([rawChunkResponse(CHUNK_ONE_BASE64, "audio/L16;rate=24000"), terminalResponseWithNoInlineData()]),
    );

    const chunks = await collect(provider.synthesizeStream("text", "en"));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].pcm).toEqual(Buffer.from("chunk-one-pcm-bytes"));
  });

  it("forwards the exact text, canonical languageCode, and model to the client", async () => {
    const sink: { input?: SynthesizeStreamInput } = {};
    const provider = new GeminiTtsStreamingProvider({ apiKey: "key", model: "gemini-3.1-flash-tts-preview" }, recordingStreamClient(sink, []));

    await collect(provider.synthesizeStream("Clienta va reveni saptamana viitoare.", "ro"));

    expect(sink.input?.text).toBe("Clienta va reveni saptamana viitoare.");
    expect(sink.input?.languageCode).toBe("ro");
    expect(sink.input?.model).toBe("gemini-3.1-flash-tts-preview");
  });
});

describe("GeminiTtsStreamingProvider.synthesizeStream -- error classification", () => {
  it("classifies a timeout (abort) as TIMEOUT, retryable", async () => {
    const provider = new GeminiTtsStreamingProvider({ apiKey: "key", model: "m", timeoutMs: 5 }, hangingUntilAbortedStreamClient());
    await expect(collect(provider.synthesizeStream("text", "en"))).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("classifies a 401/403 as NOT_CONFIGURED, non-retryable", async () => {
    const provider401 = new GeminiTtsStreamingProvider({ apiKey: "key", model: "m" }, rejectingStreamClient(httpError(401, "unauthorized")));
    const provider403 = new GeminiTtsStreamingProvider({ apiKey: "key", model: "m" }, rejectingStreamClient(httpError(403, "forbidden")));
    await expect(collect(provider401.synthesizeStream("text", "en"))).rejects.toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
    await expect(collect(provider403.synthesizeStream("text", "en"))).rejects.toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
  });

  it("classifies a 429 as RATE_LIMITED, retryable -- never collapsed into a generic failure", async () => {
    const provider = new GeminiTtsStreamingProvider({ apiKey: "key", model: "m" }, rejectingStreamClient(httpError(429, "quota exceeded")));
    await expect(collect(provider.synthesizeStream("text", "en"))).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true, status: 429 });
  });

  it("classifies a 5xx as a retryable PROVIDER_ERROR", async () => {
    const provider = new GeminiTtsStreamingProvider({ apiKey: "key", model: "m" }, rejectingStreamClient(httpError(503, "service unavailable")));
    await expect(collect(provider.synthesizeStream("text", "en"))).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });

  it("classifies an unrecognized failure as a non-retryable PROVIDER_ERROR without leaking the underlying message", async () => {
    const provider = new GeminiTtsStreamingProvider({ apiKey: "key", model: "m" }, rejectingStreamClient(new Error("internal-secret-diagnostic-string")));
    await expect(collect(provider.synthesizeStream("text", "en"))).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
    try {
      await collect(provider.synthesizeStream("text", "en"));
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("internal-secret-diagnostic-string");
    }
  });

  it("propagates a mid-stream failure after some chunks were already yielded, still correctly classified", async () => {
    async function* midStreamFailure(): AsyncGenerator<GenerateContentResponse> {
      yield rawChunkResponse(CHUNK_ONE_BASE64, "audio/L16;rate=24000");
      throw httpError(503, "dropped mid-stream");
    }
    const provider = new GeminiTtsStreamingProvider(
      { apiKey: "key", model: "m" },
      { async generateContentStream() { return midStreamFailure(); } },
    );

    const generator = provider.synthesizeStream("text", "en");
    const first = await generator.next();
    expect(first.done).toBe(false);
    expect(first.value?.pcm).toEqual(Buffer.from("chunk-one-pcm-bytes"));

    await expect(generator.next()).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true, status: 503 });
  });
});
