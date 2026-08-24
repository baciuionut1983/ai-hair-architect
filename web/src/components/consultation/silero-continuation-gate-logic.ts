// VAD Round 14 (2026-08-24), Phase C: pure, browser-free CONTINUATION/
// end-of-speech logic for Silero's own per-frame speech probability --
// split from silero-vad-shadow-runtime.ts (the ONNX/AudioWorklet-touching
// glue) the exact same way silero-start-gate-logic.ts is, and consulted
// from use-voice-recording.ts's own interval loop the same way that
// module's resolveSileroStartAuthority already is.
//
// SCOPE (this round's own explicit constraint): CONTINUATION/END-OF-SPEECH
// ONLY, and ONLY once START has already been confirmed (by EITHER
// authority -- Silero's own START gate, or the legacy heuristic fallback,
// see silero-start-gate-logic.ts's own resolveSileroStartAuthority). This
// module has no concept of START itself -- see
// resolveSileroContinuationAuthority's own first branch below, a pure
// pass-through whenever hasDetectedSpeech is still false, structurally
// guaranteeing a music-only recording (which never confirms START at all)
// can never reach this module's own override logic, regardless of how
// this file's own code evolves.
//
// REAL PRODUCTION BUG THIS CLOSES (two real recordings, both with normal
// speech, both truncated mid-utterance):
//   Normal speech:      legacy speechDurationMs=205ms, then 2100ms later
//                        declared "silence" and stopped -- while Silero's
//                        own diagnostics for the SAME recording showed
//                        peakSpeechProbability=0.9999975,
//                        meanSpeechProbability=0.9023, 81/90 frames
//                        speech-qualified (>=0.5).
//   Speech over music:   legacy speechDurationMs=192ms, then 2004ms later
//                        declared "silence" and stopped -- Silero showed
//                        peakSpeechProbability=0.9999979,
//                        meanSpeechProbability=0.8332, 76/90 frames
//                        speech-qualified.
// ROOT CAUSE (traced directly from voice-activity-logic.ts's own
// evaluateVadSample, not guessed): once hasDetectedSpeech is true,
// lastSpeechAt only ever refreshes via `continuationQualified`
// (spectralQualified alone, ROUND 6) or `windowedCandidate`
// (amplitude+spectral, possibly cross-modally paired, ROUND 4/6) --
// BOTH still gated on the SAME 2-signal (RMS + spectral-ratio) heuristic
// that this whole VAD saga's own history (rounds 2-9) has repeatedly
// documented as unreliable for reasons that are acoustic/DSP, not
// threshold-tunable (see voice-activity-logic.ts's own module doc
// comment). In both recordings above, that heuristic's own continuation
// evidence went quiet almost immediately after the initial confirming
// burst, even though the SAME audio, run through Silero, shows
// overwhelming, sustained speech evidence throughout. This is the exact
// same class of false negative ROUND 6 already diagnosed once for a
// DIFFERENT recording -- it recurs because the underlying 2-signal
// heuristic's own structural ceiling (documented across rounds 2-9) was
// never actually removed, only patched around; Silero is a materially
// better single signal for exactly this reason (see this project's own
// "Voice Next Level" architecture audit).
//
// THE FIX: once START is confirmed and Silero is healthy, Silero's own
// per-frame speech probability becomes the SOLE source of truth for
// whether the stylist is still talking -- the legacy heuristic's own
// continuation evidence (windowedCandidate/continuationQualified) is
// still computed (harmless, diagnostic-only from this point on) but can
// no longer unilaterally declare "speech ended" while Silero disagrees.
// See resolveSileroContinuationAuthority below for the exact arbitration.
//
// Every constant below is REUSED from already-validated, already-shipped
// values -- none invented for this round specifically, per this round's
// own explicit "nu supra-tuna" instruction:
//   - probabilityThreshold (0.5): IDENTICAL to
//     DEFAULT_SILERO_START_GATE_CONFIG.probabilityThreshold -- Silero's
//     own official documented default, already validated for START.
//   - speechGapToleranceMs (300): IDENTICAL to
//     DEFAULT_SILERO_START_GATE_CONFIG.gapToleranceMs (== legacy's own
//     speechEvidenceWindowMs) -- the same bounded grace period already
//     validated for tolerating a single low-probability frame amid an
//     ongoing utterance (an unvoiced consonant, a breath, a momentary
//     dip) without treating it as real silence evidence.
//   - silenceConfirmMs (2000): IDENTICAL to legacy's own
//     DEFAULT_VAD_CONFIG.silenceDurationMs -- this round's own task is
//     explicit that the EXISTING ~2s wait is not the problem and should
//     not change; only WHICH signal gets to decide "is this really
//     silence" changes, not how long the app waits once it genuinely is.
//
// HYSTERESIS DESIGN (silenceCandidateAtMs vs silenceConfirmedAtMs): the
// task asks for an explicit, observable intermediate state -- "eventual
// low-confidence gap -> real silence candidate -> silence confirmed" --
// distinguishing "Silero saw one sub-threshold frame" from "the stylist
// has actually stopped talking". silenceCandidateAtMs marks the instant
// the bounded grace period (speechGapToleranceMs) is first exceeded --
// i.e. the earliest moment this gap can no longer be explained away as a
// single missed frame. silenceConfirmedAtMs is measured from
// lastSpeechAtMs directly (not from silenceCandidateAtMs), so the TOTAL
// wait from the last real speech evidence to a confirmed stop stays
// EXACTLY silenceConfirmMs (2000ms) -- identical to legacy's own existing
// total wait, per this round's own explicit "durata poate rămâne 2
// secunde" instruction. silenceCandidateAtMs is a strictly earlier,
// purely observational marker (never gates anything on its own) that
// lands 300ms before silenceConfirmedAtMs can possibly fire.
export interface SileroContinuationGateConfig {
  probabilityThreshold: number;
  speechGapToleranceMs: number;
  silenceConfirmMs: number;
}

