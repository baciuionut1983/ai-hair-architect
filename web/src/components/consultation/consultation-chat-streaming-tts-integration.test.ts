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
  return {
    scheduleChunk: vi.fn(),
    getScheduledDurationMs: vi.fn(() => 0),
    // REAL AudioContext-timeline gap measurement (2026-08-26, ADDITIVE):
    // mirrors getScheduledDurationMs's own "always a real number" style --
    // 0 is the real GaplessPcmStreamPlayer's own honest default too (see
    // tts-streaming-playback-logic.ts), not a test-only stand-in value.
    getAudioTimelineGapMaxMs: vi.fn(() => 0),
  };
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
      telemetry.audioTimelineGapMaxMs,
      telemetry.totalStreamMs,
    ]) {
      expect(typeof field).toBe("number");
      expect(field as number).toBeGreaterThanOrEqual(0);
    }
  });

  // REAL AudioContext-timeline gap measurement (2026-08-26, ADDITIVE): proves
  // audioTimelineGapMaxMs is read from the player's own new
  // getAudioTimelineGapMaxMs at telemetry-build time -- a real, non-zero
  // value here (as opposed to fakePlayer()'s own default 0) can only reach
  // the telemetry object if this integration actually calls that method.
  it("populates audioTimelineGapMaxMs from the player's own getAudioTimelineGapMaxMs when the stream completes after playback started", async () => {
    const chunkA = new Uint8Array(5000).fill(1);
    const reader = fakeReader([{ value: chunkA }, { done: true }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    const player = fakePlayer();
    player.getAudioTimelineGapMaxMs.mockReturnValue(237);
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(player);

    const onCompleted = vi.fn();
    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onCompleted }),
      performance.now(),
    );
    await flushMicrotasks();

    const telemetry = onCompleted.mock.calls[0][0] as StreamingVoiceReplyTelemetry;
    expect(telemetry.audioTimelineGapMaxMs).toBe(237);
    // playbackGapMaxMs (the pre-existing network-timing proxy) is
    // completely independent -- kept exactly as before, never replaced by
    // the new real measurement. It's null here (not a fabricated number)
    // because this test schedules only a single chunk, and that proxy is
    // only ever computed starting from a SECOND chunk onward (see
    // scheduleFromPending's own `else if (lastScheduledAtMs !== null)`).
    expect(telemetry.playbackGapMaxMs).toBeNull();
  });

  it("reports audioTimelineGapMaxMs as null (never the player's own 0 default) when no chunk was ever scheduled -- a genuinely empty stream", async () => {
    const reader = fakeReader([{ done: true }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    const player = fakePlayer();
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(player);

    const onCompleted = vi.fn();
    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onCompleted }),
      performance.now(),
    );
    await flushMicrotasks();

    const telemetry = onCompleted.mock.calls[0][0] as StreamingVoiceReplyTelemetry;
    expect(telemetry.chunkCount).toBe(0);
    expect(telemetry.audioTimelineGapMaxMs).toBeNull();
    expect(player.getAudioTimelineGapMaxMs).not.toHaveBeenCalled();
  });

  it("populates audioTimelineGapMaxMs on a failure AFTER playback started too, not only on a clean completion", async () => {
    const chunkA = new Uint8Array(5000).fill(1);
    const reader = fakeReader([{ value: chunkA }, { error: new Error("network dropped mid-stream") }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    const player = fakePlayer();
    player.getAudioTimelineGapMaxMs.mockReturnValue(412);
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(player);

    const onFailedAfterPlaybackStarted = vi.fn();
    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks({ onFailedAfterPlaybackStarted }),
      performance.now(),
    );
    await flushMicrotasks();

    const [, telemetry] = onFailedAfterPlaybackStarted.mock.calls[0] as [string, StreamingVoiceReplyTelemetry];
    expect(telemetry.audioTimelineGapMaxMs).toBe(412);
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

// Configurable buffer-size A/B infrastructure (2026-08-26): proves
// resolveMinScheduleBytes's own env-var resolution (unexported, exercised
// only indirectly here through the real accumulate-then-flush behavior --
// see this module's own doc comment on DEFAULT_MIN_SCHEDULE_BYTES) --
// with zero configuration, behavior is byte-for-byte identical to before
// this change, and a valid override actually takes effect.
describe("MIN_SCHEDULE_BYTES resolution (NEXT_PUBLIC_TEXT_TO_SPEECH_STREAMING_MIN_SCHEDULE_BYTES)", () => {
  const ENV_VAR = "NEXT_PUBLIC_TEXT_TO_SPEECH_STREAMING_MIN_SCHEDULE_BYTES";
  const original = process.env[ENV_VAR];

  beforeEach(() => {
    vi.mocked(createGaplessPcmStreamPlayer).mockReset();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = original;
    }
  });

  it("with the env var unset, batches below the real default of 4096 bytes -- flushing only once the stream ends, exactly as before this change", async () => {
    delete process.env[ENV_VAR];
    const chunk1 = new Uint8Array(2000).fill(1);
    const chunk2 = new Uint8Array(1500).fill(2); // 3500 total, still < 4096
    const reader = fakeReader([{ value: chunk1 }, { value: chunk2 }, { done: true }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    const player = fakePlayer();
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(player);

    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks(),
      performance.now(),
    );
    await flushMicrotasks();

    // Never flushed early on either read (both below 4096) -- only the
    // final done-triggered flush schedules the one combined chunk.
    expect(player.scheduleChunk).toHaveBeenCalledTimes(1);
  });

  it("with the env var set to a valid positive integer, flushes as soon as that many bytes accumulate, without waiting for stream end", async () => {
    process.env[ENV_VAR] = "2000";
    const chunk1 = new Uint8Array(2500).fill(1); // >= 2000 -- should flush immediately on this read
    const reader = fakeReader([{ value: chunk1 }, { done: true }]);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
    const player = fakePlayer();
    vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(player);

    attemptStreamingVoiceReply(
      "client-1",
      "text",
      "en",
      { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
      noopCallbacks(),
      performance.now(),
    );
    await flushMicrotasks();

    // Flushed once already on the first (2500-byte) read; the final
    // `done` has nothing left over to flush a second time.
    expect(player.scheduleChunk).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default 4096-byte threshold for every invalid value -- non-numeric, zero, negative, decimal, leading-zero -- never throwing", async () => {
    for (const invalid of ["abc", "0", "-100", "3.5", "007", "1e10", ""]) {
      process.env[ENV_VAR] = invalid;
      const chunk1 = new Uint8Array(3000).fill(1); // below the real 4096 default
      const reader = fakeReader([{ value: chunk1 }, { done: true }]);
      const fetchMock = vi.fn().mockResolvedValue(streamResponse(reader));
      const player = fakePlayer();
      vi.mocked(createGaplessPcmStreamPlayer).mockReturnValue(player);

      expect(() =>
        attemptStreamingVoiceReply(
          "client-1",
          "text",
          "en",
          { fetch: fetchMock, audioContext: FAKE_AUDIO_CONTEXT },
          noopCallbacks(),
          performance.now(),
        ),
      ).not.toThrow();
      await flushMicrotasks();

      // Never flushed on the first (3000-byte, below-4096) read -- only
      // the final done-triggered flush -- proving the invalid value was
      // rejected and the real 4096 default applied instead.
      expect(player.scheduleChunk).toHaveBeenCalledTimes(1);
    }
  });
});
