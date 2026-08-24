import { describe, expect, it } from "vitest";

import {
  DEFAULT_SILERO_CONTINUATION_GATE_CONFIG,
  evaluateSileroContinuationGateFrame,
  initSileroContinuationGateState,
  resolveSileroContinuationAuthority,
  type SileroContinuationGateState,
} from "./silero-continuation-gate-logic";

const THRESHOLD = DEFAULT_SILERO_CONTINUATION_GATE_CONFIG.probabilityThreshold;
const GAP_TOLERANCE = DEFAULT_SILERO_CONTINUATION_GATE_CONFIG.speechGapToleranceMs;
const SILENCE_CONFIRM = DEFAULT_SILERO_CONTINUATION_GATE_CONFIG.silenceConfirmMs;

describe("evaluateSileroContinuationGateFrame", () => {
  // Required test 1: sustained speech -> silence countdown never starts.
  it("sustained qualifying frames keep refreshing lastSpeechAtMs and never produce a silence candidate", () => {
    let state = initSileroContinuationGateState();
    let now = 0;
    for (let i = 0; i < 50; i += 1) {
      now += 32;
      state = evaluateSileroContinuationGateFrame(state, 0.9, now);
    }
    expect(state.lastSpeechAtMs).toBe(now);
    expect(state.silenceCandidateAtMs).toBeNull();
    expect(state.silenceConfirmedAtMs).toBeNull();
  });

  // Required test 2: an isolated low-probability frame does not, by
  // itself, start a silence candidate.
  it("a single isolated sub-threshold frame within the gap tolerance leaves state untouched", () => {
    const afterSpeech = evaluateSileroContinuationGateFrame(initSileroContinuationGateState(), 0.9, 1000);
    const afterDip = evaluateSileroContinuationGateFrame(afterSpeech, 0.1, 1000 + GAP_TOLERANCE - 1);
    expect(afterDip).toEqual(afterSpeech);
  });

  // Required test 3: a short non-speech gap (right at the tolerance
  // boundary) is still tolerated.
  it("a gap exactly at the tolerance boundary is still tolerated (inclusive)", () => {
    const afterSpeech = evaluateSileroContinuationGateFrame(initSileroContinuationGateState(), 0.9, 1000);
    const atBoundary = evaluateSileroContinuationGateFrame(afterSpeech, 0.1, 1000 + GAP_TOLERANCE);
    expect(atBoundary.silenceCandidateAtMs).toBeNull();
  });

  it("a gap one millisecond past the tolerance boundary starts a silence candidate, frozen at lastSpeechAtMs + gapTolerance", () => {
    const afterSpeech = evaluateSileroContinuationGateFrame(initSileroContinuationGateState(), 0.9, 1000);
    const pastBoundary = evaluateSileroContinuationGateFrame(afterSpeech, 0.1, 1000 + GAP_TOLERANCE + 1);
    expect(pastBoundary.silenceCandidateAtMs).toBe(1000 + GAP_TOLERANCE);
    expect(pastBoundary.silenceConfirmedAtMs).toBeNull();
  });

  // Required test 4: speech resumes -> silence candidate resets.
  it("a qualifying frame arriving after a silence candidate has begun resets the whole state", () => {
    const afterSpeech = evaluateSileroContinuationGateFrame(initSileroContinuationGateState(), 0.9, 1000);
    const candidate = evaluateSileroContinuationGateFrame(afterSpeech, 0.1, 1000 + GAP_TOLERANCE + 200);
    expect(candidate.silenceCandidateAtMs).not.toBeNull();
    const resumed = evaluateSileroContinuationGateFrame(candidate, 0.95, 1000 + GAP_TOLERANCE + 250);
    expect(resumed).toEqual({ lastSpeechAtMs: 1000 + GAP_TOLERANCE + 250, silenceCandidateAtMs: null, silenceConfirmedAtMs: null });
  });

  // Required test 5: sustained non-speech -> silence candidate confirms.
  it("a gap reaching silenceConfirmMs since the last real speech evidence freezes silenceConfirmedAtMs", () => {
    const afterSpeech = evaluateSileroContinuationGateFrame(initSileroContinuationGateState(), 0.9, 1000);
    const stillWaiting = evaluateSileroContinuationGateFrame(afterSpeech, 0.1, 1000 + SILENCE_CONFIRM - 1);
    expect(stillWaiting.silenceConfirmedAtMs).toBeNull();
    const confirmed = evaluateSileroContinuationGateFrame(stillWaiting, 0.1, 1000 + SILENCE_CONFIRM);
    expect(confirmed.silenceConfirmedAtMs).toBe(1000 + SILENCE_CONFIRM);
  });

  it("total wait from last real speech evidence to confirmation is exactly silenceConfirmMs, not silenceConfirmMs + gapTolerance", () => {
    const afterSpeech = evaluateSileroContinuationGateFrame(initSileroContinuationGateState(), 0.9, 1000);
    let state: SileroContinuationGateState = afterSpeech;
    let firstConfirmedAt: number | null = null;
    for (let now = 1001; now <= 1000 + SILENCE_CONFIRM + 100; now += 1) {
      state = evaluateSileroContinuationGateFrame(state, 0.1, now);
      if (state.silenceConfirmedAtMs !== null && firstConfirmedAt === null) {
        firstConfirmedAt = now;
      }
    }
    expect(firstConfirmedAt).toBe(1000 + SILENCE_CONFIRM);
  });

  it("once no speech evidence has EVER been seen, sub-threshold frames are a genuine no-op (nothing to measure a gap from yet)", () => {
    const state = initSileroContinuationGateState();
    const next = evaluateSileroContinuationGateFrame(state, 0.05, 5000);
    expect(next).toBe(state);
  });

  // Required test 12: soft speech (probability right at/above threshold)
  // still qualifies and keeps refreshing.
  it("a probability exactly at the threshold qualifies (>=, not >)", () => {
    const state = evaluateSileroContinuationGateFrame(initSileroContinuationGateState(), THRESHOLD, 42);
    expect(state.lastSpeechAtMs).toBe(42);
  });

  // Required test 11: speech over music -- probability fluctuates but
  // never leaves a genuine gap; should stay fully active throughout.
  it("fluctuating but frequently-qualifying probabilities (simulating speech over music) never accumulate a real silence candidate", () => {
    let state = initSileroContinuationGateState();
    const probabilities = [0.9, 0.85, 0.6, 0.95, 0.7, 0.55, 0.92, 0.65, 0.98, 0.8];
    let now = 0;
    for (const p of probabilities) {
      now += 32;
      state = evaluateSileroContinuationGateFrame(state, p, now);
    }
    expect(state.silenceCandidateAtMs).toBeNull();
    expect(state.silenceConfirmedAtMs).toBeNull();
  });

  // Required test 15: long speech -- no premature stop, even over a much
  // longer span than the silence timeout itself.
  it("20 seconds of continuous qualifying frames never produces a silence candidate", () => {
    let state = initSileroContinuationGateState();
    let now = 0;
    while (now < 20_000) {
      now += 32;
      state = evaluateSileroContinuationGateFrame(state, 0.85, now);
    }
    expect(state.silenceCandidateAtMs).toBeNull();
    expect(state.silenceConfirmedAtMs).toBeNull();
  });
});

