"use client";

// VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: the ONLY file
// in this feature that touches onnxruntime-web, the Web Audio API, or the
// shared MediaStream -- everything else (silero-vad-shadow-logic.ts) is
// pure and unit-tested. This file is deliberately NOT unit-tested itself
// (same established convention as use-voice-recording.ts's own
// AudioContext/AnalyserNode glue -- see that file's own doc comments):
// jsdom has no real Web Audio, AudioWorklet, or WASM instantiation, so
// any test here would only prove a mock was called, not that this code
// works in a real browser. Real verification happens in production, per
// this round's own report.
//
// STRICT SHADOW MODE (this round's own explicit requirement): this module
// NEVER calls anything that could affect the real recording --
// specifically:
//   - It never calls getUserMedia itself; it only ever receives an
//     ALREADY-ACQUIRED MediaStream from the caller (use-voice-recording.ts's
//     own `stream`, the SAME one MediaRecorder is using).
//   - It only ever calls `audioContext.createMediaStreamSource(stream)`
//     on that stream -- a READ-ONLY tap, per the Web Audio API's own
//     spec: creating a MediaStreamAudioSourceNode does not take ownership
//     of the stream and never stops its tracks, regardless of what
//     happens to the AudioContext it belongs to.
//   - It is built on this EXACT stream-safety finding (verified directly
//     from ricky0123/vad's own source, not assumed): @ricky0123/vad-web's
//     MicVAD class was evaluated and REJECTED for this reason --
//     MicVAD.pause()/destroy() call a default `pauseStream` that invokes
//     `track.stop()` on whatever stream `getStream()` returned, and the
//     library "assumes full ownership" with no supported external
//     lifecycle. This module never uses MicVAD (or any higher-level
//     wrapper) at all -- it talks to onnxruntime-web directly, and never
//     holds a reference capable of stopping the real mic.
//   - stop() below only ever closes THIS module's OWN, separate
//     AudioContext (created fresh here, distinct from the existing
//     heuristic's own AudioContext in use-voice-recording.ts) and
//     disconnects THIS module's OWN nodes -- never the shared stream.
//   - Every async boundary (model fetch, WASM instantiation, worklet
//     module load, each per-frame inference call) is wrapped in try/catch;
//     a failure at ANY point degrades to `available: false` / an
//     accumulated diagnostic error, never an unhandled rejection, and
//     never anything the caller needs its own try/catch to survive.
//
// Model contract: see silero-vad-shadow-logic.ts's own doc comment for
// the full, source-verified Silero VAD v5 ONNX input/output/state/context
// specification this file implements against.
//
// Self-hosted assets (CSP connect-src 'self' requires this regardless,
// and it is also strictly better for privacy/offline/reliability -- see
// this round's own report): the ONNX model, onnxruntime-web's WASM
// runtime, and the AudioWorklet processor module all live under
// /public/vad-models/, fetched same-origin, never from a CDN.
//
// No COOP/COEP, no WASM threading (this round's own explicit constraint):
// `ort.env.wasm.numThreads = 1` is set before any session is created --
// per onnxruntime-web's own documented behavior (confirmed via its
// GitHub issue tracker, not assumed), numThreads=1 runs the WASM backend
// fully single-threaded and never touches SharedArrayBuffer, so it never
// requires `self.crossOriginIsolated` -- multi-threading (which WOULD
// require it) is only ever entered when numThreads > 1 AND the browser
// supports it AND crossOriginIsolated is already true. Leaving
// numThreads at 1 here means this feature works identically whether or
// not this app ever adds COEP in a later phase.

import {
  advanceSileroRecurrentState,
  buildSileroModelInput,
  createSileroRecurrentState,
  initSileroShadowDiagnostics,
  recordSileroFrameError,
  recordSileroFrameResult,
  SILERO_FRAME_SAMPLES,
  SILERO_SAMPLE_RATE_HZ,
  SILERO_STATE_LENGTH,
  type SileroRecurrentState,
  type SileroShadowDiagnosticsState,
} from "./silero-vad-shadow-logic";

const MODEL_NAME = "silero-vad";
const MODEL_VERSION = "v5";
const ASSET_BASE_PATH = "/vad-models/";
const ONNX_MODEL_URL = `${ASSET_BASE_PATH}silero_vad_v5.onnx`;
const WORKLET_MODULE_URL = `${ASSET_BASE_PATH}silero-frame-worklet.js`;
const WORKLET_PROCESSOR_NAME = "silero-frame-worklet-processor";

