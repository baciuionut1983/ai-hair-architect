// VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: pure,
// browser-free logic for running Silero VAD v5's ONNX model as a
// stateful/recurrent classifier and accumulating diagnostic statistics
// from its output -- split from silero-vad-shadow-runtime.ts (the
// ONNX-session/AudioWorklet-touching glue) the exact same way
// voice-activity-logic.ts is split from use-voice-recording.ts elsewhere
// in this codebase: everything here is pure functions over plain
// numbers/typed arrays, unit-testable without a browser.
//
// STRICT SHADOW MODE (per this round's own task): nothing in this file,
// or the runtime module built on top of it, is ever consulted by
// evaluateVadSample/the existing heuristic decision path -- there is no
// import in either direction between this file and voice-activity-logic.ts.
// This module only ever PRODUCES diagnostic numbers for telemetry; it
// never returns a "should stop" or "is speech" decision the caller could
// mistakenly wire into production behavior.
//
// Model contract (verified directly from the OFFICIAL reference
// implementation -- github.com/snakers4/silero-vad,
// src/silero_vad/utils_vad.py's OnnxWrapper class -- not assumed or
// reconstructed from memory, since a wrong contract here would silently
// degrade the very probability distributions this round exists to
// measure honestly):
//   - The model is STATEFUL: a [2, 1, 128] float32 LSTM-style state
//     tensor is carried across calls, replaced wholesale by the model's
//     own output state each time (never accumulated/merged).
//   - A 64-sample "context" buffer (the tail of the PREVIOUS call's
//     input) is prepended to each new 512-sample frame before inference,
//     for 16kHz audio -- so the ONNX session's own 'input' tensor is
//     actually [1, 576] (64 context + 512 new samples), not [1, 512].
//   - Session inputs: 'input' (float32 [1, 576]), 'state' (float32
//     [2, 1, 128]), 'sr' (int64 scalar, 16000).
//   - Session outputs: a scalar speech probability, and the next [2, 1,
//     128] state tensor.
//   - No normalization: raw Float32 samples in the Web Audio API's own
//     native [-1, 1] range are fed directly, unmodified.
//   - Reset semantics: zero both the state and the context at the start
//     of every new recording -- carrying state across DIFFERENT
//     recordings would let one utterance's recurrent context leak into
//     an unrelated later one.

export const SILERO_SAMPLE_RATE_HZ = 16000;
// 32ms at 16kHz -- the exact new-audio chunk size the official reference
// implementation requires per call (raises ValueError on any other size).
export const SILERO_FRAME_SAMPLES = 512;
// The trailing-context carry-over size for 16kHz audio specifically (32
// samples for 8kHz, per the reference implementation -- this app only
// ever uses 16kHz, so only that constant is defined here).
export const SILERO_CONTEXT_SAMPLES = 64;
// [2, 1, 128] flattened -- batch size is always 1 here (a single mic
// stream), never a real batching dimension.
export const SILERO_STATE_LENGTH = 2 * 1 * 128;
// Silero's own documented default ("lazy 0.5 is pretty good for most
// datasets", per the reference VADIterator's own docstring) -- used ONLY
// to count how many frames this shadow mode would have classified as
// speech, for diagnostic telemetry. Never gates any real decision (see
// this module's own doc comment above).
export const SILERO_DIAGNOSTIC_SPEECH_THRESHOLD = 0.5;

export interface SileroRecurrentState {
  // Flattened [2, 1, 128] float32 state tensor data.
  state: Float32Array;
  // The trailing SILERO_CONTEXT_SAMPLES of the previous call's model
  // input, prepended to the next frame -- see this module's own doc
  // comment on the model contract.
  context: Float32Array;
}

// Mirrors the reference implementation's own reset_states() exactly:
// zeroed state AND zeroed context together, since both describe the
// SAME notion of "a fresh, unrelated audio stream is starting now".
export function createSileroRecurrentState(): SileroRecurrentState {
  return {
    state: new Float32Array(SILERO_STATE_LENGTH),
    context: new Float32Array(SILERO_CONTEXT_SAMPLES),
  };
}

// Builds the actual ONNX session 'input' tensor data: the carried
// context, THEN the new frame -- concatenated, per the model's own
// contract (see this module's own doc comment). Throws on a
// wrongly-sized frame rather than silently padding/truncating -- a
// framing bug here must fail loudly (caught by the runtime glue's own
// try/catch, surfaced as vadModelError), never silently corrupt the
// probability distribution this round exists to measure honestly.
export function buildSileroModelInput(recurrent: SileroRecurrentState, frame: Float32Array): Float32Array {
  if (frame.length !== SILERO_FRAME_SAMPLES) {
    throw new Error(`Silero VAD frame must be exactly ${SILERO_FRAME_SAMPLES} samples, got ${frame.length}.`);
  }
  const combined = new Float32Array(SILERO_CONTEXT_SAMPLES + SILERO_FRAME_SAMPLES);
  combined.set(recurrent.context, 0);
  combined.set(frame, SILERO_CONTEXT_SAMPLES);
  return combined;
}

// Advances the recurrent state after a successful inference call: the
// model's own output state tensor REPLACES the old one wholesale (never
// merged -- matching the reference implementation exactly), and the new
// context is the trailing SILERO_CONTEXT_SAMPLES of the input tensor
// that was JUST fed to the model (which is the tail of the current
// frame, since context+frame together is what was fed).
export function advanceSileroRecurrentState(modelInput: Float32Array, outputStateData: Float32Array): SileroRecurrentState {
  if (outputStateData.length !== SILERO_STATE_LENGTH) {
    throw new Error(`Silero VAD output state must be exactly ${SILERO_STATE_LENGTH} floats, got ${outputStateData.length}.`);
  }
  return {
    state: outputStateData,
    context: modelInput.slice(modelInput.length - SILERO_CONTEXT_SAMPLES),
  };
}

