import { describe, expect, it } from "vitest";

import { convertInt16PcmToFloat32, createGaplessPcmStreamPlayer } from "./tts-streaming-playback-logic";

// createGaplessPcmStreamPlayer's real scheduling against a genuine Web
// Audio graph is deliberately NOT tested here -- this app's vitest config
// runs with environment: "node" (see vitest.config.ts), which provides no
// real AudioContext/createBuffer/createBufferSource at all, and
// fabricating a fake one to verify actual audio output would only test the
// fake, not real playback. convertInt16PcmToFloat32 is the pure half that
// can be verified for real, with plain ArrayBuffers and no mocking.
//
// REAL AudioContext-timeline gap measurement (2026-08-26, ADDITIVE): the
// new getAudioTimelineGapMaxMs's own arithmetic (`currentTime > nextStartTime`,
// then `(currentTime - nextStartTime) * 1000`, tracked as a running max) is
// pure, deterministic scheduling-timeline math over a `currentTime` value
// createGaplessPcmStreamPlayer only ever reads, never itself derives from
// real audio hardware -- so a minimal fake AudioContext exposing just a
// controllable `currentTime` plus bare-bones createBuffer/createBufferSource
// stubs (never asserted on, never producing real sound) is enough to
// exercise this exact arithmetic for real, without claiming to test real
// Web Audio playback at all.
function createFakeAudioContext(initialCurrentTimeSeconds: number): AudioContext & { advanceBySeconds: (seconds: number) => void } {
  let currentTime = initialCurrentTimeSeconds;
  return {
    get currentTime() {
      return currentTime;
    },
    advanceBySeconds(seconds: number) {
      currentTime += seconds;
    },
    destination: {},
    createBuffer(_channels: number, length: number, sampleRate: number) {
      const channelData = new Float32Array(length);
      return {
        duration: length / sampleRate,
        getChannelData: () => channelData,
      };
    },
    createBufferSource() {
      return {
        buffer: null,
        connect: () => {},
        start: () => {},
      };
    },
  } as unknown as AudioContext & { advanceBySeconds: (seconds: number) => void };
}

function pcmChunkOfSampleCount(sampleCount: number): ArrayBuffer {
  return new ArrayBuffer(sampleCount * 2);
}

function pcmBufferFromInt16Samples(samples: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return buffer;
}

describe("convertInt16PcmToFloat32", () => {
  it("converts a known fixed set of Int16 sample values to the expected Float32 range", () => {
    const samples = [0, 32767, -32768, 16384, -16384];
    const pcm = pcmBufferFromInt16Samples(samples);

    const floatSamples = convertInt16PcmToFloat32(pcm);

    expect(floatSamples[0]).toBeCloseTo(0, 5);
    expect(floatSamples[1]).toBeCloseTo(32767 / 32768, 5);
    expect(floatSamples[2]).toBeCloseTo(-1, 5);
    expect(floatSamples[3]).toBeCloseTo(0.5, 5);
    expect(floatSamples[4]).toBeCloseTo(-0.5, 5);
  });

  it("reads little-endian 16-bit samples, matching Gemini's documented PCM byte order", () => {
    // 0x0100 = 256 as a 16-bit value; little-endian bytes are [0x00, 0x01].
    const buffer = new ArrayBuffer(2);
    new Uint8Array(buffer).set([0x00, 0x01]);

    const [sample] = convertInt16PcmToFloat32(buffer);

    expect(sample).toBeCloseTo(256 / 32768, 5);
  });

  it("returns an output length matching the input sample count (byteLength / 2)", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7];
    const pcm = pcmBufferFromInt16Samples(samples);

    const floatSamples = convertInt16PcmToFloat32(pcm);

    expect(floatSamples.length).toBe(pcm.byteLength / 2);
    expect(floatSamples.length).toBe(samples.length);
  });

  it("handles an empty buffer as zero samples, never throwing", () => {
    const floatSamples = convertInt16PcmToFloat32(new ArrayBuffer(0));
    expect(floatSamples.length).toBe(0);
  });
});

