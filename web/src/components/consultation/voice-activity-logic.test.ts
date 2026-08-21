import { describe, expect, it } from "vitest";

import {
  computeVoiceActivityDiagnostics,
  DEFAULT_VAD_CONFIG,
  evaluateVadSample,
  initVadState,
  shouldAutoSubmitTranscript,
  type VadConfig,
  type VadSample,
  type VadState,
} from "./voice-activity-logic";

// Clear, loud, speech-shaped: high amplitude AND concentrated in the
// speech band -- what a real spoken sentence looks like to this classifier.
const CLEAR_SPEECH: VadSample = { rmsLevel: 0.5, speechBandRatio: 0.7 };
// Genuine silence: negligible amplitude regardless of spectral shape.
const SILENCE: VadSample = { rmsLevel: 0.001, speechBandRatio: 0.3 };
// End-of-speech hardening (2026-08-20): the exact production scenario --
// background music, loud enough to clear any bare amplitude threshold
// (same rmsLevel as CLEAR_SPEECH), but NOT concentrated in the speech band
// the way a voice is. The old classifier (amplitude only) could not tell
// this apart from real speech; that is the demonstrated production bug.
const LOUD_MUSIC: VadSample = { rmsLevel: 0.5, speechBandRatio: 0.15 };
// Moderate, sustained ambient room noise (hair dryer, general hum) --
// louder than true silence but still non-speech-shaped spectrally.
const AMBIENT_NOISE: VadSample = { rmsLevel: 0.05, speechBandRatio: 0.2 };
// VAD false-negative hardening (2026-08-21): a real, quieter speaking
// voice -- still clears both gates, but with far less headroom than
// CLEAR_SPEECH. Distinct from AMBIENT_NOISE (non-speech-shaped): this IS
// speech-shaped, just soft.
const QUIET_SPEECH: VadSample = { rmsLevel: 0.03, speechBandRatio: 0.5 };
// A single sample that fails ONLY the amplitude gate (e.g. a breath or an
// unvoiced consonant momentarily dipping below the floor) while remaining
// spectrally speech-shaped -- the exact class of brief, natural dip real
// human speech produces at 100ms sampling granularity.
const AMPLITUDE_DIP: VadSample = { rmsLevel: 0.005, speechBandRatio: 0.6 };
// Speech that remains spectrally speech-dominant despite louder background
// music/noise mixed into the same signal -- rmsLevel is elevated by the
// music, but speechBandRatio still clears minSpeechBandRatio (0.45).
const SPEECH_OVER_MODERATE_MUSIC: VadSample = { rmsLevel: 0.35, speechBandRatio: 0.48 };
// Sustained broadband, non-vocal noise (a hair dryer) -- loud, but energy
// is spread broadly rather than concentrated in the speech band.
const DRYER_NOISE: VadSample = { rmsLevel: 0.4, speechBandRatio: 0.1 };

