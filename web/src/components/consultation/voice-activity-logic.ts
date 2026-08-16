// Pure, browser-free decision logic for the chat composer mic's
// auto-stop-on-silence behaviour ("apas microfonul -> vorbesc -> dupa ~2
// secunde de liniste -> recording-ul se opreste automat"). Deliberately
// NOT a fixed "setTimeout 2 seconds after start" -- that would cut the
// stylist off mid-sentence on any pause. Instead, every sample loud enough
// to count as speech pushes the silence window forward, so only silence
// that comes AFTER speech was actually heard, and lasts long enough on its
// own, triggers a stop. A confirmed repo-wide audit found no existing
// VAD/audio-level utility anywhere in this codebase (only the unrelated
// getUserMedia/MediaRecorder capture in teach-ai-panel-logic.ts and
// use-voice-recording.ts) -- this is genuinely new, not a duplicate.
//
// The actual audio-level SAMPLING (Web Audio API's AnalyserNode) is
// necessarily real-browser-only glue code and lives in
// use-voice-recording.ts, which feeds its samples through
// evaluateVadSample below -- keeping the only decision that actually needs
// to be "right" (when to stop) fully unit-testable without a browser.

export interface VadConfig {
  // Normalized RMS level (0..1) at/above which a sample counts as speech.
  // A rough, commonly-cited starting point for mic input on a typical
  // laptop/headset -- expect this to need live tuning per the user's own
  // request ("pragul trebuie sa fie rezonabil si testabil"), so it's a
  // named, overridable config value, never a magic number inlined at the
  // call site.
  speechLevelThreshold: number;
  // How long a silence must persist AFTER speech was first detected before
  // auto-stopping -- "aproximativ 2 secunde de liniste dupa ce s-a detectat
  // vorbire", not from recording start.
  silenceDurationMs: number;
  // Safety net: if NO speech is ever detected at all (silence the whole
  // time -- dead mic, wrong input device, stylist changed their mind),
  // stop anyway after this long from recording start, so the mic can never
  // be left open indefinitely.
  noSpeechTimeoutMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  speechLevelThreshold: 0.02,
  silenceDurationMs: 2000,
  noSpeechTimeoutMs: 10000,
};

export interface VadState {
  hasDetectedSpeech: boolean;
  // Timestamp (same clock as the `now` passed to evaluateVadSample -- e.g.
  // performance.now()) of the most recent sample that counted as speech.
  lastSpeechAt: number | null;
  recordingStartedAt: number;
}

export function initVadState(recordingStartedAt: number): VadState {
  return { hasDetectedSpeech: false, lastSpeechAt: null, recordingStartedAt };
}

export type VadDecision = "continue" | "stop_silence" | "stop_no_speech_timeout";

export interface VadEvaluation {
  state: VadState;
  decision: VadDecision;
}

// Feed one fresh audio-level sample in. Returns the updated state (thread
// this back in as `state` on the next call) and what the caller should do.
// A short pause between words never trips stop_silence: any sample at/above
// the threshold immediately pushes lastSpeechAt forward, restarting the
// silenceDurationMs countdown from scratch.
export function evaluateVadSample(
  state: VadState,
  level: number,
  now: number,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): VadEvaluation {
  const isSpeech = level >= config.speechLevelThreshold;
  const nextState: VadState = isSpeech ? { ...state, hasDetectedSpeech: true, lastSpeechAt: now } : state;

  if (!nextState.hasDetectedSpeech) {
    const elapsedSinceStart = now - nextState.recordingStartedAt;
    if (elapsedSinceStart >= config.noSpeechTimeoutMs) {
      return { state: nextState, decision: "stop_no_speech_timeout" };
    }
    return { state: nextState, decision: "continue" };
  }

  const silenceDuration = now - (nextState.lastSpeechAt ?? now);
  if (silenceDuration >= config.silenceDurationMs) {
    return { state: nextState, decision: "stop_silence" };
  }
  return { state: nextState, decision: "continue" };
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
