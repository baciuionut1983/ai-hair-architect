import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const ttsProviderMock = vi.hoisted(() => ({ synthesize: vi.fn(), lastConstructedWith: undefined as unknown }));
// Lets one test simulate a hypothetical FUTURE regression in
// wrapPcmAsWav itself (real implementation used by every other test)
// to prove the route's own fail-closed WAV validation actually catches
// a malformed result rather than shipping it to the browser.
const audioFormatOverride = vi.hoisted(() => ({ wrapPcmAsWav: undefined as ((pcm: Buffer, rate?: number) => Buffer) | undefined }));
// AI Usage & Cost Metering Phase 1: this route now also records usage
// after every provider call -- mocked here like every other dependency,
// so this route's own unit tests never need a real database connection.
const usageRepoMock = vi.hoisted(() => ({ recordAiUsageEvent: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/ai-usage-repository", () => usageRepoMock);
vi.mock("@/lib/tts-provider-gemini", () => ({
  GeminiTtsProvider: class {
    constructor(options: unknown) {
      ttsProviderMock.lastConstructedWith = options;
    }
    synthesize(...args: unknown[]) {
      return ttsProviderMock.synthesize(...args);
    }
  },
}));
vi.mock("@/lib/tts-audio-format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tts-audio-format")>();
  return {
    ...actual,
    wrapPcmAsWav: (pcm: Buffer, rate?: number) => (audioFormatOverride.wrapPcmAsWav ?? actual.wrapPcmAsWav)(pcm, rate),
  };
});

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

const ORIGINAL_ENV = { ...process.env };

// A tiny, real base64 blob is all synthesize() needs to return -- the WAV-
// wrapping itself is unit-tested separately in tts-audio-format.test.ts.
const SAMPLE_AUDIO = { audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"), mimeType: "audio/L16;rate=24000" };

function invoke(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/clients/client-1/voice-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "client-1" }) },
  );
}

function createTtsProviderError(code: string, retryable: boolean, status?: number): Error {
  const error = new Error(`Gemini TTS ${code}`) as Error & { code: string; retryable: boolean; status?: number };
  error.code = code;
  error.retryable = retryable;
  if (status !== undefined) error.status = status;
  return error;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, TEXT_TO_SPEECH_PROVIDER: "gemini", TEXT_TO_SPEECH_API_KEY: "tts-key", TEXT_TO_SPEECH_MODEL: "gemini-2.5-flash-preview-tts" };
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  ttsProviderMock.synthesize.mockResolvedValue(SAMPLE_AUDIO);
  audioFormatOverride.wrapPcmAsWav = undefined;
  usageRepoMock.recordAiUsageEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  audioFormatOverride.wrapPcmAsWav = undefined;
});

