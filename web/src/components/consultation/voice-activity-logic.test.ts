import { describe, expect, it } from "vitest";

import {
  computeVoiceActivityDiagnostics,
  DEFAULT_VAD_CONFIG,
  evaluateVadSample,
  initVadState,
  shouldAutoSubmitTranscript,
  type VadConfig,
  type VadEvaluation,
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
// ROUND 3 (2026-08-22): a moderate-volume, spectrally speech-shaped sample
// that still fails the ADAPTIVE amplitude gate once the floor has already
// climbed somewhat (see the ROUND 3 module doc comment) -- real voice, just
// not loud enough to clear an already-elevated threshold. This is the exact
// class of sample real production telemetry showed dominating a false
// negative (spectralQualifiedSampleCount 69/100 vs amplitudeQualifiedSampleCount
// only 19/100).
const MODERATE_SPEECH_BELOW_ELEVATED_FLOOR: VadSample = { rmsLevel: 0.05, speechBandRatio: 0.55 };
// ROUND 4 (2026-08-22): a loud, amplitude-qualified sample whose energy is
// NOT concentrated in the speech band (e.g. a sibilant/plosive burst, or a
// vowel harmonic spread) -- the complementary real-speech shape to
// AMPLITUDE_DIP. Real continuous speech naturally alternates between
// samples shaped like this one and samples shaped like AMPLITUDE_DIP; see
// the module's own ROUND 4 doc comment for why requiring both on the SAME
// 100ms sample is not a reliable test for either, and why the windowed
// evidence model links them across nearby samples instead.
const LOUD_BROADBAND_PHONEME: VadSample = { rmsLevel: 0.3, speechBandRatio: 0.25 };
// ROUND 7 (2026-08-22): genuine, moderate room background noise -- quiet
// enough to fail the amplitude gate outright and diffuse enough to fail
// the spectral gate too, so it correctly builds the room's own
// ambientSpectralRatioEstimate baseline (see the module's own ROUND 7 doc
// comment) without itself ever looking like speech.
const MODERATE_BACKGROUND_NOISE: VadSample = { rmsLevel: 0.015, speechBandRatio: 0.25 };
// Real speech loud enough to clear amplitude, but with its own in-band
// concentration diluted by the SAME background noise down to 0.42 --
// below the fixed 0.45 absolute threshold, but (once the room's ambient
// baseline has been learned) above it by more than spectralLiftMargin,
// and above minSpeechBandRatioFloor -- the exact production shape this
// round's fix targets.
const SPEECH_OVER_BACKGROUND_NOISE: VadSample = { rmsLevel: 0.15, speechBandRatio: 0.42 };

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

    // VAD false-negative hardening, ROUND 3 (2026-08-22): a real production
    // retest on the ROUND 2 (telemetry-only) build proved the floor was
    // learning from the stylist's OWN voice, not the room -- see this
    // module's own ROUND 3 doc comment for the full root-cause chain. These
    // tests reproduce the mechanism directly and prove the fix (excluding
    // on spectralQualified alone, not the full candidate) closes it.
    describe("ROUND 3: the floor must not learn from spectrally speech-shaped samples, even when they fail the amplitude gate", () => {
      it("a spectrally speech-shaped but quiet sample never drags the noise floor upward, even though it fails the amplitude gate", () => {
        let state = initVadState(0);
        let t = 0;
        for (let i = 0; i < 30; i += 1) {
          t += 100;
          state = evaluateVadSample(state, AMPLITUDE_DIP, t).state;
        }
        // AMPLITUDE_DIP fails the amplitude gate but clears the spectral
        // gate (0.6 >= 0.45) -- pre-ROUND-3, every one of these would have
        // been folded into the ambient EMA as if it were silence/noise.
        expect(state.noiseFloorEstimate).toBe(0);
      });

      it("sustained ambient noise that is NOT spectrally speech-shaped still raises the floor normally -- the ROUND 3 fix does not weaken ambient tracking", () => {
        let state = initVadState(0);
        let t = 0;
        for (let i = 0; i < 30; i += 1) {
          t += 100;
          state = evaluateVadSample(state, AMBIENT_NOISE, t).state;
        }
        expect(state.noiseFloorEstimate).toBeGreaterThan(0.02);
      });

      it("reproduces the real production feedback loop: a moderate-volume speech sample that fails an already-elevated amplitude gate no longer pulls the floor up further", () => {
        let state = initVadState(0);
        let t = 0;
        // Raise the floor with genuine (non-speech-shaped) ambient noise
        // first -- mirrors real room background before the stylist starts
        // speaking.
        for (let i = 0; i < 40; i += 1) {
          t += 100;
          state = evaluateVadSample(state, AMBIENT_NOISE, t).state;
        }
        const floorBeforeSpeech = state.noiseFloorEstimate;
        expect(floorBeforeSpeech).toBeGreaterThan(0.02);

        // The stylist now speaks: genuine, spectrally speech-shaped audio,
        // but at a level below the now-elevated amplitude threshold (floor
        // * noiseFloorMargin) -- real voice that fails amplitude only
        // because the floor itself had already climbed.
        for (let i = 0; i < 20; i += 1) {
          t += 100;
          state = evaluateVadSample(state, MODERATE_SPEECH_BELOW_ELEVATED_FLOOR, t).state;
        }
        // Pre-ROUND-3, these 20 samples would all have been folded into
        // the ambient EMA (they fail the combined `candidate` check) and
        // pulled the floor further toward their own level, raising the bar
        // even higher for the rest of the sentence -- the exact
        // floor-chasing-speech feedback loop this round's fix closes.
        expect(state.noiseFloorEstimate).toBe(floorBeforeSpeech);
      });
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

    // Originally documented (2026-08-21) as a KNOWN LIMITATION, not fixed
    // that round: a too-quiet-but-spectrally-speech-shaped sample at
    // recording start got absorbed into the noise floor, since it failed
    // the combined `candidate` check (amplitude alone) and so was fed into
    // the ambient EMA. ROUND 3 (2026-08-22) incidentally fixes this as a
    // side effect of excluding floor adaptation on spectralQualified alone
    // (see the module's own ROUND 3 doc comment) -- this sample clears the
    // spectral gate (0.5 >= 0.45), so it is now excluded from the floor
    // regardless of failing amplitude. Updated to assert the fixed
    // behavior, not the old limitation.
    it("a very quiet but spectrally speech-shaped utterance at recording start no longer gets absorbed into the noise floor (ROUND 3 fix)", () => {
      const state = initVadState(0);
      const veryQuietSpeech: VadSample = { rmsLevel: 0.015, speechBandRatio: 0.5 }; // below minAbsoluteLevel (0.02) despite being speech-shaped
      const result = evaluateVadSample(state, veryQuietSpeech, 0);
      expect(result.state.hasDetectedSpeech).toBe(false);
      expect(result.state.noiseFloorEstimate).toBe(0);
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

  // VAD false-negative hardening, ROUND 2 (2026-08-22): a real production
  // retest on the round-1 fix still ended stop_no_speech_timeout on
  // genuinely intelligible speech, with peakRms ~0.160 and
  // peakSpeechBandRatio ~0.799 (both healthy) but only 2
  // fully-qualified samples the whole recording. These tests reproduce
  // the two distinct failure shapes the new counters must be able to
  // tell apart, and prove they do.
  describe("ROUND 2 diagnostic accumulators (amplitudeQualifiedSampleCount / spectralQualifiedSampleCount / totalSampleCount / longestCandidateGapMs / peakNoiseFloor)", () => {
    it("a spectrally-volatile signal (amplitude consistently fine, spectral ratio rarely clears the gate) shows a healthy amplitudeQualifiedSampleCount but a low spectralQualifiedSampleCount -- reproducing the real production shape", () => {
      let state = initVadState(0);
      let t = 0;
      // Amplitude is always healthy (well above the floor); speech-band
      // ratio oscillates, clearing 0.45 only 2 times out of 10 -- the
      // exact real production pattern (peak ratio was high, but only 2
      // samples were ever fully qualified).
      const ratios = [0.2, 0.3, 0.799, 0.25, 0.3, 0.799, 0.2, 0.3, 0.25, 0.2];
      for (const speechBandRatio of ratios) {
        t += 100;
        state = evaluateVadSample(state, { rmsLevel: 0.16, speechBandRatio }, t).state;
      }
      expect(state.totalSampleCount).toBe(10);
      expect(state.amplitudeQualifiedSampleCount).toBe(10); // amplitude was NEVER the problem
      expect(state.spectralQualifiedSampleCount).toBe(2); // spectral ratio rarely cleared the gate
      expect(state.fullyQualifiedSampleCount).toBe(2);
      // ROUND 4 (2026-08-22): this is EXACTLY the shape ROUND 4's windowed-
      // evidence fusion was designed to fix -- amplitude is qualified on
      // every sample, so once spectral evidence appears at t=300, it stays
      // "recently qualified" through speechEvidenceWindowMs, letting the
      // t=400/500 samples also count as windowedCandidate; the second real
      // spectral hit at t=600 completes a 300ms streak and confirms.
      // Updated from the original ROUND 2 assertion (hasDetectedSpeech:
      // false, "never sustained long enough to confirm") now that it does.
      expect(state.hasDetectedSpeech).toBe(true);
    });

    it("a signal where BOTH gates individually pass often but rarely on the SAME sample shows healthy individual counts but a low fullyQualifiedSampleCount -- the alignment-problem shape", () => {
      let state = initVadState(0);
      let t = 0;
      // Alternates which gate passes each sample -- amplitude and
      // spectral ratio are each healthy roughly half the time, but never
      // simultaneously.
      const samples: VadSample[] = [
        { rmsLevel: 0.16, speechBandRatio: 0.2 }, // amplitude only
        { rmsLevel: 0.01, speechBandRatio: 0.7 }, // spectral only
        { rmsLevel: 0.16, speechBandRatio: 0.2 }, // amplitude only
        { rmsLevel: 0.01, speechBandRatio: 0.7 }, // spectral only
      ];
      for (const sample of samples) {
        t += 100;
        state = evaluateVadSample(state, sample, t).state;
      }
      expect(state.amplitudeQualifiedSampleCount).toBe(2);
      expect(state.spectralQualifiedSampleCount).toBe(2);
      expect(state.fullyQualifiedSampleCount).toBe(0); // the two gates never aligned on one sample
    });

    it("tracks longestCandidateGapMs as the largest gap between two consecutive fully-qualified samples, even across a reset", () => {
      let state = initVadState(0);
      state = evaluateVadSample(state, CLEAR_SPEECH, 0).state; // candidate #1
      state = evaluateVadSample(state, SILENCE, 3500).state; // long gap, no candidates in between
      state = evaluateVadSample(state, CLEAR_SPEECH, 3600).state; // candidate #2, 3600ms after #1
      expect(state.longestCandidateGapMs).toBe(3600);
    });

    it("longestCandidateGapMs stays 0 when at most one candidate sample has ever occurred", () => {
      let state = initVadState(0);
      state = evaluateVadSample(state, CLEAR_SPEECH, 500).state;
      expect(state.longestCandidateGapMs).toBe(0);
    });

    it("tracks peakNoiseFloor as the highest adaptive floor ever reached, even if it later settles lower", () => {
      let state = initVadState(0);
      let t = 0;
      // A burst of sustained ambient noise raises the floor...
      for (let i = 0; i < 20; i += 1) {
        t += 100;
        state = evaluateVadSample(state, AMBIENT_NOISE, t).state;
      }
      // peakNoiseFloor is derived from the floor as it stood ENTERING each
      // sample (see evaluateVadSample), so it lags the just-applied update
      // by exactly one sample. One more (now-quiet) sample lets the reading
      // catch up to the ambient burst's true peak before decay begins.
      t += 100;
      state = evaluateVadSample(state, SILENCE, t).state;
      const peakAfterBurst = state.peakNoiseFloor;
      expect(peakAfterBurst).toBeGreaterThan(0);
      // ...then the room stays quiet, and the floor keeps decaying down.
      for (let i = 0; i < 19; i += 1) {
        t += 100;
        state = evaluateVadSample(state, SILENCE, t).state;
      }
      expect(state.noiseFloorEstimate).toBeLessThan(peakAfterBurst);
      // peakNoiseFloor still remembers the highest point reached, unlike
      // the (now-decayed) current noiseFloorEstimate / finalNoiseFloor.
      expect(state.peakNoiseFloor).toBe(peakAfterBurst);
    });
  });

  // VAD false-negative hardening, ROUND 4 (2026-08-22): a real production
  // retest on 803c538 (speaker deliberately talking naturally for 5-7s)
  // showed amplitudeQualifiedSampleCount 26/100, spectralQualifiedSampleCount
  // 20/100, but fullyQualifiedSampleCount (BOTH, same sample) only 1/100 --
  // the third real recording in a row to show this shape. See this
  // module's own ROUND 4 doc comment for the full DSP/acoustic root cause
  // and the windowedCandidate design. These tests reproduce the exact
  // production shape and prove the fix confirms real speech from it while
  // still rejecting music/noise/transients.
  describe("ROUND 4: cross-modality windowed evidence fusion (windowedCandidate)", () => {
    it("confirms speech from alternating loud-broadband and quiet-narrowband samples, even though NO single sample ever passes both gates -- the exact 26%/20%/1%-overlap production shape", () => {
      let state = initVadState(0);
      let t = 0;
      let result = evaluateVadSample(state, LOUD_BROADBAND_PHONEME, t); // t=0
      state = result.state;
      t += 100;
      result = evaluateVadSample(state, AMPLITUDE_DIP, t); // t=100
      state = result.state;
      t += 100;
      result = evaluateVadSample(state, LOUD_BROADBAND_PHONEME, t); // t=200
      state = result.state;
      t += 100;
      result = evaluateVadSample(state, AMPLITUDE_DIP, t); // t=300
      state = result.state;
      t += 100;
      result = evaluateVadSample(state, LOUD_BROADBAND_PHONEME, t); // t=400 -- 300ms streak, confirmed
      expect(result.state.hasDetectedSpeech).toBe(true);
      // The confirmation came entirely from cross-modality evidence -- not
      // one single sample in this stream ever cleared BOTH gates at once.
      expect(result.state.fullyQualifiedSampleCount).toBe(0);
      expect(result.state.windowedCandidateSampleCount).toBeGreaterThan(0);
    });

    it("at speechEvidenceWindowMs=0, windowedCandidate collapses exactly to the original same-sample AND -- confirms this is a strict generalization, not a different mechanism", () => {
      const strictConfig: VadConfig = { ...DEFAULT_VAD_CONFIG, speechEvidenceWindowMs: 0 };
      let state = initVadState(0);
      let t = 0;
      for (let i = 0; i < 20; i += 1) {
        const sample = i % 2 === 0 ? LOUD_BROADBAND_PHONEME : AMPLITUDE_DIP;
        state = evaluateVadSample(state, sample, t, strictConfig).state;
        t += 100;
      }
      expect(state.hasDetectedSpeech).toBe(false);
      expect(state.windowedCandidateSampleCount).toBe(0);
    });

    it("a short pause between words does not interrupt an in-progress cross-modality streak, and confirmed speech continues normally afterward", () => {
      let state = initVadState(0);
      let t = 0;
      for (let i = 0; i < 5; i += 1) {
        const sample = i % 2 === 0 ? LOUD_BROADBAND_PHONEME : AMPLITUDE_DIP;
        state = evaluateVadSample(state, sample, t).state; // confirmed by t=400, see headline test
        t += 100;
      }
      expect(state.hasDetectedSpeech).toBe(true);

      t += 100;
      let result = evaluateVadSample(state, SILENCE, t); // a brief true pause
      expect(result.decision).toBe("continue");
      state = result.state;

      t += 100;
      result = evaluateVadSample(state, LOUD_BROADBAND_PHONEME, t); // speech resumes
      expect(result.decision).toBe("continue");
      expect(result.state.hasDetectedSpeech).toBe(true);
    });

    // A more representative "utterance" than pure 2-value alternation --
    // occasionally both-qualified (QUIET_SPEECH), like real speech's own
    // natural variety, and short enough (3.2s) to stay well clear of the
    // pre-existing, ROUND-4-independent floor-convergence property proven
    // separately below (a single, endlessly-repeated non-spectral loudness
    // value eventually self-defeats its own amplitude gate -- see that
    // test's own doc comment).
    const PHONEME_CYCLE: VadSample[] = [LOUD_BROADBAND_PHONEME, AMPLITUDE_DIP, QUIET_SPEECH, AMPLITUDE_DIP];

    it("a long natural utterance (varied phoneme-level evidence for several seconds) never triggers a premature stop_silence mid-sentence", () => {
      let state = initVadState(0);
      let t = 0;
      let decision: ReturnType<typeof evaluateVadSample>["decision"] = "continue";
      for (let i = 0; i < 32; i += 1) {
        const sample = PHONEME_CYCLE[i % PHONEME_CYCLE.length];
        const result = evaluateVadSample(state, sample, t);
        state = result.state;
        decision = result.decision;
        expect(decision).toBe("continue");
        t += 100;
      }
      expect(state.hasDetectedSpeech).toBe(true);
    });

    it("genuine end-of-speech still triggers stop_silence once BOTH modalities go silent for long enough", () => {
      let state = initVadState(0);
      let t = 0;
      for (let i = 0; i < 6; i += 1) {
        const sample = PHONEME_CYCLE[i % PHONEME_CYCLE.length];
        state = evaluateVadSample(state, sample, t).state;
        t += 100;
      }
      expect(state.hasDetectedSpeech).toBe(true);

      let result: ReturnType<typeof evaluateVadSample> = { state, decision: "continue" };
      const deadline = t + DEFAULT_VAD_CONFIG.silenceDurationMs + 1000;
      while (result.decision === "continue" && t < deadline) {
        result = evaluateVadSample(state, SILENCE, t);
        state = result.state;
        t += 100;
      }
      expect(result.decision).toBe("stop_silence");
    });

    it("sustained music-only audio never becomes a windowed candidate, regardless of duration -- spectral rejection is unaffected by window size", () => {
      let state = initVadState(0);
      let t = 0;
      let result: ReturnType<typeof evaluateVadSample> = { state, decision: "continue" };
      for (let i = 0; i < 100; i += 1) {
        t += 100;
        result = evaluateVadSample(state, LOUD_MUSIC, t);
        state = result.state;
      }
      expect(state.hasDetectedSpeech).toBe(false);
      expect(state.windowedCandidateSampleCount).toBe(0);
      expect(result.decision).toBe("stop_no_speech_timeout");
    });

    it("sustained hair-dryer/broadband noise never becomes a windowed candidate either", () => {
      let state = initVadState(0);
      let t = 0;
      let result: ReturnType<typeof evaluateVadSample> = { state, decision: "continue" };
      for (let i = 0; i < 100; i += 1) {
        t += 100;
        result = evaluateVadSample(state, DRYER_NOISE, t);
        state = result.state;
      }
      expect(state.hasDetectedSpeech).toBe(false);
      expect(state.windowedCandidateSampleCount).toBe(0);
      expect(result.decision).toBe("stop_no_speech_timeout");
    });

    it("a short transient pair (one loud-broadband + one quiet-narrowband sample close together) does not confirm speech -- not sustained long enough", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, SILENCE, 0);
      state = result.state;
      result = evaluateVadSample(state, LOUD_BROADBAND_PHONEME, 2000); // isolated blip
      state = result.state;
      result = evaluateVadSample(state, AMPLITUDE_DIP, 2100); // its cross-modality partner
      state = result.state;
      expect(result.state.hasDetectedSpeech).toBe(false); // only ~100ms of streak -- well under minSpeechDurationMs
      result = evaluateVadSample(state, SILENCE, 2200);
      state = result.state;
      result = evaluateVadSample(state, SILENCE, 5000); // gap far exceeds maxCandidateGapMs -- streak discarded
      expect(result.state.hasDetectedSpeech).toBe(false);
    });

    it("music immediately after real speech extends the silence countdown only briefly (bounded by roughly speechEvidenceWindowMs), never indefinitely -- the original 'infinite listening' bug stays fixed", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300); // 300ms streak -- confirmed
      state = result.state;
      expect(state.hasDetectedSpeech).toBe(true);

      // Music starts immediately after -- within speechEvidenceWindowMs of
      // the last real spectral evidence, so it can briefly still register
      // as windowedCandidate. This is bounded leakage, not a regression:
      // music itself never re-qualifies spectrally (LOUD_MUSIC always
      // fails the spectral gate), so this can only borrow from the REAL
      // speech that already happened, and only for a short, aging window.
      result = evaluateVadSample(state, LOUD_MUSIC, 400);
      expect(result.decision).toBe("continue");
      state = result.state;
      result = evaluateVadSample(state, LOUD_MUSIC, 550);
      expect(result.decision).toBe("continue");
      state = result.state;

      // Feed a long, sustained run of music-only samples well past any
      // plausible leakage window -- stop_silence must fire, and it must
      // not require ever seeing a "continue" again once it does.
      let sawStopSilence = false;
      let t = 650;
      for (let i = 0; i < 30; i += 1) {
        result = evaluateVadSample(state, LOUD_MUSIC, t);
        state = result.state;
        if (result.decision === "stop_silence") {
          sawStopSilence = true;
          break;
        }
        t += 100;
      }
      expect(sawStopSilence).toBe(true);
      // The leakage was bounded to roughly speechEvidenceWindowMs -- total
      // time from the LAST real speech sample (t=300) to stop_silence must
      // stay close to silenceDurationMs (2000), not balloon indefinitely.
      expect(t - 300).toBeLessThan(DEFAULT_VAD_CONFIG.silenceDurationMs + DEFAULT_VAD_CONFIG.speechEvidenceWindowMs + 200);
    });
  });

  // VAD false-negative hardening, ROUND 5 (2026-08-22): a fourth real
  // production recording, on the ROUND 4 build, still ended
  // stop_no_speech_timeout -- but with real, measurable progress
  // (windowedCandidateSampleCount 7 vs fullyQualifiedSampleCount 1) and a
  // precisely diagnosable next bottleneck: amplitude evidence dropped to
  // 11/100 despite spectral reaching 47/100, and peakNoiseFloor still
  // ~12.7x a true quiet-room baseline. See this module's own ROUND 5 doc
  // comment for the full root-cause chain and why the fix reuses
  // spectralRecentlyQualified rather than inventing a new signal.
  describe("ROUND 5: the floor must not learn from samples with recent (not just simultaneous) spectral evidence nearby", () => {
    // Spectral qualification recurs every 200ms here (well inside
    // speechEvidenceWindowMs, 300ms), so spectralRecentlyQualified stays
    // continuously true for every intervening LOUD_BROADBAND_PHONEME
    // sample too -- the floor gets fed only once (the very first sample,
    // before any spectral evidence exists yet) and then stays pinned near
    // that initial value for the rest of the recording, regardless of
    // length. This is the exact case ROUND 4 flagged as a KNOWN
    // LIMITATION -- ROUND 5 resolves it as a direct consequence of the
    // floor-exclusion fix, not a separate change.
    it("an endlessly-repeated non-spectral loudness value no longer self-defeats its own amplitude gate, as long as spectral evidence keeps recurring within speechEvidenceWindowMs", () => {
      let state = initVadState(0);
      let t = 0;
      for (let i = 0; i < 45; i += 1) {
        const sample = i % 2 === 0 ? LOUD_BROADBAND_PHONEME : AMPLITUDE_DIP;
        state = evaluateVadSample(state, sample, t).state;
        t += 100;
      }
      const amplitudeFloorNow = Math.max(DEFAULT_VAD_CONFIG.minAbsoluteLevel, state.noiseFloorEstimate * DEFAULT_VAD_CONFIG.noiseFloorMargin);
      expect(amplitudeFloorNow).toBeLessThan(LOUD_BROADBAND_PHONEME.rmsLevel);
    });

    // Honest, PRE-EXISTING limitation, narrowed but NOT eliminated by
    // ROUND 5: when spectral evidence recurs SPARSER than
    // speechEvidenceWindowMs apart (here, once every 500ms -- outside the
    // 300ms window), most of the intervening non-spectral samples are no
    // longer protected either, so the floor still climbs and can still
    // eventually self-defeat a fixed, endlessly-repeated non-spectral
    // loudness value -- just far more slowly than before ROUND 5 (roughly
    // 5x more samples needed here, since only ~1-in-5 non-spectral
    // samples per cycle now feeds the floor instead of ~4-in-5). Real
    // speech's own natural variety (rarely repeating the exact same
    // acoustic shape for seconds at a time, uninterrupted by ANY nearby
    // spectral evidence) makes this a low-probability edge case in
    // practice, not eliminated in theory. Documented here, not silently
    // avoided.
    it("KNOWN LIMITATION (narrowed by ROUND 5, not eliminated): still self-defeats when spectral evidence recurs SPARSER than speechEvidenceWindowMs apart", () => {
      let state = initVadState(0);
      let t = 0;
      const cycle = [LOUD_BROADBAND_PHONEME, LOUD_BROADBAND_PHONEME, LOUD_BROADBAND_PHONEME, LOUD_BROADBAND_PHONEME, AMPLITUDE_DIP];
      for (let i = 0; i < 150; i += 1) {
        state = evaluateVadSample(state, cycle[i % cycle.length], t).state;
        t += 100;
      }
      const amplitudeFloorNow = Math.max(DEFAULT_VAD_CONFIG.minAbsoluteLevel, state.noiseFloorEstimate * DEFAULT_VAD_CONFIG.noiseFloorMargin);
      expect(amplitudeFloorNow).toBeGreaterThan(LOUD_BROADBAND_PHONEME.rmsLevel);
    });
  });

  // VAD false-negative hardening, ROUND 5 (2026-08-22), Phase D: real
  // production evidence (candidateResetCount: 3, maxCandidateSpeechMs
  // stalling at 191ms despite windowedCandidateSampleCount: 7) traced to a
  // genuine, code-provable inconsistency between speechEvidenceWindowMs
  // (300ms, governs whether a sample counts as windowedCandidate at all)
  // and the tighter maxCandidateGapMs (150ms, governs whether an
  // in-progress STREAK survives a gap) -- see this module's own ROUND 5
  // doc comment. These tests prove the fix (Math.max of the two) directly.
  describe("ROUND 5: streak-survival gap tolerance is consistent with speechEvidenceWindowMs", () => {
    it("a streak survives a gap between 150ms and 300ms -- exceeding the narrower maxCandidateGapMs but within speechEvidenceWindowMs -- and goes on to confirm", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0); // streak starts, lastSpeechAt=0
      state = result.state;
      // A non-candidate sample 200ms later triggers the streak-survival
      // check with a 200ms gap -- exceeds maxCandidateGapMs (150) alone,
      // but is within Math.max(150, speechEvidenceWindowMs=300).
      result = evaluateVadSample(state, SILENCE, 200);
      expect(result.state.speechStreakStartedAt).toBe(0); // streak survived, not reset
      expect(result.state.candidateResetCount).toBe(0);
      state = result.state;

      // Speech resumes -- total streak duration since t=0 is now 250ms,
      // reaching minSpeechDurationMs.
      result = evaluateVadSample(state, CLEAR_SPEECH, 250);
      expect(result.state.hasDetectedSpeech).toBe(true);
    });

    it("a gap beyond BOTH tolerances (300ms) still resets the streak -- the aligned tolerance is bounded, not unlimited", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, SILENCE, 400); // 400ms gap -- exceeds both tolerances
      expect(result.state.speechStreakStartedAt).toBeNull();
      expect(result.state.candidateResetCount).toBe(1);
    });
  });

  // VAD end-of-speech hardening, ROUND 6 (2026-08-22): a real production
  // test on 471570b, with the USER'S OWN GROUND TRUTH ("the microphone
  // stopped while I was still speaking"), proved a false POSITIVE
  // end-of-speech: speech confirmed correctly at 401ms, but lastSpeechAt
  // stopped updating at 802ms and stop_silence fired 2108ms later,
  // truncating the recording while the user kept talking (STT still
  // transcribed real content from the audio actually captured). Root
  // cause: lastSpeechAt was updated in exactly one place -- the
  // windowedCandidate branch -- so CONTINUATION reused the identical,
  // strict cross-modal bar START uses. See this module's own ROUND 6 doc
  // comment for the full analysis and why spectral-alone (never amplitude-
  // alone) is the safe, weaker continuation signal.
  describe("ROUND 6: continuation evidence (spectral-alone keeps a confirmed utterance alive)", () => {
    it("reproduces the production false-positive shape: a stretch with only spectral (no amplitude) evidence after confirmation no longer triggers a premature stop_silence", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300); // confirmed at 300ms
      state = result.state;
      expect(state.hasDetectedSpeech).toBe(true);

      // A stretch (well beyond speechEvidenceWindowMs) with only
      // spectral-alone evidence -- real, quieter speech that never
      // re-clears the amplitude gate. Pre-ROUND-6, this would NOT have
      // refreshed lastSpeechAt at all (windowedCandidate requires
      // amplitude now-or-recently), and stop_silence would have fired at
      // t=2300 (2000ms after the last full windowedCandidate hit at
      // t=300) -- cutting the user off mid-sentence exactly as the real
      // production report described.
      result = evaluateVadSample(state, AMPLITUDE_DIP, 1900);
      expect(result.decision).toBe("continue");
      expect(result.state.lastSpeechAt).toBe(1900); // refreshed via the new continuation-only rule
      state = result.state;

      // Without ROUND 6, the recording would already have stopped by now.
      result = evaluateVadSample(state, SILENCE, 2300);
      expect(result.decision).toBe("continue"); // still well within 2000ms of t=1900
    });

    it("genuine silence on BOTH modalities after a continuation-only refresh still eventually triggers stop_silence -- the new leniency is bounded, not unlimited", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300);
      state = result.state;
      result = evaluateVadSample(state, AMPLITUDE_DIP, 1900); // continuation-only refresh
      state = result.state;
      result = evaluateVadSample(state, SILENCE, 3899); // 1999ms since t=1900 -- not yet
      expect(result.decision).toBe("continue");
      state = result.state;
      result = evaluateVadSample(state, SILENCE, 3900); // exactly 2000ms since t=1900
      expect(result.decision).toBe("stop_silence");
    });

    it("music immediately after real speech still cannot ride the new continuation-only rule -- spectralQualified is never true for music, so continuationQualified never fires for it", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300);
      state = result.state;
      expect(state.hasDetectedSpeech).toBe(true);

      let t = 400;
      let sawStop = false;
      for (let i = 0; i < 30; i += 1) {
        result = evaluateVadSample(state, LOUD_MUSIC, t);
        state = result.state;
        if (result.decision === "stop_silence") {
          sawStop = true;
          break;
        }
        t += 100;
      }
      expect(sawStop).toBe(true);
      // Bounded exactly as ROUND 4 proved (the existing windowedCandidate
      // leakage window), unaffected by ROUND 6 -- not extended further,
      // since music never produces genuine spectral evidence.
      expect(t - 300).toBeLessThan(DEFAULT_VAD_CONFIG.silenceDurationMs + DEFAULT_VAD_CONFIG.speechEvidenceWindowMs + 200);
    });

    it("speech continuing over background music (intermittent spectral evidence, amplitude often elevated by the music) does not trigger a premature cutoff", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300);
      state = result.state;
      expect(state.hasDetectedSpeech).toBe(true);

      let t = 500;
      for (let i = 0; i < 15; i += 1) {
        const sample = i % 2 === 0 ? SPEECH_OVER_MODERATE_MUSIC : AMPLITUDE_DIP;
        result = evaluateVadSample(state, sample, t);
        state = result.state;
        expect(result.decision).toBe("continue");
        t += 100;
      }
      expect(state.hasDetectedSpeech).toBe(true);
    });

    it("amplitude-only post-confirmation samples are tracked diagnostically but never refresh the silence countdown", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300);
      state = result.state;
      expect(state.hasDetectedSpeech).toBe(true);

      // Well past speechEvidenceWindowMs since the last evidence, so this
      // is unambiguously NOT a windowedCandidate.
      result = evaluateVadSample(state, LOUD_BROADBAND_PHONEME, 700);
      expect(result.state.lastSpeechAt).toBe(300); // NOT refreshed -- amplitude alone is never a continuation signal
      expect(result.state.continuationAmplitudeOnlySampleCount).toBe(1);
    });

    it("tracks postConfirmationSampleCount/continuationQualifiedSampleCount/continuationSpectralOnlySampleCount correctly", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300); // confirmed here -- not itself counted as post-confirmation
      state = result.state;
      expect(state.postConfirmationSampleCount).toBe(0);

      result = evaluateVadSample(state, AMPLITUDE_DIP, 700); // spectral-only continuation hit
      state = result.state;
      expect(state.postConfirmationSampleCount).toBe(1);
      expect(state.continuationQualifiedSampleCount).toBe(1);
      expect(state.continuationSpectralOnlySampleCount).toBe(1);

      result = evaluateVadSample(state, SILENCE, 800); // no evidence at all
      state = result.state;
      expect(state.postConfirmationSampleCount).toBe(2);
      expect(state.continuationQualifiedSampleCount).toBe(1); // unchanged
      expect(state.continuationSpectralOnlySampleCount).toBe(1); // unchanged
    });

    it("longestCandidateGapMs (STRONG evidence only) is unaffected by continuation-only refreshes -- it keeps measuring gaps between full windowedCandidate hits specifically", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300); // lastWindowedCandidateAt=300
      state = result.state;
      result = evaluateVadSample(state, AMPLITUDE_DIP, 1900); // continuation-only, does NOT update lastWindowedCandidateAt
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 2000); // a full windowedCandidate hit again
      state = result.state;
      // Gap measured against lastWindowedCandidateAt (300), not the
      // continuation-refreshed lastSpeechAt (1900): 2000-300=1700.
      expect(state.longestCandidateGapMs).toBe(1700);
    });

    it("tracks longestPostConfirmationGapMs as the largest gap between two consecutive continuation-refreshing samples", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300); // confirmed, lastSpeechAt=300
      state = result.state;
      result = evaluateVadSample(state, AMPLITUDE_DIP, 1900); // continuation-only refresh, gap=1600 since t=300
      state = result.state;
      expect(state.longestPostConfirmationGapMs).toBe(1600);
    });
  });

  // VAD start-detection hardening, ROUND 7 (2026-08-22): a real production
  // test WITH background noise present reproduced a new, distinct failure:
  // START itself never confirmed. amplitudeQualifiedSampleCount was a
  // healthy 30/100, but spectralQualifiedSampleCount was only 3/100, and
  // even the single best moment in the whole 10s recording
  // (vadPeakSpeechBandRatio ~0.467) barely cleared the fixed 0.45
  // threshold -- background noise dilutes the spectral ratio's own
  // denominator (see this module's own ROUND 7 doc comment for the full
  // DSP root cause). These tests reproduce the shape directly and prove
  // the START-only adaptive lift path fixes it without weakening
  // music/dryer rejection or ROUND 6's already-stabilized continuation.
  describe("ROUND 7: START-only adaptive spectral lift in background noise", () => {
    function buildAmbientBaseline(state: VadState, t: number, sampleCount: number): { state: VadState; t: number } {
      let currentState = state;
      let currentT = t;
      for (let i = 0; i < sampleCount; i += 1) {
        currentT += 100;
        currentState = evaluateVadSample(currentState, MODERATE_BACKGROUND_NOISE, currentT).state;
      }
      return { state: currentState, t: currentT };
    }

    it("reproduces the production shape: speech diluted below the absolute threshold by background noise still confirms START, once the room's ambient baseline is learned", () => {
      let state = initVadState(0);
      let t = 0;
      ({ state, t } = buildAmbientBaseline(state, t, 60));
      expect(state.ambientSpectralRatioEstimate).toBeGreaterThanOrEqual(DEFAULT_VAD_CONFIG.spectralLiftActivationThreshold);
      expect(state.hasDetectedSpeech).toBe(false); // background noise alone never confirms

      // Real speech, over the same noise -- SPEECH_OVER_BACKGROUND_NOISE's
      // own ratio (0.42) is below the absolute 0.45 threshold, but clears
      // the room's learned ambient baseline by more than spectralLiftMargin.
      let result: VadEvaluation = { state, decision: "continue" };
      for (let i = 0; i < 4; i += 1) {
        t += 100;
        result = evaluateVadSample(result.state, SPEECH_OVER_BACKGROUND_NOISE, t);
      }
      expect(result.state.hasDetectedSpeech).toBe(true);
      expect(result.state.spectralLiftQualifiedSampleCount).toBeGreaterThan(0);
      // The strict, absolute-threshold-only fields are untouched by the
      // lift path -- this recording never had a same-sample-AND hit.
      expect(result.state.fullyQualifiedSampleCount).toBe(0);
    });

    it("the lift path never engages below spectralLiftActivationThreshold -- a still-mostly-quiet room behaves exactly as before", () => {
      let state = initVadState(0);
      let t = 0;
      // Only a handful of noise samples -- nowhere near enough to reach
      // spectralLiftActivationThreshold (0.15).
      ({ state, t } = buildAmbientBaseline(state, t, 3));
      expect(state.ambientSpectralRatioEstimate).toBeLessThan(DEFAULT_VAD_CONFIG.spectralLiftActivationThreshold);

      let result: VadEvaluation = { state, decision: "continue" };
      for (let i = 0; i < 4; i += 1) {
        t += 100;
        result = evaluateVadSample(result.state, SPEECH_OVER_BACKGROUND_NOISE, t);
      }
      // Same diluted-speech sample as the headline test, but without an
      // activated baseline -- must NOT confirm.
      expect(result.state.hasDetectedSpeech).toBe(false);
      expect(result.state.spectralLiftQualifiedSampleCount).toBe(0);
    });

    it("the lift path enforces a hard effective minimum (minSpeechBandRatioFloor) -- a ratio just below it never qualifies, even right at the activation boundary", () => {
      // With the default config, spectralLiftActivationThreshold (0.15) +
      // spectralLiftMargin (0.15) = 0.30 = minSpeechBandRatioFloor exactly
      // -- the floor is a defensive backstop that coincides with the
      // margin's own minimum possible requirement, never independently
      // looser. A ratio just below 0.30 must never qualify, regardless of
      // how the baseline/margin arithmetic works out.
      let state = initVadState(0);
      let t = 0;
      ({ state, t } = buildAmbientBaseline(state, t, 60));
      expect(state.ambientSpectralRatioEstimate).toBeGreaterThanOrEqual(DEFAULT_VAD_CONFIG.spectralLiftActivationThreshold);

      const justBelowFloor: VadSample = { rmsLevel: 0.15, speechBandRatio: 0.29 };
      let result: VadEvaluation = { state, decision: "continue" };
      for (let i = 0; i < 4; i += 1) {
        t += 100;
        result = evaluateVadSample(result.state, justBelowFloor, t);
      }
      expect(result.state.hasDetectedSpeech).toBe(false);
      expect(result.state.spectralLiftQualifiedSampleCount).toBe(0);
    });

    it("music-only remains rejected even with an elevated ambient baseline already established from prior room noise", () => {
      let state = initVadState(0);
      let t = 0;
      ({ state, t } = buildAmbientBaseline(state, t, 60));
      const baselineAfterNoise = state.ambientSpectralRatioEstimate;
      expect(baselineAfterNoise).toBeGreaterThanOrEqual(DEFAULT_VAD_CONFIG.spectralLiftActivationThreshold);

      let result: VadEvaluation = { state, decision: "continue" };
      let sawStop = false;
      for (let i = 0; i < 100; i += 1) {
        t += 100;
        result = evaluateVadSample(result.state, LOUD_MUSIC, t);
        if (result.decision === "stop_no_speech_timeout") {
          sawStop = true;
          break;
        }
      }
      expect(result.state.hasDetectedSpeech).toBe(false);
      expect(result.state.spectralLiftQualifiedSampleCount).toBe(0);
      expect(sawStop).toBe(true);
      // The safety property holds regardless of how the ambient baseline
      // itself evolves under sustained music -- even in the adversarial
      // case where music eventually self-defeats its OWN amplitude gate
      // (the pre-existing ROUND 5 "KNOWN LIMITATION" property: a single,
      // endlessly-repeated loud value chases the noise floor up until it
      // no longer clears its own bar) and so starts influencing the
      // ambient baseline too, the baseline can only ever converge TOWARD
      // music's own ratio (0.15) from above -- never past it -- so
      // baseline+margin never drops far enough for music's own ratio to
      // satisfy it. Confirmed here: the baseline visibly MOVED (proving
      // it isn't simply frozen), yet the lift path still never engaged.
      expect(result.state.ambientSpectralRatioEstimate).not.toBe(baselineAfterNoise);
      expect(result.state.ambientSpectralRatioEstimate).toBeGreaterThan(LOUD_MUSIC.speechBandRatio);
    });

    it("dryer/broadband noise remains rejected even with an elevated ambient baseline already established from prior room noise", () => {
      let state = initVadState(0);
      let t = 0;
      ({ state, t } = buildAmbientBaseline(state, t, 60));
      expect(state.ambientSpectralRatioEstimate).toBeGreaterThanOrEqual(DEFAULT_VAD_CONFIG.spectralLiftActivationThreshold);

      let result: VadEvaluation = { state, decision: "continue" };
      let sawStop = false;
      for (let i = 0; i < 100; i += 1) {
        t += 100;
        result = evaluateVadSample(result.state, DRYER_NOISE, t);
        if (result.decision === "stop_no_speech_timeout") {
          sawStop = true;
          break;
        }
      }
      expect(result.state.hasDetectedSpeech).toBe(false);
      expect(result.state.spectralLiftQualifiedSampleCount).toBe(0);
      expect(sawStop).toBe(true);
    });

    it("a quiet room's ambient baseline stays at 0, so the lift path never engages -- clear speech confirms exactly as before ROUND 7", () => {
      let state = initVadState(0);
      let result = evaluateVadSample(state, CLEAR_SPEECH, 0);
      state = result.state;
      result = evaluateVadSample(state, CLEAR_SPEECH, 300);
      state = result.state;
      expect(state.hasDetectedSpeech).toBe(true);
      expect(state.ambientSpectralRatioEstimate).toBe(0);
      expect(state.spectralLiftQualifiedSampleCount).toBe(0);
    });

    it("once confirmed, startWindowedCandidate behaves identically to windowedCandidate -- ROUND 6's continuation rule is unaffected by an elevated ambient baseline", () => {
      let state = initVadState(0);
      let t = 0;
      ({ state, t } = buildAmbientBaseline(state, t, 60));
      // Confirm speech the same way the headline test does.
      let result: VadEvaluation = { state, decision: "continue" };
      for (let i = 0; i < 4; i += 1) {
        t += 100;
        result = evaluateVadSample(result.state, SPEECH_OVER_BACKGROUND_NOISE, t);
      }
      state = result.state;
      expect(state.hasDetectedSpeech).toBe(true);
      const lastSpeechAtAfterConfirm = state.lastSpeechAt;

      // A spectral-only continuation sample (ROUND 6) -- must still
      // refresh lastSpeechAt exactly as it does with no background noise
      // present at all (see the ROUND 6 describe block's own tests).
      t += 400; // well past speechEvidenceWindowMs
      result = evaluateVadSample(state, AMPLITUDE_DIP, t);
      expect(result.decision).toBe("continue");
      expect(result.state.lastSpeechAt).toBe(t);
      expect(result.state.lastSpeechAt).not.toBe(lastSpeechAtAfterConfirm);
    });

    it("tracks peakAmbientSpectralRatioEstimate as the highest baseline ever reached, even after it later settles lower", () => {
      // A fixture with a LOWER spectral ratio than MODERATE_BACKGROUND_NOISE
      // (0.25), so switching to it actually pulls the EMA baseline down --
      // unlike SILENCE (ratio 0.3), which is higher and would push it up.
      const quieterAmbient: VadSample = { rmsLevel: 0.001, speechBandRatio: 0.05 };

      let state = initVadState(0);
      let t = 0;
      ({ state, t } = buildAmbientBaseline(state, t, 60));
      // peakAmbientSpectralRatioEstimate is computed from the PRE-update
      // value (same lagged-by-one-sample pattern as peakNoiseFloor) -- the
      // FIRST quieterAmbient sample's own snapshot (taken before ITS
      // update) is exactly the true post-burst peak; a same-type sample
      // would not work here, since it would ALSO push the baseline
      // further up first, leaving the snapshot still one step behind.
      t += 100;
      state = evaluateVadSample(state, quieterAmbient, t).state;
      const peakAfterBurst = state.peakAmbientSpectralRatioEstimate;
      expect(peakAfterBurst).toBeGreaterThan(0);

      // The room stays quieter (lower spectral ratio) -- the baseline
      // itself keeps decaying toward the new, lower ratio, but the peak
      // stays remembered.
      for (let i = 0; i < 40; i += 1) {
        t += 100;
        state = evaluateVadSample(state, quieterAmbient, t).state;
      }
      expect(state.ambientSpectralRatioEstimate).toBeLessThan(peakAfterBurst);
      expect(state.peakAmbientSpectralRatioEstimate).toBe(peakAfterBurst);
    });
  });

  // VAD start-detection hardening, ROUND 8 (2026-08-22): a real production
  // test with INSTRUMENTAL MUSIC AND NO VOICE AT ALL produced a false
  // positive -- START confirmed and stayed "listening" for 6 real
  // seconds. vadSpectralLiftQualifiedSampleCount was 0 (ROUND 7's own
  // lift path is NOT the cause); the STRICT, original absolute spectral
  // gate was satisfied directly (spectralQualifiedSampleCount 51/88,
  // peak ratio 0.89) at an aggregate rate LOWER than the confirmed
  // genuine-speech success (471570b: 72/92) -- aggregate rate statistics
  // cannot discriminate these two cases. See this module's own ROUND 8
  // doc comment for the temporal-continuity hypothesis this diagnostic-
  // only telemetry is designed to test: a held musical note/chord
  // produces ONE long unbroken run of qualifying samples; genuine,
  // phoneme-driven speech is hypothesized to produce MANY short ones.
  // These tests prove the new counters measure this correctly -- they do
  // NOT gate any decision this round (see the final test in this block).
  describe("ROUND 8: run-length telemetry (diagnostic-only, tests the speech-vs-music temporal-continuity hypothesis)", () => {
    // Loud AND spectrally concentrated on EVERY sample, sustained
    // continuously -- a held chord or melodic line staying in the
    // perceptually-salient midrange, exactly as the real production
    // report's peak ratio (0.89) and STT-confirmed voice-free audio imply.
    const SUSTAINED_INSTRUMENTAL_MUSIC: VadSample = { rmsLevel: 0.4, speechBandRatio: 0.75 };

    it("reproduces the production shape: sustained instrumental music produces ONE long, unbroken spectral run", () => {
      let state = initVadState(0);
      let t = 0;
      for (let i = 0; i < 60; i += 1) {
        // 6 seconds, matching the real production report's vadSpeechDurationMs.
        t += 100;
        state = evaluateVadSample(state, SUSTAINED_INSTRUMENTAL_MUSIC, t).state;
      }
      expect(state.hasDetectedSpeech).toBe(true); // unfixed this round -- deliberately, see below
      expect(state.spectralQualifiedRunCount).toBe(1); // one single continuous run
      expect(state.longestSpectralQualifiedRunMs).toBeGreaterThan(5000); // nearly the whole recording
      // No gap-bridging was ever needed -- the gap-TOLERANT streak length
      // and the ZERO-tolerance raw run length are essentially the same,
      // exactly what "one continuous stretch" predicts.
      expect(state.maxCandidateStreakMs).toBeGreaterThan(5000);
    });

    it("genuine phoneme-alternating speech produces MANY short spectral runs, even at a comparable aggregate qualification rate to the music case", () => {
      let state = initVadState(0);
      let t = 0;
      for (let i = 0; i < 20; i += 1) {
        // Alternates a sample that fails spectral (LOUD_BROADBAND_PHONEME)
        // with one that passes it (AMPLITUDE_DIP) -- every qualifying
        // instant is isolated, surrounded by non-qualifying samples on
        // both sides, exactly like real speech's own phoneme-rate
        // volatility (see the ROUND 4 doc comment this fixture pair was
        // originally designed to demonstrate).
        const sample = i % 2 === 0 ? LOUD_BROADBAND_PHONEME : AMPLITUDE_DIP;
        t += 100;
        state = evaluateVadSample(state, sample, t).state;
      }
      // 10 of 20 samples qualify spectrally (50%) -- the same order of
      // magnitude as both the music false positive (58%) and the genuine
      // speech success (78%) -- aggregate rate alone cannot tell this
      // apart from either.
      expect(state.spectralQualifiedSampleCount).toBe(10);
      // But the run-length signature is starkly different from sustained
      // music: every qualifying instant is its own isolated, single-
      // sample run.
      expect(state.spectralQualifiedRunCount).toBe(10);
      expect(state.longestSpectralQualifiedRunMs).toBe(0);
    });

    it("longestFullyQualifiedRunMs/fullyQualifiedRunCount track the same-sample-BOTH-gates signal independently from the spectral-only signal", () => {
      let state = initVadState(0);
      let t = 0;
      // CLEAR_SPEECH passes both gates on the same sample -- three
      // consecutive hits form one unbroken run of 200ms (t=0 to t=200).
      for (let i = 0; i < 3; i += 1) {
        state = evaluateVadSample(state, CLEAR_SPEECH, t).state;
        t += 100;
      }
      expect(state.fullyQualifiedRunCount).toBe(1);
      expect(state.longestFullyQualifiedRunMs).toBe(200);

      // A genuine gap (both gates fail) ends the run.
      state = evaluateVadSample(state, SILENCE, t).state;
      t += 100;
      expect(state.fullyQualifiedRunCount).toBe(1); // unchanged -- no new run started yet

      // A second, SHORTER run starts -- longestFullyQualifiedRunMs must
      // still remember the first, longer one.
      state = evaluateVadSample(state, CLEAR_SPEECH, t).state;
      expect(state.fullyQualifiedRunCount).toBe(2);
      expect(state.longestFullyQualifiedRunMs).toBe(200); // still the first run's length, not overwritten by the shorter second one
    });

    it("this new telemetry does not gate any VAD decision -- the real production music false positive still confirms speech, unfixed, exactly as this round's task required (telemetry-only)", () => {
      const state = initVadState(0);
      let t = 0;
      let result: VadEvaluation = { state, decision: "continue" };
      for (let i = 0; i < 60; i += 1) {
        t += 100;
        result = evaluateVadSample(result.state, SUSTAINED_INSTRUMENTAL_MUSIC, t);
      }
      // Deliberately NOT fixed this round -- see this module's own ROUND
      // 8 doc comment for why implementing a run-length-based decision
      // rule now, without a validated boundary between "a real sustained
      // vowel" and "a held musical note", would be exactly the
      // speculative tuning this round was told not to do.
      expect(result.state.hasDetectedSpeech).toBe(true);
    });
  });
});

