// Streaming Voice Reply -- CANDIDATE MODE, DEFAULT OFF (2026-08-26).
//
// Wires the already-proven, already-committed, already-real-tested TTS
// streaming/early-playback architecture (tts-provider-gemini-streaming.ts,
// /api/v1/clients/[id]/voice-reply-stream/route.ts,
// tts-streaming-playback-logic.ts -- see those files' own doc comments for
// the real, live-measured 65-89% time-to-first-audio reduction this exists
// to bring into the production Voice flow) into consultation-chat.tsx, as
// an explicit, reversible, DEFAULT-OFF candidate path.
//
// TWO INDEPENDENT kill-switches gate this, both required before streaming
// ever actually runs anywhere:
//   1. Server-side (unchanged, pre-existing): TEXT_TO_SPEECH_STREAMING_MODEL
//      -- if unset, POST /api/v1/clients/[id]/voice-reply-stream itself
//      returns 503 before doing any other work at all (see that route's
//      own module doc comment).
//   2. Client-side (NEW, this file): NEXT_PUBLIC_VOICE_STREAMING_TTS_ENABLED
//      -- see isStreamingVoiceReplyEnabled below. Every code path this
//      file adds is reached only from consultation-chat.tsx's own
//      isStreamingVoiceReplyEnabled() check, so leaving this env var unset
//      makes the whole integration a true no-op: consultation-chat.tsx
//      keeps calling the exact, byte-identical, unmodified full-WAV path
//      it always has.
//
// This module deliberately does NOT modify tts-streaming-playback-logic.ts
// (createGaplessPcmStreamPlayer is reused exactly as committed, never
// duplicated) and deliberately does NOT import from the dev-only
// web/src/app/dev/tts-streaming-demo/page.tsx (that page is a throwaway
// human-facing A/B harness, not a production dependency) -- the
// accumulate-then-flush-at-4096-bytes byte-batching pattern below mirrors
// that page's own implementation, as a second, independent, self-contained
// copy for this real production caller.

import { createGaplessPcmStreamPlayer } from "@/lib/tts-streaming-playback-logic";

// The one, single read of this env var this whole integration depends on
// -- see this file's own module doc comment for the "both switches
// required" contract. NEXT_PUBLIC_-prefixed so Next.js inlines it into the
// client bundle at build time (the same mechanism NEXT_PUBLIC_APP_COMMIT_SHA
// already relies on -- see voice-latency-logic.ts's own reportVoiceLatencySummary).
// Anything other than the literal string "true" (including unset,
// "1", "false", "TRUE") means disabled -- fails closed, never fails open.
export function isStreamingVoiceReplyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VOICE_STREAMING_TTS_ENABLED === "true";
}

// Every numeric field is `null` (never fabricated, never estimated) when
// the event it measures never actually happened for this attempt -- e.g.
// firstPlaybackStartedMs stays null for an attempt that fell back before
// ever scheduling a single chunk. chunkCount and totalStreamMs are the two
// fields that are always real numbers (0/elapsed-so-far are honest values
// even when nothing else happened yet).
export interface StreamingVoiceReplyTelemetry {
  chunkCount: number;
  firstChunkProviderMs: number | null;
  firstPlayableChunkMs: number | null;
  firstPlaybackStartedMs: number | null;
  playbackGapMaxMs: number | null;
  // REAL AudioContext-timeline gap measurement (2026-08-26, ADDITIVE --
  // kept side by side with playbackGapMaxMs above, which stays exactly
  // as-is: never removed, never renamed). playbackGapMaxMs is an honest
  // network-timing PROXY (see its own doc comment); this is the real
  // measurement, read straight from createGaplessPcmStreamPlayer's own new
  // getAudioTimelineGapMaxMs -- the actual amount of silence, in
  // milliseconds, observed on the real Web Audio playback timeline itself.
  // Same honesty contract as every other field here: null whenever no
  // chunk was ever scheduled for this attempt (nothing to measure), a real
  // number (0 included) otherwise -- never fabricated either way.
  audioTimelineGapMaxMs: number | null;
  totalStreamMs: number;
  streamingCompleted: boolean;
  streamingError: string | null;
}

