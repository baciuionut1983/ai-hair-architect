// VAD Round 11 (2026-08-23), Phase B: pure, browser-free START-gate logic
// for Silero's own per-frame speech probability -- split from
// silero-vad-shadow-runtime.ts (the ONNX/AudioWorklet-touching glue) the
// same way voice-activity-logic.ts is split from use-voice-recording.ts.
//
// SCOPE (this round's own explicit constraint): START ONLY. This module
// has no concept of continuation, silence countdown, or stop -- once its
// own `confirmed` flag flips true, use-voice-recording.ts's own glue
// layer injects that fact into the EXISTING, unchanged heuristic state
// machine (voice-activity-logic.ts's evaluateVadSample), which then
// governs continuation/end-of-speech exactly as it already does today.
// This file is never consulted for anything after START.
//
// Real production data this rule is built from (Phase A shadow mode,
// commit c85213b, three real tests, not simulated):
//   - Normal speech:        mean p_speech ~0.778, 70/88 frames >=0.5 (80%)
//   - Speech over music:    mean p_speech ~0.943, 113/118 frames >=0.5 (96%)
//   - Instrumental music,
//     zero human voice:     mean p_speech ~0.0034, only 4/1859 frames
//                            >=0.5 (0.2%) -- but PEAK reached 0.78457, a
//                            single isolated high-probability frame.
//
// That isolated 0.78457 peak on pure music is the decisive data point:
// it proves a bare "one frame >= threshold" rule is NOT safe on its own,
// for exactly the same reason ROUND 9 already proved for the old
// heuristic (a single isolated instant, amplified into a false
// confirmation) -- see voice-activity-logic.ts's own ROUND 9 doc comment.
// The fix here is the same shape as ROUND 9's, applied to Silero's own,
// much cleaner single signal: require RECURRENCE (a minimum count of
// DISTINCT qualifying frames), not just one instant, before confirming.
//
// Every constant below is REUSED from already-validated, already-shipped
// values -- none invented for this round specifically:
//   - probabilityThreshold (0.5): Silero's own official documented
//     default (github.com/snakers4/silero-vad's own VADIterator
//     docstring: "lazy 0.5 is pretty good for most datasets").
//   - minDurationMs (250): identical to DEFAULT_VAD_CONFIG.minSpeechDurationMs
//     in voice-activity-logic.ts -- validated across 9 rounds of real
//     production testing on the existing heuristic.
//   - gapToleranceMs (300): identical to
//     DEFAULT_VAD_CONFIG.speechEvidenceWindowMs -- same provenance.
//   - minQualifiedFrameCount (2): identical reasoning to ROUND 9's own
//     minStartSpectralHitCount -- the smallest count that can express
//     "this evidence recurred" at all; 1 occurrence is, by construction,
//     a single isolated instant, indistinguishable from the demonstrated
//     0.78457 music spike.
//
// Honest limitation, stated up front (see this round's own report): Phase
// A's three tests show music's qualifying frames are RARE (4/1859) but
// this data does not, by itself, prove no two of those four ever fall
// within a gap-tolerant chain of each other. This rule is well-justified
// by reusing already-validated constants and the ROUND 9 recurrence
// principle, not by a mathematical guarantee against this specific
// recording -- re-testing the EXACT SAME instrumental-music scenario
// against this new gate is this round's own acceptance criterion, not
// assumed to already be proven.

export interface SileroStartGateConfig {
  probabilityThreshold: number;
  minDurationMs: number;
  gapToleranceMs: number;
  minQualifiedFrameCount: number;
}

export const DEFAULT_SILERO_START_GATE_CONFIG: SileroStartGateConfig = {
  probabilityThreshold: 0.5,
  minDurationMs: 250,
  gapToleranceMs: 300,
  minQualifiedFrameCount: 2,
};

