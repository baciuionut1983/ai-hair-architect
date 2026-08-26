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

// Yields every real chunk first, exactly like chunksToAsyncGenerator, but
// then throws -- models a genuine mid-stream provider failure (as opposed
// to erroringAsyncGenerator's before-any-chunk failure, already covered
// above).
function chunksThenErrorAsyncGenerator(chunks: Chunk[], error: unknown): AsyncGenerator<Chunk> {
  async function* gen(): AsyncGenerator<Chunk> {
    for (const chunk of chunks) yield chunk;
    throw error;
  }
  return gen();
}

// Gates each yield behind a real timer -- needed only for the cancel()
// regression test below, so a real cancel() call can land while the
// route's own producer loop is still genuinely mid-stream (a plain,
// undelayed async generator here would race ahead of the test and finish
// before cancel() ever had a chance to run).
function chunksToAsyncGeneratorWithDelay(chunks: Chunk[], delayMs: number): AsyncGenerator<Chunk> {
  async function* gen(): AsyncGenerator<Chunk> {
    for (const chunk of chunks) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      yield chunk;
    }
  }
  return gen();
}

// Finds the one JSON log line (among every console spy call) whose parsed
// body contains the given stage -- every logVoiceReplyStream call in
// route.ts is a single JSON.stringify'd argument, exactly matching this.
function findLoggedLine(spy: { mock: { calls: unknown[][] } }, stage: string): Record<string, unknown> | undefined {
  const line = spy.mock.calls.map((args) => String(args[0])).find((entry) => entry.includes(`"stage":"${stage}"`));
  return line ? JSON.parse(line) : undefined;
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

describe("POST /api/v1/clients/[id]/voice-reply-stream -- genuine mid-stream provider failure (unchanged behavior)", () => {
  it("logs FAILED with the real partial chunkCount when the provider's stream throws after already yielding some chunks", async () => {
    streamingProviderMock.synthesizeStream.mockReturnValue(
      chunksThenErrorAsyncGenerator(
        [
          { pcm: Buffer.from([1, 2]), mimeType: "audio/L16;rate=24000" },
          { pcm: Buffer.from([3, 4]), mimeType: "audio/L16;rate=24000" },
        ],
        createTtsProviderError("PROVIDER_ERROR", true, 503),
      ),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await invoke({ text: "hello", language: "en" });
      expect(response.status).toBe(200);
      // The real controller.error() call (untouched by this test) genuinely
      // errors the stream -- draining it is expected to reject.
      await expect(response.arrayBuffer()).rejects.toBeDefined();

      const failed = findLoggedLine(errorSpy, "provider_call");
      expect(failed).toBeDefined();
      expect(failed).toMatchObject({ status: "FAILED", chunkCount: 2, pcmBytesTotal: 4, providerErrorCode: "PROVIDER_ERROR" });

      expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "FAILED", errorCategory: "PROVIDER_ERROR" }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// Regression coverage for the real, live end-to-end bug (gate
// VOICE_REPLY_STREAM, providerErrorCode ERR_INVALID_STATE,
// "Invalid state: Controller is already closed") this route was
// investigated and fixed for: controller.close() (and, defensively,
// controller.error()) can themselves throw once something else has
// already torn the controller down from the outside, even though every
// real chunk the provider produced was already enqueued successfully --
// see route.ts's own comments at the ReadableStream construction site for
// the full investigation notes. These tests reproduce that exact race by
// patching the native ReadableStreamDefaultController prototype for the
// duration of a single test (restored in a finally, every time) -- the
// only way to force this specific, otherwise-unreproducible-in-isolation
// native throw deterministically at the unit level.
describe("POST /api/v1/clients/[id]/voice-reply-stream -- controller close()/error() teardown races (regression)", () => {
  it("logs SUCCEEDED, not FAILED, and never crashes when controller.close() itself throws after every real chunk was already delivered", async () => {
    const originalClose = ReadableStreamDefaultController.prototype.close;
    const closePatch = vi.fn(() => {
      throw new Error("Invalid state: Controller is already closed");
    });
    ReadableStreamDefaultController.prototype.close = closePatch as typeof originalClose;

    try {
      streamingProviderMock.synthesizeStream.mockReturnValue(
        chunksToAsyncGenerator([
          { pcm: Buffer.from([1, 2]), mimeType: "audio/L16;rate=24000" },
          { pcm: Buffer.from([3, 4]), mimeType: "audio/L16;rate=24000" },
        ]),
      );
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        const response = await invoke({ text: "hello", language: "en" });
        expect(response.status).toBe(200);
        // The patched close() always throws instead of ever really closing
        // the stream, so the body itself never reaches "done" here -- this
        // test asserts on the server-side logging/handling only, never on
        // draining the (permanently-open, by construction) body.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(closePatch).toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();

        const succeeded = findLoggedLine(logSpy, "complete");
        expect(succeeded).toBeDefined();
        expect(succeeded).toMatchObject({ status: "SUCCEEDED", chunkCount: 2, pcmBytesTotal: 4, controllerAlreadyClosed: true });

        expect(usageRepoMock.recordAiUsageEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "SUCCEEDED" }));
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
      }
    } finally {
      ReadableStreamDefaultController.prototype.close = originalClose;
    }
  });

  it("never crashes the request handler even when controller.error() itself throws on a genuine mid-stream provider failure", async () => {
    const originalError = ReadableStreamDefaultController.prototype.error;
    const errorPatch = vi.fn(() => {
      throw new Error("Invalid state: Controller is already closed");
    });
    ReadableStreamDefaultController.prototype.error = errorPatch as typeof originalError;

    try {
      streamingProviderMock.synthesizeStream.mockReturnValue(
        chunksThenErrorAsyncGenerator(
          [{ pcm: Buffer.from([1, 2]), mimeType: "audio/L16;rate=24000" }],
          createTtsProviderError("PROVIDER_ERROR", false, 500),
        ),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        const response = await invoke({ text: "hello", language: "en" });
        expect(response.status).toBe(200);
        // The patched error() throws instead of ever really erroring the
        // stream, so (exactly like the close() test above) the body never
        // settles -- assert on logging/handling only.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(errorPatch).toHaveBeenCalled();
        const failed = findLoggedLine(errorSpy, "provider_call");
        expect(failed).toBeDefined();
        expect(failed).toMatchObject({ status: "FAILED", chunkCount: 1, providerErrorCode: "PROVIDER_ERROR" });
      } finally {
        errorSpy.mockRestore();
      }
    } finally {
      ReadableStreamDefaultController.prototype.error = originalError;
    }
  });
});

describe("POST /api/v1/clients/[id]/voice-reply-stream -- cancel() (genuine client-initiated disconnect)", () => {
  it("calls generator.return() to stop pulling more chunks, and logs an honest INFO event instead of a fake SUCCEEDED or FAILED", async () => {
    const generator = chunksToAsyncGeneratorWithDelay(
      [
        { pcm: Buffer.from([1, 2]), mimeType: "audio/L16;rate=24000" },
        { pcm: Buffer.from([3, 4]), mimeType: "audio/L16;rate=24000" },
        { pcm: Buffer.from([5, 6]), mimeType: "audio/L16;rate=24000" },
        { pcm: Buffer.from([7, 8]), mimeType: "audio/L16;rate=24000" },
        { pcm: Buffer.from([9, 10]), mimeType: "audio/L16;rate=24000" },
      ],
      20,
    );
    const returnSpy = vi.spyOn(generator, "return");
    streamingProviderMock.synthesizeStream.mockReturnValue(generator);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await invoke({ text: "hello", language: "en" });
      expect(response.status).toBe(200);

      // Cancel immediately -- the delayed generator above still has several
      // real chunks left to produce, so this genuinely lands mid-stream
      // rather than racing the natural end.
      await response.body!.cancel("client_navigated_away");
      // Let the in-flight generator.next()/return() queue settle.
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(returnSpy).toHaveBeenCalled();

      const cancelled = findLoggedLine(logSpy, "client_cancelled");
      expect(cancelled).toBeDefined();
      expect(cancelled).toMatchObject({ status: "INFO", gate: "VOICE_REPLY_STREAM" });
      expect((cancelled as { chunkCount: number }).chunkCount).toBeLessThan(5);

      // Never a fake success or a fake failure for a stream the client
      // itself walked away from.
      expect(findLoggedLine(logSpy, "complete")).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(usageRepoMock.recordAiUsageEvent).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
