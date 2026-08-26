import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same mocking convention as this repo's other route/module tests (see
// e.g. account/locale/route.test.ts's own vi.mock calls) -- placed before
// the imports of the mocked path and the module under test, matching
// house style, though vitest hoists vi.mock calls to the top of the file
// regardless of textual position. createGaplessPcmStreamPlayer is mocked
// so no real Web Audio API is ever required (this app's vitest
// environment is "node" -- see tts-streaming-playback-logic.ts's own doc
// comment).
vi.mock("@/lib/tts-streaming-playback-logic", () => ({
  createGaplessPcmStreamPlayer: vi.fn(),
}));

import { createGaplessPcmStreamPlayer } from "@/lib/tts-streaming-playback-logic";

import {
  attemptStreamingVoiceReply,
  isStreamingVoiceReplyEnabled,
  type AttemptStreamingVoiceReplyCallbacks,
  type StreamingVoiceReplyTelemetry,
} from "./consultation-chat-streaming-tts-integration";

type ReadStep = { value?: Uint8Array; done?: boolean; error?: unknown };

function fakeReader(steps: ReadStep[]) {
  let index = 0;
  return {
    read: vi.fn(async () => {
      const step = steps[index];
      index += 1;
      if (!step) {
        return { value: undefined, done: true };
      }
      if (step.error !== undefined) {
        throw step.error;
      }
      return { value: step.value, done: step.done ?? false };
    }),
  };
}

function streamResponse(reader: ReturnType<typeof fakeReader>): Response {
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
  } as unknown as Response;
}

function notOkResponse(status: number): Response {
  return { ok: false, status, body: null } as unknown as Response;
}

function fakePlayer() {
  return { scheduleChunk: vi.fn(), getScheduledDurationMs: vi.fn(() => 0) };
}

function noopCallbacks(overrides: Partial<AttemptStreamingVoiceReplyCallbacks> = {}): AttemptStreamingVoiceReplyCallbacks {
  return {
    onFirstPlaybackStarted: vi.fn(),
    onCompleted: vi.fn(),
    onFallbackBeforePlaybackStarted: vi.fn(),
    onFailedAfterPlaybackStarted: vi.fn(),
    ...overrides,
  };
}

// A real AudioContext is never touched by this module (it's only ever
// forwarded to the mocked createGaplessPcmStreamPlayer) -- a plain stand-in
// object is enough.
const FAKE_AUDIO_CONTEXT = {} as AudioContext;