const HEALTHY = { sileroModelAvailable: true, sileroErrorCount: 0 };

describe("resolveSileroContinuationAuthority", () => {
  // Required test 10: music-only (START never confirmed) can never reach
  // Phase C's own override logic at all.
  it("hasDetectedSpeech=false is a pure pass-through, regardless of gate state or model health", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: false,
      heuristicDecision: "stop_no_speech_timeout",
      heuristicLastSpeechAt: null,
      ...HEALTHY,
      continuationGateState: { lastSpeechAtMs: 900, silenceCandidateAtMs: null, silenceConfirmedAtMs: 5000 },
      fallbackAlreadyUsedThisRecording: false,
    });
    expect(result).toEqual({
      decision: "stop_no_speech_timeout",
      lastSpeechAt: null,
      legacyStopSuppressed: false,
      fallbackEngaged: false,
      fallbackReason: null,
    });
  });

  // Required test 17: max duration is untouched, unconditionally.
  it("stop_max_duration is passed through unconditionally, even if Silero disagrees", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: true,
      heuristicDecision: "stop_max_duration",
      heuristicLastSpeechAt: 1000,
      ...HEALTHY,
      continuationGateState: { lastSpeechAtMs: 59_900, silenceCandidateAtMs: null, silenceConfirmedAtMs: null },
      fallbackAlreadyUsedThisRecording: false,
    });
    expect(result.decision).toBe("stop_max_duration");
    expect(result.legacyStopSuppressed).toBe(false);
  });

  // Required test 7: the decisive regression test -- legacy wants to stop,
  // Silero still sees speech -> suppressed.
  it("suppresses a legacy stop_silence while Silero's own gate has not confirmed silence", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: true,
      heuristicDecision: "stop_silence",
      heuristicLastSpeechAt: 900,
      ...HEALTHY,
      continuationGateState: { lastSpeechAtMs: 2800, silenceCandidateAtMs: null, silenceConfirmedAtMs: null },
      fallbackAlreadyUsedThisRecording: false,
    });
    expect(result.decision).toBe("continue");
    expect(result.legacyStopSuppressed).toBe(true);
    expect(result.lastSpeechAt).toBe(2800);
  });

  // Required test 6: once Silero's own gate confirms silence, stop_silence
  // actually proceeds -- the existing ~2s behavior still works, just
  // sourced from Silero.
  it("allows stop_silence once Silero's own gate has confirmed silence", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: true,
      heuristicDecision: "stop_silence",
      heuristicLastSpeechAt: 900,
      ...HEALTHY,
      continuationGateState: { lastSpeechAtMs: 900, silenceCandidateAtMs: 1200, silenceConfirmedAtMs: 2900 },
      fallbackAlreadyUsedThisRecording: false,
    });
    expect(result.decision).toBe("stop_silence");
    expect(result.legacyStopSuppressed).toBe(false);
  });

  it("Silero can ALSO trigger a stop the legacy heuristic itself did not want yet, once its own gate confirms silence", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: true,
      heuristicDecision: "continue",
      heuristicLastSpeechAt: 900,
      ...HEALTHY,
      continuationGateState: { lastSpeechAtMs: 900, silenceCandidateAtMs: 1200, silenceConfirmedAtMs: 2900 },
      fallbackAlreadyUsedThisRecording: false,
    });
    expect(result.decision).toBe("stop_silence");
  });

  // Required test 13/14: a natural ~1s pause is tolerated, and a resumed
  // gate state (silenceCandidate set but NOT confirmed) never suppresses
  // "continue" unnecessarily -- covered by the "legacy wants continue,
  // Silero also continue" identity case:
  it("both authorities agreeing on continue is a pure continue, no suppression flagged", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: true,
      heuristicDecision: "continue",
      heuristicLastSpeechAt: 900,
      ...HEALTHY,
      continuationGateState: { lastSpeechAtMs: 1800, silenceCandidateAtMs: null, silenceConfirmedAtMs: null },
      fallbackAlreadyUsedThisRecording: false,
    });
    expect(result).toEqual({ decision: "continue", lastSpeechAt: 1800, legacyStopSuppressed: false, fallbackEngaged: false, fallbackReason: null });
  });

  // Required test 8: Silero becomes unhealthy post-start -> fallback to
  // legacy's own unmodified decision.
  it("falls back to the heuristic's own decision when Silero has a runtime error post-start", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: true,
      heuristicDecision: "stop_silence",
      heuristicLastSpeechAt: 900,
      sileroModelAvailable: true,
      sileroErrorCount: 1,
      continuationGateState: { lastSpeechAtMs: 2800, silenceCandidateAtMs: null, silenceConfirmedAtMs: null },
      fallbackAlreadyUsedThisRecording: false,
    });
    expect(result.decision).toBe("stop_silence");
    expect(result.legacyStopSuppressed).toBe(false);
    expect(result.fallbackEngaged).toBe(true);
    expect(result.fallbackReason).toBe("model_error");
  });

  it("falls back with model_unavailable when Silero setup failed entirely", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: true,
      heuristicDecision: "continue",
      heuristicLastSpeechAt: 900,
      sileroModelAvailable: false,
      sileroErrorCount: 0,
      continuationGateState: initSileroContinuationGateState(),
      fallbackAlreadyUsedThisRecording: false,
    });
    expect(result.fallbackEngaged).toBe(true);
    expect(result.fallbackReason).toBe("model_unavailable");
  });

  it("falls back with model_loading when Silero has not been assigned a handle yet", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: true,
      heuristicDecision: "continue",
      heuristicLastSpeechAt: 900,
      sileroModelAvailable: null,
      sileroErrorCount: 0,
      continuationGateState: initSileroContinuationGateState(),
      fallbackAlreadyUsedThisRecording: false,
    });
    expect(result.fallbackEngaged).toBe(true);
    expect(result.fallbackReason).toBe("model_loading");
  });

  it("does not re-flag fallbackEngaged once fallbackAlreadyUsedThisRecording is true, even though the reason keeps being reported", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: true,
      heuristicDecision: "continue",
      heuristicLastSpeechAt: 900,
      sileroModelAvailable: false,
      sileroErrorCount: 0,
      continuationGateState: initSileroContinuationGateState(),
      fallbackAlreadyUsedThisRecording: true,
    });
    expect(result.fallbackEngaged).toBe(false);
    expect(result.fallbackReason).toBe("model_unavailable");
  });

  it("uses the heuristic's own lastSpeechAt as a fallback when Silero is healthy but its own gate has not seen any frame yet", () => {
    const result = resolveSileroContinuationAuthority({
      hasDetectedSpeech: true,
      heuristicDecision: "continue",
      heuristicLastSpeechAt: 1234,
      ...HEALTHY,
      continuationGateState: initSileroContinuationGateState(),
      fallbackAlreadyUsedThisRecording: false,
    });
    expect(result.lastSpeechAt).toBe(1234);
  });
});
