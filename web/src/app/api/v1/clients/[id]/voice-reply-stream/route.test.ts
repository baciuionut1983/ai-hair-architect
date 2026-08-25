import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const streamingProviderMock = vi.hoisted(() => ({ synthesizeStream: vi.fn(), lastConstructedWith: undefined as unknown }));
const usageRepoMock = vi.hoisted(() => ({ recordAiUsageEvent: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/ai-usage-repository", () => usageRepoMock);
vi.mock("@/lib/tts-provider-gemini-streaming", () => ({
  GeminiTtsStreamingProvider: class {
    constructor(options: unknown) {
      streamingProviderMock.lastConstructedWith = options;
    }
    synthesizeStream(...args: unknown[]) {
      return streamingProviderMock.synthesizeStream(...args);
    }
  },
}));

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

const ORIGINAL_ENV = { ...process.env };

type Chunk = { pcm: Buffer; mimeType: string };

function chunksToAsyncGenerator(chunks: Chunk[]): AsyncGenerator<Chunk> {
  async function* gen(): AsyncGenerator<Chunk> {
    for (const chunk of chunks) yield chunk;
  }
  return gen();
}

function erroringAsyncGenerator(error: unknown): AsyncGenerator<Chunk> {
  async function* gen(): AsyncGenerator<Chunk> {
    throw error;
  }
  return gen();
}

function createTtsProviderError(code: string, retryable: boolean, status?: number): Error {
  const error = new Error(`Gemini TTS streaming ${code}`) as Error & { code: string; retryable: boolean; status?: number };
  error.code = code;
  error.retryable = retryable;
  if (status !== undefined) error.status = status;
  return error;
}

function invoke(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/clients/client-1/voice-reply-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "client-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = {
    ...ORIGINAL_ENV,
    TEXT_TO_SPEECH_STREAMING_MODEL: "gemini-3.1-flash-tts-preview",
    TEXT_TO_SPEECH_API_KEY: "tts-key",
  };
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  streamingProviderMock.synthesizeStream.mockReturnValue(
    chunksToAsyncGenerator([{ pcm: Buffer.from([1, 2, 3, 4]), mimeType: "audio/L16;rate=24000" }]),
  );
  usageRepoMock.recordAiUsageEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("POST /api/v1/clients/[id]/voice-reply-stream -- zero-effect-when-unset guarantee", () => {
  it("returns 503 immediately when TEXT_TO_SPEECH_STREAMING_MODEL is unset, calling NO other dependency at all", async () => {
    delete process.env.TEXT_TO_SPEECH_STREAMING_MODEL;

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "VOICE_REPLY_STREAM_NOT_CONFIGURED", message: "Streaming voice reply is not enabled." });

    expect(authMock.authenticateSessionRequest).not.toHaveBeenCalled();
    expect(hardeningMock.checkRateLimit).not.toHaveBeenCalled();
    expect(clientRepoMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(streamingProviderMock.synthesizeStream).not.toHaveBeenCalled();
    expect(usageRepoMock.recordAiUsageEvent).not.toHaveBeenCalled();
  });

  it("treats a blank TEXT_TO_SPEECH_STREAMING_MODEL the same as unset", async () => {
    process.env.TEXT_TO_SPEECH_STREAMING_MODEL = "   ";

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(503);
    expect(authMock.authenticateSessionRequest).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/clients/[id]/voice-reply-stream -- guard behavior", () => {
  it("returns 401 without a session, never calling the provider", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(401);
    expect(streamingProviderMock.synthesizeStream).not.toHaveBeenCalled();
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(429);
    expect(streamingProviderMock.synthesizeStream).not.toHaveBeenCalled();
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

    expect(streamingProviderMock.synthesizeStream).not.toHaveBeenCalled();
  });

  it("returns 400 TEXT_TOO_LONG for text over the cost-control cap, matching the existing route's 4000-char limit", async () => {
    const response = await invoke({ text: "x".repeat(4001), language: "en" });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("TEXT_TOO_LONG");
    expect(streamingProviderMock.synthesizeStream).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client, before any provider call", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(404);
    expect(streamingProviderMock.synthesizeStream).not.toHaveBeenCalled();
  });

  it("returns 400 UNSUPPORTED_LANGUAGE for a language not cloud-TTS-supported", async () => {
    const response = await invoke({ text: "hello", language: "xx" });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("UNSUPPORTED_LANGUAGE");
    expect(streamingProviderMock.synthesizeStream).not.toHaveBeenCalled();
  });

  it("returns 503 VOICE_REPLY_STREAM_NOT_CONFIGURED when TEXT_TO_SPEECH_API_KEY is missing", async () => {
    delete process.env.TEXT_TO_SPEECH_API_KEY;

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("VOICE_REPLY_STREAM_NOT_CONFIGURED");
    expect(streamingProviderMock.synthesizeStream).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/clients/[id]/voice-reply-stream -- successful streaming response", () => {
  it("returns the right headers and a body equal to the concatenation of the provider's chunks, in order", async () => {
    streamingProviderMock.synthesizeStream.mockReturnValue(
      chunksToAsyncGenerator([
        { pcm: Buffer.from([1, 2, 3]), mimeType: "audio/L16;rate=24000" },
        { pcm: Buffer.from([4, 5]), mimeType: "audio/L16;rate=24000" },
        { pcm: Buffer.from([6]), mimeType: "audio/L16;rate=24000" },
      ]),
    );

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Audio-Sample-Rate-Hz")).toBe("24000");
    expect(response.headers.get("X-Audio-Format")).toBe("pcm_s16le_mono");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("passes the exact text and canonical languageCode through to the provider -- never a second, re-worded reply", async () => {
    await invoke({ text: "Clienta va reveni saptamana viitoare.", language: "ro" });

    expect(streamingProviderMock.synthesizeStream).toHaveBeenCalledWith("Clienta va reveni saptamana viitoare.", "ro");
  });

  it("maps zh-Hans to the shared spoken-Mandarin languageCode 'zh'", async () => {
    await invoke({ text: "hello", language: "zh-Hans" });
    expect(streamingProviderMock.synthesizeStream).toHaveBeenCalledWith("hello", "zh");
  });
});

describe("POST /api/v1/clients/[id]/voice-reply-stream -- provider failure before any chunk", () => {
  it("maps a TIMEOUT failure to HTTP 504 JSON, never a 200 with an errored body", async () => {
    streamingProviderMock.synthesizeStream.mockReturnValue(erroringAsyncGenerator(createTtsProviderError("TIMEOUT", true)));

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.error).toBe("VOICE_REPLY_STREAM_TIMEOUT");
  });

  it("maps a RATE_LIMITED (429) failure to HTTP 503, distinctly from other failures", async () => {
    streamingProviderMock.synthesizeStream.mockReturnValue(erroringAsyncGenerator(createTtsProviderError("RATE_LIMITED", true, 429)));

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("VOICE_REPLY_STREAM_RATE_LIMITED");
  });

  it("maps a retryable PROVIDER_ERROR (5xx) to HTTP 503, and a non-retryable one to HTTP 502", async () => {
    streamingProviderMock.synthesizeStream.mockReturnValue(erroringAsyncGenerator(createTtsProviderError("PROVIDER_ERROR", true, 503)));
    const retryable = await invoke({ text: "hello", language: "en" });
    expect(retryable.status).toBe(503);

    streamingProviderMock.synthesizeStream.mockReturnValue(erroringAsyncGenerator(createTtsProviderError("PROVIDER_ERROR", false, 400)));
    const nonRetryable = await invoke({ text: "hello", language: "en" });
    expect(nonRetryable.status).toBe(502);
  });
});

describe("AI usage metering", () => {
  it("records a SUCCEEDED TTS usage event with feature voice_reply_stream on success", async () => {
    const response = await invoke({ text: "hello", language: "en" });
    expect(response.status).toBe(200);
    // Draining the body forces the ReadableStream's own start() to run to
    // completion -- including the fire-and-forget metering call below it.
    await response.arrayBuffer();

    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "voice_reply_stream",
        modality: "TTS",
        provider: "gemini",
        model: "gemini-3.1-flash-tts-preview",
        outcome: "SUCCEEDED",
      }),
    );
  });

  it("records a FAILED TTS usage event with feature voice_reply_stream when the provider errors before any chunk", async () => {
    streamingProviderMock.synthesizeStream.mockReturnValue(erroringAsyncGenerator(createTtsProviderError("TIMEOUT", true)));

    const response = await invoke({ text: "hello", language: "en" });

    expect(response.status).toBe(504);
    expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "voice_reply_stream", modality: "TTS", outcome: "FAILED", errorCategory: "TIMEOUT" }),
    );
  });

  it("a metering failure never turns a successful streaming response into a user-visible failure", async () => {
    usageRepoMock.recordAiUsageEvent.mockRejectedValue(new Error("this should never surface"));

    const response = await invoke({ text: "hello", language: "en" });
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).resolves.toBeDefined();
  });
});