export interface AttemptStreamingVoiceReplyDeps {
  fetch: typeof fetch;
  // ALWAYS created and owned by the caller (consultation-chat.tsx's own
  // getOrCreateStreamingAudioContext), NEVER created inside this module.
  // iOS/Safari only grants an AudioContext unlocked playback when it was
  // created (or resumed) in direct response to a real user gesture -- the
  // toggle's own click is that gesture, spent inside unlockAudioPlayback,
  // long before any reply's own async attemptStreamingVoiceReply call ever
  // runs. Creating a fresh AudioContext here instead would silently
  // produce no sound on iOS Safari regardless of anything else this
  // module does correctly.
  audioContext: AudioContext;
  signal?: AbortSignal;
}

// CRITICAL, explicit distinction -- this is what prevents double/
// overlapping playback, an explicit hard requirement of this integration:
//
// onFallbackBeforePlaybackStarted fires ONLY when the streaming attempt
// fails (network error, non-2xx response -- including the expected 503
// when TEXT_TO_SPEECH_STREAMING_MODEL is unset -- or a stream error)
// BEFORE the very first chunk was ever successfully scheduled for
// playback. It is always safe to fall back to the full-WAV path here:
// nothing has played yet, so starting the full reply from the beginning
// produces no audible artifact at all.
//
// onFailedAfterPlaybackStarted fires when a failure happens AFTER at least
// one chunk already started playing. The caller must NEVER fall back to
// full-WAV here -- that would replay the beginning of a reply the stylist
// already started hearing, producing audible double playback, which this
// task's own requirements explicitly forbid. The turn must instead end
// honestly as a partial/interrupted playback.
export interface AttemptStreamingVoiceReplyCallbacks {
  onFirstPlaybackStarted: () => void;
  onCompleted: (telemetry: StreamingVoiceReplyTelemetry) => void;
  onFallbackBeforePlaybackStarted: (reason: string) => void;
  onFailedAfterPlaybackStarted: (reason: string, telemetry: StreamingVoiceReplyTelemetry) => void;
}

// Same accumulate-then-flush-at-4096-bytes pattern as
// web/src/app/dev/tts-streaming-demo/page.tsx's own playCandidate -- see
// that page's own comment: real streaming chunks were confirmed live at
// ~1920 bytes each, so batching a few before each scheduleChunk call
// avoids scheduling a large number of very tiny AudioBufferSourceNodes.
//
// Configurable buffer-size A/B infrastructure (2026-08-26): operator-
// controlled via NEXT_PUBLIC_TEXT_TO_SPEECH_STREAMING_MIN_SCHEDULE_BYTES,
// following this file's own existing TEXT_TO_SPEECH_STREAMING_* naming
// convention (see isStreamingVoiceReplyEnabled's own doc comment above for
// the two pre-existing examples) -- NEXT_PUBLIC_-prefixed for the exact
// same reason NEXT_PUBLIC_VOICE_STREAMING_TTS_ENABLED already is: this
// whole integration runs client-side (see this file's own module doc
// comment), so only a NEXT_PUBLIC_-prefixed var is ever actually inlined
// into the browser bundle by Next.js at build time -- anything else here
// would silently read as undefined in the real, deployed app no matter
// what an operator sets it to.
//
// DEFAULT_MIN_SCHEDULE_BYTES (4096) is the exact, unchanged value this
// constant always held before this change -- resolveMinScheduleBytes
// falls back to exactly this whenever the env var is unset OR fails
// strict validation (must parse as a real positive integer -- no
// leading zeros, no sign, no decimal point, no scientific notation, no
// unsafe/overflowing magnitude; never throws, never silently accepts
// NaN/0/negative/non-integer garbage as a real configured value), so
// with zero configuration this is byte-for-byte identical to before this
// change. Resolved fresh on every runStreamingAttempt call (never cached
// at module load) rather than being a top-level const, purely so this
// stays easy to exercise directly in tests; the real, built app inlines
// NEXT_PUBLIC_ vars as literals at build time regardless, so there is no
// runtime cost or behavior difference from this either way.
//
// This is PURELY infrastructure for a human-run, human-restarted local
// A/B comparison -- see this module's own doc comment. Deliberately NO
// automatic switching logic anywhere near this: nothing here ever picks a
// value, compares outcomes, or changes behavior on its own.
const DEFAULT_MIN_SCHEDULE_BYTES = 4096;
// Positive integers only -- no leading zero (so "0", "007" are rejected),
// no sign, no decimal point, no whitespace, no scientific notation.
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