export interface SileroStartGateState {
  confirmed: boolean;
  // Timestamp (same clock as `now` passed to evaluateSileroStartGateFrame)
  // of the moment `confirmed` first flipped true -- null until then, and
  // frozen (never overwritten) afterward.
  confirmedAtMs: number | null;
  streakStartedAt: number | null;
  lastQualifiedAt: number | null;
  // How many DISTINCT frames (probability >= threshold) have contributed
  // to the CURRENTLY-ALIVE streak -- reset to 0 exactly when the streak
  // itself resets (gap exceeds gapToleranceMs), mirroring
  // voice-activity-logic.ts's own streakSpectralHitCount exactly.
  qualifiedFrameCount: number;
  // The highest qualifiedFrameCount ever reached, even after a later
  // reset -- lets a real production report see how much recurrence the
  // longest-forming streak actually had, without needing to infer it
  // from whether confirmation happened.
  peakQualifiedFrameCount: number;
}

export function initSileroStartGateState(): SileroStartGateState {
  return {
    confirmed: false,
    confirmedAtMs: null,
    streakStartedAt: null,
    lastQualifiedAt: null,
    qualifiedFrameCount: 0,
    peakQualifiedFrameCount: 0,
  };
}

// Feeds one fresh Silero frame probability in. Returns the updated state
// (thread this back in as `state` on the next call). Once `confirmed` is
// already true, this is a no-op (returns the SAME state unchanged) --
// this module has nothing further to say once START has happened; see
// this module's own doc comment on scope.
export function evaluateSileroStartGateFrame(
  state: SileroStartGateState,
  probability: number,
  now: number,
  config: SileroStartGateConfig = DEFAULT_SILERO_START_GATE_CONFIG,
): SileroStartGateState {
  if (state.confirmed) return state;

  const qualified = probability >= config.probabilityThreshold;

  if (!qualified) {
    const gapSinceLastQualified = now - (state.lastQualifiedAt ?? -Infinity);
    if (gapSinceLastQualified > config.gapToleranceMs) {
      // A genuinely long gap -- the in-progress streak, if any, is
      // discarded. Matches voice-activity-logic.ts's own streak-reset
      // semantics exactly.
      return {
        ...state,
        streakStartedAt: null,
        qualifiedFrameCount: 0,
      };
    }
    // Within tolerance -- the streak survives unchanged while we wait for
    // the next qualifying frame.
    return state;
  }

  const isNewStreak = state.streakStartedAt === null;
  const streakStartedAt = state.streakStartedAt ?? now;
  const qualifiedFrameCount = isNewStreak ? 1 : state.qualifiedFrameCount + 1;
  const peakQualifiedFrameCount = Math.max(state.peakQualifiedFrameCount, qualifiedFrameCount);
  const streakDuration = now - streakStartedAt;
  const confirmed = streakDuration >= config.minDurationMs && qualifiedFrameCount >= config.minQualifiedFrameCount;

  return {
    confirmed,
    confirmedAtMs: confirmed ? now : state.confirmedAtMs,
    streakStartedAt,
    lastQualifiedAt: now,
    qualifiedFrameCount,
    peakQualifiedFrameCount,
  };
}