// VAD Round 10, Phase A diagnostic accumulator -- deliberately mirrors
// the established style of voice-activity-logic.ts's own diagnostic
// accumulators (immutable update functions returning a new state, never
// a mutated class instance) for consistency with the rest of this
// codebase's VAD-adjacent modules, even though this one is otherwise
// fully independent of voice-activity-logic.ts.
export interface SileroShadowDiagnosticsState {
  totalSampleCount: number;
  speechQualifiedSampleCount: number;
  peakSpeechProbability: number;
  probabilitySum: number;
  probabilitySumSquares: number;
  peakInferenceMs: number;
  inferenceMsSum: number;
  // Distinct from totalSampleCount: how many inference attempts FAILED
  // (threw) rather than producing a probability at all -- never fabricated
  // into a probability of 0, which would be a false "confidently not
  // speech" reading rather than an honest "the model could not be run".
  errorCount: number;
  lastError: string | null;
}

export function initSileroShadowDiagnostics(): SileroShadowDiagnosticsState {
  return {
    totalSampleCount: 0,
    speechQualifiedSampleCount: 0,
    peakSpeechProbability: 0,
    probabilitySum: 0,
    probabilitySumSquares: 0,
    peakInferenceMs: 0,
    inferenceMsSum: 0,
    errorCount: 0,
    lastError: null,
  };
}

// Records one successful frame's inference result. `probability` is
// expected in [0, 1] (Silero's own output range) -- not clamped or
// validated here, since a genuinely out-of-range value from a real model
// run would itself be diagnostically interesting (a sign something is
// wrong with the model/session), not something to silently normalize away.
export function recordSileroFrameResult(
  state: SileroShadowDiagnosticsState,
  probability: number,
  inferenceMs: number,
): SileroShadowDiagnosticsState {
  return {
    ...state,
    totalSampleCount: state.totalSampleCount + 1,
    speechQualifiedSampleCount:
      probability >= SILERO_DIAGNOSTIC_SPEECH_THRESHOLD ? state.speechQualifiedSampleCount + 1 : state.speechQualifiedSampleCount,
    peakSpeechProbability: Math.max(state.peakSpeechProbability, probability),
    probabilitySum: state.probabilitySum + probability,
    probabilitySumSquares: state.probabilitySumSquares + probability * probability,
    peakInferenceMs: Math.max(state.peakInferenceMs, inferenceMs),
    inferenceMsSum: state.inferenceMsSum + inferenceMs,
  };
}

// Records a failed inference attempt -- never touches any of the
// probability/timing accumulators above, so a run of errors can never be
// misread as "the model confidently heard silence". `errorMessage` is
// bounded (see the runtime glue's own sanitization) before it ever
// reaches telemetry, matching this app's existing convention for other
// provider-error fields (see voice-latency-telemetry-logic.ts).
export function recordSileroFrameError(state: SileroShadowDiagnosticsState, errorMessage: string): SileroShadowDiagnosticsState {
  return {
    ...state,
    errorCount: state.errorCount + 1,
    lastError: errorMessage,
  };
}

export interface SileroShadowSummary {
  totalSampleCount: number;
  speechQualifiedSampleCount: number;
  peakSpeechProbability: number;
  meanSpeechProbability: number | null;
  // Diagnostic-only additional field (this round's task explicitly
  // allows 1-3 extra fields to help compare music vs speech): real
  // speech is hypothesized to show HIGH frame-to-frame probability
  // variance (phoneme-rate volatility, the same acoustic-phonetics
  // reasoning behind this whole VAD saga's own run-length findings),
  // while a sustained musical tone may show LOW variance (steadily
  // high or steadily low) even at a similar mean -- exactly the
  // dimension a bare peak/mean pair cannot see. Never used to gate
  // anything; purely descriptive.
  speechProbabilityStdDev: number | null;
  peakInferenceMs: number;
  meanInferenceMs: number | null;
  errorCount: number;
  lastError: string | null;
}

// Never fabricates a mean/stddev from zero samples (null, not 0 or NaN)
// -- matches this codebase's own established "0 is a truthful measured
// value, never a placeholder for absent data" convention (see
// voice-activity-logic.ts's own VoiceActivityDiagnostics doc comments).
export function summarizeSileroShadowDiagnostics(state: SileroShadowDiagnosticsState): SileroShadowSummary {
  const hasSamples = state.totalSampleCount > 0;
  const meanSpeechProbability = hasSamples ? state.probabilitySum / state.totalSampleCount : null;
  const variance =
    hasSamples && meanSpeechProbability !== null
      ? Math.max(0, state.probabilitySumSquares / state.totalSampleCount - meanSpeechProbability * meanSpeechProbability)
      : null;
  return {
    totalSampleCount: state.totalSampleCount,
    speechQualifiedSampleCount: state.speechQualifiedSampleCount,
    peakSpeechProbability: state.peakSpeechProbability,
    meanSpeechProbability,
    speechProbabilityStdDev: variance !== null ? Math.sqrt(variance) : null,
    peakInferenceMs: state.peakInferenceMs,
    meanInferenceMs: hasSamples ? state.inferenceMsSum / state.totalSampleCount : null,
    errorCount: state.errorCount,
    lastError: state.lastError,
  };
}