export interface SileroShadowModelInfo {
  available: boolean;
  name: string;
  version: string;
  // Wall-clock time for onnxruntime-web module init + WASM instantiation
  // + ONNX session creation combined -- null only when setup never got
  // far enough to measure it (e.g. audio graph itself failed before
  // model loading was even attempted), never a fabricated 0.
  loadMs: number | null;
  // Bounded, sanitized (see sanitizeErrorMessage below) -- never a raw
  // provider/browser error object, matching this app's existing
  // provider-error-message convention (voice-latency-telemetry-logic.ts).
  error: string | null;
}

export interface SileroShadowHandle {
  // Returns a POINT-IN-TIME snapshot -- safe to call repeatedly (e.g.
  // once when the real recording stops) without affecting the running
  // accumulation.
  getDiagnostics(): SileroShadowDiagnosticsState;
  getModelInfo(): SileroShadowModelInfo;
  // Idempotent -- safe to call more than once (mirrors vadCleanupRef's
  // own contract in use-voice-recording.ts). Never touches the shared
  // MediaStream passed into startSileroVadShadow (see this module's own
  // doc comment on stream safety).
  stop(): void;
}

const MAX_ERROR_MESSAGE_LENGTH = 300;

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.length > MAX_ERROR_MESSAGE_LENGTH ? `${raw.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...` : raw;
}