describe("POST /api/v1/clients/[id]/voice-reply", () => {
  it("returns 401 without a session, never calling the provider", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(401);
    expect(ttsProviderMock.synthesize).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(429);
    expect(ttsProviderMock.synthesize).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client -- cross-owner isolation enforced before any provider call", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(404);
    expect(ttsProviderMock.synthesize).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON, never a raw 500", async () => {
    const response = await invoke("{not json");

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("INVALID_REQUEST");
  });

  it("returns 400 for missing or empty text", async () => {
    const missing = await invoke({ language: "en" });
    expect(missing.status).toBe(400);

    const empty = await invoke({ text: "   ", language: "en" });
    expect(empty.status).toBe(400);

    expect(ttsProviderMock.synthesize).not.toHaveBeenCalled();
  });

  it("returns 400 TEXT_TOO_LONG for text over the cost-control cap, without calling the provider", async () => {
    const response = await invoke({ text: "x".repeat(4001), language: "en" });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("TEXT_TOO_LONG");
    expect(ttsProviderMock.synthesize).not.toHaveBeenCalled();
  });

  it("returns 400 UNSUPPORTED_LANGUAGE for a language not cloud-TTS-supported, without calling the provider", async () => {
    const response = await invoke({ text: "hello", language: "xx" });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("UNSUPPORTED_LANGUAGE");
    expect(ttsProviderMock.synthesize).not.toHaveBeenCalled();
  });

  it("returns 503 VOICE_REPLY_PROVIDER_NOT_CONFIGURED, honestly, when TEXT_TO_SPEECH_PROVIDER is unset", async () => {
    delete process.env.TEXT_TO_SPEECH_PROVIDER;

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("VOICE_REPLY_PROVIDER_NOT_CONFIGURED");
    expect(ttsProviderMock.synthesize).not.toHaveBeenCalled();
  });

  it("returns 503 VOICE_REPLY_PROVIDER_NOT_CONFIGURED when the API key is missing, even if the provider flag is set", async () => {
    delete process.env.TEXT_TO_SPEECH_API_KEY;

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("VOICE_REPLY_PROVIDER_NOT_CONFIGURED");
  });

  it("uses TEXT_TO_SPEECH_API_KEY, a SEPARATE key from AI_ANALYSIS_API_KEY -- never reuses the chat/vision key", async () => {
    process.env.AI_ANALYSIS_API_KEY = "chat-vision-key";
    process.env.TEXT_TO_SPEECH_API_KEY = "tts-only-key";

    await invoke({ text: "hello", language: "en" });

    expect(ttsProviderMock.lastConstructedWith).toMatchObject({ apiKey: "tts-only-key" });
  });

  it("returns real audio/wav bytes on success, with the correct Content-Type and no caching", async () => {
    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/wav");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(44); // WAV header + real PCM bytes
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
  });

  // Playback investigation: proves the route's own fail-closed safety net
  // (isValidWavHeader) actually catches a malformed result and refuses to
  // ship it to the browser -- rather than the browser being the first
  // place a future wrapPcmAsWav regression would ever be discovered.
  it("fails closed with 502 rather than shipping a malformed audio body, if the WAV-wrapping ever produces an invalid header", async () => {
    audioFormatOverride.wrapPcmAsWav = () => Buffer.from("not actually a wav file at all");

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe("VOICE_REPLY_FAILED");
    expect(body.message.toLowerCase()).toContain("still available");
  });

  it("passes the exact text and canonical language through to the provider -- never a second, re-worded reply", async () => {
    await invoke({ text: "Clienta va reveni saptamana viitoare.", language: "ro" });

    expect(ttsProviderMock.synthesize).toHaveBeenCalledWith("Clienta va reveni saptamana viitoare.", "ro");
  });

  it("maps zh-Hans and zh-Hant to the shared spoken-Mandarin languageCode 'zh'", async () => {
    await invoke({ text: "hello", language: "zh-Hans" });
    expect(ttsProviderMock.synthesize).toHaveBeenCalledWith("hello", "zh");

    await invoke({ text: "hello", language: "zh-Hant" });
    expect(ttsProviderMock.synthesize).toHaveBeenCalledWith("hello", "zh");
  });

  it("works for languages well beyond en/ro -- Arabic, Japanese, Korean, Hebrew, Hindi", async () => {
    for (const language of ["ar", "ja", "ko", "he", "hi"]) {
      ttsProviderMock.synthesize.mockClear();
      const response = await invoke({ text: "hello", language });
      expect(response.status).toBe(200);
      expect(ttsProviderMock.synthesize).toHaveBeenCalledWith("hello", language);
    }
  });

  // This is the exact regression that motivated this task: a real upstream
  // 429 must never come back to the client as a generic, indistinguishable
  // failure -- it gets its own status and its own honest message.
  it("maps a provider RATE_LIMITED (429) failure to HTTP 503, distinctly from other failures", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("RATE_LIMITED", true, 429));

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("VOICE_REPLY_RATE_LIMITED");
  });

  it("maps a provider TIMEOUT failure to HTTP 504", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("TIMEOUT", true));

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(504);
  });

  it("maps a provider NOT_CONFIGURED failure to HTTP 502", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("NOT_CONFIGURED", false, 401));

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(502);
  });

  it("maps a provider INVALID_FORMAT failure (no audio returned) to HTTP 502", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("INVALID_FORMAT", false));

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(502);
  });

  it("maps a retryable PROVIDER_ERROR (5xx) to HTTP 503, and a non-retryable one to HTTP 502", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("PROVIDER_ERROR", true, 503));
    const retryable = await invoke({ text: "hello", language: "en" });
    expect(retryable.status).toBe(503);

    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("PROVIDER_ERROR", false, 400));
    const nonRetryable = await invoke({ text: "hello", language: "en" });
    expect(nonRetryable.status).toBe(502);
  });

  it("every failure response still tells the stylist the text reply is still available", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("RATE_LIMITED", true, 429));

    const response = await invoke({ text: "hello", language: "en" });
    const body = await response.json();

    expect(body.message.toLowerCase()).toContain("still available");
  });
});

