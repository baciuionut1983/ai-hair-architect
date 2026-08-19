import { describe, expect, it } from "vitest";

import { isValidWavHeader } from "@/lib/tts-audio-format";

import { encodePcmAsWav, openAudioContext } from "./audio-wav-encode";

function asBuffer(wav: ArrayBuffer): Buffer {
  return Buffer.from(wav);
}

describe("encodePcmAsWav", () => {
  it("produces a header this app's own server-side WAV validator accepts", () => {
    const wav = encodePcmAsWav([new Float32Array([0, 0.5, -0.5, 1, -1])], 24000);
    expect(isValidWavHeader(asBuffer(wav))).toEqual({ valid: true });
  });

  it("embeds the exact sample rate it was given", () => {
    const wav = encodePcmAsWav([new Float32Array([0])], 48000);
    expect(asBuffer(wav).readUInt32LE(24)).toBe(48000);
  });

  it("converts full-scale samples to the correct 16-bit PCM extremes", () => {
    const wav = encodePcmAsWav([new Float32Array([1, -1, 0])], 24000);
    const buffer = asBuffer(wav);
    expect(buffer.readInt16LE(44)).toBe(32767); // +1.0 -> max positive int16
    expect(buffer.readInt16LE(46)).toBe(-32768); // -1.0 -> max negative int16
    expect(buffer.readInt16LE(48)).toBe(0);
  });

  it("clamps out-of-range samples rather than wrapping/overflowing", () => {
    const wav = encodePcmAsWav([new Float32Array([1.5, -1.5])], 24000);
    const buffer = asBuffer(wav);
    expect(buffer.readInt16LE(44)).toBe(32767);
    expect(buffer.readInt16LE(46)).toBe(-32768);
  });

  it("downmixes multi-channel input to mono by averaging", () => {
    // channel 0 is all +1, channel 1 is all -1 -- the average of every
    // frame is exactly 0, regardless of channel count.
    const wav = encodePcmAsWav([new Float32Array([1, 1]), new Float32Array([-1, -1])], 24000);
    const buffer = asBuffer(wav);
    expect(buffer.readInt16LE(44)).toBe(0);
    expect(buffer.readInt16LE(46)).toBe(0);
  });

  it("declares mono, 16-bit PCM in the fmt chunk regardless of input channel count", () => {
    const wav = encodePcmAsWav([new Float32Array([0]), new Float32Array([0])], 24000);
    const buffer = asBuffer(wav);
    expect(buffer.readUInt16LE(22)).toBe(1); // channel count
    expect(buffer.readUInt16LE(34)).toBe(16); // bits per sample
  });
});

// STT payload-size optimization (2026-08-19, Round 7): openAudioContext is
// the fallback-safe half of decodeBlobAsWav's new 16kHz downsampling --
// decodeBlobAsWav itself stays untested DOM glue (this file's own
// long-standing convention, since jsdom does not implement AudioContext
// and vitest.config.ts runs this suite in the "node" environment, where
// `window` itself does not exist), but this pure function accepts the
// constructor directly, so the fallback-on-throw behavior that keeps a
// browser with no 16kHz support fully working is directly demonstrable,
// not just asserted by comment.
describe("openAudioContext", () => {
  class FakeAudioContext {
    sampleRate: number;
    constructor(options?: { sampleRate?: number }) {
      this.sampleRate = options?.sampleRate ?? 44100;
    }
    decodeAudioData(): Promise<never> {
      return Promise.reject(new Error("not used by this test"));
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  }

  class RejectsExplicitSampleRate {
    sampleRate = 48000;
    constructor(options?: { sampleRate?: number }) {
      if (options?.sampleRate !== undefined) {
        throw new Error("Unsupported sample rate.");
      }
    }
    decodeAudioData(): Promise<never> {
      return Promise.reject(new Error("not used by this test"));
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  }

  it("opens at the 16kHz STT target rate when the platform supports it", () => {
    const context = openAudioContext(FakeAudioContext);
    expect(context.sampleRate).toBe(16000);
  });

  it("falls back to the default (native-rate) constructor when 16kHz construction throws", () => {
    const context = openAudioContext(RejectsExplicitSampleRate);
    expect(context.sampleRate).toBe(48000);
  });
});
