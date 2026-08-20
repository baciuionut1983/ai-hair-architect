// Pure, browser-free decision logic for the chat composer mic's
// auto-stop-on-silence behaviour ("apas microfonul -> vorbesc -> dupa ~2
// secunde de liniste -> recording-ul se opreste automat"). Deliberately
// NOT a fixed "setTimeout 2 seconds after start" -- that would cut the
// stylist off mid-sentence on any pause. Instead, every sample loud enough
// to count as speech pushes the silence window forward, so only silence
// that comes AFTER speech was actually heard, and lasts long enough on its
// own, triggers a stop.
//
// End-of-speech hardening (2026-08-20): a real production report proved
// this file's ORIGINAL classifier -- "loud enough" (a bare RMS-amplitude
// threshold) counts as speech -- has no way to distinguish a stylist's
// voice from sustained ambient background music. In that report, the
// music stayed above the amplitude threshold continuously, so lastSpeechAt
// was pushed forward every single sample and stop_silence could never
// fire -- "Ascult..." stayed on screen indefinitely, exactly as reported.
// This was demonstrated by reading the code, not assumed: the OLD
// evaluateVadSample took a single scalar `level` and compared it only to
// `speechLevelThreshold` -- amplitude alone, nothing else.
//
// The fix adds two more signals no single loudness threshold can provide,
// using only what the existing AnalyserNode (already in use, see
// use-voice-recording.ts) can compute -- no new dependency:
//
// 1. Speech-band spectral ratio: real voiced speech concentrates the large
//    majority of its energy in roughly 300-3400 Hz (the standard telephony
//    band covering fundamental + the first few formants for most voices).
//    Sustained ambient sources this product's own salon environment
//    actually contains -- music (bass/treble-heavy), a hair dryer
//    (broadband/high-frequency noise), general room hum -- typically do
//    NOT concentrate energy there the way a voice does. A sample must
//    clear BOTH an amplitude gate AND a speech-band-ratio gate to count as
//    a speech candidate.
// 2. Adaptive noise floor: rather than one fixed absolute amplitude
//    threshold (which a sufficiently loud room permanently sits above),
//    the amplitude gate is `max(minAbsoluteLevel, noiseFloorEstimate *
//    noiseFloorMargin)` -- an exponential moving average of the recently
//    observed AMBIENT (non-speech-candidate) level, updated only from
//    samples that fail the speech-candidate test, so the stylist's own
//    voice can never drag the floor upward mid-sentence.
//
// Also added: a minimum sustained-speech duration (minSpeechDurationMs)
// before a speech candidate is actually confirmed as "the stylist has
// started speaking" -- filters a single loud transient (a knock, a music
// swell) from falsely opening the speech window -- and an unconditional
// maxRecordingDurationMs safety cap, since a repo-wide audit found NO
// existing upper bound on recording duration at all: if the classifier is
// ever fooled indefinitely, nothing before this stopped the mic short of
// a manual Stop click.
//
// Known, honest limitation (not solved by this heuristic, or by any
// single-microphone amplitude/spectral heuristic): a NEARBY PERSON TALKING
// has the same spectral signature as the stylist's own voice -- there is
// no way for this classifier to tell the two apart. This round targets
// non-speech ambient noise (music, hair dryers, machine hum), the
// specific, demonstrated production failure -- not background
// conversations. See this round's report for why a dedicated speaker
// separation/diarization solution is out of scope here.

export interface VadConfig {
  // Absolute floor beneath which nothing ever counts as speech, regardless
  // of the adaptive noise floor -- prevents a near-silent room's own
  // adaptive floor from drifting toward zero and becoming hypersensitive
  // to any tiny sound. A rough, commonly-cited starting point for mic
  // input on a typical laptop/headset -- expect this to need live tuning,
  // so it's a named, overridable config value, never a magic number
  // inlined at the call site.
  minAbsoluteLevel: number;
  // A sample's RMS level must be at least this many times the current
  // adaptive noise floor estimate to be a speech candidate on the
  // amplitude axis. Needs live tuning against real salon recordings.
  noiseFloorMargin: number;
  // How much weight each new AMBIENT (non-speech-candidate) sample gets in
  // the exponential moving average that tracks the noise floor -- small,
  // so the floor tracks genuinely SUSTAINED ambient levels (music, a hair
  // dryer left running) rather than reacting to every brief fluctuation.
  noiseFloorAdaptRate: number;
  // Minimum fraction (0..1) of a sample's total spectral energy that must
  // fall within the speech band (see module comment: ~300-3400 Hz) for it
  // to count as a speech candidate. The second, independent gate --
  // amplitude alone is never sufficient.
  minSpeechBandRatio: number;
  // A speech candidate must sustain for at least this long, continuously,
  // before hasDetectedSpeech actually flips true -- filters a single loud
  // transient from opening the speech window.
  minSpeechDurationMs: number;
  // How long a silence must persist AFTER speech was confirmed before
  // auto-stopping -- "aproximativ 2 secunde de liniste dupa ce s-a detectat
  // vorbire", not from recording start.
  silenceDurationMs: number;
  // Safety net: if NO speech is ever confirmed at all (silence, or
  // non-speech ambient noise, the whole time -- dead mic, wrong input
  // device, stylist changed their mind), stop anyway after this long from
  // recording start.
  noSpeechTimeoutMs: number;
  // Unconditional safety cap, independent of speech state entirely: if
  // nothing else has stopped the recording by this point, stop anyway. The
  // last line of defense against a classifier that's somehow still fooled.
  maxRecordingDurationMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  minAbsoluteLevel: 0.02,
  noiseFloorMargin: 1.6,
  noiseFloorAdaptRate: 0.05,
  minSpeechBandRatio: 0.45,
  minSpeechDurationMs: 250,
  silenceDurationMs: 2000,
  noSpeechTimeoutMs: 10000,
  maxRecordingDurationMs: 60000,
};