export const DEFAULT_SILERO_CONTINUATION_GATE_CONFIG: SileroContinuationGateConfig = {
  probabilityThreshold: 0.5,
  speechGapToleranceMs: 300,
  silenceConfirmMs: 2000,
};

export interface SileroContinuationGateState {
  // Timestamp (same clock as `now` passed to evaluateSileroContinuationGateFrame
  // -- e.g. performance.now()) of the most recent frame that counted as
  // speech evidence: either a directly qualifying frame (probability >=
  // threshold), or -- implicitly, since a qualifying frame resets this to
  // itself -- any frame within speechGapToleranceMs of one. Null only
  // before this gate has EVER seen a qualifying frame this recording.
  lastSpeechAtMs: number | null;
  // The instant a REAL (grace-period-exceeded) non-speech stretch began --
  // null while speech is ongoing or the gap since it is still within
  // speechGapToleranceMs; frozen at lastSpeechAtMs + speechGapToleranceMs
  // once set, until a qualifying frame resets the whole state.
  silenceCandidateAtMs: number | null;
  // Frozen the instant the gap since lastSpeechAtMs first reaches
  // silenceConfirmMs -- never overwritten again until a qualifying frame
  // resets the whole state. This is the field that actually gates a stop
  // (see resolveSileroContinuationAuthority below).
  silenceConfirmedAtMs: number | null;
}

export function initSileroContinuationGateState(): SileroContinuationGateState {
  return { lastSpeechAtMs: null, silenceCandidateAtMs: null, silenceConfirmedAtMs: null };
}