// VAD Round 11 (2026-08-23), Phase B: pure arbitration between the
// existing heuristic's own (unmodified) per-tick computation and Silero's
// own START gate above -- split out specifically so it is unit-testable
// without a browser (use-voice-recording.ts's own interval loop, where
// this used to be inlined, cannot be unit-tested at all: jsdom has no
// real AudioContext/AudioWorklet/WASM). This function is the ENTIRE
// authority rule Phase B adds; everything else (voice-activity-logic.ts's
// own continuation/silence-countdown/stop machinery) is untouched and
// never consulted here.
//
// SCOPE: START only. Once `wasSpeechConfirmedBeforeThisTick` is true,
// this function is a pure pass-through of the heuristic's own values --
// it has nothing further to decide, ever, for the rest of that recording
// (continuation/end-of-speech stay fully on the existing, unmodified
// heuristic from that point on, per this round's own explicit
// constraint).
export interface StartAuthorityInput {
  // Whether hasDetectedSpeech was ALREADY true before this tick's own
  // evaluateVadSample call (i.e. state.hasDetectedSpeech read BEFORE
  // calling it, the exact `wasSpeechConfirmed` value use-voice-recording.ts
  // already computes for its own, pre-existing telemetry purposes).
  wasSpeechConfirmedBeforeThisTick: boolean;
  // The heuristic's own RAW hasDetectedSpeech/lastSpeechAt for THIS tick,
  // exactly as evaluateVadSample returned them -- never mutated before
  // being passed in here.
  heuristicHasDetectedSpeech: boolean;
  heuristicLastSpeechAt: number | null;
  now: number;
  // null = Silero shadow mode has not even been assigned a handle yet
  // this recording (still loading its model/WASM/worklet) -- distinct
  // from `false` (setup completed but failed).
  sileroModelAvailable: boolean | null;
  // >0 means at least one per-frame inference error has occurred --
  // Silero is treated as no longer trustworthy for the REST of this
  // recording once this happens (a one-way ratchet, mirroring
  // hasDetectedSpeech's own one-way-true semantics).
  sileroErrorCount: number;
  sileroStartGateConfirmed: boolean;
  // Whether fallback has ALREADY been engaged (and its reason recorded)
  // earlier in this same recording -- prevents re-flagging `fallbackEngaged`
  // on every subsequent tick once the caller has already recorded it once.
  fallbackAlreadyUsedThisRecording: boolean;
}

export interface StartAuthorityResult {
  hasDetectedSpeech: boolean;
  lastSpeechAt: number | null;
  // True only on the SINGLE tick fallback newly engages -- the caller
  // should record fallbackReason exactly once, on this signal, not on
  // every subsequent tick fallback remains active.
  fallbackEngaged: boolean;
  fallbackReason: "model_loading" | "model_unavailable" | "model_error" | null;
}

export function resolveSileroStartAuthority(input: StartAuthorityInput): StartAuthorityResult {
  if (input.wasSpeechConfirmedBeforeThisTick) {
    // Already confirmed by a PRIOR tick (by either authority) -- Phase B
    // never revisits an already-made decision. Pure pass-through: this is
    // exactly the "continuation/end-of-speech stays on the existing
    // heuristic" guarantee, structurally, not by convention.
    return {
      hasDetectedSpeech: input.heuristicHasDetectedSpeech,
      lastSpeechAt: input.heuristicLastSpeechAt,
      fallbackEngaged: false,
      fallbackReason: null,
    };
  }

  const sileroHealthy = input.sileroModelAvailable === true && input.sileroErrorCount === 0;

  if (sileroHealthy) {
    if (input.sileroStartGateConfirmed) {
      // Silero itself confirmed -- force hasDetectedSpeech true regardless
      // of what the heuristic's own raw computation said this tick.
      // lastSpeechAt prefers the heuristic's own (likely already-fresh,
      // since real speech that satisfies Silero very likely also produced
      // SOME heuristic-visible amplitude/spectral activity) value, falling
      // back to `now` only if the heuristic never saw anything at all yet.
      return {
        hasDetectedSpeech: true,
        lastSpeechAt: input.heuristicLastSpeechAt ?? input.now,
        fallbackEngaged: false,
        fallbackReason: null,
      };
    }
    // Silero healthy but not yet confirmed -- suppress the heuristic's
    // own independent confirmation, whatever it is this tick.
    return { hasDetectedSpeech: false, lastSpeechAt: input.heuristicLastSpeechAt, fallbackEngaged: false, fallbackReason: null };
  }

  // Silero unavailable (still loading, failed to load, or has thrown a
  // runtime error) -- model failure != microphone failure: fall back to
  // the heuristic's own, completely unmodified computation.
  const fallbackReason: "model_loading" | "model_unavailable" | "model_error" =
    input.sileroModelAvailable === null ? "model_loading" : input.sileroModelAvailable === false ? "model_unavailable" : "model_error";
  return {
    hasDetectedSpeech: input.heuristicHasDetectedSpeech,
    lastSpeechAt: input.heuristicLastSpeechAt,
    fallbackEngaged: !input.fallbackAlreadyUsedThisRecording,
    fallbackReason,
  };
}