// One fresh audio-level sample. Both fields are computed browser-side from
// the SAME AnalyserNode already in use (use-voice-recording.ts) -- rmsLevel
// from time-domain byte data (unchanged from before this round),
// speechBandRatio newly from frequency-domain byte data. Kept as two plain
// numbers (not raw Uint8Arrays) so this stays a pure, browser-free module.
export interface VadSample {
  rmsLevel: number;
  speechBandRatio: number;
}

export interface VadState {
  hasDetectedSpeech: boolean;
  // Timestamp (same clock as the `now` passed to evaluateVadSample -- e.g.
  // performance.now()) of the most recent sample that counted as a
  // (confirmed-or-candidate) speech sample.
  lastSpeechAt: number | null;
  recordingStartedAt: number;
  // Exponential moving average of the ambient (non-speech-candidate)
  // level -- see noiseFloorAdaptRate. Starts at 0; minAbsoluteLevel alone
  // protects the first samples before any real estimate has formed.
  noiseFloorEstimate: number;
  // When the CURRENT unbroken streak of speech-candidate samples began --
  // null whenever the most recent sample was not a candidate. Used to
  // measure minSpeechDurationMs.
  speechStreakStartedAt: number | null;
}

export function initVadState(recordingStartedAt: number): VadState {
  return {
    hasDetectedSpeech: false,
    lastSpeechAt: null,
    recordingStartedAt,
    noiseFloorEstimate: 0,
    speechStreakStartedAt: null,
  };
}

export type VadDecision = "continue" | "stop_silence" | "stop_no_speech_timeout" | "stop_max_duration";

export interface VadEvaluation {
  state: VadState;
  decision: VadDecision;
}

function isSpeechCandidate(sample: VadSample, noiseFloorEstimate: number, config: VadConfig): boolean {
  const amplitudeFloor = Math.max(config.minAbsoluteLevel, noiseFloorEstimate * config.noiseFloorMargin);
  return sample.rmsLevel >= amplitudeFloor && sample.speechBandRatio >= config.minSpeechBandRatio;
}

// Feed one fresh audio-level sample in. Returns the updated state (thread
// this back in as `state` on the next call) and what the caller should do.
// A short pause between words never trips stop_silence: any speech-
// candidate sample immediately pushes lastSpeechAt forward, restarting the
// silenceDurationMs countdown from scratch.
export function evaluateVadSample(
  state: VadState,
  sample: VadSample,
  now: number,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): VadEvaluation {
  // Checked first, unconditionally -- independent of speech state, so
  // nothing that fools the classifier below can ever keep the mic open
  // past this.
  if (now - state.recordingStartedAt >= config.maxRecordingDurationMs) {
    return { state, decision: "stop_max_duration" };
  }

  const candidate = isSpeechCandidate(sample, state.noiseFloorEstimate, config);

  // The noise floor only ever learns from samples that did NOT look like
  // speech -- otherwise the stylist's own voice would drag the floor
  // upward mid-sentence, making the back half of a sentence harder to
  // detect than the front half.
  const noiseFloorEstimate = candidate
    ? state.noiseFloorEstimate
    : state.noiseFloorEstimate * (1 - config.noiseFloorAdaptRate) + sample.rmsLevel * config.noiseFloorAdaptRate;

  if (!candidate) {
    if (state.hasDetectedSpeech) {
      const silenceDuration = now - (state.lastSpeechAt ?? now);
      const nextState: VadState = { ...state, noiseFloorEstimate, speechStreakStartedAt: null };
      if (silenceDuration >= config.silenceDurationMs) {
        return { state: nextState, decision: "stop_silence" };
      }
      return { state: nextState, decision: "continue" };
    }
    // Never confirmed speech yet, and this sample doesn't extend an
    // in-progress candidate streak either -- a brief loud blip that failed
    // to sustain resets cleanly, it never partially counts.
    const elapsedSinceStart = now - state.recordingStartedAt;
    const nextState: VadState = { ...state, noiseFloorEstimate, speechStreakStartedAt: null };
    if (elapsedSinceStart >= config.noSpeechTimeoutMs) {
      return { state: nextState, decision: "stop_no_speech_timeout" };
    }
    return { state: nextState, decision: "continue" };
  }

  // This sample IS a speech candidate on both axes.
  const speechStreakStartedAt = state.speechStreakStartedAt ?? now;
  const streakDuration = now - speechStreakStartedAt;
  const hasDetectedSpeech = state.hasDetectedSpeech || streakDuration >= config.minSpeechDurationMs;

  return {
    state: { ...state, noiseFloorEstimate, speechStreakStartedAt, hasDetectedSpeech, lastSpeechAt: now },
    decision: "continue",
  };
}

