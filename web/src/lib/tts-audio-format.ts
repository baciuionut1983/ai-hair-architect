// Gemini's native TTS returns raw, headerless PCM audio (its documented
// mimeType is of the form "audio/L16;rate=24000" -- 16-bit signed linear
// PCM at the given sample rate) inside inlineData.data. A browser's
// <audio>/Audio element cannot play raw PCM directly -- it needs a real
// container. WAV is the simplest correct one: a fixed 44-byte header in
// front of the exact same PCM bytes, no re-encoding, no external
// dependency. Kept as pure functions (no I/O, no SDK types) so this is
// unit-testable without mocking the Gemini client at all.

const WAV_HEADER_BYTES = 44;
const DEFAULT_SAMPLE_RATE_HZ = 24000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_FORMAT_CODE = 1; // 1 = integer PCM, per the WAV/RIFF spec

// Parses the sample rate out of a Gemini-style mimeType string
// ("audio/L16;rate=24000", "audio/L16;codec=pcm;rate=48000"). Falls back
// to the documented default (24000 Hz) for any mimeType that doesn't
// carry a rate parameter -- never throws on an unexpected/missing value,
// since a wrong sample rate would only make the resulting audio play at
// the wrong pitch/speed, not fail outright, and a real Gemini response
// with no rate parameter is not a case worth hard-failing the whole reply
// over.
export function parseSampleRateFromMimeType(mimeType: string | undefined, fallback: number = DEFAULT_SAMPLE_RATE_HZ): number {
  if (!mimeType) return fallback;
  const match = /rate=(\d+)/.exec(mimeType);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Prepends a standard 44-byte PCM WAV header to raw PCM bytes. Mono,
// 16-bit signed, little-endian -- exactly what Gemini's TTS models emit
// (see the module doc comment above) -- so this never has to branch on
// channel count or bit depth.
export function wrapPcmAsWav(pcm: Buffer, sampleRateHz: number = DEFAULT_SAMPLE_RATE_HZ): Buffer {
  const byteRate = sampleRateHz * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const blockAlign = PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const dataSize = pcm.length;

  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size for PCM
  header.writeUInt16LE(PCM_FORMAT_CODE, 20);
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