describe("AI usage metering", () => {
  it("records a SUCCEEDED TTS usage event with the provider's real usage/providerRequestId on success", async () => {
    ttsProviderMock.synthesize.mockResolvedValue({ ...SAMPLE_AUDIO, usage: { characterCount: 40 }, providerRequestId: "resp-1" });

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(200);
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        clientId: "client-1",
        feature: "voice_reply",
        modality: "TTS",
        provider: "gemini",
        providerRequestId: "resp-1",
        usage: { characterCount: 40 },
        outcome: "SUCCEEDED",
      }),
    );
  });

  it("records a FAILED TTS usage event with the classified error code when the provider call throws", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("RATE_LIMITED", true, 429));

    await invoke({ text: "hello", language: "en" });

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "voice_reply", modality: "TTS", outcome: "FAILED", errorCategory: "RATE_LIMITED" }),
    );
  });

  it("a metering failure never turns a successful voice reply into a user-visible failure", async () => {
    usageRepoMock.recordAiUsageEvent.mockRejectedValueOnce(new Error("this should never surface"));

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(200);
  });
});

describe("production diagnostics logging", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  function loggedLine(spy: ReturnType<typeof vi.spyOn>, index = 0): Record<string, unknown> {
    return JSON.parse(spy.mock.calls[index][0] as string);
  }

  it("logs endpoint_entered as the very first line, unconditionally, even before authentication is checked", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    await invoke({ text: "hello", language: "en" });

    expect(loggedLine(logSpy)).toMatchObject({ gate: "VOICE_REPLY", status: "INFO", stage: "endpoint_entered" });
  });

  it("logs provider_call FAILED with the classified code and real HTTP status, but NEVER the reply text itself", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("RATE_LIMITED", true, 429));

    await invoke({ text: "the client's actual private consultation reply text", language: "en" });

    const logged = loggedLine(errorSpy);
    expect(logged).toMatchObject({ gate: "VOICE_REPLY", status: "FAILED", stage: "provider_call", providerErrorCode: "RATE_LIMITED", providerHttpStatus: 429 });
    expect(JSON.stringify(logged)).not.toContain("private consultation reply text");
  });

  it("logs wav_validation FAILED with the specific validation reason when the wrapped audio is malformed", async () => {
    // At least 44 bytes (so it's not rejected for being too short to even
    // contain a header) but missing the RIFF magic bytes specifically.
    audioFormatOverride.wrapPcmAsWav = () => Buffer.alloc(64, 0x00);

    await invoke({ text: "hello", language: "en" });

    const logged = loggedLine(errorSpy);
    expect(logged).toMatchObject({ gate: "VOICE_REPLY", status: "FAILED", stage: "wav_validation", reason: "missing_riff_magic" });
  });

  it("logs a SUCCEEDED line on success (console.log, not console.error), with safe fields but never the reply text", async () => {
    await invoke({ text: "the client's actual private consultation reply text", language: "en" });

    expect(errorSpy).not.toHaveBeenCalled();
    const loggedLines = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const completeLine = loggedLines.find((line) => line.stage === "complete");
    expect(completeLine).toMatchObject({ gate: "VOICE_REPLY", status: "SUCCEEDED", stage: "complete", language: "en" });
    expect(JSON.stringify(loggedLines)).not.toContain("private consultation reply text");
  });

  // Playback investigation: the ONLY way to confirm what Gemini actually
  // returned (vs what this route assumes -- 16-bit/mono/24kHz raw PCM,
  // wrapped as WAV) is to log the provider's own mimeType and the raw
  // PCM byte count alongside the final wrapped size, not just the final
  // wav.length -- otherwise a format mismatch is unverifiable from logs
  // alone.
  it("logs the provider's own mimeType, sample rate, and raw PCM byte count -- not just the final wrapped WAV size", async () => {
    await invoke({ text: "hello", language: "en" });

    const loggedLines = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const completeLine = loggedLines.find((line) => line.stage === "complete");
    expect(completeLine).toMatchObject({
      providerMimeType: SAMPLE_AUDIO.mimeType,
      sampleRateHz: 24000,
      pcmBytes: 4,
      audioBytes: 48,
    });
  });
});