describe("evaluateVadSample", () => {
  it("does not stop while the stylist is actively speaking", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, CLEAR_SPEECH, 0); // streak starts
    state = result.state;
    result = evaluateVadSample(state, CLEAR_SPEECH, 300); // sustained 300ms >= minSpeechDurationMs
    expect(result.decision).toBe("continue");
    expect(result.state.hasDetectedSpeech).toBe(true);
  });

  // The exact required scenario: speech detected, then ~2s of silence ->
  // auto stop.
  it("auto-stops after silenceDurationMs of quiet following detected speech", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, CLEAR_SPEECH, 200); // streak starts
    state = result.state;
    result = evaluateVadSample(state, CLEAR_SPEECH, 500); // sustained 300ms -- speech confirmed by t=500
    expect(result.decision).toBe("continue");
    expect(result.state.hasDetectedSpeech).toBe(true);
    state = result.state;

    result = evaluateVadSample(state, SILENCE, 1500); // 1000ms of silence so far
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, SILENCE, 2500); // 2000ms of silence since t=500
    expect(result.decision).toBe("stop_silence");
  });

  // Required: a short pause between words (well under the threshold) must
  // never trip an auto-stop.
  it("does NOT stop on a short silence below the threshold", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, CLEAR_SPEECH, 300);
    state = result.state;
    result = evaluateVadSample(state, CLEAR_SPEECH, 500);
    state = result.state;

    result = evaluateVadSample(state, SILENCE, 1200); // only 700ms of silence
    expect(result.decision).toBe("continue");
  });

  // Required: NOT a fixed "2 seconds from start" timer -- a new loud
  // speech-shaped sample must restart the silence countdown from scratch,
  // so speech separated by brief pauses is never cut off.
  it("a fresh speech sample resets the silence countdown, even after some quiet time has already passed", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
    state = result.state;
    result = evaluateVadSample(state, CLEAR_SPEECH, 250);
    state = result.state;

    result = evaluateVadSample(state, SILENCE, 1750); // 1500ms quiet
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, CLEAR_SPEECH, 1850); // speaks again -- resets the clock
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, SILENCE, 3250); // only 1400ms since the t=1850 speech
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, SILENCE, 3950); // now 2100ms since t=1850
    expect(result.decision).toBe("stop_silence");
  });

  // Required: if the stylist never speaks at all, a safe timeout must
  // still end the recording.
  it("stops via the no-speech safety timeout when nothing is ever said", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, SILENCE, 5000);
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, SILENCE, 10000);
    expect(result.decision).toBe("stop_no_speech_timeout");
  });

  it("never applies the no-speech timeout once real speech has been detected, even much later", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, CLEAR_SPEECH, 100);
    state = result.state;
    result = evaluateVadSample(state, CLEAR_SPEECH, 400); // sustained 300ms -- speech confirmed
    state = result.state;

    // Well past noSpeechTimeoutMs (10s), but speech WAS detected -- this
    // must be judged purely on the silence-after-speech rule, not the
    // no-speech safety net.
    result = evaluateVadSample(state, SILENCE, 11000);
    expect(result.decision).toBe("stop_silence");
  });

  it("respects a custom config", () => {
    const config: VadConfig = { ...DEFAULT_VAD_CONFIG, minAbsoluteLevel: 0.1, silenceDurationMs: 500, noSpeechTimeoutMs: 3000 };
    let state = initVadState(0);
    let result = evaluateVadSample(state, CLEAR_SPEECH, 0, config);
    state = result.state;
    result = evaluateVadSample(state, CLEAR_SPEECH, 250, config);
    state = result.state;

    result = evaluateVadSample(state, SILENCE, 850, config);
    expect(result.decision).toBe("stop_silence");
  });

  it("a sample sitting exactly at the minimum absolute level and speech-band ratio counts toward speech", () => {
    const state = initVadState(0);
    const sample: VadSample = { rmsLevel: DEFAULT_VAD_CONFIG.minAbsoluteLevel, speechBandRatio: DEFAULT_VAD_CONFIG.minSpeechBandRatio };
    let result = evaluateVadSample(state, sample, 0);
    result = evaluateVadSample(result.state, sample, DEFAULT_VAD_CONFIG.minSpeechDurationMs);
    expect(result.state.hasDetectedSpeech).toBe(true);
  });

  // End-of-speech hardening (2026-08-20): the exact demonstrated production
  // bug, reproduced directly -- background music loud enough to clear any
  // bare amplitude threshold must NEVER be classified as speech, and must
  // therefore never block stop_no_speech_timeout from firing.
  describe("background music / ambient noise (the demonstrated production bug)", () => {
    it("loud background music alone never counts as speech, no matter how long it plays", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, LOUD_MUSIC, 1000);
      expect(result.state.hasDetectedSpeech).toBe(false);
      state = result.state;

      result = evaluateVadSample(state, LOUD_MUSIC, 5000);
      expect(result.state.hasDetectedSpeech).toBe(false);
      state = result.state;

      // Music alone, for the whole recording -- the no-speech safety
      // timeout must still fire. This is the direct fix for "Ascult..."
      // never ending: the OLD classifier's lastSpeechAt would have been
      // pushed forward by the music on every sample, so this decision
      // would never have been reached at all.
      result = evaluateVadSample(state, LOUD_MUSIC, 10000);
      expect(result.decision).toBe("stop_no_speech_timeout");
    });

    it("real speech is still detected correctly WHILE loud background music is also playing", () => {
      let state = initVadState(0);
      // Music plays before the stylist starts talking.
      let result = evaluateVadSample(state, LOUD_MUSIC, 500);
      state = result.state;
      result = evaluateVadSample(state, LOUD_MUSIC, 1000);
      state = result.state;

      // The stylist speaks -- music is presumably still audible in the
      // room, but THIS classifier only ever sees one sample at a time
      // (the mixed signal); a genuinely voice-shaped sample must still be
      // recognized as speech regardless of what came before it.
      result = evaluateVadSample(state, CLEAR_SPEECH, 1300);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 1600); // sustained 300ms -- speech confirmed
      expect(result.state.hasDetectedSpeech).toBe(true);
    });

    it("does not stop on silence after music-only samples that never triggered hasDetectedSpeech -- the no-speech timeout governs instead", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, LOUD_MUSIC, 2000);
      state = result.state;
      // Music stops; genuine silence follows. hasDetectedSpeech was never
      // set, so stop_silence (which only applies AFTER confirmed speech)
      // must never fire here -- only the no-speech timeout can end this.
      result = evaluateVadSample(state, SILENCE, 3000);
      expect(result.decision).toBe("continue");
    });
  });

  // Required: a brief loud blip (a knock, a door, a short music swell) must
  // not be enough on its own to open the speech window.
  describe("minimum speech duration (a brief loud blip must not falsely start speech)", () => {
    it("a single speech-shaped sample that does not sustain never confirms speech", () => {
      let state = initVadState(0);
      const result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      // Below minSpeechDurationMs (250ms) on the very first sample --
      // streak has only just started, not yet confirmed.
      expect(result.state.hasDetectedSpeech).toBe(false);
      state = result.state;

      // The blip ends immediately -- silence follows well before the
      // streak could have sustained long enough to confirm.
      const after = evaluateVadSample(state, SILENCE, 50);
      expect(after.state.hasDetectedSpeech).toBe(false);
      expect(after.decision).toBe("continue"); // governed by the no-speech timeout, not stop_silence
    });

    it("confirms speech once a speech-shaped streak sustains for minSpeechDurationMs", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 100);
      expect(result.state.hasDetectedSpeech).toBe(false); // only 100ms so far
      state = result.state;

      result = evaluateVadSample(state, CLEAR_SPEECH, 260); // 260ms since streak start
      expect(result.state.hasDetectedSpeech).toBe(true);
    });
  });

  // Required: an adaptive noise floor, not one fixed absolute threshold --
  // proves the floor tracks sustained ambient level and never drifts
  // upward from the stylist's own confirmed speech.
  describe("adaptive noise floor", () => {
    it("the noise floor rises to track sustained ambient noise, raising the bar for what counts as a speech candidate", () => {
      let state = initVadState(0);
      // Feed many samples of moderate, sustained, non-speech-shaped ambient
      // noise so the floor has time to adapt upward.
      let t = 0;
      for (let i = 0; i < 50; i += 1) {
        t += 100;
        state = evaluateVadSample(state, AMBIENT_NOISE, t).state;
      }
      expect(state.noiseFloorEstimate).toBeGreaterThan(0.02);
      expect(state.hasDetectedSpeech).toBe(false);
    });

    it("the stylist's own confirmed speech never drags the noise floor upward", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300);
      state = result.state;
      const floorAfterSpeech = state.noiseFloorEstimate;
      result = evaluateVadSample(state, CLEAR_SPEECH, 600);
      // Still zero (or unchanged) -- CLEAR_SPEECH samples are always
      // speech candidates, so they are never fed into the ambient EMA.
      expect(result.state.noiseFloorEstimate).toBe(floorAfterSpeech);
    });
  });

  // Required: an unconditional maximum recording duration, independent of
  // whatever the classifier decides -- the last line of defense.
  describe("maxRecordingDurationMs safety cap", () => {
    it("stops once maxRecordingDurationMs elapses, even while the stylist is actively (and validly) still speaking", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 100);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300);
      state = result.state;

      result = evaluateVadSample(state, CLEAR_SPEECH, DEFAULT_VAD_CONFIG.maxRecordingDurationMs);
      expect(result.decision).toBe("stop_max_duration");
    });

    it("stops via maxRecordingDurationMs even when nothing but silence was ever heard, before the no-speech timeout's own shorter window would apply again", () => {
      const config: VadConfig = { ...DEFAULT_VAD_CONFIG, noSpeechTimeoutMs: 999_000, maxRecordingDurationMs: 60000 };
      const state = initVadState(0);
      const result = evaluateVadSample(state, SILENCE, 60000, config);
      expect(result.decision).toBe("stop_max_duration");
    });
  });

  // VAD false-negative hardening (2026-08-21): real production evidence
  // showed genuinely intelligible speech ending in stop_no_speech_timeout
  // with hasDetectedSpeech never confirmed. Root cause: speechStreakStartedAt
  // reset to null unconditionally on ANY single non-candidate sample, even
  // one sitting inside an otherwise-sustained utterance -- see this
  // module's own doc comment for the full analysis. This block is the
  // regression matrix for that fix (and the surrounding, deliberately
  // UNCHANGED behaviors it must not regress).
  describe("false-negative hardening: brief dips within an otherwise-sustained streak", () => {
    it("a brief single-sample dip within an otherwise-sustained speech streak does not discard accumulated progress (the core fix)", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0); // streak starts
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 100); // 100ms into streak
      state = result.state;

      // A single sample dips below the amplitude gate (e.g. a quiet
      // consonant or a breath). WITHOUT this round's fix, this would reset
      // speechStreakStartedAt to null, discarding the 100ms already
      // accumulated -- exactly the demonstrated production false negative.
      result = evaluateVadSample(state, AMPLITUDE_DIP, 200);
      expect(result.state.hasDetectedSpeech).toBe(false); // not yet -- still only 200ms of real evidence
      expect(result.state.speechStreakStartedAt).toBe(0); // streak survived the dip, not reset
      state = result.state;

      // Speech resumes immediately after the dip -- total elapsed since
      // the ORIGINAL streak start is now 300ms, past minSpeechDurationMs.
      result = evaluateVadSample(state, CLEAR_SPEECH, 300);
      expect(result.state.hasDetectedSpeech).toBe(true);
    });

    it("a genuinely long gap between candidate-like samples still resets accumulated progress -- tolerance is bounded, not unlimited", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 100);
      state = result.state;

      // A genuinely longer gap (well beyond maxCandidateGapMs, 150ms) --
      // two separate blips, not one continuous utterance with a momentary
      // dip.
      result = evaluateVadSample(state, SILENCE, 500); // 400ms since the last candidate at t=100
      expect(result.state.speechStreakStartedAt).toBeNull();
      expect(result.state.candidateResetCount).toBe(1);
      state = result.state;

      result = evaluateVadSample(state, CLEAR_SPEECH, 550); // streak restarts fresh from here
      expect(result.state.hasDetectedSpeech).toBe(false); // needs another 250ms from t=550
    });

    it("quiet but valid sustained speech is still confirmed", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, QUIET_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, QUIET_SPEECH, 300);
      expect(result.state.hasDetectedSpeech).toBe(true);
    });

    it("speech that remains spectrally speech-dominant despite moderate background music/noise mixed in is still confirmed", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, SPEECH_OVER_MODERATE_MUSIC, 0);
      state = result.state;
      result = evaluateVadSample(state, SPEECH_OVER_MODERATE_MUSIC, 300);
      expect(result.state.hasDetectedSpeech).toBe(true);
    });

    it("sustained non-vocal broadband noise (a hair dryer) never confirms as speech or blocks the no-speech timeout", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, DRYER_NOISE, 2000);
      state = result.state;
      result = evaluateVadSample(state, DRYER_NOISE, 6000);
      expect(result.state.hasDetectedSpeech).toBe(false);
      state = result.state;
      result = evaluateVadSample(state, DRYER_NOISE, 10000);
      expect(result.decision).toBe("stop_no_speech_timeout");
    });

    it("real speech is confirmed just as fast when it begins immediately at recording start as when it begins later", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300);
      expect(result.state.hasDetectedSpeech).toBe(true);
    });

    // Honest limitation, NOT fixed this round -- see this round's own
    // report for why: distinguishing "a genuinely too-quiet utterance"
    // from "ambient noise" at the very first sample of a recording (before
    // any real candidate has ever registered) would require changing the
    // noise-floor/amplitude-gate logic itself, which was not touched this
    // round (no evidence tied it specifically to the demonstrated false
    // negatives, unlike the streak-reset brittleness this round's fix
    // targets).
    it("KNOWN LIMITATION (not fixed this round): a very quiet utterance right at recording start can still be absorbed into the noise floor before any candidate is ever recognized", () => {
      const state = initVadState(0);
      const veryQuietSpeech: VadSample = { rmsLevel: 0.015, speechBandRatio: 0.5 }; // below minAbsoluteLevel (0.02) despite being speech-shaped
      const result = evaluateVadSample(state, veryQuietSpeech, 0);
      expect(result.state.hasDetectedSpeech).toBe(false);
      expect(result.state.noiseFloorEstimate).toBeGreaterThan(0);
    });

    it("music before AND after real speech never blocks stop_silence once speech has genuinely ended", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, LOUD_MUSIC, 500);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 800);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 1150); // 350ms into the streak -- confirmed
      expect(result.state.hasDetectedSpeech).toBe(true);
      state = result.state;

      // Speech ends -- music continues, but music alone must never count
      // as a candidate, so it can never restart the silence countdown.
      result = evaluateVadSample(state, LOUD_MUSIC, 2000); // 850ms since the last real speech sample
      expect(result.decision).toBe("continue");
      state = result.state;
      result = evaluateVadSample(state, LOUD_MUSIC, 3150); // 2000ms since t=1150
      expect(result.decision).toBe("stop_silence");
    });
  });

  describe("diagnostic accumulators (peakRms / peakSpeechBandRatio / fullyQualifiedSampleCount)", () => {
    it("tracks peakRms and peakSpeechBandRatio across the whole recording, from every sample, even ones that fail one or both gates", () => {
      let state = initVadState(0);
      state = evaluateVadSample(state, { rmsLevel: 0.1, speechBandRatio: 0.2 }, 100).state;
      state = evaluateVadSample(state, { rmsLevel: 0.05, speechBandRatio: 0.9 }, 200).state;
      expect(state.peakRms).toBeCloseTo(0.1);
      expect(state.peakSpeechBandRatio).toBeCloseTo(0.9);
    });

    it("counts fullyQualifiedSampleCount only for samples that pass BOTH gates", () => {
      let state = initVadState(0);
      state = evaluateVadSample(state, CLEAR_SPEECH, 100).state; // candidate
      state = evaluateVadSample(state, LOUD_MUSIC, 200).state; // amplitude ok, spectral fails
      state = evaluateVadSample(state, CLEAR_SPEECH, 500).state; // candidate again
      expect(state.fullyQualifiedSampleCount).toBe(2);
    });

    it("tracks maxCandidateStreakMs as the longest streak ever reached, even one that was later reset before confirmation", () => {
      let state = initVadState(0);
      state = evaluateVadSample(state, CLEAR_SPEECH, 0).state;
      state = evaluateVadSample(state, CLEAR_SPEECH, 200).state; // streak reaches 200ms
      state = evaluateVadSample(state, SILENCE, 600).state; // long gap -- resets, never confirmed
      expect(state.hasDetectedSpeech).toBe(false);
      expect(state.maxCandidateStreakMs).toBe(200);
    });
  });
});

