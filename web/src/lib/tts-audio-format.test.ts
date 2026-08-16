import { describe, expect, it } from "vitest";

import { parseSampleRateFromMimeType, wrapPcmAsWav } from "./tts-audio-format";

describe("parseSampleRateFromMimeType", () => {
  it("extracts the rate parameter from a Gemini-style mimeType", () => {
    expect(parseSampleRateFromMimeType("audio/L16;rate=24000")).toBe(24000);
    expect(parseSampleRateFromMimeType("audio/L16;codec=pcm;rate=48000")).toBe(48000);
  });

  it("falls back to 24000 for an undefined or rate-less mimeType", () => {
    expect(parseSampleRateFromMimeType(undefined)).toBe(24000);
    expect(parseSampleRateFromMimeType("audio/L16")).toBe(24000);
    expect(parseSampleRateFromMimeType("")).toBe(24000);
  });

  it("uses the given fallback, not always 24000", () => {
    expect(parseSampleRateFromMimeType(undefined, 16000)).toBe(16000);
  });

  it("never throws on a malformed rate value", () => {
    expect(parseSampleRateFromMimeType("audio/L16;rate=notanumber")).toBe(24000);
  });
});

describe("wrapPcmAsWav", () => {
  it("prepends exactly a 44-byte RIFF/WAVE header", () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const wav = wrapPcmAsWav(pcm, 24000);
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.subarray(12, 16).toString("ascii")).toBe("fmt ");
    expect(wav.subarray(36, 40).toString("ascii")).toBe("data");
  });

  it("preserves the exact original PCM bytes unmodified after the header", () => {
    const pcm = Buffer.from([10, 20, 30, 40, 50]);
    const wav = wrapPcmAsWav(pcm, 24000);
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it("writes the given sample rate into the header, not a hardcoded one", () => {
    const pcm = Buffer.from([0, 0]);
    const wav16k = wrapPcmAsWav(pcm, 16000);
    const wav48k = wrapPcmAsWav(pcm, 48000);
    expect(wav16k.readUInt32LE(24)).toBe(16000);
    expect(wav48k.readUInt32LE(24)).toBe(48000);
  });

  it("declares mono, 16-bit PCM in the fmt chunk", () => {
    const wav = wrapPcmAsWav(Buffer.from([0, 0]), 24000);
    expect(wav.readUInt16LE(20)).toBe(1); // PCM format code
    expect(wav.readUInt16LE(22)).toBe(1); // channels = mono
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
  });

  it("declares the correct data chunk size for the given PCM length", () => {
    const pcm = Buffer.alloc(1000);
    const wav = wrapPcmAsWav(pcm, 24000);
    expect(wav.readUInt32LE(40)).toBe(1000);
    expect(wav.readUInt32LE(4)).toBe(36 + 1000); // RIFF chunk size
  });

  it("defaults to 24000 Hz when no sample rate is given", () => {
    const wav = wrapPcmAsWav(Buffer.from([0, 0]));
    expect(wav.readUInt32LE(24)).toBe(24000);
  });
});
