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
});

// End-of-speech hardening (2026-08-20), Task E: proves the telemetry
// computation itself, independent of the browser-only sampling loop that
// feeds it (use-voice-recording.ts).
describe("computeVoiceActivityDiagnostics", () => {
  it("computes a full breakdown for a normal stop_silence turn", () => {
    const diagnostics = computeVoiceActivityDiagnostics({
      recordingStartedAt: 1000,
      stopDecidedAt: 5500, // recording lasted 4500ms total
      speechDetectedAt: 1300, // speech confirmed 300ms in
      lastSpeechAt: 3500, // last speech-like sample at 2500ms in
      autoStopReason: "stop_silence",
      vadMode: "heuristic-rms-spectral-v1",
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
    });
    expect(diagnostics.autoStopReason).toBe("manual_stop");
    expect(diagnostics.maxDurationTriggered).toBe(false);
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
  it("starts with no speech detected, no lastSpeechAt, a zero noise floor, and no in-progress streak", () => {
    const state: VadState = initVadState(1234);
    expect(state).toEqual({
      hasDetectedSpeech: false,
      lastSpeechAt: null,
      recordingStartedAt: 1234,
      noiseFloorEstimate: 0,
      speechStreakStartedAt: null,
    });
  });
});