function resolveAudioContextConstructor(): (new (options?: { sampleRate?: number }) => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & { webkitAudioContext?: new (options?: { sampleRate?: number }) => AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

// A no-op stand-in returned whenever setup fails at any point -- callers
// (use-voice-recording.ts) can treat every return value from
// startSileroVadShadow identically, never needing to branch on "did setup
// actually succeed" before calling getDiagnostics()/getModelInfo()/stop().
function unavailableHandle(modelInfo: SileroShadowModelInfo): SileroShadowHandle {
  const diagnostics = initSileroShadowDiagnostics();
  return {
    getDiagnostics: () => diagnostics,
    getModelInfo: () => modelInfo,
    stop: () => {},
  };
}

// Lazily imported ONLY from here (never at this module's own top level),
// so onnxruntime-web's JS (and, transitively, its WASM/model fetches) is
// never even requested until a recording actually starts -- see this
// round's own report for the measured bundle/asset impact this keeps out
// of the initial page load.
async function loadOnnxRuntime() {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.wasmPaths = {
    wasm: `${ASSET_BASE_PATH}ort-wasm-simd-threaded.wasm`,
    mjs: `${ASSET_BASE_PATH}ort-wasm-simd-threaded.mjs`,
  };
  // This round's own explicit constraint: single-threaded WASM only, so
  // this feature never depends on (or requires adding) COOP/COEP -- see
  // this module's own doc comment above for the verified reasoning.
  ort.env.wasm.numThreads = 1;
  return ort;
}

// Runs one 512-sample frame through the model, updating both the
// recurrent state (silero-vad-shadow-logic.ts) and the diagnostic
// accumulator -- isolated in its own function so the per-frame try/catch
// in the worklet message handler stays small and readable.
async function runOneFrame(
  ort: Awaited<ReturnType<typeof loadOnnxRuntime>>,
  session: import("onnxruntime-web/wasm").InferenceSession,
  recurrent: SileroRecurrentState,
  frame: Float32Array,
): Promise<{ recurrent: SileroRecurrentState; probability: number; inferenceMs: number }> {
  const modelInput = buildSileroModelInput(recurrent, frame);
  const inputTensor = new ort.Tensor("float32", modelInput, [1, modelInput.length]);
  const stateTensor = new ort.Tensor("float32", recurrent.state, [2, 1, recurrent.state.length / 2]);
  const srTensor = new ort.Tensor("int64", BigInt64Array.from([BigInt(SILERO_SAMPLE_RATE_HZ)]), []);

  const startedAt = performance.now();
  const results = await session.run({ input: inputTensor, state: stateTensor, sr: srTensor });
  const inferenceMs = performance.now() - startedAt;

  // Read outputs POSITIONALLY via the session's own declared output
  // order (session.outputNames), exactly mirroring the official
  // reference implementation's own `out, state = ort_outs` positional
  // destructuring -- see silero-vad-shadow-logic.ts's own doc comment.
  // Deliberately does NOT hardcode a guessed output tensor name: the
  // reference implementation itself never names them, only orders them,
  // so matching that order is the faithful, source-verified approach.
  const [probabilityName, stateName] = session.outputNames;
  const probabilityData = results[probabilityName]?.data;
  const stateData = results[stateName]?.data;
  if (!probabilityData || !stateData) {
    throw new Error("Silero VAD ONNX session did not return the expected 2 outputs.");
  }
  const probability = Number(probabilityData[0]);
  const nextState = Float32Array.from(stateData as ArrayLike<number>);
  if (nextState.length !== SILERO_STATE_LENGTH) {
    throw new Error(`Silero VAD output state had unexpected length ${nextState.length}.`);
  }

  return { recurrent: advanceSileroRecurrentState(modelInput, nextState), probability, inferenceMs };
}

// Starts Silero shadow mode on an ALREADY-RUNNING recording's stream.
// Never throws and never rejects -- every failure path returns a handle
// whose getModelInfo().available is false, so the caller (readOnly-style,
// see use-voice-recording.ts) never needs its own try/catch around this
// call specifically (though it still wraps it defensively, matching the
// existing heuristic VAD setup's own belt-and-suspenders style).
export async function startSileroVadShadow(stream: MediaStream): Promise<SileroShadowHandle> {
  const loadStartedAt = performance.now();
  try {
    const AudioContextCtor = resolveAudioContextConstructor();
    if (!AudioContextCtor) {
      return unavailableHandle({
        available: false,
        name: MODEL_NAME,
        version: MODEL_VERSION,
        loadMs: null,
        error: "AudioContext is not available in this browser.",
      });
    }

    const ort = await loadOnnxRuntime();
    const session = await ort.InferenceSession.create(ONNX_MODEL_URL, { executionProviders: ["wasm"] });
    const requiredInputs = ["input", "state", "sr"];
    const missingInputs = requiredInputs.filter((name) => !session.inputNames.includes(name));
    if (missingInputs.length > 0 || session.outputNames.length < 2) {
      throw new Error(
        `Silero VAD ONNX model has an unexpected signature (inputs: ${session.inputNames.join(",")}; outputs: ${session.outputNames.join(",")}).`,
      );
    }

    // A SEPARATE AudioContext from the existing heuristic's own one in
    // use-voice-recording.ts, deliberately constructed at Silero's own
    // required 16kHz -- reuses this app's own already-production-proven
    // pattern (see audio-wav-encode.ts's openAudioContext, shipped and
    // live for STT payload-size optimization) rather than inventing new
    // resampling code: the browser's own audio engine resamples the live
    // mic input to this context's operating rate as a standard part of
    // the Web Audio API, the exact same mechanism already trusted here
    // for the offline decodeAudioData case.
    const audioContext = new AudioContextCtor({ sampleRate: SILERO_SAMPLE_RATE_HZ });
    await audioContext.audioWorklet.addModule(WORKLET_MODULE_URL);

    // READ-ONLY tap -- see this module's own doc comment on stream safety.
    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, WORKLET_PROCESSOR_NAME);
    // A muted destination connection: some browser implementations only
    // reliably keep pulling render quanta through a node that is part of
    // an active path to the destination. gain=0 guarantees this shadow
    // pipeline is never audible, while still keeping frames flowing.
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    source.connect(workletNode);
    workletNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    let recurrent = createSileroRecurrentState();
    let diagnostics = initSileroShadowDiagnostics();
    let stopped = false;

    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (stopped) return;
      const frame = event.data;
      if (!(frame instanceof Float32Array) || frame.length !== SILERO_FRAME_SAMPLES) return;
      void runOneFrame(ort, session, recurrent, frame)
        .then((result) => {
          if (stopped) return;
          recurrent = result.recurrent;
          diagnostics = recordSileroFrameResult(diagnostics, result.probability, result.inferenceMs);
        })
        .catch((error: unknown) => {
          if (stopped) return;
          diagnostics = recordSileroFrameError(diagnostics, sanitizeErrorMessage(error));
        });
    };

    const loadMs = performance.now() - loadStartedAt;
    const modelInfo: SileroShadowModelInfo = { available: true, name: MODEL_NAME, version: MODEL_VERSION, loadMs, error: null };

    return {
      getDiagnostics: () => diagnostics,
      getModelInfo: () => modelInfo,
      stop: () => {
        if (stopped) return;
        stopped = true;
        workletNode.port.onmessage = null;
        try {
          source.disconnect();
          workletNode.disconnect();
          silentGain.disconnect();
        } catch {
          // Disconnecting an already-torn-down node throws in some
          // browsers -- irrelevant here, the graph is being discarded
          // either way.
        }
        // Closes ONLY this module's own dedicated AudioContext -- never
        // the shared MediaStream/its tracks (see this module's own doc
        // comment on stream safety; createMediaStreamSource never took
        // ownership of `stream` in the first place).
        void audioContext.close().catch(() => {});
        void session.release?.().catch(() => {});
      },
    };
  } catch (error) {
    return unavailableHandle({
      available: false,
      name: MODEL_NAME,
      version: MODEL_VERSION,
      loadMs: performance.now() - loadStartedAt,
      error: sanitizeErrorMessage(error),
    });
  }
}
