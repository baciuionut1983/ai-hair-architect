// VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: a minimal
// AudioWorkletProcessor whose ONLY job is to slice the continuous,
// gapless audio stream on a DEDICATED 16kHz AudioContext (see
// silero-vad-shadow.ts's own doc comment for why a separate context, not
// the existing heuristic's AnalyserNode-polling loop, is required here --
// Silero is a STATEFUL/recurrent model and needs a truly continuous
// sample stream, not periodic disjoint snapshots) into fixed 512-sample
// (32ms @ 16kHz) chunks, exactly the frame size Silero VAD v5's own ONNX
// contract requires (see the official snakers4/silero-vad reference
// implementation, utils_vad.py's OnnxWrapper.__call__).
//
// Deliberately does nothing else: no model inference (ONNX Runtime cannot
// run inside an AudioWorkletGlobalScope in a browser-portable way; this
// worklet's only job is gapless framing), no decision logic, no reference
// to any MediaStream/track -- process() only ever receives the raw
// Float32 samples the browser's own audio graph feeds it. This file is
// plain JS (not TypeScript) and lives under /public because
// AudioWorkletGlobalScope module loading (audioContext.audioWorklet.
// addModule(url)) requires a plain, separately-fetchable script URL, not
// a bundler-processed import -- the same self-hosting/asset-serving
// approach already used for the ONNX model and onnxruntime-web's own WASM
// files in this same directory (see this round's own report for why: CSP
// connect-src 'self' already requires self-hosting regardless).
const FRAME_SAMPLES = 512;

class SileroFrameWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(FRAME_SAMPLES);
    this._bufferedCount = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel || channel.length === 0) {
      // No input yet (e.g. the very first render quantum before the
      // graph is fully connected) -- keep the node alive, do nothing.
      return true;
    }
    let offset = 0;
    while (offset < channel.length) {
      const spaceLeft = FRAME_SAMPLES - this._bufferedCount;
      const toCopy = Math.min(spaceLeft, channel.length - offset);
      this._buffer.set(channel.subarray(offset, offset + toCopy), this._bufferedCount);
      this._bufferedCount += toCopy;
      offset += toCopy;
      if (this._bufferedCount === FRAME_SAMPLES) {
        // Transfers a COPY (postMessage structured-clones a fresh
        // Float32Array each time, not a reference into this._buffer) --
        // this._buffer is immediately reused for the next frame, so the
        // main thread must never see it mutate out from under it.
        this.port.postMessage(this._buffer.slice(0));
        this._bufferedCount = 0;
      }
    }
    // Returning true keeps this processor node alive for the lifetime of
    // the audio graph -- the caller's own cleanup (closing the dedicated
    // AudioContext) is what actually stops this from running, exactly
    // mirroring how the existing heuristic's setInterval is torn down via
    // vadCleanupRef in use-voice-recording.ts.
    return true;
  }
}

registerProcessor("silero-frame-worklet-processor", SileroFrameWorkletProcessor);