// The auto-submit gate: after a recording ends (whether by VAD auto-stop
// or a manual Stop click) and finishes transcribing, this is the ONLY
// thing that decides whether to fire off the chat send -- a transcription
// FAILURE never reaches this function at all (finishRecording's onFailure
// path is structurally separate from onSuccess, see
// teach-ai-panel-logic.ts), and an empty/whitespace-only transcript
// (should the backend ever somehow return one) is explicitly rejected
// here too, so "STT eșuează -> zero submit" and "transcript gol -> zero
// submit" both hold by construction, not by convention.
export function shouldAutoSubmitTranscript(transcript: string | null | undefined): boolean {
  return typeof transcript === "string" && transcript.trim().length > 0;
}

// End-of-speech hardening (2026-08-20), Task E: telemetry sufficient to
// later see WHY a recording ended, without ever storing raw audio or
// conversation content. `manual_stop` is not a VadDecision (evaluateVadSample
// never produces it) -- it is recorded separately, by the caller, the
// moment a manual Stop click wins the race against VAD's own interval.
export type VoiceActivityAutoStopReason = VadDecision | "manual_stop";

export interface VoiceActivityDiagnostics {
  autoStopReason: VoiceActivityAutoStopReason | null;
  recordingDurationMs: number | null;
  // The span from the moment speech was first CONFIRMED (see
  // minSpeechDurationMs) to the last sample that still counted as speech --
  // an approximation of "how long the stylist was actually talking", not a
  // frame-perfect measurement. Null whenever speech was never confirmed at
  // all (e.g. stop_no_speech_timeout, or music-only per this round's fix).
  speechDurationMs: number | null;
  // Only ever populated for autoStopReason === "stop_silence" -- for every
  // other reason this app has no honest claim about "silence after
  // speech" to make, so it stays null rather than reporting a number that
  // doesn't mean what its name promises.
  silenceAfterSpeechMs: number | null;
  // Offsets from recording start (never an absolute wall-clock timestamp,
  // matching this app's existing telemetry privacy convention) -- lets an
  // operator reconstruct the shape of a turn (how long before speech
  // started, how long it lasted) without ever knowing what was actually said.
  speechDetectedAtMs: number | null;
  speechEndedAtMs: number | null;
  maxDurationTriggered: boolean;
  // Identifies which VAD algorithm version produced this report -- see
  // use-voice-recording.ts's own VAD_MODE constant.
  vadMode: string;
}

export function computeVoiceActivityDiagnostics(params: {
  recordingStartedAt: number;
  stopDecidedAt: number;
  speechDetectedAt: number | null;
  lastSpeechAt: number | null;
  autoStopReason: VoiceActivityAutoStopReason | null;
  vadMode: string;
}): VoiceActivityDiagnostics {
  const speechDetectedAtMs =
    params.speechDetectedAt !== null ? Math.max(0, Math.round(params.speechDetectedAt - params.recordingStartedAt)) : null;
  const speechEndedAtMs =
    params.lastSpeechAt !== null ? Math.max(0, Math.round(params.lastSpeechAt - params.recordingStartedAt)) : null;
  return {
    autoStopReason: params.autoStopReason,
    recordingDurationMs: Math.max(0, Math.round(params.stopDecidedAt - params.recordingStartedAt)),
    speechDurationMs:
      speechDetectedAtMs !== null && speechEndedAtMs !== null ? Math.max(0, speechEndedAtMs - speechDetectedAtMs) : null,
    silenceAfterSpeechMs:
      params.autoStopReason === "stop_silence" && params.lastSpeechAt !== null
        ? Math.max(0, Math.round(params.stopDecidedAt - params.lastSpeechAt))
        : null,
    speechDetectedAtMs,
    speechEndedAtMs,
    maxDurationTriggered: params.autoStopReason === "stop_max_duration",
    vadMode: params.vadMode,
  };
}
