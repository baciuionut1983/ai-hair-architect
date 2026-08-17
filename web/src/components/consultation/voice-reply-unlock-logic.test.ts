import { describe, expect, it } from "vitest";

import { isValidWavHeader } from "@/lib/tts-audio-format";

import {
  AUDIO_UNLOCK_DATA_URI,
  dataUriToBlob,
  resolveVoiceReplyEnableOutcome,
  VOICE_REPLY_UNLOCK_FAILED_MESSAGE,
} from "./voice-reply-unlock-logic";

describe("AUDIO_UNLOCK_DATA_URI", () => {
  it("is a real, valid, playable WAV clip -- not just an arbitrary base64 string", () => {
    const base64 = AUDIO_UNLOCK_DATA_URI.slice(AUDIO_UNLOCK_DATA_URI.indexOf(",") + 1);
    const bytes = Buffer.from(base64, "base64");
    expect(isValidWavHeader(bytes)).toEqual({ valid: true });
  });

  it("declares the audio/wav MIME type the app's own player expects", () => {
    expect(AUDIO_UNLOCK_DATA_URI.startsWith("data:audio/wav;base64,")).toBe(true);
  });
});

// Regression: this app's own CSP (next.config.ts) is media-src 'self'
// blob: -- it does NOT include data:, so an <audio> element's src can
// never be set to a data: URI directly; it must be converted to a blob:
// URL first (see this file's own module comment on dataUriToBlob).
describe("dataUriToBlob", () => {
  it("decodes the WAV unlock clip back to its exact original bytes", async () => {
    const originalBase64 = AUDIO_UNLOCK_DATA_URI.slice(AUDIO_UNLOCK_DATA_URI.indexOf(",") + 1);
    const originalBytes = Buffer.from(originalBase64, "base64");

    const blob = dataUriToBlob(AUDIO_UNLOCK_DATA_URI);
    const decodedBytes = Buffer.from(await blob.arrayBuffer());

    expect(decodedBytes.equals(originalBytes)).toBe(true);
  });

  it("preserves the declared MIME type on the resulting Blob", () => {
    const blob = dataUriToBlob(AUDIO_UNLOCK_DATA_URI);
    expect(blob.type).toBe("audio/wav");
  });

  it("produces a Blob whose bytes still pass this app's own WAV validator", async () => {
    const blob = dataUriToBlob(AUDIO_UNLOCK_DATA_URI);
    const bytes = Buffer.from(await blob.arrayBuffer());
    expect(isValidWavHeader(bytes)).toEqual({ valid: true });
  });

  it("works for an arbitrary data URI, not just the unlock clip specifically", async () => {
    const blob = dataUriToBlob("data:text/plain;base64,aGVsbG8=");
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("hello");
  });
});

describe("resolveVoiceReplyEnableOutcome", () => {
  it("enables Voice Reply with no message when the unlock attempt succeeded", () => {
    expect(resolveVoiceReplyEnableOutcome(true)).toEqual({ enabled: true, message: null });
  });

  it("never claims Voice Reply is on when the unlock attempt failed", () => {
    const outcome = resolveVoiceReplyEnableOutcome(false);
    expect(outcome.enabled).toBe(false);
    expect(outcome.message).toBe(VOICE_REPLY_UNLOCK_FAILED_MESSAGE);
  });
});
