import { describe, expect, it } from "vitest";

import { isValidWavHeader, parseSampleRateFromMimeType, wrapPcmAsWav } from "./tts-audio-format";

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

// Playback investigation: a live production test proved cloud TTS
// delivers real audio bytes (HTTP 200, ~801KB received, Blob correctly
// typed audio/wav) but Chrome still refused to play it -- these tests
// verify the actual magic bytes/chunk structure this app produces really
// is a valid, well-formed WAV, the same way a real media parser would
// check it, rather than trusting wrapPcmAsWav's own construction logic
// by assumption. (The live investigation's actual root cause turned out
// to be a missing CSP media-src directive blocking the blob: URL before
// the browser ever got to decode it -- these tests independently confirm
// the bytes themselves were never the problem, closing that off for good.)
describe("isValidWavHeader", () => {
  it("accepts every WAV this app actually produces, across sizes and sample rates", () => {
    for (const [pcmLength, rate] of [[0, 8000], [1, 16000], [2, 22050], [1000, 24000], [1_056_526, 24000]] as const) {
      const wav = wrapPcmAsWav(Buffer.alloc(pcmLength), rate);
      expect(isValidWavHeader(wav)).toEqual({ valid: true });
    }
  });

  it("rejects a buffer too short to even contain a full header", () => {
    expect(isValidWavHeader(Buffer.alloc(10))).toEqual({ valid: false, reason: "too_short_for_header" });
    expect(isValidWavHeader(Buffer.alloc(0))).toEqual({ valid: false, reason: "too_short_for_header" });
  });

  it("rejects raw PCM with no WAV header at all -- the exact failure mode this whole investigation was checking for", () => {
    // Plausible-looking audio-sized data with NO RIFF/WAVE wrapping --
    // if wrapPcmAsWav were ever accidentally skipped, this is what would
    // reach the browser instead.
    const rawPcm = Buffer.alloc(1000, 0x7f);
    expect(isValidWavHeader(rawPcm)).toEqual({ valid: false, reason: "missing_riff_magic" });
  });

  it("rejects a buffer with the RIFF magic bytes corrupted", () => {
    const wav = wrapPcmAsWav(Buffer.from([1, 2, 3, 4]), 24000);
    wav.write("RIFX", 0, "ascii");
    expect(isValidWavHeader(wav)).toEqual({ valid: false, reason: "missing_riff_magic" });
  });

  it("rejects a buffer with the WAVE magic bytes corrupted", () => {
    const wav = wrapPcmAsWav(Buffer.from([1, 2, 3, 4]), 24000);
    wav.write("WAVX", 8, "ascii");
    expect(isValidWavHeader(wav)).toEqual({ valid: false, reason: "missing_wave_magic" });
  });

  it("rejects a buffer missing the 'fmt ' chunk marker", () => {
    const wav = wrapPcmAsWav(Buffer.from([1, 2, 3, 4]), 24000);
    wav.write("xxxx", 12, "ascii");
    expect(isValidWavHeader(wav)).toEqual({ valid: false, reason: "missing_fmt_chunk" });
  });

  it("rejects a buffer missing the 'data' chunk marker", () => {
    const wav = wrapPcmAsWav(Buffer.from([1, 2, 3, 4]), 24000);
    wav.write("xxxx", 36, "ascii");
    expect(isValidWavHeader(wav)).toEqual({ valid: false, reason: "missing_data_chunk" });
  });

  it("rejects a truncated file even with a technically-intact header (declared size larger than actual bytes)", () => {
    const wav = wrapPcmAsWav(Buffer.alloc(1000), 24000);
    const truncated = wav.subarray(0, 500); // header still says 1000 bytes of PCM follow, only 456 do
    const result = isValidWavHeader(truncated);
    expect(result.valid).toBe(false);
    expect(["riff_chunk_size_mismatch", "data_chunk_size_mismatch"]).toContain(result.reason);
  });

  it("rejects a buffer whose declared RIFF chunk size doesn't match its real length", () => {
    const wav = wrapPcmAsWav(Buffer.from([1, 2, 3, 4]), 24000);
    wav.writeUInt32LE(999999, 4);
    expect(isValidWavHeader(wav)).toEqual({ valid: false, reason: "riff_chunk_size_mismatch" });
  });
});
