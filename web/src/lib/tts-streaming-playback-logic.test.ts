import { describe, expect, it } from "vitest";

import { convertInt16PcmToFloat32 } from "./tts-streaming-playback-logic";

// createGaplessPcmStreamPlayer is deliberately NOT tested here -- this
// app's vitest config runs with environment: "node" (see vitest.config.ts),
// which provides no real AudioContext/createBuffer/createBufferSource at
// all, and fabricating a fake one would only test the fake, not the real
// scheduling logic. convertInt16PcmToFloat32 is the pure half that can be
// verified for real, with plain ArrayBuffers and no mocking.

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