function resolveMinScheduleBytes(): number {
  // Read as a literal `process.env.NEXT_PUBLIC_...` member access (never
  // through a variable holding the name, never bracket notation) -- this
  // exact literal syntactic shape is what lets Next.js's build-time
  // DefinePlugin statically find and inline it into the client bundle
  // (see this constant's own doc comment above); a computed/indirect
  // lookup would not be recognized by that static analysis and would
  // silently read as undefined in the real, deployed app.
  const raw = process.env.NEXT_PUBLIC_TEXT_TO_SPEECH_STREAMING_MIN_SCHEDULE_BYTES;
  if (raw === undefined || !POSITIVE_INTEGER_PATTERN.test(raw)) {
    return DEFAULT_MIN_SCHEDULE_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    return DEFAULT_MIN_SCHEDULE_BYTES;
  }
  return parsed;
}

// Matches the X-Audio-Sample-Rate-Hz header voice-reply-stream/route.ts
// always sends (24000) -- see tts-streaming-playback-logic.ts's own
// createGaplessPcmStreamPlayer, which needs this to build correctly-sized
// AudioBuffers from raw Int16 PCM byte counts.
const STREAMING_SAMPLE_RATE_HZ = 24000;

export function attemptStreamingVoiceReply(
  clientId: string,
  text: string,
  language: string,
  deps: AttemptStreamingVoiceReplyDeps,
  callbacks: AttemptStreamingVoiceReplyCallbacks,
  requestStartedAtMs: number,
): void {
  void runStreamingAttempt(clientId, text, language, deps, callbacks, requestStartedAtMs);
}

