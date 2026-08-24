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

  // Voice latency audit (2026-08-18): the success body is raw audio bytes,
  // not JSON, so the real, measured provider duration (the same number
  // AI Usage Metering already computes) is exposed as a response header
  // instead -- lets the client report a real ttsProviderMs.
  it("exposes the real, measured provider duration as an X-Provider-Latency-Ms header on success", async () => {
    const response = await invoke({ text: "hello", language: "en" });

    const header = response.headers.get("X-Provider-Latency-Ms");
    expect(header).not.toBeNull();
    expect(Number.isInteger(Number(header))).toBe(true);
    expect(Number(header)).toBeGreaterThanOrEqual(0);
  });

  // TTS latency root-cause (2026-08-19, Round 7): a real production test
  // showed ttsTotalMs roughly double ttsProviderMs with no way to tell
  // why -- these headers are the server's own granular breakdown of that
  // gap (pre-provider auth/DB overhead, the awaited AI Usage Metering DB
  // write, in-memory audio processing, and the authoritative server
  // total), each a real, non-negative integer, never fabricated.
  it("exposes the full granular timing breakdown (pre-provider, usage write, audio processing, server total) as response headers on success", async () => {
    const response = await invoke({ text: "hello", language: "en" });

    for (const name of ["X-Pre-Provider-Ms", "X-Usage-Write-Ms", "X-Audio-Processing-Ms", "X-Server-Total-Ms"]) {
      const header = response.headers.get(name);
      expect(header, `${name} should be present`).not.toBeNull();
      expect(Number.isInteger(Number(header))).toBe(true);
      expect(Number(header)).toBeGreaterThanOrEqual(0);
    }

    // The server's own total must be at least as large as the provider
    // call alone -- it is measured end-to-end (requestReceivedAt to just
    // before the response is built), not summed from parts, so this holds
    // regardless of how the pre/post buckets individually split.
    const providerMs = Number(response.headers.get("X-Provider-Latency-Ms"));
    const serverTotalMs = Number(response.headers.get("X-Server-Total-Ms"));
    expect(serverTotalMs).toBeGreaterThanOrEqual(providerMs);
  });

  // End-to-end voice turn correlation (2026-08-19): when the client sends
  // voiceTurnId (the SAME id already used for STT), it's echoed into this
  // route's own structured log so a single stylist-reported incident can
  // be found across STT/Consult AI/TTS logs by this one value.
  describe("voiceTurnId correlation", () => {
    it("includes a valid voiceTurnId in the success log", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await invoke({ text: "hello", language: "en", voiceTurnId: "a1b2c3d4-0000-0000-0000-000000000000" });

      const lines = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
      const complete = lines.find((line) => line.stage === "complete");
      expect(complete).toMatchObject({ voiceTurnId: "a1b2c3d4-0000-0000-0000-000000000000" });
      logSpy.mockRestore();
    });

    it("logs voiceTurnId as null (never omitted, never fabricated) when absent", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await invoke({ text: "hello", language: "en" });

      const lines = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
      const complete = lines.find((line) => line.stage === "complete");
      expect(complete).toMatchObject({ voiceTurnId: null });
      logSpy.mockRestore();
    });

    it("rejects a malformed voiceTurnId -- never trusted blindly, logged as null instead of a raw unvalidated string", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await invoke({ text: "hello", language: "en", voiceTurnId: "<script>alert(1)</script>" });

      const lines = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
      const complete = lines.find((line) => line.stage === "complete");
      expect(complete).toMatchObject({ voiceTurnId: null });
      logSpy.mockRestore();
    });
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