// Feeds one fresh Silero frame probability in -- called on EVERY worklet
// frame (~32ms cadence), same as evaluateSileroStartGateFrame, so this
// gate's own time resolution is not bottlenecked by the heuristic's own
// 100ms polling interval. Deliberately has NO "already confirmed, no-op"
// early return the way evaluateSileroStartGateFrame does: unlike START
// (a one-way flip), continuation is a live, ongoing judgment that must
// keep tracking speech/silence for the entire rest of the recording.
export function evaluateSileroContinuationGateFrame(
  state: SileroContinuationGateState,
  probability: number,
  now: number,
  config: SileroContinuationGateConfig = DEFAULT_SILERO_CONTINUATION_GATE_CONFIG,
): SileroContinuationGateState {
  const qualified = probability >= config.probabilityThreshold;

  if (qualified) {
    // Real speech evidence this frame -- resets everything. Any
    // in-progress silence candidacy was not real silence after all.
    return { lastSpeechAtMs: now, silenceCandidateAtMs: null, silenceConfirmedAtMs: null };
  }

  if (state.lastSpeechAtMs === null) {
    // No speech evidence has ever been seen yet by THIS gate (e.g. START
    // was confirmed a moment ago by the legacy fallback, before Silero
    // had processed any frame at all) -- nothing to measure a silence gap
    // FROM yet. Nothing to do until the first qualifying frame arrives.
    return state;
  }

  const gapSinceLastSpeech = now - state.lastSpeechAtMs;
  if (gapSinceLastSpeech <= config.speechGapToleranceMs) {
    // Still within the bounded grace period -- not yet real silence
    // evidence, matches Phase B's own START gate / the legacy heuristic's
    // own gap-tolerant streak survival.
    return state;
  }

  const silenceCandidateAtMs = state.silenceCandidateAtMs ?? state.lastSpeechAtMs + config.speechGapToleranceMs;
  const silenceConfirmedAtMs =
    gapSinceLastSpeech >= config.silenceConfirmMs ? (state.silenceConfirmedAtMs ?? now) : state.silenceConfirmedAtMs;

  return { ...state, silenceCandidateAtMs, silenceConfirmedAtMs };
}

// VAD Round 14 (2026-08-24), Phase C: pure arbitration between the
// existing heuristic's own (unmodified) per-tick decision and Silero's own
// continuation gate above -- the ENTIRE authority rule this round adds.
// Mirrors silero-start-gate-logic.ts's own resolveSileroStartAuthority in
// shape and spirit: split out specifically so it is unit-tested without a
// browser (use-voice-recording.ts's own interval loop cannot be).
//
// A minimal, closed set of VadDecision values is duplicated here (not
// imported from voice-activity-logic.ts) to keep this module's own
// dependency graph one-directional -- exactly the same reasoning
// silero-start-gate-logic.ts already documents for reusing plain
// primitives instead of importing the heuristic module.
export type ContinuationAuthorityDecision = "continue" | "stop_silence" | "stop_no_speech_timeout" | "stop_max_duration";

export interface ContinuationAuthorityInput {
  // hasDetectedSpeech for THIS tick, AFTER Phase B's own START-gate
  // authority has already been resolved (see use-voice-recording.ts's own
  // interval loop) -- i.e. true from the exact tick START was confirmed,
  // by either authority, onward.
  hasDetectedSpeech: boolean;
  // The heuristic's own RAW decision for this tick, exactly as
  // evaluateVadSample returned it -- never mutated before being passed in
  // here.
  heuristicDecision: ContinuationAuthorityDecision;
  heuristicLastSpeechAt: number | null;
  // null = Silero shadow mode has not been assigned a handle yet this
  // recording -- distinct from `false` (setup completed but failed).
  sileroModelAvailable: boolean | null;
  // >0 means at least one per-frame inference error has occurred this
  // recording -- Silero is treated as no longer trustworthy for the REST
  // of the recording once this happens, mirroring Phase B's own one-way
  // ratchet exactly (same shared diagnostics counter Phase B already
  // reads).
  sileroErrorCount: number;
  // The continuation gate's own live, per-frame-accumulated state (see
  // evaluateSileroContinuationGateFrame above).
  continuationGateState: SileroContinuationGateState;
  // Whether fallback has ALREADY been engaged (and its reason recorded)
  // earlier in this same recording -- prevents re-flagging
  // `fallbackEngaged` on every subsequent tick once the caller has already
  // recorded it once. Separate from Phase B's own
  // fallbackAlreadyUsedThisRecording flag/ref -- START and CONTINUATION
  // fallback are independent events (Silero could confirm START healthily
  // and only degrade later, mid-utterance).
  fallbackAlreadyUsedThisRecording: boolean;
}