// End-of-speech hardening (2026-08-20), Task E: proves the telemetry
// computation itself, independent of the browser-only sampling loop that
// feeds it (use-voice-recording.ts).
describe("computeVoiceActivityDiagnostics", () => {
  // VAD false-negative hardening (2026-08-21): the 6 new diagnostic
  // accumulators, always present regardless of the scenario -- a minimal,
  // arbitrary-but-fixed set reused across every test below so each test
  // only needs to override what it's actually asserting on.
  const DIAGNOSTIC_ACCUMULATORS = {
    peakRms: 0.4,
    peakSpeechBandRatio: 0.6,
    finalNoiseFloor: 0.03,
    maxCandidateSpeechMs: 300,
    candidateResetCount: 1,
    fullyQualifiedSampleCount: 12,
  };

  it("computes a full breakdown for a normal stop_silence turn", () => {
    const diagnostics = computeVoiceActivityDiagnostics({
      recordingStartedAt: 1000,
      stopDecidedAt: 5500, // recording lasted 4500ms total
      speechDetectedAt: 1300, // speech confirmed 300ms in
      lastSpeechAt: 3500, // last speech-like sample at 2500ms in
      autoStopReason: "stop_silence",
      vadMode: "heuristic-rms-spectral-v1",
      ...DIAGNOSTIC_ACCUMULATORS,
    });
    expect(diagnostics).toEqual({
      autoStopReason: "stop_silence",
      recordingDurationMs: 4500,
      speechDurationMs: 2200, // 2500 - 300
      silenceAfterSpeechMs: 2000, // 5500 - 3500
      speechDetectedAtMs: 300,
      speechEndedAtMs: 2500,
      maxDurationTriggered: false,
      vadMode: "heuristic-rms-spectral-v1",
      ...DIAGNOSTIC_ACCUMULATORS,
    });
  });

  it("leaves speechDurationMs/speechEndedAtMs/silenceAfterSpeechMs null when speech was never confirmed at all -- e.g. music-only, stop_no_speech_timeout", () => {
    const diagnostics = computeVoiceActivityDiagnostics({
      recordingStartedAt: 0,
      stopDecidedAt: 10000,
      speechDetectedAt: null,
      lastSpeechAt: null,
      autoStopReason: "stop_no_speech_timeout",
      vadMode: "heuristic-rms-spectral-v1",
      ...DIAGNOSTIC_ACCUMULATORS,
    });
    expect(diagnostics.speechDurationMs).toBeNull();
    expect(diagnostics.speechDetectedAtMs).toBeNull();
    expect(diagnostics.speechEndedAtMs).toBeNull();
    expect(diagnostics.silenceAfterSpeechMs).toBeNull();
    expect(diagnostics.recordingDurationMs).toBe(10000);
  });

  it("only ever populates silenceAfterSpeechMs for stop_silence -- never a number that doesn't mean what its name promises for another reason", () => {
    const diagnostics = computeVoiceActivityDiagnostics({
      recordingStartedAt: 0,
      stopDecidedAt: 60000,
      speechDetectedAt: 300,
      lastSpeechAt: 55000,
      autoStopReason: "stop_max_duration",
      vadMode: "heuristic-rms-spectral-v1",
      ...DIAGNOSTIC_ACCUMULATORS,
    });
    expect(diagnostics.silenceAfterSpeechMs).toBeNull();
    expect(diagnostics.maxDurationTriggered).toBe(true);
  });

  it("sets maxDurationTriggered true only for stop_max_duration", () => {
    const other = computeVoiceActivityDiagnostics({
      recordingStartedAt: 0,
      stopDecidedAt: 3000,
      speechDetectedAt: 300,
      lastSpeechAt: 1000,
      autoStopReason: "stop_silence",
      vadMode: "heuristic-rms-spectral-v1",
      ...DIAGNOSTIC_ACCUMULATORS,
    });
    expect(other.maxDurationTriggered).toBe(false);
  });

  it("marks autoStopReason as manual_stop for a manual Stop click, distinct from every VAD-driven reason", () => {
    const diagnostics = computeVoiceActivityDiagnostics({
      recordingStartedAt: 0,
      stopDecidedAt: 1500,
      speechDetectedAt: 200,
      lastSpeechAt: 1200,
      autoStopReason: "manual_stop",
      vadMode: "heuristic-rms-spectral-v1",
      ...DIAGNOSTIC_ACCUMULATORS,
    });
    expect(diagnostics.autoStopReason).toBe("manual_stop");
    expect(diagnostics.maxDurationTriggered).toBe(false);
  });

  // VAD false-negative hardening (2026-08-21): passes the 6 new
  // accumulators straight through, unmodified -- computeVoiceActivityDiagnostics
  // never derives or fabricates them itself, only evaluateVadSample does.
  it("passes the 6 new diagnostic accumulators through unmodified", () => {
    const diagnostics = computeVoiceActivityDiagnostics({
      recordingStartedAt: 0,
      stopDecidedAt: 10000,
      speechDetectedAt: null,
      lastSpeechAt: 3200,
      autoStopReason: "stop_no_speech_timeout",
      vadMode: "heuristic-rms-spectral-v1",
      peakRms: 0.18,
      peakSpeechBandRatio: 0.41,
      finalNoiseFloor: 0.025,
      maxCandidateSpeechMs: 210,
      candidateResetCount: 4,
      fullyQualifiedSampleCount: 9,
    });
    expect(diagnostics.peakRms).toBe(0.18);
    expect(diagnostics.peakSpeechBandRatio).toBe(0.41);
    expect(diagnostics.finalNoiseFloor).toBe(0.025);
    expect(diagnostics.maxCandidateSpeechMs).toBe(210);
    expect(diagnostics.candidateResetCount).toBe(4);
    expect(diagnostics.fullyQualifiedSampleCount).toBe(9);
  });

  // VAD false-negative hardening (2026-08-21), Task 13: proves
  // speechDetectedAtMs:null with speechEndedAtMs:<real value> is a LEGAL,
  // documented, non-contradictory telemetry state (real production
  // evidence showed exactly this combination) -- never a bug to force
  // into artificial consistency. The real caller (use-voice-recording.ts)
  // only ever sets speechDetectedAt the instant hasDetectedSpeech first
  // flips true; lastSpeechAt updates on every candidate sample regardless
  // of confirmation. So a candidate sample that occurred but never
  // sustained long enough to confirm leaves a real lastSpeechAt behind
  // with no corresponding speechDetectedAt -- exactly reproduced here from
  // the real state machine, not asserted in isolation.
  it("speechDetectedAtMs:null with speechEndedAtMs:<value> is legal -- a candidate sample occurred but never sustained long enough to confirm", () => {
    let state = initVadState(0);
    const result = evaluateVadSample(state, CLEAR_SPEECH, 0); // one real candidate sample
    state = result.state;
    const afterGap = evaluateVadSample(state, SILENCE, 5000); // gap far exceeds maxCandidateGapMs -- streak resets, never confirmed
    expect(afterGap.state.hasDetectedSpeech).toBe(false);
    expect(afterGap.state.lastSpeechAt).toBe(0); // the one real candidate sample seen

    const diagnostics = computeVoiceActivityDiagnostics({
      recordingStartedAt: 0,
      stopDecidedAt: 10000,
      speechDetectedAt: null, // never confirmed -- the real caller never sets this
      lastSpeechAt: afterGap.state.lastSpeechAt,
      autoStopReason: "stop_no_speech_timeout",
      vadMode: "heuristic-rms-spectral-v1",
      peakRms: afterGap.state.peakRms,
      peakSpeechBandRatio: afterGap.state.peakSpeechBandRatio,
      finalNoiseFloor: afterGap.state.noiseFloorEstimate,
      maxCandidateSpeechMs: afterGap.state.maxCandidateStreakMs,
      candidateResetCount: afterGap.state.candidateResetCount,
      fullyQualifiedSampleCount: afterGap.state.fullyQualifiedSampleCount,
    });

    expect(diagnostics.speechDetectedAtMs).toBeNull();
    expect(diagnostics.speechEndedAtMs).toBe(0);
    // The new diagnostic fields make this exact scenario directly
    // explainable instead of ambiguous: real candidate-like evidence DID
    // exist (fullyQualifiedSampleCount > 0), it just never sustained long
    // enough to be confirmed as speech (maxCandidateSpeechMs stayed at 0,
    // the streak's only recorded duration before it was discarded).
    expect(diagnostics.fullyQualifiedSampleCount).toBe(1);
    expect(diagnostics.maxCandidateSpeechMs).toBe(0);
    expect(diagnostics.candidateResetCount).toBe(1);
  });
});

