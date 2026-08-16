import { describe, expect, it } from "vitest";

import {
  GEMINI_TTS_DEFAULT_TIMEOUT_MS,
  GEMINI_TTS_PROVIDER_NAME,
  GeminiTtsProvider,
  type GeminiTtsClient,
  type SynthesizeSpeechInput,
} from "./tts-provider-gemini";

function fixedClient(result: { audioBase64: string; mimeType: string } | undefined): GeminiTtsClient {
  return { async synthesizeSpeech() { return result; } };
}

function rejectingClient(error: unknown): GeminiTtsClient {
  return { async synthesizeSpeech() { throw error; } };
}

function recordingClient(sink: { input?: SynthesizeSpeechInput }, result: { audioBase64: string; mimeType: string }): GeminiTtsClient {
  return {
    async synthesizeSpeech(input) {
      sink.input = input;
      return result;
    },
  };
}

function hangingUntilAbortedClient(): GeminiTtsClient {
  return {
    synthesizeSpeech({ signal }) {
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

const SAMPLE_RESULT = { audioBase64: "ZmFrZS1hdWRpby1ieXRlcw==", mimeType: "audio/L16;rate=24000" };

describe("GeminiTtsProvider construction", () => {
  it("throws NOT_CONFIGURED for a missing or blank API key", () => {
    expect(() => new GeminiTtsProvider({ apiKey: "", model: "gemini-2.5-flash-preview-tts" })).toThrow();
    expect(() => new GeminiTtsProvider({ apiKey: "   ", model: "gemini-2.5-flash-preview-tts" })).toThrow();
  });

  it("throws NOT_CONFIGURED for a missing or blank model", () => {
    expect(() => new GeminiTtsProvider({ apiKey: "key", model: "" })).toThrow();
  });

  it("exposes its own name and model version", () => {
    const provider = new GeminiTtsProvider({ apiKey: "key", model: "gemini-2.5-flash-preview-tts" }, fixedClient(SAMPLE_RESULT));
    expect(provider.name).toBe(GEMINI_TTS_PROVIDER_NAME);
    expect(provider.modelVersion).toBe("gemini-2.5-flash-preview-tts");
  });

  it("defaults the timeout to 20 seconds when not overridden", () => {
    expect(GEMINI_TTS_DEFAULT_TIMEOUT_MS).toBe(20_000);
  });
});

describe("GeminiTtsProvider.synthesize -- success path", () => {
  it("returns the audio bytes and mimeType the client provides", async () => {
    const provider = new GeminiTtsProvider({ apiKey: "key", model: "gemini-2.5-flash-preview-tts" }, fixedClient(SAMPLE_RESULT));
    const result = await provider.synthesize("Hello there", "en");
    expect(result).toEqual(SAMPLE_RESULT);
  });

  it("forwards the exact text and canonical languageCode to the client -- never a second, re-worded request", async () => {
    const sink: { input?: SynthesizeSpeechInput } = {};
    const provider = new GeminiTtsProvider({ apiKey: "key", model: "gemini-2.5-flash-preview-tts" }, recordingClient(sink, SAMPLE_RESULT));
    await provider.synthesize("Clienta va reveni saptamana viitoare.", "ro");
    expect(sink.input?.text).toBe("Clienta va reveni saptamana viitoare.");
    expect(sink.input?.languageCode).toBe("ro");
    expect(sink.input?.model).toBe("gemini-2.5-flash-preview-tts");
  });

  it("works identically for languages well beyond en/ro -- Arabic, Japanese, Korean, Chinese", async () => {
    for (const languageCode of ["ar", "ja", "ko", "zh"]) {
      const sink: { input?: SynthesizeSpeechInput } = {};
      const provider = new GeminiTtsProvider({ apiKey: "key", model: "gemini-2.5-flash-preview-tts" }, recordingClient(sink, SAMPLE_RESULT));
      await provider.synthesize("reply text", languageCode);
      expect(sink.input?.languageCode).toBe(languageCode);
    }
  });
});

describe("GeminiTtsProvider.synthesize -- error classification", () => {
  it("throws INVALID_FORMAT when the client returns no audio at all", async () => {
    const provider = new GeminiTtsProvider({ apiKey: "key", model: "gemini-2.5-flash-preview-tts" }, fixedClient(undefined));
    await expect(provider.synthesize("text", "en")).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  it("classifies a timeout (abort) as TIMEOUT, retryable", async () => {
    const provider = new GeminiTtsProvider(
      { apiKey: "key", model: "gemini-2.5-flash-preview-tts", timeoutMs: 5 },
      hangingUntilAbortedClient(),
    );
    await expect(provider.synthesize("text", "en")).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("classifies a 401/403 as NOT_CONFIGURED, non-retryable", async () => {
    const provider401 = new GeminiTtsProvider({ apiKey: "key", model: "m" }, rejectingClient(httpError(401, "unauthorized")));
    const provider403 = new GeminiTtsProvider({ apiKey: "key", model: "m" }, rejectingClient(httpError(403, "forbidden")));
    await expect(provider401.synthesize("text", "en")).rejects.toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
    await expect(provider403.synthesize("text", "en")).rejects.toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
  });

  // This is the exact classification the live STT regression showed was
  // missing (a real Gemini 429 collapsed into a generic, indistinguishable
  // 502) -- confirmed present here for the NEW provider from day one.
  it("classifies a 429 as RATE_LIMITED, retryable -- never collapsed into a generic failure", async () => {
    const provider = new GeminiTtsProvider({ apiKey: "key", model: "m" }, rejectingClient(httpError(429, "quota exceeded")));
    await expect(provider.synthesize("text", "en")).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true, status: 429 });
  });

  it("classifies a 5xx as a retryable PROVIDER_ERROR", async () => {
    const provider = new GeminiTtsProvider({ apiKey: "key", model: "m" }, rejectingClient(httpError(503, "service unavailable")));
    await expect(provider.synthesize("text", "en")).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });

  it("classifies an unrecognized failure as a non-retryable PROVIDER_ERROR without leaking the underlying message", async () => {
    const provider = new GeminiTtsProvider({ apiKey: "key", model: "m" }, rejectingClient(new Error("internal-secret-diagnostic-string")));
    await expect(provider.synthesize("text", "en")).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
    try {
      await provider.synthesize("text", "en");
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("internal-secret-diagnostic-string");
    }
  });
});