export interface ContinuationAuthorityResult {
  decision: ContinuationAuthorityDecision;
  lastSpeechAt: number | null;
  // True only on ticks where the heuristic's own raw decision was
  // "stop_silence" AND Silero (healthy, confirmed speech ongoing)
  // overrode it back to "continue" -- the direct, per-tick proof of the
  // exact regression this round fixes. Counted (not just flagged) by the
  // caller across the whole recording, see
  // SileroContinuationReportContext.legacyStopSuppressedCount's own doc
  // comment in use-voice-recording.ts.
  legacyStopSuppressed: boolean;
  // True only on the SINGLE tick fallback newly engages this recording --
  // the caller should record fallbackReason exactly once, on this signal,
  // matching Phase B's own fallbackEngaged contract exactly.
  fallbackEngaged: boolean;
  fallbackReason: "model_loading" | "model_unavailable" | "model_error" | null;
}

export function resolveSileroContinuationAuthority(input: ContinuationAuthorityInput): ContinuationAuthorityResult {
  if (!input.hasDetectedSpeech) {
    // START has not happened yet (by either authority) -- this module has
    // nothing to decide. Pure pass-through: structurally guarantees a
    // music-only recording (START never confirmed) can never reach this
    // module's own override logic, and that Phase C never touches
    // stop_no_speech_timeout (only ever reachable pre-confirmation).
    return {
      decision: input.heuristicDecision,
      lastSpeechAt: input.heuristicLastSpeechAt,
      legacyStopSuppressed: false,
      fallbackEngaged: false,
      fallbackReason: null,
    };
  }

  if (input.heuristicDecision === "stop_max_duration") {
    // Unconditional safety cap (see evaluateVadSample's own first check,
    // independent of speech state entirely) -- Phase C never touches this,
    // per this round's own explicit "NU modifica stop_max_duration"
    // constraint.
    return { decision: "stop_max_duration", lastSpeechAt: input.heuristicLastSpeechAt, legacyStopSuppressed: false, fallbackEngaged: false, fallbackReason: null };
  }

  const sileroHealthy = input.sileroModelAvailable === true && input.sileroErrorCount === 0;

  if (!sileroHealthy) {
    // Silero unavailable (still loading, failed to load, or has thrown a
    // runtime error) -- model failure != microphone failure: fall back to
    // the heuristic's own, completely unmodified continuation decision,
    // exactly mirroring Phase B's own fallback contract.
    const fallbackReason: "model_loading" | "model_unavailable" | "model_error" =
      input.sileroModelAvailable === null ? "model_loading" : input.sileroModelAvailable === false ? "model_unavailable" : "model_error";
    return {
      decision: input.heuristicDecision,
      lastSpeechAt: input.heuristicLastSpeechAt,
      legacyStopSuppressed: false,
      fallbackEngaged: !input.fallbackAlreadyUsedThisRecording,
      fallbackReason,
    };
  }

  // Silero healthy and START already confirmed -- Silero's own
  // continuation gate becomes the SOLE authority on whether this is real
  // silence, per this round's own explicit "Silero devine sursa principală
  // de adevăr" requirement.
  const sileroLastSpeechAt = input.continuationGateState.lastSpeechAtMs ?? input.heuristicLastSpeechAt;
  const sileroSilenceConfirmed = input.continuationGateState.silenceConfirmedAtMs !== null;
  const legacyWantsStop = input.heuristicDecision === "stop_silence";

  return {
    decision: sileroSilenceConfirmed ? "stop_silence" : "continue",
    lastSpeechAt: sileroLastSpeechAt,
    legacyStopSuppressed: legacyWantsStop && !sileroSilenceConfirmed,
    fallbackEngaged: false,
    fallbackReason: null,
  };
}