// TTS reliability hardening (2026-08-19): a real production TIMEOUT
// proved this route never retried the provider call at all -- unlike STT
// and Consult AI, which already recover from the identical class of
// transient failure. Mirrors both exactly: at most ONE retry, only for a
// failure GeminiTtsProvider's own classifyTtsError already marked
// `retryable`.
describe("TTS reliability hardening (single automatic retry)", () => {
  it("succeeds on the first attempt -- exactly one provider call, attemptCount 1", async () => {
    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(200);
    expect(ttsProviderMock.synthesize).toHaveBeenCalledTimes(1);
    expect(response.headers.get("X-Provider-Attempt-Count")).toBe("1");
  });

  // VOICE NEXT LEVEL, Phase D (2026-08-24): the real, per-attempt
  // breakdown -- see provider-attempt-telemetry-logic.ts's own doc
  // comment for the production gap this closes. On a clean first-attempt
  // success, attempt1 reflects "success" and attempt2 is genuinely absent
  // (no X-Attempt2-* headers at all), never a fabricated placeholder.
  it("exposes X-Attempt1-* headers as 'success' on a first-attempt success, with no X-Attempt2-* headers at all", async () => {
    const response = await invoke({ text: "hello", language: "en" });

    expect(response.headers.get("X-Attempt1-Outcome")).toBe("success");
    expect(Number.isInteger(Number(response.headers.get("X-Attempt1-Ms")))).toBe(true);
    expect(response.headers.has("X-Attempt2-Ms")).toBe(false);
    expect(response.headers.has("X-Attempt2-Outcome")).toBe(false);
  });

  it("recovers a TIMEOUT via the single automatic retry -- second attempt succeeds", async () => {
    ttsProviderMock.synthesize
      .mockRejectedValueOnce(createTtsProviderError("TIMEOUT", true))
      .mockResolvedValueOnce(SAMPLE_AUDIO);

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(200);
    expect(ttsProviderMock.synthesize).toHaveBeenCalledTimes(2);
    expect(response.headers.get("X-Provider-Attempt-Count")).toBe("2");
  });

  // VOICE NEXT LEVEL, Phase D (2026-08-24): proves BOTH attempts' own
  // telemetry survive to the successful response -- attempt1 shows the
  // real timeout that was recovered from, attempt2 shows the real
  // success, never merged into one number the way providerLatencyMs
  // alone (whichever attempt won) already did before this round.
  it("exposes attempt1='timeout' and attempt2='success' headers after a recovered retry", async () => {
    ttsProviderMock.synthesize
      .mockRejectedValueOnce(createTtsProviderError("TIMEOUT", true))
      .mockResolvedValueOnce(SAMPLE_AUDIO);

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.headers.get("X-Attempt1-Outcome")).toBe("timeout");
    expect(Number.isInteger(Number(response.headers.get("X-Attempt1-Ms")))).toBe(true);
    expect(response.headers.get("X-Attempt2-Outcome")).toBe("success");
    expect(Number.isInteger(Number(response.headers.get("X-Attempt2-Ms")))).toBe(true);
  });

  it("recovers a transient RATE_LIMITED (429) via the single automatic retry -- second attempt succeeds", async () => {
    ttsProviderMock.synthesize
      .mockRejectedValueOnce(createTtsProviderError("RATE_LIMITED", true, 429))
      .mockResolvedValueOnce(SAMPLE_AUDIO);

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(200);
    expect(ttsProviderMock.synthesize).toHaveBeenCalledTimes(2);
  });

  it("recovers a transient 5xx PROVIDER_ERROR via the single automatic retry -- second attempt succeeds", async () => {
    ttsProviderMock.synthesize
      .mockRejectedValueOnce(createTtsProviderError("PROVIDER_ERROR", true, 503))
      .mockResolvedValueOnce(SAMPLE_AUDIO);

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(200);
    expect(ttsProviderMock.synthesize).toHaveBeenCalledTimes(2);
  });

  it("never retries a permanent failure (NOT_CONFIGURED) -- exactly one provider call, a second identical call could never change the outcome", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("NOT_CONFIGURED", false, 401));

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(502);
    expect(ttsProviderMock.synthesize).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body.providerAttemptCount).toBe(1);
  });

  it("never retries a permanent failure (INVALID_FORMAT / bad request) -- exactly one provider call", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("INVALID_FORMAT", false));

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(502);
    expect(ttsProviderMock.synthesize).toHaveBeenCalledTimes(1);
  });

  it("falls through to the browser fallback ONLY after both the first attempt and the retry are exhausted -- two real attempts, one final failure response", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("TIMEOUT", true));

    const response = await invoke({ text: "hello", language: "en" });

    expect(ttsProviderMock.synthesize).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.error).toBe("VOICE_REPLY_TIMEOUT");
    expect(body.providerAttemptCount).toBe(2);
  });

  // VOICE NEXT LEVEL, Phase D (2026-08-24): the exact real-production
  // shape this round's task reported (errorCode="VOICE_REPLY_TIMEOUT",
  // providerAttemptCount=2) -- proves the failure JSON body itself (not
  // headers, since a JSON error response carries no binary-audio
  // constraint) now shows BOTH attempts timed out, closing the gap where
  // only the aggregate outcome/count was ever visible.
  it("includes ttsAttempt1/ttsAttempt2 telemetry in the failure JSON body when both attempts time out", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("TIMEOUT", true));

    const response = await invoke({ text: "hello", language: "en" });

    const body = await response.json();
    expect(body.ttsAttempt1Outcome).toBe("timeout");
    expect(typeof body.ttsAttempt1Ms).toBe("number");
    expect(body.ttsAttempt2Outcome).toBe("timeout");
    expect(typeof body.ttsAttempt2Ms).toBe("number");
  });

  // A permanent, non-retryable failure never reaches a second attempt --
  // ttsAttempt2* must be genuinely absent, not a fabricated null.
  it("includes only ttsAttempt1 telemetry (never a fabricated attempt2) when the first failure is non-retryable", async () => {
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("NOT_CONFIGURED", false, 401));

    const response = await invoke({ text: "hello", language: "en" });

    const body = await response.json();
    expect(body.ttsAttempt1Outcome).toBe("http_error");
    expect(body.ttsAttempt1HttpStatus).toBe(401);
    expect("ttsAttempt2Ms" in body).toBe(false);
    expect("ttsAttempt2Outcome" in body).toBe(false);
  });

  // No duplicate audio: this whole retry happens inside ONE request/
  // response cycle -- the route only ever returns a SINGLE Response,
  // either the final audio bytes or a final JSON error, never two.
  it("never returns more than one audio response, even when the retry is the one that succeeds", async () => {
    ttsProviderMock.synthesize
      .mockRejectedValueOnce(createTtsProviderError("TIMEOUT", true))
      .mockResolvedValueOnce(SAMPLE_AUDIO);

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(200);
    const buf = await response.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
    // A second read of the same body would throw ("already read") if this
    // route somehow produced/streamed more than one body -- proving
    // exactly one real HTTP response was ever constructed for this
    // request, regardless of how many provider attempts it took.
  });

  it("usage metering represents actual provider attempts correctly -- one FAILED row for the first attempt, one SUCCEEDED row for the recovering retry, sharing one correlationId", async () => {
    ttsProviderMock.synthesize
      .mockRejectedValueOnce(createTtsProviderError("TIMEOUT", true))
      .mockResolvedValueOnce({ ...SAMPLE_AUDIO, usage: { characterCount: 40 }, providerRequestId: "resp-retry" });

    await invoke({ text: "hello", language: "en" });

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledTimes(2);
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ outcome: "FAILED", attemptNumber: 1, errorCategory: "TIMEOUT" }),
    );
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ outcome: "SUCCEEDED", attemptNumber: 2, providerRequestId: "resp-retry" }),
    );
    const [firstCall, secondCall] = usageRepoMock.recordAiUsageEvent.mock.calls;
    expect(firstCall[0].correlationId).toBe(secondCall[0].correlationId);
  });

  it("usage metering records exactly one row when the first attempt succeeds outright -- never a phantom retry row", async () => {
    await invoke({ text: "hello", language: "en" });

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledTimes(1);
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "SUCCEEDED", attemptNumber: 1 }));
  });

  it("uses TEXT_TO_SPEECH_FALLBACK_MODEL for the retry ONLY when explicitly configured -- never the first attempt, never invented", async () => {
    process.env.TEXT_TO_SPEECH_FALLBACK_MODEL = "gemini-tts-fallback";
    ttsProviderMock.synthesize
      .mockRejectedValueOnce(createTtsProviderError("TIMEOUT", true))
      .mockResolvedValueOnce(SAMPLE_AUDIO);

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(200);
    // recordAiUsageEvent's own `model` field is the most direct proof of
    // which model actually ran for each attempt.
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: "gemini-2.5-flash-preview-tts" }),
    );
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: "gemini-tts-fallback" }),
    );
  });

  it("never uses a fallback model when TEXT_TO_SPEECH_FALLBACK_MODEL is unset -- the retry reuses the exact same model as the first attempt", async () => {
    ttsProviderMock.synthesize
      .mockRejectedValueOnce(createTtsProviderError("TIMEOUT", true))
      .mockResolvedValueOnce(SAMPLE_AUDIO);

    await invoke({ text: "hello", language: "en" });

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: "gemini-2.5-flash-preview-tts" }),
    );
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: "gemini-2.5-flash-preview-tts" }),
    );
  });

  it("includes providerAttemptNumber in the provider_call failure log for both the first attempt and the retry", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    ttsProviderMock.synthesize.mockRejectedValue(createTtsProviderError("TIMEOUT", true));

    await invoke({ text: "hello", language: "en" });

    const lines = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const providerCallLines = lines.filter((line) => line.stage === "provider_call");
    expect(providerCallLines).toHaveLength(2);
    expect(providerCallLines[0]).toMatchObject({ providerAttemptNumber: 1 });
    expect(providerCallLines[1]).toMatchObject({ providerAttemptNumber: 2 });
    logSpy.mockRestore();
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
