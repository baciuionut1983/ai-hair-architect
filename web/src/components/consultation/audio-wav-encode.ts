// Root cause of the live "Voice transcription failed" / provider 500
// report: MediaRecorder's own container format on Chrome/Android
// (audio/webm;codecs=opus) is simply not among Gemini's documented
// supported audio input formats for generateContent (wav/mp3/aiff/aac/
// ogg/flac -- confirmed against Google's own audio-understanding docs;
// WebM appears nowhere on that page, not even as an explicitly-rejected
// format). Sending it as inlineData reliably reaches Gemini's servers
// (audio does arrive, the request is well-formed JSON) but fails deep in
// their own audio-decoding pipeline, surfacing as a generic HTTP 500
// rather than a clean 400 -- this is why it looked like a provider outage
// rather than a format mismatch. This is deterministic given the input
// container, not transient: no retry would ever change the outcome.
//
// The fix converts to WAV -- Gemini's simplest documented format --
// client-side, before upload, regardless of which container the
// recording browser actually produced (Chrome/Android's webm/opus,
// Safari's mp4/aac, or anything else): AudioContext.decodeAudioData can
// decode any format the browser's own media engine supports, which is a
// strict superset of what MediaRecorder can produce in every mainstream
// browser. One conversion step fixes every platform uniformly, rather
// than chasing each browser's own MediaRecorder output format
// individually.
//
// Split in two, matching this file's established pure-logic/DOM-glue
// convention (see teach-ai-panel-logic.ts): the actual byte-writing here
// is pure and unit-testable; only decodeBlobAsWav (this file's other
// export) touches AudioContext, which jsdom does not implement.

const WAV_HEADER_BYTES = 44;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_FORMAT_CODE = 1; // 1 = integer PCM, per the WAV/RIFF spec

// Downmixes to mono (channelData.length may be >1) and converts Float32
// samples (the Web Audio API's own native range, -1..1) to 16-bit signed
// PCM, matching this app's server-side WAV writer exactly (see
// tts-audio-format.ts's wrapPcmAsWav) -- same header layout, same mono/
// 16-bit assumption, just written with DataView/ArrayBuffer here instead
// of Node's Buffer, since this runs in the browser.
export function encodePcmAsWav(channelData: Float32Array[], sampleRateHz: number): ArrayBuffer {
  const frameCount = channelData[0]?.length ?? 0;
  const channelCount = channelData.length || 1;

  const byteRate = sampleRateHz * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const blockAlign = PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const dataSize = frameCount * blockAlign;

  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataSize);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, "WAVE");
  writeAsciiString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size for PCM
  view.setUint16(20, PCM_FORMAT_CODE, true);
  view.setUint16(22, PCM_CHANNELS, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, PCM_BITS_PER_SAMPLE, true);
  writeAsciiString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      sum += channelData[channel][frame] ?? 0;
    }
    const monoSample = sum / channelCount;
    const clamped = Math.max(-1, Math.min(1, monoSample));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(WAV_HEADER_BYTES + frame * 2, int16, true);
  }

  return buffer;
}

function writeAsciiString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

export interface AudioContextLike {
  decodeAudioData(data: ArrayBuffer): Promise<{
    sampleRate: number;
    numberOfChannels: number;
    getChannelData(channel: number): Float32Array;
  }>;
  close(): Promise<void>;
}

type AudioContextConstructorLike = new () => AudioContextLike;

function resolveAudioContextConstructor(): AudioContextConstructorLike | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & { webkitAudioContext?: AudioContextConstructorLike };
  return (w.AudioContext as unknown as AudioContextConstructorLike | undefined) ?? w.webkitAudioContext ?? null;
}

// The DOM-dependent half: decodes whatever container the browser actually
// recorded (regardless of which one) and re-encodes it as a WAV Blob.
// Callers (teach-ai-panel-logic.ts's finishRecording) treat a rejection
// here as "conversion unavailable" and fall back to uploading the
// original recording unchanged -- this must never be the ONLY path to a
// working upload, only the fix for the one specific, demonstrated
// container-format failure.
export async function decodeBlobAsWav(blob: Blob): Promise<Blob> {
  const AudioContextCtor = resolveAudioContextConstructor();
  if (!AudioContextCtor) {
    throw new Error("AudioContext is not available in this browser.");
  }

  const audioContext = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer);
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      channels.push(decoded.getChannelData(channel));
    }
    const wav = encodePcmAsWav(channels, decoded.sampleRate);
    return new Blob([wav], { type: "audio/wav" });
  } finally {
    void audioContext.close().catch(() => {});
  }
}