describe("shouldAutoSubmitTranscript", () => {
  it("is true for a real, non-empty transcript", () => {
    expect(shouldAutoSubmitTranscript("Vreau să păstrez lungimea.")).toBe(true);
  });

  // Required: "transcript gol -> zero submit".
  it("is false for an empty or whitespace-only transcript", () => {
    expect(shouldAutoSubmitTranscript("")).toBe(false);
    expect(shouldAutoSubmitTranscript("   ")).toBe(false);
  });

  // Required: "STT eșuează -> zero submit" -- a failed transcription never
  // even produces a string to check (see finishRecording's onFailure path,
  // structurally separate from onSuccess), but this function is
  // defensively correct for null/undefined too, matching that guarantee.
  it("is false for null or undefined (no transcript at all, e.g. a failed transcription)", () => {
    expect(shouldAutoSubmitTranscript(null)).toBe(false);
    expect(shouldAutoSubmitTranscript(undefined)).toBe(false);
  });
});

describe("initVadState", () => {
  it("starts with no speech detected, no lastSpeechAt, a zero noise floor, no in-progress streak, and all diagnostic accumulators at zero", () => {
    const state: VadState = initVadState(1234);
    expect(state).toEqual({
      hasDetectedSpeech: false,
      lastSpeechAt: null,
      recordingStartedAt: 1234,
      noiseFloorEstimate: 0,
      speechStreakStartedAt: null,
      peakRms: 0,
      peakSpeechBandRatio: 0,
      maxCandidateStreakMs: 0,
      candidateResetCount: 0,
      fullyQualifiedSampleCount: 0,
    });
  });
});
