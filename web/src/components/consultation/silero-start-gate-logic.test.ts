import { describe, expect, it } from "vitest";

import {
  DEFAULT_SILERO_START_GATE_CONFIG,
  evaluateSileroStartGateFrame,
  initSileroStartGateState,
  resolveSileroStartAuthority,
  type SileroStartGateConfig,
  type StartAuthorityInput,
} from "./silero-start-gate-logic";

describe("evaluateSileroStartGateFrame", () => {
  // Required test 1: Silero low probability constant -> START NU se confirmă.
  it("a low, constant probability stream (below threshold) never confirms START, no matter how long it plays", () => {
    let state = initSileroStartGateState();
    let t = 0;
    for (let i = 0; i < 100; i += 1) {
      t += 32;
      state = evaluateSileroStartGateFrame(state, 0.05, t);
    }
    expect(state.confirmed).toBe(false);
    expect(state.confirmedAtMs).toBeNull();
  });

  // Required test 2: an isolated large spike must NOT confirm START --
  // reproduces the exact real production shape from Phase A's music-only
  // test (peak 0.78457, only 4/1859 qualifying frames total).
  it("a single isolated high-probability spike does not confirm START -- the exact real production music-spike shape", () => {
    let state = initSileroStartGateState();
    let t = 0;
    // Low probability, then one isolated spike, then low again.
    state = evaluateSileroStartGateFrame(state, 0.05, (t += 32));
    state = evaluateSileroStartGateFrame(state, 0.05, (t += 32));
    state = evaluateSileroStartGateFrame(state, 0.78457, (t += 32)); // the spike
    expect(state.confirmed).toBe(false); // duration is 0 on a fresh streak, and count is only 1
    state = evaluateSileroStartGateFrame(state, 0.05, (t += 32));
    state = evaluateSileroStartGateFrame(state, 0.05, (t += 32));
    // Well past the gap tolerance with no further qualifying evidence --
    // the streak resets, exactly like real music never recurring.
    t += DEFAULT_SILERO_START_GATE_CONFIG.gapToleranceMs + 100;
    state = evaluateSileroStartGateFrame(state, 0.05, t);
    expect(state.confirmed).toBe(false);
    expect(state.streakStartedAt).toBeNull();
    expect(state.qualifiedFrameCount).toBe(0);
  });

  // Required test 3: sustained speech probability confirms START.
  it("sustained, recurring high-probability frames confirm START once both duration and recurrence are satisfied", () => {
    let state = initSileroStartGateState();
    let t = 0;
    // 32ms frames -- need to cross minDurationMs (250ms) AND
    // minQualifiedFrameCount (2). 250ms / 32ms ~= 8 frames.
    for (let i = 0; i < 10; i += 1) {
      t += 32;
      state = evaluateSileroStartGateFrame(state, 0.9, t);
    }
    expect(state.confirmed).toBe(true);
    expect(state.confirmedAtMs).not.toBeNull();
    expect(state.qualifiedFrameCount).toBeGreaterThanOrEqual(DEFAULT_SILERO_START_GATE_CONFIG.minQualifiedFrameCount);
  });

  // Required test 4: a short gap between speech-qualifying frames is
  // tolerated (does not reset the streak).
  it("a short gap between qualifying frames (within gapToleranceMs) does not reset the streak, and confirmation still proceeds", () => {
    let state = initSileroStartGateState();
    let t = 0;
    state = evaluateSileroStartGateFrame(state, 0.9, (t += 0)); // t=0, streak starts, count=1
    // A brief dip below threshold -- well within gapToleranceMs (300ms).
    t += 100;
    state = evaluateSileroStartGateFrame(state, 0.1, t);
    expect(state.streakStartedAt).toBe(0); // survived the dip
    expect(state.qualifiedFrameCount).toBe(1); // unchanged by the non-qualifying dip
    // Speech resumes -- total elapsed since t=0 now exceeds minDurationMs.
    t += 200; // t=300
    state = evaluateSileroStartGateFrame(state, 0.9, t);
    expect(state.confirmed).toBe(true);
  });

  // Required test 5: a gap that exceeds tolerance resets the candidate
  // streak entirely.
  it("a gap longer than gapToleranceMs resets the streak -- tolerance is bounded, not unlimited", () => {
    let state = initSileroStartGateState();
    let t = 0;
    state = evaluateSileroStartGateFrame(state, 0.9, t); // streak starts
    t += DEFAULT_SILERO_START_GATE_CONFIG.gapToleranceMs + 1; // just past tolerance
    state = evaluateSileroStartGateFrame(state, 0.1, t);
    expect(state.streakStartedAt).toBeNull();
    expect(state.qualifiedFrameCount).toBe(0);
    expect(state.confirmed).toBe(false);

    // A fresh streak starting now must still need its OWN full duration +
    // recurrence -- the discarded progress does not carry over.
    t += 32;
    state = evaluateSileroStartGateFrame(state, 0.9, t);
    expect(state.confirmed).toBe(false);
  });

  it("once confirmed, further frames are a no-op -- this module has nothing further to say after START (continuation is out of scope)", () => {
    let state = initSileroStartGateState();
    let t = 0;
    for (let i = 0; i < 10; i += 1) {
      t += 32;
      state = evaluateSileroStartGateFrame(state, 0.9, t);
    }
    expect(state.confirmed).toBe(true);
    const confirmedState = state;
    const confirmedAt = state.confirmedAtMs;

    // Feed silence, and even a fresh spike -- state must not change at all.
    state = evaluateSileroStartGateFrame(state, 0.0, (t += 1000));
    expect(state).toEqual(confirmedState);
    state = evaluateSileroStartGateFrame(state, 0.99, (t += 1000));
    expect(state).toEqual(confirmedState);
    expect(state.confirmedAtMs).toBe(confirmedAt);
  });

  it("tracks peakQualifiedFrameCount across a reset -- reveals how much recurrence the longest streak had even if it was later discarded", () => {
    let state = initSileroStartGateState();
    let t = 0;
    // Build a streak of 3 qualified frames (not yet enough duration to
    // confirm), then let it fully reset.
    state = evaluateSileroStartGateFrame(state, 0.9, (t += 0));
    state = evaluateSileroStartGateFrame(state, 0.9, (t += 32));
    state = evaluateSileroStartGateFrame(state, 0.9, (t += 32));
    expect(state.qualifiedFrameCount).toBe(3);
    expect(state.confirmed).toBe(false); // duration (64ms) < 250ms
    t += DEFAULT_SILERO_START_GATE_CONFIG.gapToleranceMs + 1;
    state = evaluateSileroStartGateFrame(state, 0.0, t);
    expect(state.qualifiedFrameCount).toBe(0); // reset
    expect(state.peakQualifiedFrameCount).toBe(3); // remembered
  });

  it("respects a custom config", () => {
    const config: SileroStartGateConfig = { probabilityThreshold: 0.8, minDurationMs: 100, gapToleranceMs: 50, minQualifiedFrameCount: 3 };
    let state = initSileroStartGateState();
    let t = 0;
    // 0.7 fails the custom, higher threshold.
    state = evaluateSileroStartGateFrame(state, 0.7, t, config);
    expect(state.confirmed).toBe(false);
    expect(state.qualifiedFrameCount).toBe(0);

    // Streak starts at t=32; needs BOTH >=3 qualified frames AND >=100ms
    // duration since streak start -- 3 frames alone (up to t=96, 64ms of
    // duration) satisfy the count but not yet the duration.
    state = evaluateSileroStartGateFrame(state, 0.85, (t += 32), config); // t=32
    state = evaluateSileroStartGateFrame(state, 0.85, (t += 32), config); // t=64
    state = evaluateSileroStartGateFrame(state, 0.85, (t += 32), config); // t=96, count=3, duration=64ms
    expect(state.confirmed).toBe(false);
    state = evaluateSileroStartGateFrame(state, 0.85, (t += 32), config); // t=128, duration=96ms
    expect(state.confirmed).toBe(false);
    state = evaluateSileroStartGateFrame(state, 0.85, (t += 32), config); // t=160, duration=128ms >= 100
    expect(state.confirmed).toBe(true);
  });
});

