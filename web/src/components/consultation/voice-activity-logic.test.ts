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

    // Honest, PRE-EXISTING limitation (not introduced by ROUND 4, and not
    // fixed by it either -- a property of the noise-floor mechanism from
    // 803c538, left unchanged this round per that round's own Phase B
    // reasoning): a SINGLE, endlessly-repeated non-spectral loudness value
    // will always eventually self-defeat its own amplitude qualification,
    // once the floor's EMA (rate 0.05, margin 1.6) converges close enough
    // to that same value -- true regardless of the value's magnitude,
    // since the crossover point is a function of noiseFloorMargin/
    // noiseFloorAdaptRate alone, not the specific level. Real speech's own
    // natural variety (rarely repeating the exact same acoustic shape 20+
    // times uninterrupted) makes this a low-probability edge case in
    // practice, not eliminated in theory. Documented here, not silently
    // avoided, so a future round has this written down rather than
    // rediscovering it from a production report.
    it("KNOWN LIMITATION (pre-existing, not fixed this round): an endlessly-repeated single non-spectral loudness value eventually self-defeats its own amplitude gate", () => {
      let state = initVadState(0);
      let t = 0;
      for (let i = 0; i < 45; i += 1) {
        const sample = i % 2 === 0 ? LOUD_BROADBAND_PHONEME : AMPLITUDE_DIP;
        state = evaluateVadSample(state, sample, t).state;
        t += 100;
      }
      // The floor has chased LOUD_BROADBAND_PHONEME's own fixed loudness
      // upward far enough that IT no longer clears its own amplitude gate.
      const amplitudeFloorNow = Math.max(DEFAULT_VAD_CONFIG.minAbsoluteLevel, state.noiseFloorEstimate * DEFAULT_VAD_CONFIG.noiseFloorMargin);
      expect(amplitudeFloorNow).toBeGreaterThan(LOUD_BROADBAND_PHONEME.rmsLevel);
    });
  });
});

// End-of-speech hardening (2026-08-20), Task E: proves the telemetry
// computation itself, independent of the browser-only sampling loop that
// feeds it (use-voice-recording.ts).
describe("computeVoiceActivityDiagnostics", () => {
  // VAD false-negative hardening (2026-08-21 / ROUND 2 2026-08-22 / ROUND
  // 4 2026-08-22): the 12 diagnostic accumulators, always present
  // regardless of the scenario -- a minimal, arbitrary-but-fixed set
  // reused across every test below so each test only needs to override
  // what it's actually asserting on.
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

  // VAD false-negative hardening (2026-08-21 / ROUND 2 2026-08-22 / ROUND
  // 4 2026-08-22): passes all 12 diagnostic accumulators straight through,
  // unmodified -- computeVoiceActivityDiagnostics never derives or
  // fabricates them itself, only evaluateVadSample does.
  it("passes all 12 diagnostic accumulators through unmodified", () => {
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
    });
  });
});