// REAL AudioContext-timeline gap measurement (2026-08-26, ADDITIVE): see
// GaplessPcmStreamPlayer.getAudioTimelineGapMaxMs's own doc comment for
// exactly what this measures and why it's a strictly more honest signal
// than a network-timing proxy. sampleRateHz is deliberately 1000 in every
// test below (not the real 24000 STREAMING_SAMPLE_RATE_HZ) purely so a
// chunk's own duration is trivial to reason about: N samples = N
// milliseconds of audio, given the fake createBuffer above computes
// duration as length / sampleRate.
describe("createGaplessPcmStreamPlayer -- getAudioTimelineGapMaxMs (real AudioContext-timeline gap)", () => {
  it("is 0 before any chunk has ever been scheduled -- never null, mirroring getScheduledDurationMs's own style", () => {
    const audioContext = createFakeAudioContext(0);
    const player = createGaplessPcmStreamPlayer(audioContext, 1000);

    expect(player.getAudioTimelineGapMaxMs()).toBe(0);
  });

  it("stays 0 when chunks are scheduled back-to-back with no real underrun (currentTime never overtakes nextStartTime)", () => {
    const audioContext = createFakeAudioContext(0);
    const player = createGaplessPcmStreamPlayer(audioContext, 1000);

    // First chunk: 100 samples = 100ms of audio, scheduled at currentTime 0.
    player.scheduleChunk(pcmChunkOfSampleCount(100));
    // Second chunk arrives well within that 100ms window -- no real gap.
    audioContext.advanceBySeconds(0.05);
    player.scheduleChunk(pcmChunkOfSampleCount(100));

    expect(player.getAudioTimelineGapMaxMs()).toBe(0);
  });

  it("records a real gap, in milliseconds, when audioContext.currentTime has genuinely overtaken nextStartTime", () => {
    const audioContext = createFakeAudioContext(0);
    const player = createGaplessPcmStreamPlayer(audioContext, 1000);

    // First chunk: 100 samples = 100ms of audio -- nextStartTime becomes 0.1s.
    player.scheduleChunk(pcmChunkOfSampleCount(100));
    // Simulate a real network stall: currentTime advances to 0.25s, 150ms
    // PAST the 0.1s the previous chunk's audio was scheduled to end at --
    // real, honestly-audible silence played there.
    audioContext.advanceBySeconds(0.25);
    player.scheduleChunk(pcmChunkOfSampleCount(100));

    expect(player.getAudioTimelineGapMaxMs()).toBeCloseTo(150, 5);
  });

  it("tracks the MAX real gap across multiple stalls, never decreasing when a later gap is smaller", () => {
    const audioContext = createFakeAudioContext(0);
    const player = createGaplessPcmStreamPlayer(audioContext, 1000);

    player.scheduleChunk(pcmChunkOfSampleCount(100)); // nextStartTime -> 0.1s
    audioContext.advanceBySeconds(0.25); // currentTime = 0.25s, 150ms past 0.1s
    player.scheduleChunk(pcmChunkOfSampleCount(100)); // nextStartTime -> 0.35s
    expect(player.getAudioTimelineGapMaxMs()).toBeCloseTo(150, 5);

    audioContext.advanceBySeconds(0.12); // currentTime = 0.37s, only 20ms past nextStartTime (0.35s)
    player.scheduleChunk(pcmChunkOfSampleCount(100));
    // The max stays the earlier, larger 150ms gap -- a smaller later gap
    // never overwrites it.
    expect(player.getAudioTimelineGapMaxMs()).toBeCloseTo(150, 5);
  });

  it("does not change scheduleChunk's own existing scheduling behavior -- getScheduledDurationMs still reflects the same nextStartTime math as before this change", () => {
    const audioContext = createFakeAudioContext(0);
    const player = createGaplessPcmStreamPlayer(audioContext, 1000);

    player.scheduleChunk(pcmChunkOfSampleCount(100)); // nextStartTime -> 0.1s
    audioContext.advanceBySeconds(0.25); // real stall recorded on the side
    player.scheduleChunk(pcmChunkOfSampleCount(100)); // startAt clamps to currentTime (0.25s) -> nextStartTime = 0.35s

    // getScheduledDurationMs is completely unaffected by the new gap
    // tracking -- still exactly (nextStartTime - currentTime) * 1000.
    expect(player.getScheduledDurationMs()).toBeCloseTo((0.35 - 0.25) * 1000, 5);
  });

  it("never records a gap for a chunk that arrives on time or early (currentTime <= nextStartTime)", () => {
    const audioContext = createFakeAudioContext(0);
    const player = createGaplessPcmStreamPlayer(audioContext, 1000);

    player.scheduleChunk(pcmChunkOfSampleCount(1000)); // nextStartTime -> 1.0s
    // Next chunk arrives immediately (currentTime still 0s), far earlier
    // than nextStartTime -- no real playback gap, regardless of how far in
    // the future nextStartTime already is.
    player.scheduleChunk(pcmChunkOfSampleCount(100));

    expect(player.getAudioTimelineGapMaxMs()).toBe(0);
  });
});