async function runStreamingAttempt(
  clientId: string,
  text: string,
  language: string,
  deps: AttemptStreamingVoiceReplyDeps,
  callbacks: AttemptStreamingVoiceReplyCallbacks,
  requestStartedAtMs: number,
): Promise<void> {
  let response: Response;
  try {
    response = await deps.fetch(`/api/v1/clients/${clientId}/voice-reply-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch {
    // The request never completed at all (offline, CORS, aborted) --
    // nothing has played, always safe to fall back.
    callbacks.onFallbackBeforePlaybackStarted("network");
    return;
  }

  // The route's own first line of defense: TEXT_TO_SPEECH_STREAMING_MODEL
  // is unset in this environment -- see voice-reply-stream/route.ts's own
  // module doc comment. Expected and routine everywhere this candidate
  // mode hasn't been explicitly turned on server-side too.
  if (response.status === 503) {
    callbacks.onFallbackBeforePlaybackStarted("not_configured");
    return;
  }
  if (!response.ok) {
    callbacks.onFallbackBeforePlaybackStarted(`http_${response.status}`);
    return;
  }
  if (!response.body) {
    callbacks.onFallbackBeforePlaybackStarted("no_response_body");
    return;
  }

  // Reuses the existing, already-tested module exactly as committed --
  // never duplicated, never modified.
  const player = createGaplessPcmStreamPlayer(deps.audioContext, STREAMING_SAMPLE_RATE_HZ);
  const reader = response.body.getReader();
  // Resolved once per attempt (see resolveMinScheduleBytes's own doc
  // comment above for why this is call-time, not module-load-time).
  const minScheduleBytes = resolveMinScheduleBytes();

  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let chunkCount = 0;
  let firstByteReadAtMs: number | null = null;
  let lastScheduledAtMs: number | null = null;
  let firstChunkProviderMs: number | null = null;
  let firstPlayableChunkMs: number | null = null;
  let firstPlaybackStartedMs: number | null = null;
  // playbackGapMaxMs: an honest, documented JS-scheduling-side PROXY, not
  // a certified Web-Audio-timeline measurement -- createGaplessPcmStreamPlayer's
  // own public interface (deliberately not modified by this integration)
  // exposes no real AudioContext-timeline gap data. This tracks the max
  // gap, in ms, between when one chunk's bytes were read from the network
  // and when the PREVIOUS chunk was scheduled -- i.e. how long the
  // scheduler had to wait, after already scheduling everything it had so
  // far, for more network data to arrive. A real, if approximate, signal
  // for "did playback likely stutter here", never claimed to be more
  // precise than that.
  let playbackGapMaxMs: number | null = null;

  const buildTelemetry = (streamingCompleted: boolean, streamingError: string | null): StreamingVoiceReplyTelemetry => ({
    chunkCount,
    firstChunkProviderMs,
    firstPlayableChunkMs,
    firstPlaybackStartedMs,
    playbackGapMaxMs,
    // REAL AudioContext-timeline gap measurement (2026-08-26, ADDITIVE):
    // read fresh from the player at telemetry-build time (completion or
    // failure-after-playback-started -- see this function's own call
    // sites) rather than tracked separately in this closure, since the
    // player itself already owns the one real, authoritative running max.
    // null (never player.getAudioTimelineGapMaxMs's own default 0) when no
    // chunk was ever scheduled -- honest "never measured", not a
    // fabricated "measured zero".
    audioTimelineGapMaxMs: chunkCount > 0 ? player.getAudioTimelineGapMaxMs() : null,
    totalStreamMs: Math.max(0, Math.round(performance.now() - requestStartedAtMs)),
    streamingCompleted,
    streamingError,
  });

  // See the CRITICAL distinction on AttemptStreamingVoiceReplyCallbacks's
  // own doc comment: whether ANY chunk was ever scheduled (chunkCount > 0)
  // is exactly what decides which of the two failure callbacks is safe to
  // call. Called from every catch block below -- always exactly once per
  // invocation (every call site returns immediately after).
  const fail = (reason: string): void => {
    if (chunkCount > 0) {
      callbacks.onFailedAfterPlaybackStarted(reason, buildTelemetry(false, reason));
    } else {
      callbacks.onFallbackBeforePlaybackStarted(reason);
    }
  };

  // Combines whatever raw bytes have accumulated so far into one chunk and
  // schedules it -- called either because enough bytes have accumulated
  // (minScheduleBytes -- see resolveMinScheduleBytes above) or because the
  // stream is done and whatever is left must be flushed regardless of
  // size. `readAtMs` is the timestamp of the network read that triggered
  // this flush -- the real, honest anchor for both firstChunkProviderMs
  // (on the very first chunk) and playbackGapMaxMs (on every later one).
  const scheduleFromPending = (readAtMs: number): void => {
    const combined = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const part of pending) {
      combined.set(part, offset);
      offset += part.length;
    }
    pending = [];
    pendingBytes = 0;

    const isFirstChunk = chunkCount === 0;
    if (isFirstChunk) {
      firstChunkProviderMs = Math.max(0, Math.round((firstByteReadAtMs ?? readAtMs) - requestStartedAtMs));
      firstPlayableChunkMs = Math.max(0, Math.round(performance.now() - requestStartedAtMs));
    } else if (lastScheduledAtMs !== null) {
      const gap = Math.max(0, Math.round(readAtMs - lastScheduledAtMs));
      if (playbackGapMaxMs === null || gap > playbackGapMaxMs) {
        playbackGapMaxMs = gap;
      }
    }

    player.scheduleChunk(combined.buffer);
    chunkCount += 1;
    lastScheduledAtMs = performance.now();

    if (isFirstChunk) {
      // An honest, documented APPROXIMATION of real audible start, never
      // claimed to be more precise than this actually is: the Web Audio
      // API's own scheduling has no equivalent of HTMLMediaElement's
      // "playing" event to mark the exact moment sound genuinely reaches
      // the speaker. "Right after the first scheduleChunk call returns"
      // is the earliest point this code can observe that playback has
      // been committed to the audio graph -- close to, but not certified
      // identical to, the real audible-start instant.
      firstPlaybackStartedMs = Math.max(0, Math.round(lastScheduledAtMs - requestStartedAtMs));
      callbacks.onFirstPlaybackStarted();
    }
  };

  const flush = (flushRemaining: boolean, readAtMs: number): void => {
    if (pendingBytes === 0) return;
    if (!flushRemaining && pendingBytes < minScheduleBytes) return;
    scheduleFromPending(readAtMs);
  };

  for (;;) {
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await reader.read();
    } catch {
      fail("stream_error");
      return;
    }

    const { value, done } = readResult;
    const readAtMs = performance.now();

    if (value && value.length > 0) {
      if (firstByteReadAtMs === null) {
        firstByteReadAtMs = readAtMs;
      }
      pending.push(value);
      pendingBytes += value.length;
      try {
        flush(false, readAtMs);
      } catch {
        fail("stream_error");
        return;
      }
    }

    if (done) {
      try {
        flush(true, readAtMs);
      } catch {
        fail("stream_error");
        return;
      }
      // Real completion: the reader reported done and every accumulated
      // byte has been flushed (scheduled or, for a genuinely empty
      // stream, simply never existed) -- streamingCompleted is true and
      // streamingError is null, never fabricated either way.
      callbacks.onCompleted(buildTelemetry(true, null));
      return;
    }
  }
}
