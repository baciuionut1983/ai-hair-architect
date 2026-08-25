// Client-side (browser) PCM streaming playback for TRUE Gemini TTS
// streaming (see tts-provider-gemini-streaming.ts's own module doc
// comment for the architecture this exists to prove: streaming vs.
// buffer-then-play, not a model swap). Split, deliberately, the same way
// this codebase already splits pure logic from DOM/API-touching code
// elsewhere (e.g. voice-latency-logic.ts): convertInt16PcmToFloat32 below
// is pure arithmetic over an ArrayBuffer, with NO Web Audio API calls at
// all -- fully unit-testable with plain ArrayBuffers, no AudioContext
// mocking required (this app's vitest environment is "node", which has no
// real AudioContext at all -- see this file's own .test.ts for why only
// this function is unit-tested here). createGaplessPcmStreamPlayer is the
// thin, real-AudioContext-backed scheduler built on top of it.

// Gemini's native TTS streams raw, headerless 16-bit signed little-endian
// PCM audio chunks (see tts-audio-format.ts's own identical note for the
// non-streaming path) -- the Web Audio API needs those samples as a
// Float32Array in the range [-1, 1], never raw Int16 bytes directly.
// Reads via DataView.getInt16(offset, true) (little-endian, matching
// Gemini's documented PCM byte order) rather than an Int16Array view, so
// this works correctly regardless of the input ArrayBuffer's own
// alignment.
export function convertInt16PcmToFloat32(pcm: ArrayBuffer): Float32Array {
  const view = new DataView(pcm);
  const sampleCount = Math.floor(pcm.byteLength / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

export interface GaplessPcmStreamPlayer {
  // Schedules one more chunk of raw Int16 PCM bytes to play immediately
  // after whatever is already scheduled -- never overlapping, never
  // leaving an audible gap between chunks arriving back-to-back.
  scheduleChunk(pcm: ArrayBuffer): void;
  // How much scheduled audio is still queued to play, in milliseconds --
  // approaches 0 as playback catches up to the live edge of what has been
  // scheduled so far.
  getScheduledDurationMs(): number;
}

// Gapless playback of a live PCM chunk stream via the Web Audio API: each
// chunk becomes its own AudioBufferSourceNode, scheduled to start exactly
// when the previous chunk's audio ends (the running nextStartTime
// cursor), rather than at "now" -- which would either overlap (audible
// glitching) or leave a gap (audible stutter) between chunks arriving at
// irregular network intervals.
// `Math.max(nextStartTime, audioContext.currentTime)` is the one piece of
// defensive logic this needs: if a real chunk arrives LATE (network
// jitter genuinely outran playback, so nextStartTime is already in the
// past), scheduling it there anyway would either throw (AudioContext
// rejects start times in the past in some implementations) or, at best,
// produce an inaudible burst dropped by the render quantum boundary --
// clamping to "now" means a real, honestly-audible gap instead of lost
// audio.
export function createGaplessPcmStreamPlayer(audioContext: AudioContext, sampleRateHz: number): GaplessPcmStreamPlayer {
  let nextStartTime = audioContext.currentTime;

  return {
    scheduleChunk(pcm: ArrayBuffer): void {
      const floatSamples = convertInt16PcmToFloat32(pcm);
      const audioBuffer = audioContext.createBuffer(1, floatSamples.length, sampleRateHz);
      audioBuffer.getChannelData(0).set(floatSamples);

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);

      const startAt = Math.max(nextStartTime, audioContext.currentTime);
      source.start(startAt);
      nextStartTime = startAt + audioBuffer.duration;
    },
    getScheduledDurationMs(): number {
      return (nextStartTime - audioContext.currentTime) * 1000;
    },
  };
}