// End-of-speech hardening (2026-08-20), Task E: proves the telemetry
// computation itself, independent of the browser-only sampling loop that
// feeds it (use-voice-recording.ts).
describe("computeVoiceActivityDiagnostics", () => {
  // VAD false-negative hardening (2026-08-21 / ROUND 2 2026-08-22 / ROUND
  // 4 2026-08-22 / ROUND 6 2026-08-22): the 17 diagnostic accumulators,
  // always present regardless of the scenario -- a minimal, arbitrary-but-
  // fixed set reused across every test below so each test only needs to
  // override what it's actually asserting on. Every test below that
  // spreads this fixture uses a non-null speechDetectedAt (a confirmed
  // recording), so the ROUND 6 continuation counters pass through
  // unmodified rather than being nulled -- see computeVoiceActivityDiagnostics's
  // own hadConfirmedSpeech branching.
  const DIAGNOSTIC_ACCUMULATORS = {
    peakRms: 0.4,
    peakSpeechBandRatio: 0.6,
    finalNoiseFloor: 0.03,
    maxCandidateSpeechMs: 300,
    candidateResetCount: 1,
    fullyQualifiedSampleCount: 12,
    totalSampleCount: 80,
    amplitudeQualifiedSampleCount: 40,
    spectralQualifiedSampleCount: 20,
    longestCandidateGapMs: 500,
    peakNoiseFloor: 0.035,
    windowedCandidateSampleCount: 18,
    postConfirmationSampleCount: 30,
    continuationQualifiedSampleCount: 22,
    continuationSpectralOnlySampleCount: 6,
    continuationAmplitudeOnlySampleCount: 4,
    longestPostConfirmationGapMs: 400,
    ambientSpectralRatioEstimate: 0.22,
    peakAmbientSpectralRatioEstimate: 0.28,
    spectralLiftQualifiedSampleCount: 5,
    longestSpectralQualifiedRunMs: 350,
    spectralQualifiedRunCount: 7,
    longestFullyQualifiedRunMs: 150,
    fullyQualifiedRunCount: 4,
  };

  it("computes a full breakdown for a normal stop_silence turn", () => {
    const diagnostics = computeVoiceActivityDiagnostics({
      recordingStartedAt: 1000,
      stopDecidedAt: 5500, // recording lasted 4500ms total
      speechDetectedAt: 1300, // speech confirmed 300ms in
      lastSpeechAt: 3500, // last speech-like sample at 2500ms in
      autoStopReason: "stop_silence",
      vadMode: "heuristic-rms-spectral-v1",
      lastWindowedCandidateAt: 4000, // last STRONG (cross-modal) hit at 3000ms in
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
      // 5500 - 4000
      lastStrongEvidenceAgeAtStopMs: 1500,
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
      lastWindowedCandidateAt: null,
      ...DIAGNOSTIC_ACCUMULATORS,
    });
    expect(diagnostics.speechDurationMs).toBeNull();
    expect(diagnostics.speechDetectedAtMs).toBeNull();
    expect(diagnostics.speechEndedAtMs).toBeNull();
    expect(diagnostics.silenceAfterSpeechMs).toBeNull();
    expect(diagnostics.recordingDurationMs).toBe(10000);
    // ROUND 6: no post-confirmation period ever existed on this recording.
    expect(diagnostics.postConfirmationSampleCount).toBeNull();
    expect(diagnostics.continuationQualifiedSampleCount).toBeNull();
    expect(diagnostics.continuationSpectralOnlySampleCount).toBeNull();
    expect(diagnostics.continuationAmplitudeOnlySampleCount).toBeNull();
    expect(diagnostics.longestPostConfirmationGapMs).toBeNull();
  });

  it("only ever populates silenceAfterSpeechMs for stop_silence -- never a number that doesn't mean what its name promises for another reason", () => {
    const diagnostics = computeVoiceActivityDiagnostics({
      recordingStartedAt: 0,
      stopDecidedAt: 60000,
      speechDetectedAt: 300,
      lastSpeechAt: 55000,
      autoStopReason: "stop_max_duration",
      vadMode: "heuristic-rms-spectral-v1",
      lastWindowedCandidateAt: 55000,
      ...DIAGNOSTIC_ACCUMULATORS,
    });
    expect(diagnostics.silenceAfterSpeechMs).toBeNull();
    expect(diagnostics.maxDurationTriggered).toBe(true);
    // ROUND 6: only ever populated for stop_silence, same convention as
    // silenceAfterSpeechMs -- stop_max_duration has no honest claim to make.
    expect(diagnostics.lastStrongEvidenceAgeAtStopMs).toBeNull();
  });

  it("sets maxDurationTriggered true only for stop_max_duration", () => {
    const other = computeVoiceActivityDiagnostics({
      recordingStartedAt: 0,
      stopDecidedAt: 3000,
      speechDetectedAt: 300,
      lastSpeechAt: 1000,
      autoStopReason: "stop_silence",
      vadMode: "heuristic-rms-spectral-v1",
      lastWindowedCandidateAt: 1000,
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
      lastWindowedCandidateAt: 1200,
      ...DIAGNOSTIC_ACCUMULATORS,
    });
    expect(diagnostics.autoStopReason).toBe("manual_stop");
    expect(diagnostics.maxDurationTriggered).toBe(false);
  });

  // VAD false-negative hardening (2026-08-21 / ROUND 2 2026-08-22 / ROUND
  // 4 2026-08-22 / ROUND 6 2026-08-22): passes all 12 pre-ROUND-6
  // diagnostic accumulators straight through, unmodified --
  // computeVoiceActivityDiagnostics never derives or fabricates them
  // itself, only evaluateVadSample does. Uses speechDetectedAt: null
  // deliberately (a stop_no_speech_timeout turn), so the ROUND 6
  // continuation counters are asserted NULL below instead -- see the
  // dedicated "nulls every ROUND 6 continuation field" test for the
  // confirmed-speech, pass-through case (already covered by the first
  // test in this describe block).
  it("passes all 12 pre-ROUND-6 diagnostic accumulators through unmodified", () => {
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
      totalSampleCount: 100,
      amplitudeQualifiedSampleCount: 60,
      spectralQualifiedSampleCount: 15,
      longestCandidateGapMs: 3000,
      peakNoiseFloor: 0.03,
      windowedCandidateSampleCount: 45,
      lastWindowedCandidateAt: 3200,
      postConfirmationSampleCount: 12,
      continuationQualifiedSampleCount: 8,
      continuationSpectralOnlySampleCount: 3,
      continuationAmplitudeOnlySampleCount: 2,
      longestPostConfirmationGapMs: 700,
      ambientSpectralRatioEstimate: 0.2,
      peakAmbientSpectralRatioEstimate: 0.25,
      spectralLiftQualifiedSampleCount: 6,
      longestSpectralQualifiedRunMs: 400,
      spectralQualifiedRunCount: 5,
      longestFullyQualifiedRunMs: 180,
      fullyQualifiedRunCount: 3,
    });
    expect(diagnostics.peakRms).toBe(0.18);
    expect(diagnostics.peakSpeechBandRatio).toBe(0.41);
    expect(diagnostics.finalNoiseFloor).toBe(0.025);
    expect(diagnostics.maxCandidateSpeechMs).toBe(210);
    expect(diagnostics.candidateResetCount).toBe(4);
    expect(diagnostics.fullyQualifiedSampleCount).toBe(9);
    expect(diagnostics.totalSampleCount).toBe(100);
    expect(diagnostics.amplitudeQualifiedSampleCount).toBe(60);
    expect(diagnostics.spectralQualifiedSampleCount).toBe(15);
    expect(diagnostics.longestCandidateGapMs).toBe(3000);
    expect(diagnostics.peakNoiseFloor).toBe(0.03);
    expect(diagnostics.windowedCandidateSampleCount).toBe(45);
    // ROUND 6: speechDetectedAt is null (never confirmed) -- every
    // continuation field must be null here, regardless of the (non-null)
    // raw counters passed in above, since there was no post-confirmation
    // period to describe at all.
    expect(diagnostics.postConfirmationSampleCount).toBeNull();
    expect(diagnostics.continuationQualifiedSampleCount).toBeNull();
    expect(diagnostics.continuationSpectralOnlySampleCount).toBeNull();
    expect(diagnostics.continuationAmplitudeOnlySampleCount).toBeNull();
    expect(diagnostics.longestPostConfirmationGapMs).toBeNull();
    // ROUND 7: unlike the continuation counters, these are NOT gated on
    // hadConfirmedSpeech -- the ambient spectral baseline is meaningful
    // even on a recording that never confirmed speech at all (e.g. it
    // shows whether the lift path ever had a chance to engage).
    expect(diagnostics.ambientSpectralRatioEstimate).toBe(0.2);
    expect(diagnostics.peakAmbientSpectralRatioEstimate).toBe(0.25);
    expect(diagnostics.spectralLiftQualifiedSampleCount).toBe(6);
    // ROUND 8: also NOT gated on hadConfirmedSpeech -- diagnostic-only,
    // pass-through unconditionally, same as the ROUND 7 fields above.
    expect(diagnostics.longestSpectralQualifiedRunMs).toBe(400);
    expect(diagnostics.spectralQualifiedRunCount).toBe(5);
    expect(diagnostics.longestFullyQualifiedRunMs).toBe(180);
    expect(diagnostics.fullyQualifiedRunCount).toBe(3);
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
      totalSampleCount: afterGap.state.totalSampleCount,
      amplitudeQualifiedSampleCount: afterGap.state.amplitudeQualifiedSampleCount,
      spectralQualifiedSampleCount: afterGap.state.spectralQualifiedSampleCount,
      longestCandidateGapMs: afterGap.state.longestCandidateGapMs,
      peakNoiseFloor: afterGap.state.peakNoiseFloor,
      windowedCandidateSampleCount: afterGap.state.windowedCandidateSampleCount,
      lastWindowedCandidateAt: afterGap.state.lastWindowedCandidateAt,
      postConfirmationSampleCount: afterGap.state.postConfirmationSampleCount,
      continuationQualifiedSampleCount: afterGap.state.continuationQualifiedSampleCount,
      continuationSpectralOnlySampleCount: afterGap.state.continuationSpectralOnlySampleCount,
      continuationAmplitudeOnlySampleCount: afterGap.state.continuationAmplitudeOnlySampleCount,
      longestPostConfirmationGapMs: afterGap.state.longestPostConfirmationGapMs,
      ambientSpectralRatioEstimate: afterGap.state.ambientSpectralRatioEstimate,
      peakAmbientSpectralRatioEstimate: afterGap.state.peakAmbientSpectralRatioEstimate,
      spectralLiftQualifiedSampleCount: afterGap.state.spectralLiftQualifiedSampleCount,
      longestSpectralQualifiedRunMs: afterGap.state.longestSpectralQualifiedRunMs,
      spectralQualifiedRunCount: afterGap.state.spectralQualifiedRunCount,
      longestFullyQualifiedRunMs: afterGap.state.longestFullyQualifiedRunMs,
      fullyQualifiedRunCount: afterGap.state.fullyQualifiedRunCount,
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
      amplitudeQualifiedSampleCount: 0,
      spectralQualifiedSampleCount: 0,
      totalSampleCount: 0,
      longestCandidateGapMs: 0,
      peakNoiseFloor: 0,
      lastAmplitudeQualifiedAt: null,
      lastSpectralQualifiedAt: null,
      windowedCandidateSampleCount: 0,
      lastWindowedCandidateAt: null,
      postConfirmationSampleCount: 0,
      continuationQualifiedSampleCount: 0,
      continuationSpectralOnlySampleCount: 0,
      continuationAmplitudeOnlySampleCount: 0,
      longestPostConfirmationGapMs: 0,
      ambientSpectralRatioEstimate: 0,
      peakAmbientSpectralRatioEstimate: 0,
      lastSpectralQualifiedAtForStart: null,
      spectralLiftQualifiedSampleCount: 0,
      spectralRunStartedAt: null,
      longestSpectralQualifiedRunMs: 0,
      spectralQualifiedRunCount: 0,
      fullyQualifiedRunStartedAt: null,
      longestFullyQualifiedRunMs: 0,
      fullyQualifiedRunCount: 0,
    });
  });
});