async function flushMicrotasks(): Promise<void> {
  // attemptStreamingVoiceReply is fire-and-forget (returns void) -- every
  // test needs to let its internal async work run to completion before
  // asserting on callbacks. A handful of microtask turns is enough for
  // any depth of await chain this module uses.
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

describe("isStreamingVoiceReplyEnabled", () => {
  const original = process.env.NEXT_PUBLIC_VOICE_STREAMING_TTS_ENABLED;

  afterEach(() => {
    process.env.NEXT_PUBLIC_VOICE_STREAMING_TTS_ENABLED = original;
  });

  it("is true only when the env var is the exact literal string 'true'", () => {
    process.env.NEXT_PUBLIC_VOICE_STREAMING_TTS_ENABLED = "true";
    expect(isStreamingVoiceReplyEnabled()).toBe(true);
  });

  it("is false when the env var is unset", () => {
    delete process.env.NEXT_PUBLIC_VOICE_STREAMING_TTS_ENABLED;
    expect(isStreamingVoiceReplyEnabled()).toBe(false);
  });

  it("is false for any other value -- '1', 'false', 'TRUE' all fail closed", () => {
    for (const value of ["1", "false", "TRUE", "yes", ""]) {
      process.env.NEXT_PUBLIC_VOICE_STREAMING_TTS_ENABLED = value;
      expect(isStreamingVoiceReplyEnabled()).toBe(false);
    }
  });
});

describe("attemptStreamingVoiceReply", () => {
  beforeEach(() => {
    vi.mocked(createGaplessPcmStreamPlayer).mockReset();
  });

  it("posts the exact clientId/text/language to voice-reply-stream", async () => {
    const reader = fakeReader([{ done: true }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(fakePlayer());

    attemptStreamingVoiceReply(
      "client-1",
      "Clienta va reveni saptamana viitoare.",
      "ro",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks(),
      performance.now(),
    );
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/clients/client-1/voice-reply-stream");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ text: "Clienta va reveni saptamana viitoare.", language: "ro" });
  });

  it("a 503 (not configured) response triggers onFallbackBeforePlaybackStarted, never touching the player", async () => {
    const fetchMock = vi.fn().mockResolvedValue(notOkResponse(503));
    const onFallbackBeforePlaybackStarted = vi.fn();
    const onFailedAfterPlaybackStarted = vi.fn();

    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onFallbackBeforePlaybackStarted, onFailedAfterPlaybackStarted }),
      performance.now(),
    );
    await flushMicrotasks();

    expect(onFallbackBeforePlaybackStarted).toHaveBeenCalledTimes(1);
    expect(onFallbackBeforePlaybackStarted.mock.calls[0][0]).toMatch(/not_configured/);
    expect(onFailedAfterPlaybackStarted).not.toHaveBeenCalled();
    expect(createGaplessPcmStreamPlayer).not.toHaveBeenCalled();
  });

  it("a non-503 non-ok response triggers onFallbackBeforePlaybackStarted with an http_<status> reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(notOkResponse(502));
    const onFallbackBeforePlaybackStarted = vi.fn();

    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onFallbackBeforePlaybackStarted }),
      performance.now(),
    );
    await flushMicrotasks();

    expect(onFallbackBeforePlaybackStarted).toHaveBeenCalledWith("http_502");
    expect(createGaplessPcmStreamPlayer).not.toHaveBeenCalled();
  });

  it("a network-level fetch rejection triggers onFallbackBeforePlaybackStarted with a 'network' reason", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const onFallbackBeforePlaybackStarted = vi.fn();

    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onFallbackBeforePlaybackStarted }),
      performance.now(),
    );
    await flushMicrotasks();

    expect(onFallbackBeforePlaybackStarted).toHaveBeenCalledWith("network");
    expect(createGaplessPcmStreamPlayer).not.toHaveBeenCalled();
  });

  it("a successful multi-chunk stream calls onFirstPlaybackStarted exactly once, then onCompleted exactly once with real, non-negative telemetry", async () => {
    const chunkA = new Uint8Array(5000).fill(1);
    const chunkB = new Uint8Array(5000).fill(2);
    const reader = fakeReader([{ value: chunkA }, { value: chunkB }, { done: true }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    const player = fakePlayer();
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(player);

    const callOrder: string[] = [];
    const onFirstPlaybackStarted = vi.fn(() => callOrder.push("first"));
    const onCompleted = vi.fn((telemetry: StreamingVoiceReplyTelemetry) => {
      callOrder.push("completed");
      return telemetry;
    });

    const requestStartedAtMs = performance.now();
    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onFirstPlaybackStarted, onCompleted }),
      requestStartedAtMs,
    );
    await flushMicrotasks();

    expect(player.scheduleChunk).toHaveBeenCalledTimes(2);
    expect(onFirstPlaybackStarted).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["first", "completed"]);

    const telemetry = onCompleted.mock.calls[0][0] as StreamingVoiceReplyTelemetry;
    expect(telemetry.streamingCompleted).toBe(true);
    expect(telemetry.streamingError).toBeNull();
    expect(telemetry.chunkCount).toBe(2);
    for (const field of [
      telemetry.firstChunkProviderMs,
      telemetry.firstPlayableChunkMs,
      telemetry.firstPlaybackStartedMs,
      telemetry.playbackGapMaxMs,
      telemetry.totalStreamMs,
    ]) {
      expect(typeof field).toBe("number");
      expect(field as number).toBeGreaterThanOrEqual(0);
    }
  });

  it("never calls onFirstPlaybackStarted or onCompleted for a genuinely empty stream -- zero chunks, honest telemetry", async () => {
    const reader = fakeReader([{ done: true }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    const player = fakePlayer();
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(player);

    const onFirstPlaybackStarted = vi.fn();
    const onCompleted = vi.fn();

    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onFirstPlaybackStarted, onCompleted }),
      performance.now(),
    );
    await flushMicrotasks();

    expect(player.scheduleChunk).not.toHaveBeenCalled();
    expect(onFirstPlaybackStarted).not.toHaveBeenCalled();
    expect(onCompleted).toHaveBeenCalledTimes(1);
    const telemetry = onCompleted.mock.calls[0][0] as StreamingVoiceReplyTelemetry;
    expect(telemetry.chunkCount).toBe(0);
    expect(telemetry.firstPlaybackStartedMs).toBeNull();
  });

  it("a stream that errors AFTER the player already scheduled a chunk calls onFailedAfterPlaybackStarted, never onFallbackBeforePlaybackStarted", async () => {
    const chunkA = new Uint8Array(5000).fill(1);
    const reader = fakeReader([{ value: chunkA }, { error: new Error("network dropped mid-stream") }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    const player = fakePlayer();
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(player);

    const onFallbackBeforePlaybackStarted = vi.fn();
    const onFailedAfterPlaybackStarted = vi.fn();
    const onFirstPlaybackStarted = vi.fn();

    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onFallbackBeforePlaybackStarted, onFailedAfterPlaybackStarted, onFirstPlaybackStarted }),
      performance.now(),
    );
    await flushMicrotasks();

    expect(onFirstPlaybackStarted).toHaveBeenCalledTimes(1);
    expect(onFailedAfterPlaybackStarted).toHaveBeenCalledTimes(1);
    expect(onFallbackBeforePlaybackStarted).not.toHaveBeenCalled();

    const [reason, telemetry] = onFailedAfterPlaybackStarted.mock.calls[0] as [string, StreamingVoiceReplyTelemetry];
    expect(typeof reason).toBe("string");
    expect(telemetry.chunkCount).toBe(1);
    expect(telemetry.streamingCompleted).toBe(false);
  });

  it("a stream that errors BEFORE any chunk was scheduled calls onFallbackBeforePlaybackStarted, never onFailedAfterPlaybackStarted", async () => {
    const reader = fakeReader([{ error: new Error("connection reset") }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(fakePlayer());

    const onFallbackBeforePlaybackStarted = vi.fn();
    const onFailedAfterPlaybackStarted = vi.fn();

    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onFallbackBeforePlaybackStarted, onFailedAfterPlaybackStarted }),
      performance.now(),
    );
    await flushMicrotasks();

    expect(onFallbackBeforePlaybackStarted).toHaveBeenCalledTimes(1);
    expect(onFailedAfterPlaybackStarted).not.toHaveBeenCalled();
  });

  it("forwards an optional AbortSignal to the fetch call when provided", async () => {
    const reader = fakeReader([{ done: true }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(fakePlayer());
    const controller = new AbortController();

    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT, signal: controller.signal },
      noopCallbacks(),
      performance.now(),
    );
    await flushMicrotasks();

    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBe(controller.signal);
  });

  it("never calls more than one of the four callbacks for a single invocation", async () => {
    const chunkA = new Uint8Array(5000).fill(1);
    const reader = fakeReader([{ value: chunkA }, { done: true }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(fakePlayer());

    const onCompleted = vi.fn();
    const onFallbackBeforePlaybackStarted = vi.fn();
    const onFailedAfterPlaybackStarted = vi.fn();

    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onCompleted, onFallbackBeforePlaybackStarted, onFailedAfterPlaybackStarted }),
      performance.now(),
    );
    await flushMicrotasks();

    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onFallbackBeforePlaybackStarted).not.toHaveBeenCalled();
    expect(onFailedAfterPlaybackStarted).not.toHaveBeenCalled();
  });
});