// VAD Round 11 (2026-08-23), Phase B: pure arbitration between the
// heuristic's own raw computation and Silero's own gate -- see
// silero-start-gate-logic.ts's own doc comment for the full rule. Split
// out specifically so it is unit-testable: use-voice-recording.ts's own
// interval loop (where this logic is actually consulted) cannot be, since
// jsdom has no real AudioContext/AudioWorklet/WASM.
describe("resolveSileroStartAuthority", () => {
  const baseInput: StartAuthorityInput = {
    wasSpeechConfirmedBeforeThisTick: false,
    heuristicHasDetectedSpeech: false,
    heuristicLastSpeechAt: null,
    now: 1000,
    sileroModelAvailable: true,
    sileroErrorCount: 0,
    sileroStartGateConfirmed: false,
    fallbackAlreadyUsedThisRecording: false,
  };

  // Required test 6: model unavailable -> fallback heuristic.
  it("model unavailable (setup failed) falls back to the heuristic's own raw computation, and reports the reason once", () => {
    const result = resolveSileroStartAuthority({
      ...baseInput,
      sileroModelAvailable: false,
      heuristicHasDetectedSpeech: true,
      heuristicLastSpeechAt: 950,
    });
    expect(result.hasDetectedSpeech).toBe(true); // the heuristic's own value, unmodified
    expect(result.lastSpeechAt).toBe(950);
    expect(result.fallbackEngaged).toBe(true);
    expect(result.fallbackReason).toBe("model_unavailable");
  });

  // Required test 7: model runtime error -> fallback heuristic.
  it("a runtime inference error (errorCount > 0) on an otherwise-available model falls back to the heuristic, distinct from 'never loaded'", () => {
    const result = resolveSileroStartAuthority({
      ...baseInput,
      sileroModelAvailable: true,
      sileroErrorCount: 3,
      heuristicHasDetectedSpeech: true,
      heuristicLastSpeechAt: 950,
    });
    expect(result.hasDetectedSpeech).toBe(true);
    expect(result.fallbackEngaged).toBe(true);
    expect(result.fallbackReason).toBe("model_error");
  });

  it("model still loading (no handle assigned yet, sileroModelAvailable null) falls back to the heuristic -- the first-utterance/model-load race", () => {
    const result = resolveSileroStartAuthority({
      ...baseInput,
      sileroModelAvailable: null,
      heuristicHasDetectedSpeech: true,
      heuristicLastSpeechAt: 950,
    });
    expect(result.hasDetectedSpeech).toBe(true); // the heuristic alone can still confirm during the load window
    expect(result.fallbackEngaged).toBe(true);
    expect(result.fallbackReason).toBe("model_loading");
  });

  it("fallbackEngaged is true only on the FIRST tick fallback applies -- never re-flagged on subsequent ticks", () => {
    const first = resolveSileroStartAuthority({ ...baseInput, sileroModelAvailable: false, fallbackAlreadyUsedThisRecording: false });
    expect(first.fallbackEngaged).toBe(true);
    const second = resolveSileroStartAuthority({ ...baseInput, sileroModelAvailable: false, fallbackAlreadyUsedThisRecording: true });
    expect(second.fallbackEngaged).toBe(false);
    // The reason is still reported every time (the caller only WRITES it
    // once, per its own doc comment, but the function itself always
    // computes the true current reason).
    expect(second.fallbackReason).toBe("model_unavailable");
  });

  it("Silero healthy but not yet confirmed suppresses an independently-confirming heuristic", () => {
    const result = resolveSileroStartAuthority({
      ...baseInput,
      sileroModelAvailable: true,
      sileroErrorCount: 0,
      sileroStartGateConfirmed: false,
      heuristicHasDetectedSpeech: true, // the heuristic's OWN raw computation confirmed this tick
      heuristicLastSpeechAt: 950,
    });
    expect(result.hasDetectedSpeech).toBe(false); // suppressed -- Silero has not confirmed yet
    expect(result.fallbackEngaged).toBe(false);
  });

  it("Silero healthy and confirmed forces hasDetectedSpeech true, even if the heuristic's own raw computation has not independently confirmed", () => {
    const result = resolveSileroStartAuthority({
      ...baseInput,
      sileroModelAvailable: true,
      sileroErrorCount: 0,
      sileroStartGateConfirmed: true,
      heuristicHasDetectedSpeech: false,
      heuristicLastSpeechAt: null,
      now: 2000,
    });
    expect(result.hasDetectedSpeech).toBe(true);
    expect(result.lastSpeechAt).toBe(2000); // falls back to `now` since the heuristic never saw anything
  });

  it("Silero confirmed AND the heuristic already has a real lastSpeechAt -- prefers the heuristic's own (likely fresher) value over `now`", () => {
    const result = resolveSileroStartAuthority({
      ...baseInput,
      sileroModelAvailable: true,
      sileroStartGateConfirmed: true,
      heuristicHasDetectedSpeech: false,
      heuristicLastSpeechAt: 1900,
      now: 2000,
    });
    expect(result.hasDetectedSpeech).toBe(true);
    expect(result.lastSpeechAt).toBe(1900);
  });

  // Required test 9: Silero START confirmed -> continuation/end rămâne
  // legacy. Modeled here as: once wasSpeechConfirmedBeforeThisTick is
  // true (START already happened, by EITHER authority, on a prior tick),
  // this function must be a pure, unconditional pass-through of the
  // heuristic's own values -- proving Phase B never touches anything
  // after START, structurally.
  describe("once START is already confirmed (wasSpeechConfirmedBeforeThisTick), continuation/end stays fully on the heuristic", () => {
    it("passes the heuristic's own values through unchanged, regardless of Silero's current state", () => {
      const scenarios: Partial<StartAuthorityInput>[] = [
        { sileroModelAvailable: false, sileroErrorCount: 0, sileroStartGateConfirmed: false },
        { sileroModelAvailable: true, sileroErrorCount: 5, sileroStartGateConfirmed: false },
        { sileroModelAvailable: true, sileroErrorCount: 0, sileroStartGateConfirmed: true },
        { sileroModelAvailable: null, sileroErrorCount: 0, sileroStartGateConfirmed: false },
      ];
      for (const scenario of scenarios) {
        const result = resolveSileroStartAuthority({
          ...baseInput,
          ...scenario,
          wasSpeechConfirmedBeforeThisTick: true,
          heuristicHasDetectedSpeech: true, // continuation keeps this true, per the existing heuristic's own rules
          heuristicLastSpeechAt: 1234,
        });
        expect(result.hasDetectedSpeech).toBe(true);
        expect(result.lastSpeechAt).toBe(1234);
        expect(result.fallbackEngaged).toBe(false);
        expect(result.fallbackReason).toBeNull();
      }
    });

    it("also passes through a FALSE heuristic value unchanged (e.g. a genuine silence tick mid-continuation) -- never forces true", () => {
      const result = resolveSileroStartAuthority({
        ...baseInput,
        wasSpeechConfirmedBeforeThisTick: true,
        sileroStartGateConfirmed: true, // even if Silero's own gate happens to show confirmed=true
        heuristicHasDetectedSpeech: false,
        heuristicLastSpeechAt: 500,
      });
      expect(result.hasDetectedSpeech).toBe(false);
      expect(result.lastSpeechAt).toBe(500);
    });
  });
});
